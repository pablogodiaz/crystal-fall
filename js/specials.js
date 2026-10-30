// ---------- Special zombies ----------
// Threat unlocks and rolls, screamers, spitters (acid lobs + puddles) and "New threat" banners.
// All numbers are in threats.js; the explosive and armored modifiers are handled in zombies.js.
import * as THREE from 'three';
import { TILE } from './config.js';
import { mr, mri } from './utils.js';
import { scene } from './renderer.js';
import { SH } from './assets.js';
import { ZTYPES, ZMODS, THREAT_BASE, THREAT_POOL, SHUFFLE_INTRO, INTRO_FORCED, SPOT_RANGE } from './threats.js';
import { state, zombies, spits, puddles, rings } from './state.js';
import { isBlockedTile, lineOfSight } from './grid.js';
import { player } from './player.js';
import { spawnZombieAt, findSpawnNear, makeNoise } from './zombies.js';
import { hurtPlayer } from './combat.js';
import { burst } from './fx.js';
import { queueBanner, toast } from './hud.js';
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

// Line of sight to the player, re-checked 5 times a second.
function sees(z, dt, dist, range){
  z.losT -= dt;
  if (z.losT <= 0){ z.losT = 0.2; z.los = dist < range && lineOfSight(z.pos.x, z.pos.z, player.pos.x, player.pos.z); }
  return z.los;
}

// ---------- Screamer ----------
// Returns true while rooted in the wind-up. Killing it before the wind-up ends cancels the scream.
export function updateScreamer(z, dt, dist){
  const S = ZTYPES.screamer;
  if (z.windup > 0){
    z.windup -= dt;
    if (z.windup <= 0) scream(z);
    return z.windup > 0;
  }
  if (!z.screamed && sees(z, dt, dist, S.sight)){ z.windup = S.windup; z.alert = true; z.windSnd = sfx.windup(); return true; }
  return false;
}
function scream(z){
  const S = ZTYPES.screamer;
  z.screamed = true; z.windup = 0; z.windSnd = null; resetPose(z);
  makeNoise(z.pos.x, z.pos.z, S.alertR);
  const mat = new THREE.MeshBasicMaterial({ color:0xffd0d0, transparent:true, opacity:0.7, depthWrite:false, side:THREE.DoubleSide });
  const ring = new THREE.Mesh(SH.markGeo, mat); ring.rotation.x = -Math.PI/2; ring.position.set(z.pos.x, 1.6, z.pos.z);
  scene.add(ring); rings.push({ mesh:ring, t:0, T:0.6, r0:1, r1:15.4, op:0.7 });
  sfx.scream(); state.shake = Math.max(state.shake, 0.35);
  // Spawns count toward the horde while it's on, so the road still waits for them.
  const horde = state.phase === 'horde', n = mri(S.spawn[0], S.spawn[1]);
  for (let i=0;i<n;i++){
    const s = findSpawnNear(z.pos.x, z.pos.z, S.spawnR[0], S.spawnR[1]); if (!s) continue;
    spawnZombieAt(s.x, s.z, horde, true, false, 'screamer');
    burst(new THREE.Vector3(s.x, 0.3, s.z), 'dust', 6, 2.5);
  }
  toast('A screamer called more of them', 'bad');
}
export function cancelScream(z){ if (z.windSnd){ z.windSnd(); z.windSnd = null; } z.windup = 0; resetPose(z); }
function resetPose(z){
  const p = z.parts;
  if (p.head){ p.head.scale.set(0.9,1.15,0.9); p.mouth.scale.y = 1; p.headMat.emissive.setHex(0); p.headMat.emissiveIntensity = 1; }
  if (p.sac) p.sac.scale.setScalar(1);
}

// ---------- Spitter ----------
const HOLD = [0, 0, 0];
// Returns [dirX, dirZ, speedMul] while it handles its own spacing, or null to chase normally.
export function updateSpitter(z, dt, dist, dx, dz){
  const S = ZTYPES.spitter;
  if (!z.alert) return null;
  const los = sees(z, dt, dist, S.sight);
  z.spitCd -= dt;
  if (z.spitT > 0){ z.spitT -= dt; if (z.spitT <= 0) lob(z); return HOLD; }
  if (los && z.spitCd <= 0 && dist > 2.5 && dist < S.range[1] + 1){ z.spitT = S.windup; return HOLD; }
  if (!los || dist > S.range[1]) return null;
  if (dist < S.range[0]) return [-dx/dist, -dz/dist, S.backSpeed];
  if (Math.random() < dt*0.4) z.side = -z.side;
  return [-dz/dist*z.side, dx/dist*z.side, 0.35];  // in range: sidestep
}
function lob(z){
  const S = ZTYPES.spitter, T = mr(S.flight[0], S.flight[1]);
  z.spitCd = mr(S.cooldown[0], S.cooldown[1]);
  let ex = player.pos.x + player.vel.x*T*S.lead + mr(-S.spread, S.spread), ez = player.pos.z + player.vel.z*T*S.lead + mr(-S.spread, S.spread);
  if (isBlockedTile(Math.floor(ex/TILE), Math.floor(ez/TILE))){ ex = player.pos.x; ez = player.pos.z; }
  const g = new THREE.Group(); scene.add(g);
  const ball = new THREE.Mesh(SH.acidGeo, SH.acidMat);
  const ring = new THREE.Mesh(SH.markGeo, SH.markMat), fill = new THREE.Mesh(SH.fireGeo, SH.markFillMat);
  for (const m of [ring, fill]){ m.rotation.x = -Math.PI/2; m.position.set(ex, 0.13, ez); }
  ring.scale.setScalar(S.puddleR); fill.scale.setScalar(0.01);
  g.add(ball, ring, fill);
  const a = z.g.rotation.y, sx = z.pos.x + Math.sin(a)*0.5, sz = z.pos.z + Math.cos(a)*0.5;
  spits.push({ mesh:g, ball, ring, fill, sx, sz, ex, ez, t:0, T });
  sfx.spit();
}
function splash(o){
  const S = ZTYPES.spitter;
  const m = new THREE.Mesh(SH.fireGeo, SH.acidPoolMat); m.rotation.x = -Math.PI/2; m.position.set(o.ex, 0.11, o.ez); m.scale.setScalar(S.puddleR);  // above slabs and decals, below fire
  scene.add(m); puddles.push({ mesh:m, x:o.ex, z:o.ez, t:S.puddleTime, tick:0 });
  burst(new THREE.Vector3(o.ex, 0.3, o.ez), 'acid', 12, 3.5); sfx.splash();
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
  for (let i=spits.length-1;i>=0;i--){
    const o = spits[i]; o.t += dt;
    const k = Math.min(1, o.t/o.T);
    o.ball.position.set(o.sx + (o.ex-o.sx)*k, 1.5*(1-k) + Math.sin(k*Math.PI)*(2.5 + o.T*2) + 0.15, o.sz + (o.ez-o.sz)*k);
    o.fill.scale.setScalar(Math.max(0.01, k*S.puddleR));
    if (k >= 1){ scene.remove(o.mesh); spits.splice(i,1); splash(o); }
  }
  for (let i=puddles.length-1;i>=0;i--){
    const h = puddles[i]; h.t -= dt; h.tick -= dt;
    h.mesh.scale.setScalar(S.puddleR*Math.min(1, h.t/0.6) + Math.sin(h.t*7)*0.04);
    if (Math.random() < dt*6) burst(new THREE.Vector3(h.x + mr(-1,1), 0.15, h.z + mr(-1,1)), 'acid', 1, 0.5);
    if (h.tick <= 0){
      h.tick = 0.25;
      if (Math.hypot(player.pos.x - h.x, player.pos.z - h.z) < S.puddleR + player.radius*0.5){ hurtPlayer(S.puddleDps*0.25, null); if (state.mode !== 'play') return; }
    }
    if (h.t <= 0){ scene.remove(h.mesh); puddles.splice(i,1); }
  }
  for (let i=rings.length-1;i>=0;i--){
    // Expanding rings (screams, shockwaves): ease out from r0 to r1 over T s while fading.
    const r = rings[i]; r.t += dt; const k = Math.min(1, r.t/r.T);
    r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0)*(1 - (1-k)**3)); r.mesh.material.opacity = r.op*(1 - k*k);
    if (r.t >= r.T){ scene.remove(r.mesh); r.mesh.material.dispose(); rings.splice(i,1); }
  }
  // "New threat" banner the first time each type/modifier with a tip comes near.
  spotT -= dt; if (spotT > 0) return; spotT = 0.25;
  for (const z of zombies){
    if (Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z) > SPOT_RANGE) continue;
    for (const id of [z.type, ...Object.keys(z.mods)]){
      const def = ZTYPES[id] || ZMODS[id];
      if (!def.tip || state.seenThreats.has(id)) continue;
      state.seenThreats.add(id);
      queueBanner(`New threat: ${def.name}`, def.tip, 4200);
    }
  }
}
