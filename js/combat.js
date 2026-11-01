// ---------- Combat ----------
// Shooting, melee, bullets, and damage to the player and the Crystal.
import * as THREE from 'three';
import { TILE } from './config.js';
import { $, mr, clamp } from './utils.js';
import { scene, muzzleLight } from './renderer.js';
import { SH } from './assets.js';
import { WEAPONS, CRIT } from './items.js';
import { state, world, zombies, bullets, dev } from './state.js';
import { isOpaqueTile } from './grid.js';
import { player } from './player.js';
import { damageZombie, makeNoise } from './zombies.js';
import { curWeapon, magSize } from './inventory.js';
import { toast, floatText } from './hud.js';
import { weaponStats } from './weapons.js';
import { fireUnique } from './uniques.js';
import { dropArrow } from './loot.js';
import { burst } from './fx.js';
import { sfx } from './audio.js';
import { die } from './game.js';
import { foundCrystal, checkPulse, breakCrystal } from './crystal.js';

export function tryReload(){
  const w = curWeapon();
  if (state.mode !== 'play' || WEAPONS[w.id].kind || player.reloadT > 0 || w.mag >= magSize(w) || player.ammo[w.id] <= 0) return;
  player.reloadT = weaponStats(w).reload; sfx.reload();
}
// Called every frame the trigger is held. Regular guns (and the bow) shoot bullets here using the
// gun's own stats (weaponStats: rarity modifiers + upgrades); uniques with a `kind` fire in uniques.js.
// Anything that can't fire falls back to melee.
export function fire(dt){
  if (player.reloadT > 0 || player.fireCd > 0) return;
  const w = curWeapon(), W = WEAPONS[w.id];
  if (W.kind){ if (!fireUnique(w, dt)) dryMelee(); return; }
  if (w.mag <= 0){ if (player.ammo[w.id] > 0) tryReload(); else dryMelee(); return; }
  const S = weaponStats(w);
  // A bad "crit" roll jams instead; fast guns jam less per shot so they don't stall every second.
  if (S.jam && Math.random() < S.jam*clamp(S.rate/0.5, 0.15, 1)){ player.fireCd = 0.7; sfx.jam(); floatText('Jammed!', 'dim'); return; }
  if (!(S.free && Math.random() < S.free)) w.mag--;
  if (S.waste && w.mag > 0 && Math.random() < S.waste) w.mag--;
  player.fireCd = S.rate;
  const crit = S.crit && Math.random() < S.crit;
  const n = S.pellets, spread = S.spread || 0.11;
  for (let i=0;i<n;i++){
    const a = player.angle + (n > 1 ? (i-(n-1)/2)*spread : 0) + mr(-S.jitter,S.jitter);
    const dx = Math.sin(a), dz = Math.cos(a);
    const m = new THREE.Mesh(W.arrow ? SH.arrowGeo : SH.bulletGeo, W.arrow ? SH.arrowMat : crit ? SH.critMat : SH.bulletMat);
    m.position.set(player.pos.x + dx*0.9, 1.15, player.pos.z + dz*0.9); m.rotation.y = a;
    scene.add(m);
    bullets.push({ mesh:m, dx, dz, speed:S.speed*mr(0.94,1.06), life:S.life, damage:S.dmg*(crit ? CRIT : 1), pierce:S.pierce, kb:S.kb, crit, arrow:!!W.arrow, hit:new Set() });
  }
  if (!W.arrow){
    muzzleLight.position.set(player.pos.x + Math.sin(player.angle)*1.1, 1.3, player.pos.z + Math.cos(player.angle)*1.1);
    muzzleLight.intensity = crit ? 4.5 : 3;
  }
  sfx.shot(W.sound);
  // Gunfire is heard far off; zombies that can't see you walk to where it came from.
  makeNoise(player.pos.x, player.pos.z, S.noise);
  if (w.mag === 0) tryReload();
}
// ---------- Melee ----------
// A butt-stroke with the held gun: F any time, or left click once the gun is completely dry.
// melee() starts the swing; player.js animates it and calls meleeStrike() when the blow lands.
export const MELEE_TIME = 0.4, MELEE_HIT = 0.42;  // swing length (s), fraction where the blow lands
export function melee(){
  if (state.mode !== 'play' || player.meleeT > 0 || player.meleeCd > 0) return;
  player.meleeT = MELEE_TIME; player.meleeHit = false; player.meleeCd = 0.55;
  player.fireCd = Math.max(player.fireCd, MELEE_TIME);
  sfx.swing();
}
let dryWarned = 0;
function dryMelee(){
  const w = curWeapon(), W = WEAPONS[w.id];
  if (performance.now() - dryWarned > 6000){
    dryWarned = performance.now();
    toast(w.id === 'flamer' ? 'Out of fuel. Refuel at a gas station pump (once per station), or press Q to swap'
      : w.id === 'potion' ? `The flask is still brewing (${Math.ceil(w.cd)} s). Press Q to swap`
      : w.id === 'tesla' ? 'Recharging. Press Q to swap' : `Out of ${W.ammo}. Search the city or press Q to swap`, 'bad');
  }
  melee();
}
// Angle between the player's facing and the direction to (dx,dz).
const offAim = (dx, dz) => Math.abs(((Math.atan2(dx,dz) - player.angle) % (Math.PI*2) + Math.PI*3) % (Math.PI*2) - Math.PI);
export function meleeStrike(){
  makeNoise(player.pos.x, player.pos.z, 6);
  const dmg = 1*player.dmgMul;
  for (const z of zombies.slice()){
    const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z, d = Math.hypot(dx,dz) || 0.001;
    if (d > 1.7 + z.r || z.turned > 0) continue;  // turned zombies are on your side
    if (offAim(dx, dz) < 1.0) damageZombie(z, dmg, dx/d*1.8, dz/d*1.8, 'melee');
  }
  const crystal = world.crystal;
  if (crystal && crystal.alive){
    const dx = crystal.pos.x - player.pos.x, dz = crystal.pos.z - player.pos.z;
    if (Math.hypot(dx,dz) < 1.7 + CRYSTAL_R && offAim(dx, dz) < 1.0){
      hitCrystal(dmg); burst(new THREE.Vector3(crystal.pos.x - dx*0.3, 1.2, crystal.pos.z - dz*0.3), 'crystal', 6, 3);
    }
  }
}
export function updateBullets(dt){
  const crystal = world.crystal;
  for (let i=bullets.length-1;i>=0;i--){
    const b = bullets[i]; b.life -= dt; let dead = b.life <= 0;
    // Sub-step so fast bullets can't tunnel through walls or zombies.
    const steps = Math.max(1, Math.ceil(b.speed*dt/0.35)), sdt = dt/steps;
    for (let s=0;s<steps && !dead;s++){
      const bp = b.mesh.position;
      bp.x += b.dx*b.speed*sdt; bp.z += b.dz*b.speed*sdt;
      const tx = Math.floor(bp.x/TILE), tz = Math.floor(bp.z/TILE);
      if (crystal && crystal.alive){
        // The Crystal's whole tile is solid, so anything entering it counts as a hit (not a wall spark).
        const cx = bp.x - crystal.pos.x, cz = bp.z - crystal.pos.z, ct = world.city.crystalTile;
        if (cx*cx + cz*cz < CRYSTAL_R*CRYSTAL_R || (tx === ct.x && tz === ct.z)){ hitCrystal(b.damage); burst(bp.clone(), 'crystal', 5, 3); bp.x -= b.dx*0.8; bp.z -= b.dz*0.8; dead = true; break; }
      }
      if (isOpaqueTile(tx, tz)){ burst(bp.clone(), 'spark', 4, 2.5); bp.x -= b.dx*0.5; bp.z -= b.dz*0.5; dead = true; break; }  // cell bars let shots through
      for (const z of zombies){
        if (b.hit.has(z) || z.rise > 0 || z.turned > 0) continue;  // still digging out: shots pass over; turned ones are friends
        const zx = bp.x - z.pos.x, zz = bp.z - z.pos.z, rr = z.r + 0.14;
        if (zx*zx + zz*zz < rr*rr){
          // A riot shield stops the bullet outright, piercing or not.
          b.hit.add(z); const blocked = damageZombie(z, b.damage, b.dx*b.kb, b.dz*b.kb, 'bullet');
          if (b.crit && !blocked) burst(bp.clone(), 'spark', 6, 4);
          if (b.pierce > 0 && !blocked) b.pierce--; else dead = true;
          break;
        }
      }
    }
    if (dead){
      scene.remove(b.mesh); bullets.splice(i,1);
      // Most arrows survive and can be picked back up where they stopped.
      if (b.arrow && Math.random() < WEAPONS.bow.keep) dropArrow(b.mesh.position.x, b.mesh.position.z);
    }
  }
}
export function hurtPlayer(dmg, z){
  if (state.mode !== 'play' || dev.god) return;
  player.hp -= dmg; state.shake = Math.max(state.shake, 0.25);
  $('vignette').style.opacity = 0.7; sfx.hurt();
  if (z){
    const dx = player.pos.x - z.pos.x, dz = player.pos.z - z.pos.z, l = Math.hypot(dx,dz) || 1; player.vel.x += dx/l*6; player.vel.z += dz/l*6;
    if (!player.bleeding && Math.random() < z.bleed){ player.bleeding = true; toast('You’re bleeding. Use a bandage', 'bad'); }
  }
  if (player.hp <= 0){ player.hp = 0; die(); }
}
// Silent health loss (bleeding). Returns true if it killed the player.
export function drainHp(n){
  if (dev.god) return false;
  player.hp -= n;
  if (player.hp <= 0){ player.hp = 0; die(); return true; }
  return false;
}
export const CRYSTAL_R = 1.15;  // pedestal radius
export function hitCrystal(dmg){
  const crystal = world.crystal;
  crystal.hp -= dmg; crystal.flash = 0.1; sfx.crystal();
  if (!state.crystalFound) foundCrystal();
  if (crystal.hp <= 0) breakCrystal(); else checkPulse();
}
