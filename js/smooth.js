// ---------- Smoothing (snapshot interpolation) ----------
// Positions from another machine arrive in steps (20–30 a second) and at uneven times, while the screen
// draws 60+ frames a second. Drawing each update the moment it lands makes things move in jerks.
// Instead every update carries the sender's clock; we keep a few samples per object and draw them
// DELAY seconds in the past, blending between the two samples around that moment, so the motion is
// as smooth as it was on the sender's screen.
// clock(): one per sender, maps their clock onto ours. track(o, t, x, z, r): add a sample to object
// o (o.trk), at sender time t. at(o, clk, delay): { x, z, r, vx, vz } for now, or null without samples.
const now = () => performance.now()/1000;
const KEEP = 8;  // samples per object (well over DELAY's worth)

// off = best estimate of (their clock − ours); show = the offset actually used for drawing, which only
// eases toward off (playing back at most SLEW faster or slower), so a correction never makes a jump.
const SLEW = 0.05;
export function clock(){ return { off:null, show:null, last:0 }; }
// The fastest packet tells us the offset best; slowly give that up in case the clocks drift apart.
export function syncClock(c, remoteT){
  const o = remoteT - now();
  c.off = c.off === null || o > c.off ? o : c.off - 0.0002;
}
function showTime(c){
  const n = now();
  if (c.show === null || Math.abs(c.off - c.show) > 0.25) c.show = c.off;  // first sample, or a big change: jump
  else { const step = (n - c.last)*SLEW; c.show += Math.max(-step, Math.min(step, c.off - c.show)); }
  c.last = n;
  return n + c.show;
}
export function track(o, t, x, z, r){
  let b = o.trk || (o.trk = []);
  if (b.length && t <= b[b.length - 1].t) return;  // out of order or repeated
  if (b.length && t - b[b.length - 1].t > 0.5) b = o.trk = [];  // back after a gap (out of range): start over, no slide
  b.push({ t, x, z, r });
  if (b.length > KEEP) b.shift();
}
export function resetTrack(o){ o.trk = null; }
// Where o was at (our now − delay) in the sender's time; a little extrapolation past the newest sample
// (up to 0.1 s) covers a late packet, then it holds still.
export function at(o, c, delay){
  const b = o.trk; if (!b || !b.length || c.off === null) return null;
  const t = showTime(c) - delay;
  let i = b.length - 1;
  while (i > 0 && b[i - 1].t >= t) i--;
  const B = b[i], A = i > 0 ? b[i - 1] : null;
  if (!A){ return { x:B.x, z:B.z, r:B.r, vx:0, vz:0 }; }
  const span = B.t - A.t || 1e-3, k = Math.min((t - A.t)/span, 1 + Math.min(0.1, Math.max(0, t - B.t))/span);
  const vx = (B.x - A.x)/span, vz = (B.z - A.z)/span, dr = Math.atan2(Math.sin(B.r - A.r), Math.cos(B.r - A.r));
  if (t >= B.t && t - B.t > 0.1) return { x:B.x + vx*0.1, z:B.z + vz*0.1, r:B.r, vx:0, vz:0 };
  return { x:A.x + (B.x - A.x)*k, z:A.z + (B.z - A.z)*k, r:A.r + dr*Math.min(1, k), vx, vz };
}
