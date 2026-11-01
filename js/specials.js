// ---------- Special zombies ----------
// Threat unlocks and rolls, screamers, spitters (acid lobs + puddles) and "New threat" banners.
// All numbers are in threats.js; the explosive and armored modifiers are handled in zombies.js.
import * as THREE from 'three';
import { TILE } from './config.js';
import { mr, mri } from './utils.js';
import { scene } from './renderer.js';
import { SH } from './assets.js';
import { ZTYPES, ZMODS, THREAT_BASE, THREAT_POOL, SHUFFLE_INTRO, INTRO_FORCED, SPOT_RANGE } from './threats.js';
import { state, zombies, spits, puddles, dev, players } from './state.js';
import { isBlockedTile, lineOfSight, groundAt } from './grid.js';
import { viewed, crowd, cheats } from './player.js';
import { spawnZombieAt, findSpawnNear, alertZombie, alertNear } from './zombies.js';
import { hurtPlayer } from './combat.js';
import { burst, addRing, animateRings, shake } from './fx.js';
import { queueBanner, toastAll } from './hud.js';
import { emit, nextId } from './host.js';
import { sfx } from './audio.js';

// ---------- Unlocks ----------
// New run: pick the order the pool's threats arrive in, and forget which banners were shown.
export function shuffleThreats(){
  const o = THREAT_POOL.slice();
  if (SHUFFLE_INTRO) for (let i=o.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [o[i], o[j]] = [o[j], o[i]]; }
  state.threatOrder = o; state.seenThreats = new Set();
}
// City 1 has the base threats; city n adds the (n-1)th of the run's order. The newest one is
// forced onto the first few spawns so it reliably shows up.
export function setupThreats(level){
  const intro = state.threatIntro = {};
  for (const id of THREAT_BASE) intro[id] = 1;
  state.threatOrder.slice(0, level-1).forEach((id, i) => intro[id] = i+2);
  const fresh = state.threatOrder[level-2];
  state.forceThreat = fresh ? { id:fresh, n:INTRO_FORCED } : null;
}
const odds = (c, id) => { const l = state.threatIntro[id]; return l ? Math.min(c[2], c[0] + c[1]*(state.level - l)) : 0; };
const countType = id => { let n = 0; for (const z of zombies) if (z.type === id) n++; return n; };
// One type (walker fills whatever odds are left), then each modifier rolls on its own.
export function rollThreat(guard, exclude){
  if (dev.spawn) return { type:dev.spawn.type, mods:Object.assign({}, dev.spawn.mods) };  // dev tools spawn
  let type = 'walker', acc = 0;
  const r = Math.random(), mods = {};
  for (const id in ZTYPES){
    const S = ZTYPES[id]; if (!S.chance || id === exclude) continue;
    acc += odds(S.chance, id);
    if (r < acc){ if (!S.maxAlive || countType(id) < S.maxAlive) type = id; break; }
  }
  for (const id in ZMODS){
    const M = ZMODS[id], bonus = guard && state.threatIntro[id] ? M.guard || 0 : 0;
    if (Math.random() < odds(M.chance, id) + bonus) mods[id] = true;
  }
  const f = state.forceThreat;
  if (f && f.n > 0 && !guard && f.id !== exclude){ f.n--; if (ZTYPES[f.id]) type = f.id; else mods[f.id] = true; }
  return { type, mods };
}

// Line of sight to its player p (see updateZombies), re-checked 5 times a second.
function sees(z, dt, dist, range, p){
  z.losT -= dt;
  if (z.losT <= 0){ z.losT = 0.2; z.los = !!p && !(dev.ignored && cheats(p)) && dist < range && lineOfSight(z.pos.x, z.pos.z, p.pos.x, p.pos.z); }
  return z.los;
}

// ---------- Screamer ----------
// Returns true while rooted in the wind-up. Killing it before the wind-up ends cancels the scream.
// p = the player it's working against (it screams about them).
export function updateScreamer(z, dt, dist, p){
  const S = ZTYPES.screamer;
  if (z.windup > 0){
    z.windup -= dt;
    if (z.windup <= 0) scream(z, z.screamAt);
    return z.windup > 0;
  }
  if (!z.screamed && sees(z, dt, dist, S.sight, p)){ z.windup = S.windup; z.screamAt = p; alertZombie(z, false, p); z.windSnd = sfx.windup(); return true; }
  return false;
}
function scream(z, p){
  const S = ZTYPES.screamer;
  z.screamed = true; z.windup = 0; z.windSnd = null; resetPose(z);
  alertNear(z.pos.x, z.pos.z, S.alertR, p);  // they all learn where that player is
  addRing('mark', 0xffd0d0, z.pos.x, 1.6, z.pos.z, 1, 15.4, 0.6, 0.7);
  sfx.scream(); shake(0.35);
  // During the takeover its spawns count as the takeover's (always alert, never despawn).
  const horde = state.phase === 'takeover', n = Math.round(mri(S.spawn[0], S.spawn[1])*crowd(true));
  for (let i=0;i<n;i++){
    const s = findSpawnNear(z.pos.x, z.pos.z, S.spawnR[0], S.spawnR[1]); if (!s) continue;
    spawnZombieAt(s.x, s.z, horde, true, false, 'screamer');
    burst(new THREE.Vector3(s.x, 0.3, s.z), 'dust', 6, 2.5);
  }
  if (Math.hypot(z.pos.x - viewed().pos.x, z.pos.z - viewed().pos.z) < 40) toastAll('A screamer called more of them', 'bad');
}
export function cancelScream(z){ if (z.windSnd){ z.windSnd(); z.windSnd = null; } z.windup = 0; resetPose(z); }
function resetPose(z){
  const p = z.parts;
  if (p.head){ p.head.scale.set(0.9,1.15,0.9); p.mouth.scale.y = 1; p.headMat.emissive.setHex(0); p.headMat.emissiveIntensity = 1; }
  if (p.sac) p.sac.scale.setScalar(1);
}

// ---------- Spitter ----------
const HOLD = [0, 0, 0], r2 = v => Math.round(v*100)/100;
// Returns [dirX, dirZ, speedMul] while it handles its own spacing, or null to chase normally.
// p = the player it's working against (dx/dz/dist toward them).
export function updateSpitter(z, dt, dist, dx, dz, p){
  const S = ZTYPES.spitter;
  if (!z.alert || !p) return null;
  const los = sees(z, dt, dist, S.sight, p);
  z.spitCd -= dt;
  if (z.spitT > 0){ z.spitT -= dt; if (z.spitT <= 0) lob(z, z.spitAt || p); return HOLD; }
  if (los && z.spitCd <= 0 && dist > 2.5 && dist < S.range[1] + 1){ z.spitT = S.windup; z.spitAt = p; return HOLD; }
  if (!los || dist > S.range[1]) return null;
  if (dist < S.range[0]) return [-dx/dist, -dz/dist, S.backSpeed];
  if (Math.random() < dt*0.4) z.side = -z.side;
  return [-dz/dist*z.side, dx/dist*z.side, 0.35];  // in range: sidestep
}
function lob(z, p){
  const S = ZTYPES.spitter, T = mr(S.flight[0], S.flight[1]);
  z.spitCd = mr(S.cooldown[0], S.cooldown[1]);
  let ex = p.pos.x + p.vel.x*T*S.lead + mr(-S.spread, S.spread), ez = p.pos.z + p.vel.z*T*S.lead + mr(-S.spread, S.spread);
  if (isBlockedTile(Math.floor(ex/TILE), Math.floor(ez/TILE))){ ex = p.pos.x; ez = p.pos.z; }
  const a = z.g.rotation.y, sx = z.pos.x + Math.sin(a)*0.5, sz = z.pos.z + Math.cos(a)*0.5;
  spitMesh(sx, sz, ex, ez, T);
  emit(['spit', r2(sx), r2(sz), r2(ex), r2(ez), T]);
  sfx.spit();
}
// The acid ball in flight plus its landing marker (ghost = a client's copy: it doesn't splash).
export function spitMesh(sx, sz, ex, ez, T, ghost){
  const S = ZTYPES.spitter, g = new THREE.Group(); scene.add(g);
  const ball = new THREE.Mesh(SH.acidGeo, SH.acidMat);
  const ring = new THREE.Mesh(SH.markGeo, SH.markMat), fill = new THREE.Mesh(SH.fireGeo, SH.markFillMat);
  for (const m of [ring, fill]){ m.rotation.x = -Math.PI/2; m.position.set(ex, 0.13, ez); }
  ring.scale.setScalar(S.puddleR); fill.scale.setScalar(0.01);
  g.add(ball, ring, fill);
  spits.push({ mesh:g, ball, ring, fill, sx, sz, ex, ez, t:0, T, ghost });
}
function splash(o){
  const S = ZTYPES.spitter, nid = nextId();
  puddleMesh(o.ex, o.ez, S.puddleTime, nid);
  emit(['hz+', nid, 'acid', r2(o.ex), r2(o.ez), S.puddleTime]);
  burst(new THREE.Vector3(o.ex, 0.3, o.ez), 'acid', 12, 3.5); sfx.splash();
}
export function puddleMesh(x, z, t, nid, ghost){
  const S = ZTYPES.spitter;
  const m = new THREE.Mesh(SH.fireGeo, SH.acidPoolMat); m.rotation.x = -Math.PI/2; m.position.set(x, groundAt(x, z) + 0.11, z); m.scale.setScalar(S.puddleR);  // above slabs and decals, below fire
  scene.add(m); const h = { mesh:m, x, z, t, tick:0, nid, ghost }; puddles.push(h); return h;
}
// Acid in flight and puddles, looks only: clients run this on their copies (ghosts).
export function animateAcid(dt){
  const S = ZTYPES.spitter;
  for (let i=spits.length-1;i>=0;i--){
    const o = spits[i]; o.t += dt;
    const k = Math.min(1, o.t/o.T);
    o.ball.position.set(o.sx + (o.ex-o.sx)*k, 1.5*(1-k) + Math.sin(k*Math.PI)*(2.5 + o.T*2) + 0.15, o.sz + (o.ez-o.sz)*k);
    o.fill.scale.setScalar(Math.max(0.01, k*S.puddleR));
    if (k >= 1){ scene.remove(o.mesh); spits.splice(i,1); if (!o.ghost) splash(o); }
  }
  for (let i=puddles.length-1;i>=0;i--){
    const h = puddles[i]; h.t -= dt;
    h.mesh.scale.setScalar(S.puddleR*Math.max(0.01, Math.min(1, h.t/0.6)) + Math.sin(h.t*7)*0.04);
    if (Math.random() < dt*6) burst(new THREE.Vector3(h.x + mr(-1,1), 0.15, h.z + mr(-1,1)), 'acid', 1, 0.5, true);
    if (h.t <= 0 && h.ghost){ scene.remove(h.mesh); puddles.splice(i,1); }
  }
}

// ---------- Poses ----------
// Wind-up tells, applied after the walk cycle: the screamer's head swells and glows, arms rise,
// mouth gapes; the spitter's acid sac swells as it rears back.
export function poseSpecial(z){
  const p = z.parts;
  if (z.windup > 0){
    const k = 1 - z.windup/ZTYPES.screamer.windup, pulse = 1 + Math.sin(k*42)*0.04*k;
    p.head.scale.set(0.9*(1 + k*0.35)*pulse, 1.15*(1 + k*0.35)*pulse, 0.9*(1 + k*0.35)*pulse);
    p.headMat.emissive.setRGB(1, 0.35 + 0.5*k, 0.25*k); p.headMat.emissiveIntensity = 0.5 + k*2.5;
    p.mouth.scale.y = 1 + k*2.2;
    z.arms[0].rotation.x = z.arms[1].rotation.x = -0.1 - k*1.3;
    z.b.rotation.x = -0.25*k;
  } else if (z.spitT > 0){
    const k = 1 - z.spitT/ZTYPES.spitter.windup;
    p.sac.scale.setScalar(1 + k*0.6); z.b.rotation.x = -0.3*k;
  } else if (p.sac){ p.sac.scale.setScalar(1 + Math.sin(z.phase*1.3)*0.06); z.b.rotation.x = 0; }
  else if (p.head) z.b.rotation.x = 0;
}

// ---------- Per-frame ----------
let spotT = 0;
export function updateSpecials(dt){
  const S = ZTYPES.spitter;
  animateAcid(dt);
  for (let i=puddles.length-1;i>=0;i--){
    const h = puddles[i]; h.tick -= dt;
    if (h.tick <= 0){
      h.tick = 0.25;
      for (const p of players){
        if (p.dead || Math.hypot(p.pos.x - h.x, p.pos.z - h.z) >= S.puddleR + p.radius*0.5) continue;
        hurtPlayer(p, S.puddleDps*0.25, null); if (state.mode !== 'play') return;
      }
    }
    if (h.t <= 0){ scene.remove(h.mesh); puddles.splice(i,1); emit(['hz-', h.nid]); }
  }
  animateRings(dt);
  spotThreats(dt);
}
// "New threat" banner the first time each type/modifier with a tip comes near the player being watched
// (clients run this themselves, for their own screen).
export function spotThreats(dt){
  spotT -= dt; if (spotT > 0) return; spotT = 0.25;
  const v = viewed();
  for (const z of zombies){
    if (Math.hypot(z.pos.x - v.pos.x, z.pos.z - v.pos.z) > SPOT_RANGE) continue;
    for (const id of [z.type, ...Object.keys(z.mods)]){
      const def = ZTYPES[id] || ZMODS[id];
      if (!def.tip || state.seenThreats.has(id)) continue;
      state.seenThreats.add(id);
      queueBanner(`New threat: ${def.name}`, def.tip, 4200);
    }
  }
}
