// ---------- Combat ----------
// Shooting, melee, bullets, and damage to the player and the Crystal.
import * as THREE from 'three';
import { TILE } from './config.js';
import { $, mr } from './utils.js';
import { scene, muzzleLight } from './renderer.js';
import { SH } from './assets.js';
import { WEAPONS } from './items.js';
import { state, world, zombies, bullets } from './state.js';
import { isBlockedTile } from './grid.js';
import { player } from './player.js';
import { damageZombie, makeNoise } from './zombies.js';
import { curWeapon, magSize } from './inventory.js';
import { toast } from './hud.js';
import { burst } from './fx.js';
import { sfx } from './audio.js';
import { die, foundCrystal, breakCrystal } from './game.js';

export function tryReload(){
  const w = curWeapon();
  if (state.mode !== 'play' || player.reloadT > 0 || w.mag >= magSize(w) || player.ammo[w.id] <= 0) return;
  player.reloadT = WEAPONS[w.id].reload*player.reloadMul; sfx.reload();
}
export function fire(){
  if (player.reloadT > 0 || player.fireCd > 0) return;
  const w = curWeapon(), W = WEAPONS[w.id];
  if (w.mag <= 0){ if (player.ammo[w.id] > 0) tryReload(); else melee(); return; }
  w.mag--; player.fireCd = W.rate*player.fireMul;
  const n = W.pellets + player.pellets, spread = W.spread || 0.11;
  for (let i=0;i<n;i++){
    const a = player.angle + (n > 1 ? (i-(n-1)/2)*spread : 0) + mr(-W.jitter,W.jitter);
    const dx = Math.sin(a), dz = Math.cos(a);
    const m = new THREE.Mesh(SH.bulletGeo, SH.bulletMat);
    m.position.set(player.pos.x + dx*0.9, 1.15, player.pos.z + dz*0.9); m.rotation.y = a;
    scene.add(m);
    bullets.push({ mesh:m, dx, dz, speed:W.speed*mr(0.94,1.06), life:W.life, damage:W.dmg*player.dmgMul, pierce:W.pierce + player.pierce, hit:new Set() });
  }
  muzzleLight.position.set(player.pos.x + Math.sin(player.angle)*1.1, 1.3, player.pos.z + Math.cos(player.angle)*1.1);
  muzzleLight.intensity = 3;
  sfx.shot(W.sound);
  // Gunfire alerts nearby zombies.
  makeNoise(player.pos.x, player.pos.z, W.noise);
  if (w.mag === 0) tryReload();
}
// Out of ammo for this gun: a short-range shove with the stock.
let dryWarned = 0;
function melee(){
  player.fireCd = 0.55; sfx.swing();
  if (performance.now() - dryWarned > 6000){ dryWarned = performance.now(); toast(`Out of ${WEAPONS[curWeapon().id].ammo}. Search the city or press Q to swap`, 'bad'); }
  for (const z of zombies.slice()){
    const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z, d = Math.hypot(dx,dz) || 0.001;
    if (d > 1.7 + z.r) continue;
    const da = Math.abs(((Math.atan2(dx,dz) - player.angle) % (Math.PI*2) + Math.PI*3) % (Math.PI*2) - Math.PI);
    if (da < 1.0) damageZombie(z, 1*player.dmgMul, dx/d*1.8, dz/d*1.8);
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
      if (crystal && crystal.alive){
        const cx = bp.x - crystal.pos.x, cz = bp.z - crystal.pos.z;
        if (cx*cx + cz*cz < 1.0){ hitCrystal(b.damage); burst(bp.clone(), 'crystal', 5, 3); dead = true; break; }
      }
      if (isBlockedTile(Math.floor(bp.x/TILE), Math.floor(bp.z/TILE))){ burst(bp.clone(), 'spark', 4, 2.5); dead = true; break; }
      for (const z of zombies){
        if (b.hit.has(z)) continue;
        const zx = bp.x - z.pos.x, zz = bp.z - z.pos.z, rr = z.r + 0.14;
        if (zx*zx + zz*zz < rr*rr){
          b.hit.add(z); damageZombie(z, b.damage, b.dx, b.dz);
          if (b.pierce > 0) b.pierce--; else dead = true;
          break;
        }
      }
    }
    if (dead){ scene.remove(b.mesh); bullets.splice(i,1); }
  }
}
export function hurtPlayer(dmg, z){
  if (state.mode !== 'play') return;
  player.hp -= dmg; state.shake = Math.max(state.shake, 0.25);
  $('vignette').style.opacity = 0.7; sfx.hurt();
  if (z){
    const dx = player.pos.x - z.pos.x, dz = player.pos.z - z.pos.z, l = Math.hypot(dx,dz) || 1; player.vel.x += dx/l*6; player.vel.z += dz/l*6;
    if (!player.bleeding && Math.random() < z.bleed){ player.bleeding = true; toast('You’re bleeding. Use a bandage', 'bad'); }
  }
  if (player.hp <= 0){ player.hp = 0; die(); }
}
// Silent health loss (bleeding, starving). Returns true if it killed the player.
export function drainHp(n){
  player.hp -= n;
  if (player.hp <= 0){ player.hp = 0; die(); return true; }
  return false;
}
function hitCrystal(dmg){
  const crystal = world.crystal;
  crystal.hp -= dmg; crystal.flash = 0.1; sfx.crystal();
  if (!state.crystalFound) foundCrystal();
  if (crystal.hp <= 0) breakCrystal();
}
