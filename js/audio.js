// ---------- Audio ----------
// Procedural WebAudio SFX; no audio files.
import { mr } from './utils.js';

let actx = null, master = null, noiseBuf = null, muted = false;
export function initAudio(){
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.32; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  } catch(e){ actx = null; }
}
export function toggleMute(){ muted = !muted; }
function sNoise(dur, freq, vol){
  if (!actx || muted) return;
  const t = actx.currentTime, src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  src.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t+dur+0.05);
}
function sTone(f1, f2, dur, type, vol){
  if (!actx || muted) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(20,f2), t+dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t+dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.05);
}
// [noise dur, noise lowpass, noise vol, thump freq, thump vol] per weapon.
const SHOTS = { pistol:[0.14,1900,0.55,180,0.12], shotgun:[0.32,1200,0.8,120,0.2], smg:[0.08,2400,0.36,220,0.07], rifle:[0.42,2800,0.8,140,0.22] };
export const sfx = {
  shot: kind => { const p = SHOTS[kind] || SHOTS.pistol; sNoise(p[0], p[1], p[2]); sTone(p[3], 60, 0.08, 'square', p[4]); },
  hit: () => sTone(140, 60, 0.07, 'sine', 0.25),
  hurt: () => sTone(220, 90, 0.18, 'sawtooth', 0.18),
  crystal: () => { sTone(980, 1300, 0.12, 'sine', 0.12); sTone(1470, 1900, 0.1, 'sine', 0.06); },
  shatter: () => { sNoise(1.2, 5000, 0.5); sTone(520, 60, 1.6, 'sawtooth', 0.18); },
  roar: () => { sTone(80, 45, 2.4, 'sawtooth', 0.25); sNoise(2.0, 400, 0.3); },
  pickup: () => sTone(560, 980, 0.14, 'triangle', 0.2),
  reload: () => { sTone(900, 700, 0.04, 'square', 0.08); setTimeout(() => sTone(700, 900, 0.05, 'square', 0.08), 160); },
  groan: () => sTone(mr(90,130), mr(60,80), mr(0.5,0.9), 'sawtooth', 0.04),
  open: () => { sTone(330, 660, 0.4, 'triangle', 0.18); setTimeout(() => sTone(440, 880, 0.5, 'triangle', 0.18), 220); },
  swing: () => sNoise(0.12, 900, 0.2),
  swap: () => { sTone(500, 400, 0.05, 'square', 0.06); setTimeout(() => sTone(400, 620, 0.05, 'square', 0.06), 120); },
  search: () => sNoise(mr(0.15,0.3), mr(500,900), 0.12),
  loot: () => { sTone(660, 990, 0.08, 'triangle', 0.14); setTimeout(() => sTone(880, 1320, 0.1, 'triangle', 0.12), 90); },
  use: () => sTone(400, 720, 0.14, 'triangle', 0.15),
  craft: () => { sNoise(0.1, 3000, 0.2); setTimeout(() => sNoise(0.1, 2500, 0.2), 140); setTimeout(() => sTone(500, 800, 0.15, 'triangle', 0.15), 300); },
  throw: () => sNoise(0.2, 1200, 0.15),
  ignite: () => { sNoise(0.9, 900, 0.45); sTone(200, 80, 0.5, 'sawtooth', 0.06); },
  beep: () => sTone(1500, 1500, 0.06, 'square', 0.07),
  boom: () => { sNoise(1.4, 600, 0.9); sTone(110, 30, 1.0, 'sine', 0.5); },
  alarm: () => { for (let i=0;i<8;i++) setTimeout(() => sTone(i%2 ? 700 : 950, i%2 ? 700 : 950, 0.26, 'square', 0.07), i*280); }
};
