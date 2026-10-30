// ---------- Crystal ----------
// Finding it, its half-HP pulse (city 3+), breaking it, and the takeover's look: violet light,
// the screen wave and the color overlay. The takeover's countdown and spawning are in game.js.
import * as THREE from 'three';
import { $, mr, fmtTime } from './utils.js';
import { scene, camera, setTint } from './renderer.js';
import { SH } from './assets.js';
import { CRYSTAL, AI } from './threats.js';
import { state, world, zombies, rings } from './state.js';
import { reveal } from './grid.js';
import { player } from './player.js';
import { spawnZombieAt, findSpawnNear, alertZombie, alertNear } from './zombies.js';
import { burst } from './fx.js';
import { banner } from './hud.js';
import { sfx } from './audio.js';

export function foundCrystal(){
  state.crystalFound = true;
  reveal(world.city.crystalTile.x, world.city.crystalTile.z, 3);
  banner('The Crystal', 'Shoot it to shatter it, then survive what comes');
}
// Violet ring sweeping out from (x,z) to radius r1 over T s (animated with the other `rings`).
function ring(x, y, z, r1, T, op, geo = SH.markGeo){
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:0xb07cff, transparent:true, opacity:op, depthWrite:false, side:THREE.DoubleSide }));
  m.rotation.x = -Math.PI/2; m.position.set(x, y, z); scene.add(m);
  rings.push({ mesh:m, t:0, T, r0:1, r1, op });
}
// Called after every hit that leaves it standing; lashes out once per city.
export function checkPulse(){
  const cr = world.crystal, C = CRYSTAL;
  if (cr.pulsed || state.level < C.pulseFrom || cr.hp > cr.maxHp*C.pulseAt) return;
  const { x, z } = cr.pos;
  cr.pulsed = true; cr.flash = 0.5;
  alertNear(x, z, C.pulseR);
  ring(x, 1.8, z, 26, 0.9, 0.8); ring(x, 0.14, z, C.pulseR*0.5, 1.4, 0.6, SH.blastRingGeo);
  burst(new THREE.Vector3(x, 2.1, z), 'crystal', 30, 8);
  screenWave(0.9, false);
  sfx.pulse(); state.shake = Math.max(state.shake, 0.5);
  const [b, per, max] = C.pulseSpawn, n = Math.min(max, b + per*(state.level - C.pulseFrom));
  for (let i=0;i<n;i++){
    const s = findSpawnNear(x, z, C.pulseDist[0], C.pulseDist[1]); if (!s) continue;
    spawnZombieAt(s.x, s.z, false, true, false, null, mr(1.1, 2.4));  // staggered: they keep coming up
  }
  banner('The Crystal fights back', 'It pulled the dead up out of the ground', 2400);
}
export function breakCrystal(){
  const cr = world.crystal, C = CRYSTAL, { x, z } = cr.pos;
  cr.alive = false;
  cr.mesh.visible = false;
  for (const s of cr.shards) s.visible = false;
  cr.light.intensity = 0;
  world.mmDirty = true;
  burst(cr.pos.clone(), 'crystal', 40, 7);
  sfx.shatter(); setTimeout(sfx.roar, 500);
  state.shake = 0.8;
  ring(x, 1.8, z, 40, 1.2, 0.8); ring(x, 0.14, z, 110, 2.4, 0.7, SH.blastRingGeo);
  screenWave(1.6, true);
  // Its beam stays up, throbbing, until the takeover ends.
  Object.assign(state, { phase:'takeover', takeover:C.takeover, surge:C.surge[0] + C.surge[1]*(state.level-1), spawnTimer:2.2, tick:10 });
  // Everything nearby joins the takeover and hunts you until it ends.
  for (const o of zombies) if (Math.hypot(o.pos.x - x, o.pos.z - z) < C.breakR) alertZombie(o, true);
  banner('The Crystal takes the city', `Survive ${fmtTime(C.takeover)} until its hold breaks`);
}
// Clock ran out: the light drains away and the takeover's dead become ordinary ones.
export function endTakeover(){
  const cr = world.crystal;
  cr.beam.visible = false; cr.glow.visible = false;
  burst(new THREE.Vector3(cr.pos.x, 1.5, cr.pos.z), 'crystal', 30, 6);
  ring(player.pos.x, 0.14, player.pos.z, 30, 1.4, 0.5, SH.blastRingGeo);
  // The takeover's dead stay where they are and become ordinary residents there.
  for (const z of zombies){
    if (z.tracked && !z.guard){ z.hx = z.pos.x; z.hz = z.pos.z; z.leash = AI.leash; }
    z.horde = false; z.tracked = false;
  }
  state.hordeAlive = 0;
  tint.target = 0;
}

// ---------- Takeover look ----------
// tint.k (0..1) drives the scene's light colors and the #taint overlay (mix-blend-mode: color).
// A wave is a ring sweeping across the screen from the Crystal; with fill, the city turns violet
// behind it.
const tint = { k:0, target:0, wave:null }, cpos = new THREE.Vector3(), css = {};
function screenWave(T, fill){
  tint.wave = { t:0, T, fill };
  if (fill) tint.target = 1;
}
export function resetTakeover(){ tint.k = tint.target = 0; tint.wave = null; setTint(0); }
function setCss(el, prop, v){ const key = el.id + prop; if (css[key] !== v){ css[key] = v; el.style.setProperty(prop, v); } }

export function animateCrystal(dt, t){
  const cr = world.crystal;
  if (cr && cr.alive){
    // Angrier after its pulse: spins faster and burns brighter.
    const angry = cr.pulsed ? 1 : 0;
    cr.mesh.rotation.y += dt*(0.8 + angry*1.4);
    cr.mesh.position.y = 2.1 + Math.sin(t*1.6)*0.15;
    cr.beam.material.opacity = 0.16 + Math.sin(t*(2.2 + angry*3))*0.05 + angry*0.05;
    cr.light.intensity = 2.2 + Math.sin(t*3)*0.4 + (cr.flash > 0 ? 3 : 0) + angry*0.8;
    cr.mat.emissiveIntensity = cr.flash > 0 ? 2.2 : 0.9 + angry*0.6;
    if (cr.flash > 0) cr.flash -= dt;
    const shakeAmt = state.crystalFound ? (1 - cr.hp/cr.maxHp)*0.08 + angry*0.04 : 0;
    cr.mesh.position.x = mr(-shakeAmt, shakeAmt);
  } else if (cr && cr.beam.visible){
    cr.beam.material.opacity = 0.24 + Math.sin(t*5)*0.08;
    cr.glow.material.opacity = 0.35 + Math.sin(t*5)*0.12;
  }
  if (state.mode === 'play' && state.phase === 'takeover' && Math.random() < dt*6)
    burst(new THREE.Vector3(player.pos.x + mr(-14,14), mr(0.3,1.2), player.pos.z + mr(-14,14)), 'crystal', 1, 0.6);  // drifting motes

  tint.k += Math.sign(tint.target - tint.k)*Math.min(Math.abs(tint.target - tint.k), dt/(tint.target > tint.k ? 1.4 : 3));
  setTint(tint.k);
  const w = tint.wave, ov = $('taint'), rim = $('taintWave');
  let o = tint.k*(0.42 + Math.sin(t*1.3)*0.06), r = 9999, ro = 0;
  if (w && cr){
    w.t += dt;
    const p = Math.min(1, w.t/w.T), e = 1 - (1-p)**2;
    cpos.copy(cr.pos).project(camera);
    const x = (cpos.x+1)/2*innerWidth, y = (1-cpos.y)/2*innerHeight;
    const far = Math.max(Math.hypot(x, y), Math.hypot(innerWidth - x, y), Math.hypot(x, innerHeight - y), Math.hypot(innerWidth - x, innerHeight - y)) + 120;
    r = e*far; ro = Math.sqrt(1 - p);
    if (w.fill) o = 0.5;
    setCss(ov, '--x', x.toFixed(0) + 'px'); setCss(ov, '--y', y.toFixed(0) + 'px');
    setCss(rim, '--x', x.toFixed(0) + 'px'); setCss(rim, '--y', y.toFixed(0) + 'px');
    if (p >= 1) tint.wave = null;
  }
  setCss(ov, '--r', r.toFixed(0) + 'px'); setCss(rim, '--r', r.toFixed(0) + 'px');
  setCss(ov, 'opacity', o.toFixed(3)); setCss(rim, 'opacity', ro.toFixed(3));
}
