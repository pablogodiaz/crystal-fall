// ---------- Unique weapons ----------
// Flamethrower and Cryo sprayer (sprayed cones: burning / chilling and freezing), Turncoat flask (thrown;
// zombies in the splash fight their own kind, see the Turned section of zombies.js), Arc caster (chain
// lightning, recharges by itself), Gravity well launcher (orbs that open wells dragging zombies together),
// Railgun (charge + release: a beam through everything in a line and one wall), Crystal shard (ricocheting
// shards, recharged by breaking Crystals; bounces in combat.js) and Guardian drone (flies around you and
// shoots on its own). The bow is a regular gun whose arrows drop (combat.js, loot.js).
// Numbers live with each weapon in WEAPONS (items.js); frozen zombies are in zombies.js. Everything
// here acts for a player p (whoever holds the weapon); their spray/rail/drone timers live on p.
import * as THREE from 'three';
import { TILE } from './config.js';
import { mr } from './utils.js';
import { scene, muzzleLight } from './renderer.js';
import { SH, droneModel } from './assets.js';
import { WEAPONS } from './items.js';
import { state, world, zombies, bullets, players } from './state.js';
import { isOpaqueTile, lineOfSight, resolveCircle } from './grid.js';
import { viewed, pushPlayer } from './player.js';
import { damageZombie, stunZombie, alertZombie, makeNoise, turnZombie, chillZombie } from './zombies.js';
import { hitCrystal, tryReload, offAim, CRYSTAL_R } from './combat.js';
import { weaponStats } from './weapons.js';
import { magSize } from './inventory.js';
import { throwPotion, throwPath } from './throwables.js';
import { burst, shockwave, addDecal } from './fx.js';
import { floatText } from './hud.js';
import { sfx, playSfx } from './audio.js';
import { emit, sfxFor, nextId } from './host.js';
import { muzzle, addBullet } from './combat.js';
import { shake } from './fx.js';

const flames = [], bolts = [], beams = [], orbs = [], wells = [], burning = new Map();
const lvMul = () => 1 + 0.3*(state.level - 1);  // fire scales with the city like molotovs
const targetable = z => !z.dead && !(z.rise > 0) && !(z.turned > 0);
const r2 = v => Math.round(v*100)/100;
export const isBurning = z => burning.has(z);

// Fires p's held unique; false = it can't right now (empty, brewing, recharging) and the caller melees.
export function fireUnique(p, w, dt){
  if (w.id === 'flamer' || w.id === 'cryo') return spray(p, w, dt);
  if (w.id === 'tesla') return fireArc(p, w);
  if (w.id === 'gravity') return fireGravity(p, w);
  if (w.id === 'railgun') return chargeRail(p, w, dt);
  if (w.id === 'shard') return fireShard(p, w);
  if (w.id === 'drone') return toggleDrone(p, w);
  if (w.id === 'potion'){
    if (w.cd > 0) return false;
    if (throwPotion(p)){ w.cd = weaponStats(w).cooldown; w.mag = 0; p.fireCd = 0.4; }
    return true;
  }
  return false;
}
// Brewing and recharging tick for both slots of every player, held or not (the dead's too: they
// come back next city).
export function updateWeaponTimers(dt){
  for (const p of players) for (const w of p.weapons){
    if (!w) continue;
    if (w.id === 'potion' && w.cd > 0){ w.cd = Math.max(0, w.cd - dt); if (!w.cd){ w.mag = 1; floatText('Turncoat flask ready', 'good', p); sfxFor(p, 'brew'); } }
    if (w.id === 'tesla'){ const W = WEAPONS.tesla; w.idle += dt; if (w.idle > W.regenDelay) w.mag = Math.min(magSize(w), w.mag + W.regen*dt); }
    if (w.id === 'drone' && !w.out) w.mag = Math.min(magSize(w), w.mag + WEAPONS.drone.recharge*dt);
    if (!p.ctl.fire) w.latch = false;  // one launch / orb per click
  }
}

// ---------- Flamethrower & Cryo sprayer ----------
// Hold to spray puffs in a cone that stop at walls. Fire hurts and ignites (`burning`), hurts the
// Crystal; frost chills (chillZombie) until zombies freeze solid. Both alert what they touch.
function spray(p, w, dt){
  const W = WEAPONS[w.id], cold = w.id === 'cryo';
  if (w.mag <= 0) return false;
  w.mag = Math.max(0, w.mag - W.use*dt); p.flameT = 0.12;
  const S = weaponStats(w);
  sprayFx(p, w.id, dt, S.range);
  p.flameTick = (p.flameTick || 0) - dt;
  if (p.flameTick <= 0){
    p.flameTick = 0.1;
    const dmg = S.dmg*0.1*lvMul();
    for (const z of zombies.slice()){
      if (!targetable(z)) continue;
      const dx = z.pos.x - p.pos.x, dz = z.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 0.001;
      if (d > S.range + z.r || (d > 1 && offAim(p, dx, dz) > W.cone + z.r/d) || !lineOfSight(p.pos.x, p.pos.z, z.pos.x, z.pos.z)) continue;
      alertZombie(z, false, p);
      if (cold){ if (!(z.frozen > 0)) chillZombie(z, W.chill*0.1); }
      else { ignite(z, p); damageZombie(z, dmg, dx/d*0.12, dz/d*0.12, 'fire', p); }
    }
    const cr = world.crystal;
    if (!cold && cr && cr.alive){
      const dx = cr.pos.x - p.pos.x, dz = cr.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < S.range + CRYSTAL_R && offAim(p, dx, dz) < W.cone + CRYSTAL_R/d) hitCrystal(dmg*0.5);
    }
  }
  p.flameNoise = (p.flameNoise || 0) - dt; if (p.flameNoise <= 0){ p.flameNoise = 0.3; makeNoise(p.pos.x, p.pos.z, S.noise); }
  p.flameSfx = (p.flameSfx || 0) - dt; if (p.flameSfx <= 0){ p.flameSfx = 0.11; cold ? sfx.frost() : sfx.flame(); }
  if (cold && w.mag <= 0) tryReload(p);
  return true;
}
// The spray's look: puffs fly out and grow (fire cools from white-yellow to red, frost from white to
// blue, then smoke / mist) and light the muzzle. Clients draw it for anyone whose snapshot says spraying.
// range = how far the puffs fly (the weapon's, with a range modifier; clients use what they know of it).
export function sprayFx(p, id, dt, range){
  if (!range){ const w = p.weapons[p.cur]; range = w && w.id === id ? weaponStats(w).range : WEAPONS[id].range; }
  const W = WEAPONS[id], cold = id === 'cryo', a0 = p.angle, ux = Math.sin(a0), uz = Math.cos(a0);
  const ox = p.pos.x + ux*1.1, oz = p.pos.z + uz*1.1;
  for (let i=0, n=Math.max(1, Math.round(dt*70)); i<n && flames.length < 220; i++){
    const a = a0 + mr(-W.cone, W.cone)*0.75, sp = mr(10, 13);
    puff(ox, 1.15, oz, Math.sin(a)*sp + p.vel.x*0.5, mr(-0.3, 0.6), Math.cos(a)*sp + p.vel.z*0.5, range/sp*mr(0.8, 1.05),
      cold ? SH.frostMats : SH.flameMats, cold ? SH.mistMat : SH.smokeMat, 4.5);
  }
  muzzleLight.position.set(ox + ux, 1.3, oz + uz); muzzleLight.intensity = Math.max(muzzleLight.intensity, cold ? 1.2 : 2.2);
}
// A short-lived particle (flames, frost, gravity swirl, railgun charge): moves in a straight line for T s,
// stepping through `mats` and ending as `end`; grow = how much it scales up (negative shrinks).
function puff(x, y, z, vx, vy, vz, T, mats, end, grow){
  const m = new THREE.Mesh(SH.partGeo, mats[0]); m.position.set(x, y, z); scene.add(m);
  flames.push({ m, vx, vy, vz, t:0, T, mats, end, grow });
}
function ignite(z, by){ burning.set(z, { t:WEAPONS.flamer.burn, tick:0.25, by }); }
function updateFlames(dt){
  for (let i=flames.length-1;i>=0;i--){
    const f = flames[i], p = f.m.position; f.t += dt;
    const k = f.t/f.T;
    if (k >= 1 || isOpaqueTile(Math.floor(p.x/TILE), Math.floor(p.z/TILE))){
      if (k < 1 && f.mats === SH.flameMats && Math.random() < 0.3) burst(p.clone(), 'fire', 1, 1, true);
      scene.remove(f.m); flames.splice(i,1); continue;
    }
    p.x += f.vx*dt; p.z += f.vz*dt; p.y += f.vy*dt;
    f.m.scale.setScalar(Math.max(0.2, 1 + k*f.grow)); f.m.rotation.set(f.t*7, f.t*5, 0);
    f.m.material = k > 0.85 && f.end ? f.end : f.mats[Math.min(f.mats.length - 1, Math.floor(k*f.mats.length))];
  }
  // Burning zombies keep taking fire damage for a while.
  for (const [z, b] of burning){
    if (z.dead){ burning.delete(z); continue; }
    b.t -= dt; b.tick -= dt;
    if (Math.random() < dt*14) burst(new THREE.Vector3(z.pos.x + mr(-0.3,0.3), mr(0.6,1.6)*z.g.scale.y, z.pos.z + mr(-0.3,0.3)), 'fire', 1, 0.8, true);
    if (b.tick <= 0){ b.tick = 0.25; damageZombie(z, WEAPONS.flamer.burnDps*0.25*lvMul(), 0, 0, 'fire', b.by); }
    if (b.t <= 0) burning.delete(z);
  }
  for (const p of players) if (p.flameT > 0) p.flameT -= dt;
}
// Gas stations refuel it: hold E at a pump. Each station has enough left for one fill.
export function refuel(p, w, l){
  w.mag = magSize(w); l.refueled = true;
  sfxFor(p, 'refuel'); floatText('+ Fuel (full tank)', 'good', p);
}

// ---------- Turncoat flask ----------
// Called by throwables.js when player p's flask lands.
export function splashPotion(p, x, z){
  const W = WEAPONS.potion, fl = p && p.weapons.find(w => w && w.id === 'potion'), S = fl ? weaponStats(fl) : { range:W.radius, noise:W.noise };
  let n = 0;
  for (const o of zombies) if (!o.dead && !(o.rise > 0) && Math.hypot(o.pos.x - x, o.pos.z - z) < S.range + o.r){ turnZombie(o, W.turn); n++; }
  const at = new THREE.Vector3(x, 0.5, z);
  burst(at, 'brew', 22, 5); burst(at, 'spark', 6, 3);
  shockwave(x, z, S.range, 0xff5fd2); addDecal(x, z, S.range*0.6, SH.brewMat);
  sfx.splash(); sfx.brew(); makeNoise(x, z, S.noise);
  floatText(n ? `${n} zombie${n > 1 ? 's' : ''} turned` : 'Nobody in the splash', n ? 'good' : 'dim', p);
}

// ---------- Arc caster ----------
// The bolt goes to the nearest zombie (or the Crystal) in front within range and clear sight, then
// jumps to the nearest zombie not yet hit within `jump`, up to `chain` times, weaker each jump.
function fireArc(p, w){
  const W = WEAPONS.tesla;
  if (w.mag < W.cost) return false;
  const S = weaponStats(w);
  w.mag -= W.cost; w.idle = 0; p.fireCd = S.rate;
  const px = p.pos.x, pz = p.pos.z, ux = Math.sin(p.angle), uz = Math.cos(p.angle);
  const pts = [new THREE.Vector3(px + ux*1.1, 1.25, pz + uz*1.1)];
  let cur = null, best = S.range;
  for (const z of zombies){
    if (!targetable(z)) continue;
    const dx = z.pos.x - px, dz = z.pos.z - pz, d = Math.hypot(dx, dz);
    if (d < best && (d < 1.2 || offAim(p, dx, dz) < W.cone) && lineOfSight(px, pz, z.pos.x, z.pos.z)){ best = d; cur = z; }
  }
  const cr = world.crystal;
  if (cr && cr.alive){
    const dx = cr.pos.x - px, dz = cr.pos.z - pz, d = Math.hypot(dx, dz);
    if (d - CRYSTAL_R < best && offAim(p, dx, dz) < W.cone + 0.2){
      cur = null; hitCrystal(S.dmg*2); pts.push(new THREE.Vector3(cr.pos.x, 1.6, cr.pos.z)); burst(pts[1], 'crystal', 8, 4);
    }
  }
  if (cur){
    const hit = new Set(); let dmg = S.dmg;
    for (let i=0;i<=W.chain && cur;i++){
      hit.add(cur); pts.push(new THREE.Vector3(cur.pos.x, 1.2*cur.g.scale.y, cur.pos.z));
      const prev = pts[pts.length - 2], dx = cur.pos.x - prev.x, dz = cur.pos.z - prev.z, l = Math.hypot(dx, dz) || 1;
      damageZombie(cur, dmg, dx/l*0.5, dz/l*0.5, 'bullet', p); stunZombie(cur, W.stun);
      burst(pts[pts.length - 1], 'spark', 5, 3);
      dmg *= W.fall;
      const from = cur; cur = null; let nd = W.jump;
      for (const z of zombies){
        if (hit.has(z) || !targetable(z)) continue;
        const d = Math.hypot(z.pos.x - from.pos.x, z.pos.z - from.pos.z);
        if (d < nd && lineOfSight(from.pos.x, from.pos.z, z.pos.x, z.pos.z)){ nd = d; cur = z; }
      }
    }
  } else if (pts.length === 1){
    // Nothing in reach: the arc crackles out a few units ahead.
    let s = 0.5; while (s < 4.5 && !isOpaqueTile(Math.floor((px + ux*s)/TILE), Math.floor((pz + uz*s)/TILE))) s += 0.5;
    pts.push(new THREE.Vector3(px + ux*s, 1.1, pz + uz*s)); burst(pts[1], 'spark', 4, 2);
  }
  drawBolt(pts);
  muzzle(pts[0].x, pts[0].z, 3.5);
  sfx.zap(); makeNoise(px, pz, S.noise);
  return true;
}
// A jagged bolt through pts: each link split into a few kinked segments (thin glowing boxes).
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
export function drawBolt(pts){
  if (pts[0].isVector3) emit(['bolt', pts.flatMap(v => [r2(v.x), r2(v.y), r2(v.z)])]);
  else { const v = []; for (let i=0;i<pts.length;i+=3) v.push(new THREE.Vector3(pts[i], pts[i+1], pts[i+2])); pts = v; }
  const meshes = [];
  for (let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i], n = Math.max(2, Math.ceil(a.distanceTo(b)/1.2));
    let prev = a.clone();
    for (let k=1;k<=n;k++){
      const next = k === n ? b.clone() : new THREE.Vector3().lerpVectors(a, b, k/n).add(new THREE.Vector3(mr(-0.35,0.35), mr(-0.25,0.25), mr(-0.35,0.35)));
      for (const [mat, w] of [[SH.boltMat, 1], [SH.boltCoreMat, 0.35]]){
        const m = new THREE.Mesh(SH.boltGeo, mat);
        tmpA.copy(prev).add(next).multiplyScalar(0.5); m.position.copy(tmpA);
        m.lookAt(tmpB.copy(next)); m.scale.set(w, w, prev.distanceTo(next));
        scene.add(m); meshes.push(m);
      }
      prev = next;
    }
  }
  bolts.push({ meshes, t:0.15 });
}
function updateBolts(dt){
  for (let i=bolts.length-1;i>=0;i--){
    const b = bolts[i]; b.t -= dt;
    for (const m of b.meshes) m.visible = b.t > 0.03 || Math.random() < 0.5;
    if (b.t <= 0){ for (const m of b.meshes) scene.remove(m); bolts.splice(i,1); }
  }
}

// A client's copies: puffs, bolts, beams, orbs and wells (all ghosts there), animated every frame.
export function animateUniques(dt){ updateFlames(dt); updateBolts(dt); updateBeams(dt); updateOrbs(dt); updateWells(dt); }
// Every frame in play.
export function updateUniques(dt){
  updateWeaponTimers(dt); updateFlames(dt); updateBolts(dt);
  updateRail(dt); updateBeams(dt); updateOrbs(dt); updateWells(dt); updateDrone(dt);
}
// New city: clear leftover effects.
export function resetUniques(){
  for (const f of flames) scene.remove(f.m); flames.length = 0;
  for (const b of bolts) for (const m of b.meshes) scene.remove(m); bolts.length = 0;
  burning.clear();
  for (const b of beams){ scene.remove(b.g); b.mats.forEach(m => m.dispose()); } beams.length = 0;
  for (const o of orbs) scene.remove(o.m); orbs.length = 0;
  for (const w of wells) scene.remove(w.g); wells.length = 0;
  // Gravity wells are refilled at the start of every city.
  for (const p of players) for (const w of p.weapons) if (w && w.id === 'gravity') w.mag = magSize(w);
}

// ---------- Gravity well launcher ----------
// One orb per click, flying to the cursor (throwPath: max 13 units, short of walls) where it opens a well.
function fireGravity(p, w){
  const W = WEAPONS.gravity;
  if (w.latch) return true;
  if (w.mag < 1) return false;
  w.latch = true; w.mag--; p.fireCd = 0.5;
  const t = throwPath(p), T = Math.max(0.15, Math.hypot(t.ex - t.sx, t.ez - t.sz)/W.speed);
  orbMesh(t.sx, t.sz, t.ex, t.ez, T);
  emit(['orb', r2(t.sx), r2(t.sz), r2(t.ex), r2(t.ez), r2(T)]);
  sfx.orb(); makeNoise(p.pos.x, p.pos.z, weaponStats(w).noise);
  return true;
}
// ghost = a client's copy: flies the same, but opens no well (the host's well arrives as its own event).
export function orbMesh(sx, sz, ex, ez, T, ghost){
  const m = new THREE.Mesh(SH.orbGeo, SH.voidMat); m.position.set(sx, 1.2, sz); scene.add(m);
  orbs.push({ m, sx, sz, ex, ez, t:0, T, ghost });
}
function updateOrbs(dt){
  for (let i=orbs.length-1;i>=0;i--){
    const o = orbs[i]; o.t += dt;
    const k = Math.min(1, o.t/o.T), p = o.m.position;
    p.set(o.sx + (o.ex - o.sx)*k, 1.2, o.sz + (o.ez - o.sz)*k);
    o.m.rotation.y += dt*8; o.m.scale.setScalar(1 + Math.sin(o.t*30)*0.12);
    if (Math.random() < dt*30) puff(p.x, p.y, p.z, mr(-1,1), mr(-0.5,0.5), mr(-1,1), 0.4, SH.gravMats, null, -0.5);
    if (k >= 1){ scene.remove(o.m); orbs.splice(i,1); if (!o.ghost) openWell(o.ex, o.ez); }
  }
}
// The well: a dark core with spinning rings and a violet disc showing its reach. Everything inside is
// dragged toward the middle (faster further out) and kept dazed; its noise draws more in. It pops at the end.
function openWell(x, z){
  const W = WEAPONS.gravity, nid = nextId();
  wellMesh(x, z, W.time, nid);
  emit(['hz+', nid, 'well', r2(x), r2(z), W.time]);
  burst(new THREE.Vector3(x, 1.2, z), 'void', 14, 4); shockwave(x, z, W.radius, 0xa070ff);
  sfx.well(); makeNoise(x, z, 18, true);
}
export function wellMesh(x, z, t, nid, ghost){
  const W = WEAPONS.gravity, g = new THREE.Group(); g.position.set(x, 0, z);
  const core = new THREE.Mesh(SH.orbGeo, SH.voidMat); core.position.y = 1.2; core.scale.setScalar(1.5);
  const r1 = new THREE.Mesh(SH.wellRingGeo, SH.wellRingMat); r1.position.y = 1.2; r1.scale.setScalar(0.8);
  const r2 = new THREE.Mesh(SH.wellRingGeo, SH.wellRingMat); r2.position.y = 1.2; r2.scale.setScalar(1.25);
  const floor = new THREE.Mesh(SH.blastFillGeo, SH.wellFloorMat); floor.rotation.x = -Math.PI/2; floor.position.y = 0.13; floor.scale.setScalar(W.radius);
  const edge = new THREE.Mesh(SH.blastRingGeo, SH.wellRingMat); edge.rotation.x = -Math.PI/2; edge.position.y = 0.135; edge.scale.setScalar(W.radius);
  g.add(core, r1, r2, floor, edge); scene.add(g);
  const w = { g, core, r1, r2, edge, x, z, t, nid, ghost }; wells.push(w); return w;
}
export function removeWell(nid){ const i = wells.findIndex(w => w.nid === nid); if (i >= 0){ scene.remove(wells[i].g); wells.splice(i, 1); } }
function updateWells(dt){
  const W = WEAPONS.gravity;
  for (let i=wells.length-1;i>=0;i--){
    const w = wells[i]; w.t -= dt;
    const life = W.time - w.t;
    w.r1.rotation.set(life*3, life*2, 0); w.r2.rotation.set(-life*2, 0, life*2.5);
    w.core.scale.setScalar(1.5 + Math.sin(life*12)*0.15); w.edge.rotation.z = life;
    for (let n=0;n<2;n++) if (Math.random() < dt*25){
      // Swirl: specks spawned out at the rim drift into the core.
      const a = Math.random()*Math.PI*2, r = mr(0.6, 1)*W.radius, T = mr(0.6, 0.9);
      puff(w.x + Math.sin(a)*r, mr(0.3, 1.8), w.z + Math.cos(a)*r, -Math.sin(a)*r/T, 0, -Math.cos(a)*r/T, T, SH.gravMats, null, -0.6);
    }
    if (w.ghost){ if (w.t <= 0){ scene.remove(w.g); wells.splice(i,1); } continue; }
    for (const z of zombies){
      if (z.dead || z.rise > 0) continue;
      const dx = w.x - z.pos.x, dz = w.z - z.pos.z, d = Math.hypot(dx, dz);
      if (d >= W.radius + z.r) continue;
      stunZombie(z, 0.25);
      if (d > 0.7){ const s = Math.min(d - 0.6, W.pull*(0.35 + 0.65*d/W.radius)*dt); z.pos.x += dx/d*s; z.pos.z += dz/d*s; resolveCircle(z.pos, z.r); }
    }
    if (w.t <= 0){
      for (const z of zombies) if (Math.hypot(z.pos.x - w.x, z.pos.z - w.z) < W.radius + z.r) stunZombie(z, W.stun);
      burst(new THREE.Vector3(w.x, 1.2, w.z), 'void', 24, 7); shockwave(w.x, w.z, W.radius, 0xc8a8ff);
      shake(0.3); sfx.pop();
      scene.remove(w.g); wells.splice(i,1); emit(['hz-', w.nid]);
    }
  }
}

// ---------- Railgun ----------
// Holding the trigger charges it (fire() calls chargeRail every frame); letting go fires once fully
// charged, otherwise the charge fizzles. Swapping away drops the charge. p.railStop stops the hum.
const stopRail = p => { if (p.railStop){ p.railStop(); p.railStop = null; } };
function chargeRail(p, w, dt){
  const T = weaponStats(w).charge;
  if (w.mag < 1) return false;
  if (!(w.charge > 0)){ w.charge = 0; stopRail(p); p.railStop = p === viewed() ? playSfx('charge') : null; }  // clients make their own whine
  w.charge = Math.min(T, w.charge + dt);
  chargeFx(p, w.charge/T, dt);
  return true;
}
// Railgun charge look (k = 0..1): the muzzle brightens while sparks get sucked into it.
export function chargeFx(p, k, dt){
  const ux = Math.sin(p.angle), uz = Math.cos(p.angle), mx = p.pos.x + ux*1.6, mz = p.pos.z + uz*1.6;
  muzzleLight.position.set(mx, 1.3, mz); muzzleLight.intensity = Math.max(muzzleLight.intensity, 0.5 + 2.5*k);
  if (Math.random() < dt*(10 + 40*k)){
    const a = Math.random()*Math.PI*2, r = mr(0.6, 1.2);
    puff(mx + Math.sin(a)*r, 1.2 + mr(-0.5,0.5), mz + Math.cos(a)*r, -Math.sin(a)*r/0.25, 0, -Math.cos(a)*r/0.25, 0.25, SH.frostMats, null, -0.7);
  }
}
function updateRail(dt){
  for (const p of players){
    const cur = p.weapons[p.cur];
    for (const w of p.weapons){
      if (!w || w.id !== 'railgun' || !(w.charge > 0)) continue;
      if (w !== cur || p.dead){ w.charge = 0; stopRail(p); }
      else if (!p.ctl.fire){
        if (w.charge >= weaponStats(w).charge - 1e-6){ p.railStop = null; fireRail(p, w); } else stopRail(p);
        w.charge = 0;
      }
    }
  }
}
// The beam: through everything along the line, crossing the first wall it meets and stopping at the second.
function fireRail(p, w){
  const W = WEAPONS.railgun, S = weaponStats(w);
  w.mag--; p.fireCd = 0.35;
  const px = p.pos.x, pz = p.pos.z, ux = Math.sin(p.angle), uz = Math.cos(p.angle);
  let wall = 0, end = S.range;
  for (let s=0.9;s<S.range;s+=0.2){
    const op = isOpaqueTile(Math.floor((px + ux*s)/TILE), Math.floor((pz + uz*s)/TILE));
    if (op && !wall) wall = 1;
    else if (!op && wall === 1){ wall = 2; burst(new THREE.Vector3(px + ux*s, 1.2, pz + uz*s), 'spark', 8, 4); }
    else if (op && wall === 2){ end = s; break; }
  }
  const onBeam = (x, z, r) => { const rx = x - px, rz = z - pz, t = rx*ux + rz*uz; return t > 0.3 && t < end && Math.abs(rx*uz - rz*ux) < r; };
  for (const z of zombies.slice()){
    if (!targetable(z) || !onBeam(z.pos.x, z.pos.z, z.r + 0.35)) continue;
    burst(new THREE.Vector3(z.pos.x, 1.2, z.pos.z), 'spark', 6, 4);
    damageZombie(z, S.dmg, ux*W.kb*S.kb, uz*W.kb*S.kb, 'rail', p);
  }
  const cr = world.crystal;
  if (cr && cr.alive && onBeam(cr.pos.x, cr.pos.z, CRYSTAL_R + 0.3)){ hitCrystal(S.dmg); burst(new THREE.Vector3(cr.pos.x, 1.4, cr.pos.z), 'crystal', 10, 5); }
  beamFx(px, pz, p.angle, end);
  emit(['beam', r2(px), r2(pz), Math.round(p.angle*1000)/1000, r2(end)]);
  burst(new THREE.Vector3(px + ux*end, 1.2, pz + uz*end), 'spark', 10, 5);
  muzzle(px + ux*1.6, pz + uz*1.6, 6);
  shake(0.35, p);
  pushPlayer(p, -ux*4, -uz*4);  // recoil
  sfx.rail(); makeNoise(px, pz, S.noise);
  if (w.mag <= 0) tryReload(p);
}
// A thick glowing beam with a white core from (px,pz) heading a, `end` units long, fading out.
export function beamFx(px, pz, a, end){
  const g = new THREE.Group(), mats = [];
  for (const [color, w0] of [[0x6ad0ff, 3.4], [0xffffff, 1.2]]){
    const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending, depthWrite:false });
    const m = new THREE.Mesh(SH.boltGeo, mat); m.scale.set(w0, w0, end - 0.9); m.position.z = (end + 0.9)/2; g.add(m); mats.push(mat);
  }
  g.position.set(px, 1.2, pz); g.rotation.y = a; scene.add(g);
  beams.push({ g, mats, t:0, T:0.45 });
}
function updateBeams(dt){
  for (let i=beams.length-1;i>=0;i--){
    const b = beams[i]; b.t += dt;
    const k = b.t/b.T;
    b.mats.forEach(m => m.opacity = 0.9*(1 - k)); b.g.children.forEach(m => { m.scale.x = m.scale.y = (m === b.g.children[0] ? 3.4 : 1.2)*(1 - k*0.7); });
    if (k >= 1){ scene.remove(b.g); b.mats.forEach(m => m.dispose()); beams.splice(i,1); }
  }
}

// ---------- Crystal shard ----------
// Shards are bullets with `bounce` (ricochets in updateBullets). Only breaking a Crystal recharges them.
function fireShard(p, w){
  const W = WEAPONS.shard, S = weaponStats(w);
  if (w.mag < 1) return false;
  w.mag--; p.fireCd = S.rate;
  // A fan of shards (more with a pellets modifier), one charge per shot.
  const n = S.pellets;
  for (let i=0;i<n;i++){
    const a = p.angle + (i - (n-1)/2)*S.spread + mr(-S.jitter, S.jitter);
    addBullet('shard', p.pos.x + Math.sin(a)*0.9, 1.15, p.pos.z + Math.cos(a)*0.9, a, W.speed*mr(0.95,1.05), S.life, { damage:S.dmg, pierce:S.pierce, kb:1, bounce:W.bounce, owner:p });
  }
  muzzle(p.pos.x + Math.sin(p.angle)*1.1, p.pos.z + Math.cos(p.angle)*1.1, 1.8);
  sfx.shard(); makeNoise(p.pos.x, p.pos.z, S.noise);
  return true;
}
// Called by crystal.js when a Crystal breaks: every player's shard weapon drinks from it.
export function rechargeShards(){
  for (const p of players) for (const w of p.weapons){
    if (!w || w.id !== 'shard') continue;
    const k = Math.min(magSize(w) - w.mag, WEAPONS.shard.refill);
    if (k > 0){ w.mag += k; floatText(`+${k} crystal shards`, 'r-unique', p); }
  }
}

// ---------- Guardian drone ----------
// Click to launch / dock (w.out). Flying, it circles its player at `orbit` and shoots the nearest zombie it
// can see within range, whatever they're holding, until its battery runs flat. One model per player
// (p.drone, shared geometry), kept for the session. A dead player's drone docks.
function toggleDrone(p, w){
  if (w.latch) return true;
  if (!w.out && w.mag < WEAPONS.drone.launch) return false;
  w.latch = true; w.out = !w.out; p.fireCd = 0.3;
  floatText(w.out ? 'Drone launched' : 'Drone docked', 'dim', p); sfxFor(p, 'drone', w.out);
  return true;
}
function updateDrone(dt){ for (const p of players) droneFor(p, dt); }
function droneFor(p, dt){
  const W = WEAPONS.drone, w = p.weapons.find(w => w && w.id === 'drone' && w.out);
  if (w && p.dead) w.out = false;
  let drone = p.drone;
  if (!w || p.dead){ if (drone && drone.visible){ drone.visible = false; burst(drone.position.clone(), 'spark', 6, 2, true); } return; }
  w.mag -= W.drain*dt;
  if (w.mag <= 0){ w.mag = 0; w.out = false; floatText('Drone battery flat: docked', 'dim', p); sfxFor(p, 'drone', false); return; }
  if (!drone){ drone = p.drone = droneModel(); scene.add(drone); drone.visible = false; p.droneA = 0; p.droneShot = 0; }
  p.droneA += dt*1.3;
  const droneA = p.droneA;
  const tx = p.pos.x + Math.sin(droneA)*W.orbit, tz = p.pos.z + Math.cos(droneA)*W.orbit, ty = 2.6 + Math.sin(droneA*3)*0.15;
  if (!drone.visible){ drone.visible = true; drone.position.set(p.pos.x, 1.5, p.pos.z); }
  drone.position.x += (tx - drone.position.x)*Math.min(1, dt*5); drone.position.z += (tz - drone.position.z)*Math.min(1, dt*5);
  drone.position.y += (ty - drone.position.y)*Math.min(1, dt*4);
  for (const r of drone.rotors) r.rotation.y += dt*40;
  // Target: the nearest zombie in range it has a clear line to.
  const dp = drone.position, S = weaponStats(w);
  let best = null, bd = S.range;
  for (const z of zombies){
    if (!targetable(z)) continue;
    const d = Math.hypot(z.pos.x - dp.x, z.pos.z - dp.z);
    if (d < bd && lineOfSight(dp.x, dp.z, z.pos.x, z.pos.z)){ bd = d; best = z; }
  }
  const face = best ? Math.atan2(best.pos.x - dp.x, best.pos.z - dp.z) : p.angle;
  drone.rotation.y += Math.atan2(Math.sin(face - drone.rotation.y), Math.cos(face - drone.rotation.y))*Math.min(1, dt*8);
  drone.rotation.z = Math.sin(droneA*2)*0.08;
  p.droneShot -= dt;
  if (best && p.droneShot <= 0){
    const dx = (best.pos.x - dp.x)/bd, dz = (best.pos.z - dp.z)/bd;
    p.droneShot = S.rate;
    addBullet('drone', dp.x + dx*0.3, 1.5, dp.z + dz*0.3, Math.atan2(dx, dz), W.speed, S.range/W.speed + 0.1, { damage:S.dmg, pierce:0, kb:0.6, owner:p });
    sfx.shot('drone'); makeNoise(dp.x, dp.z, S.noise);
  }
}
