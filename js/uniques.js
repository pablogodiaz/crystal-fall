// ---------- Unique weapons ----------
// Flamethrower (fire cone, burning zombies, fuel refilled at gas stations), Turncoat flask (thrown;
// zombies in the splash fight their own kind, see the Turned section of zombies.js) and Arc caster
// (chain lightning, recharges by itself). The bow is a regular gun whose arrows drop (combat.js, loot.js).
// Numbers live with each weapon in WEAPONS (items.js).
import * as THREE from 'three';
import { TILE } from './config.js';
import { mr } from './utils.js';
import { scene, muzzleLight } from './renderer.js';
import { SH } from './assets.js';
import { WEAPONS } from './items.js';
import { state, world, zombies } from './state.js';
import { isOpaqueTile, lineOfSight } from './grid.js';
import { player } from './player.js';
import { damageZombie, stunZombie, alertZombie, makeNoise, turnZombie } from './zombies.js';
import { hitCrystal, CRYSTAL_R } from './combat.js';
import { weaponStats } from './weapons.js';
import { throwPotion } from './throwables.js';
import { burst, shockwave, addDecal } from './fx.js';
import { floatText } from './hud.js';
import { sfx } from './audio.js';

const flames = [], bolts = [], burning = new Map();
let flameTick = 0, flameNoise = 0, flameSfx = 0;
const lvMul = () => 1 + 0.3*(state.level - 1);  // fire scales with the city like molotovs
// Angle between the player's facing and the direction (dx,dz).
const offAim = (dx, dz) => Math.abs(((Math.atan2(dx,dz) - player.angle) % (Math.PI*2) + Math.PI*3) % (Math.PI*2) - Math.PI);
const targetable = z => !z.dead && !(z.rise > 0) && !(z.turned > 0);

// Fires the held unique; false = it can't right now (empty, brewing, recharging) and the caller melees.
export function fireUnique(w, dt){
  if (w.id === 'flamer') return sprayFlame(w, dt);
  if (w.id === 'tesla') return fireArc(w);
  if (w.id === 'potion'){
    if (w.cd > 0) return false;
    if (throwPotion()){ w.cd = WEAPONS.potion.cooldown; w.mag = 0; player.fireCd = 0.4; }
    return true;
  }
  return false;
}
// Brewing and recharging tick for both slots, held or not.
export function updateWeaponTimers(dt){
  for (const w of player.weapons){
    if (!w) continue;
    if (w.id === 'potion' && w.cd > 0){ w.cd = Math.max(0, w.cd - dt); if (!w.cd){ w.mag = 1; floatText('Turncoat flask ready', 'good'); sfx.brew(); } }
    if (w.id === 'tesla'){ const W = WEAPONS.tesla; w.idle += dt; if (w.idle > W.regenDelay) w.mag = Math.min(W.mag, w.mag + W.regen*dt); }
  }
}

// ---------- Flamethrower ----------
function sprayFlame(w, dt){
  const W = WEAPONS.flamer;
  if (w.mag <= 0) return false;
  w.mag = Math.max(0, w.mag - W.use*dt); player.flameT = 0.12;
  const S = weaponStats(w), a0 = player.angle, ux = Math.sin(a0), uz = Math.cos(a0);
  const ox = player.pos.x + ux*1.1, oz = player.pos.z + uz*1.1;
  // Flame puffs: fly out, grow, cool from white-yellow to red, stop at walls.
  for (let i=0, n=Math.max(1, Math.round(dt*70)); i<n && flames.length < 160; i++){
    const a = a0 + mr(-W.cone, W.cone)*0.75, sp = mr(10, 13);
    const m = new THREE.Mesh(SH.partGeo, SH.flameMats[0]); m.position.set(ox, 1.15, oz); scene.add(m);
    flames.push({ m, vx:Math.sin(a)*sp + player.vel.x*0.5, vz:Math.cos(a)*sp + player.vel.z*0.5, vy:mr(-0.3, 0.6), t:0, T:W.range/sp*mr(0.8, 1.05) });
  }
  muzzleLight.position.set(ox + ux, 1.3, oz + uz); muzzleLight.intensity = Math.max(muzzleLight.intensity, 2.2);
  flameTick -= dt;
  if (flameTick <= 0){
    flameTick = 0.1;
    const dmg = S.dmg*0.1*lvMul();
    for (const z of zombies.slice()){
      if (!targetable(z)) continue;
      const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 0.001;
      if (d > W.range + z.r || (d > 1 && offAim(dx, dz) > W.cone + z.r/d) || !lineOfSight(player.pos.x, player.pos.z, z.pos.x, z.pos.z)) continue;
      alertZombie(z); ignite(z);
      damageZombie(z, dmg, dx/d*0.12, dz/d*0.12, 'fire');
    }
    const cr = world.crystal;
    if (cr && cr.alive){
      const dx = cr.pos.x - player.pos.x, dz = cr.pos.z - player.pos.z, d = Math.hypot(dx, dz);
      if (d < W.range + CRYSTAL_R && offAim(dx, dz) < W.cone + CRYSTAL_R/d) hitCrystal(dmg*0.5);
    }
  }
  flameNoise -= dt; if (flameNoise <= 0){ flameNoise = 0.3; makeNoise(player.pos.x, player.pos.z, S.noise); }
  flameSfx -= dt; if (flameSfx <= 0){ flameSfx = 0.11; sfx.flame(); }
  return true;
}
function ignite(z){ burning.set(z, { t:WEAPONS.flamer.burn, tick:0.25 }); }
function updateFlames(dt){
  for (let i=flames.length-1;i>=0;i--){
    const f = flames[i], p = f.m.position; f.t += dt;
    const k = f.t/f.T;
    if (k >= 1 || isOpaqueTile(Math.floor(p.x/TILE), Math.floor(p.z/TILE))){
      if (k < 1 && Math.random() < 0.3) burst(p.clone(), 'fire', 1, 1);
      scene.remove(f.m); flames.splice(i,1); continue;
    }
    p.x += f.vx*dt; p.z += f.vz*dt; p.y += f.vy*dt;
    f.m.scale.setScalar(1 + k*4.5); f.m.rotation.set(f.t*7, f.t*5, 0);
    f.m.material = k > 0.85 ? SH.smokeMat : SH.flameMats[Math.min(3, Math.floor(k*4))];
  }
  // Burning zombies keep taking fire damage for a while.
  for (const [z, b] of burning){
    if (z.dead){ burning.delete(z); continue; }
    b.t -= dt; b.tick -= dt;
    if (Math.random() < dt*14) burst(new THREE.Vector3(z.pos.x + mr(-0.3,0.3), mr(0.6,1.6)*z.g.scale.y, z.pos.z + mr(-0.3,0.3)), 'fire', 1, 0.8);
    if (b.tick <= 0){ b.tick = 0.25; damageZombie(z, WEAPONS.flamer.burnDps*0.25*lvMul(), 0, 0, 'fire'); }
    if (b.t <= 0) burning.delete(z);
  }
  if (player.flameT > 0) player.flameT -= dt;
}
// Gas stations refuel it: hold E at a pump. Each station has enough left for one fill.
export function refuel(w, l){
  w.mag = WEAPONS.flamer.mag; l.refueled = true;
  sfx.refuel(); floatText('+ Fuel (full tank)', 'good');
}

// ---------- Turncoat flask ----------
// Called by throwables.js when the flask lands.
export function splashPotion(x, z){
  const W = WEAPONS.potion;
  let n = 0;
  for (const o of zombies) if (!o.dead && !(o.rise > 0) && Math.hypot(o.pos.x - x, o.pos.z - z) < W.radius + o.r){ turnZombie(o, W.turn); n++; }
  const p = new THREE.Vector3(x, 0.5, z);
  burst(p, 'brew', 22, 5); burst(p, 'spark', 6, 3);
  shockwave(x, z, W.radius, 0xff5fd2); addDecal(x, z, W.radius*0.6, SH.brewMat);
  sfx.splash(); sfx.brew(); makeNoise(x, z, W.noise);
  floatText(n ? `${n} zombie${n > 1 ? 's' : ''} turned` : 'Nobody in the splash', n ? 'good' : 'dim');
}

// ---------- Arc caster ----------
// The bolt goes to the nearest zombie (or the Crystal) in front within range and clear sight, then
// jumps to the nearest zombie not yet hit within `jump`, up to `chain` times, weaker each jump.
function fireArc(w){
  const W = WEAPONS.tesla;
  if (w.mag < W.cost) return false;
  const S = weaponStats(w);
  w.mag -= W.cost; w.idle = 0; player.fireCd = S.rate;
  const px = player.pos.x, pz = player.pos.z, ux = Math.sin(player.angle), uz = Math.cos(player.angle);
  const pts = [new THREE.Vector3(px + ux*1.1, 1.25, pz + uz*1.1)];
  let cur = null, best = W.range;
  for (const z of zombies){
    if (!targetable(z)) continue;
    const dx = z.pos.x - px, dz = z.pos.z - pz, d = Math.hypot(dx, dz);
    if (d < best && (d < 1.2 || offAim(dx, dz) < W.cone) && lineOfSight(px, pz, z.pos.x, z.pos.z)){ best = d; cur = z; }
  }
  const cr = world.crystal;
  if (cr && cr.alive){
    const dx = cr.pos.x - px, dz = cr.pos.z - pz, d = Math.hypot(dx, dz);
    if (d - CRYSTAL_R < best && offAim(dx, dz) < W.cone + 0.2){
      cur = null; hitCrystal(S.dmg*2); pts.push(new THREE.Vector3(cr.pos.x, 1.6, cr.pos.z)); burst(pts[1], 'crystal', 8, 4);
    }
  }
  if (cur){
    const hit = new Set(); let dmg = S.dmg;
    for (let i=0;i<=W.chain && cur;i++){
      hit.add(cur); pts.push(new THREE.Vector3(cur.pos.x, 1.2*cur.g.scale.y, cur.pos.z));
      const prev = pts[pts.length - 2], dx = cur.pos.x - prev.x, dz = cur.pos.z - prev.z, l = Math.hypot(dx, dz) || 1;
      damageZombie(cur, dmg, dx/l*0.5, dz/l*0.5, 'bullet'); stunZombie(cur, W.stun);
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
  muzzleLight.position.copy(pts[0]); muzzleLight.intensity = 3.5;
  sfx.zap(); makeNoise(px, pz, S.noise);
  return true;
}
// A jagged bolt through pts: each link split into a few kinked segments (thin glowing boxes).
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
function drawBolt(pts){
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

// Every frame in play.
export function updateUniques(dt){ updateWeaponTimers(dt); updateFlames(dt); updateBolts(dt); }
// New city: clear leftover effects.
export function resetUniques(){
  for (const f of flames) scene.remove(f.m); flames.length = 0;
  for (const b of bolts) for (const m of b.meshes) scene.remove(m); bolts.length = 0;
  burning.clear();
}
