// ---------- Zombies ----------
import * as THREE from 'three';
import { TILE, N, DIRS8, walkable } from './config.js';
import { mr, lerpAngle } from './utils.js';
import { scene } from './renderer.js';
import { SH } from './assets.js';
import { state, world, zombies, dying } from './state.js';
import { distField, isBlockedTile, resolveCircle } from './grid.js';
import { player } from './player.js';
import { hurtPlayer } from './combat.js';
import { burst, addDecal, spawnPickup } from './fx.js';
import { dropZombieAmmo } from './loot.js';
import { sfx } from './audio.js';

const ZTYPES = {
  walker: { hp:3, speed:[2.0,2.8], r:0.42, dmg:10, bleed:0.25, scale:1, skin:0x7d9468 },
  runner: { hp:2, speed:[4.3,5.1], r:0.38, dmg:8, bleed:0.3, scale:0.92, skin:0xa3a777 },
  brute:  { hp:12, speed:[1.6,1.9], r:0.7, dmg:22, bleed:0.5, scale:1.5, skin:0x5e7052 }
};
const SHIRTS = [0x6b4a3a,0x4a5a6b,0x5a5a4a,0x7a3a3a,0x3a4a3a,0x6a6a72,0x8a7a5a];
function createZombieMesh(type){
  const S = ZTYPES[type];
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
  const bodyMat = new THREE.MeshStandardMaterial({ color:SHIRTS[Math.floor(Math.random()*SHIRTS.length)], roughness:0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color:S.skin, roughness:0.8 });
  const body = new THREE.Mesh(SH.zBody, bodyMat); body.position.y = 1.03; body.rotation.x = 0.12;
  const head = new THREE.Mesh(SH.zHead, skinMat); head.position.set(0,1.68,0.06); head.rotation.z = mr(-0.25,0.25);
  const a1 = new THREE.Mesh(SH.zArm, skinMat); a1.position.set(0.43,1.3,0.32);
  const a2 = new THREE.Mesh(SH.zArm, skinMat); a2.position.set(-0.43,1.3,0.32);
  const l1 = new THREE.Mesh(SH.zLeg, SH.pantsMat); l1.position.set(0.17,0.62,0);
  const l2 = new THREE.Mesh(SH.zLeg, SH.pantsMat); l2.position.set(-0.17,0.62,0);
  b.add(body, head, a1, a2, l1, l2);
  b.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(S.scale);
  return { g, b, mats:[bodyMat, skinMat], legs:[l1,l2], arms:[a1,a2] };
}
// guard = stays near its spawn point (police station) and never despawns.
export function spawnZombieAt(x,z,horde,alert,guard){
  const lv = state.level, r = Math.random();
  const bruteC = lv >= 2 ? Math.min(0.2, 0.05 + 0.04*(lv-2)) : (horde ? 0.05 : 0);
  const runC = Math.min(0.38, 0.1 + 0.07*(lv-1));
  const type = r < bruteC ? 'brute' : r < bruteC + runC ? 'runner' : 'walker';
  const S = ZTYPES[type], m = createZombieMesh(type);
  m.g.position.set(x,0,z); m.g.rotation.y = Math.random()*Math.PI*2;
  scene.add(m.g);
  const hp = S.hp * (1 + 0.3*(lv-1));
  const zz = { type, g:m.g, b:m.b, mats:m.mats, legs:m.legs, arms:m.arms, pos:m.g.position, vel:new THREE.Vector3(),
    hp, speed:mr(S.speed[0],S.speed[1])*(1+0.04*(lv-1)), r:S.r, dmg:S.dmg, bleed:S.bleed, atkCd:0, flash:0,
    horde, guard:!!guard, hx:x, hz:z, alert:!!alert || horde, wanderT:0, wx:0, wz:0, phase:Math.random()*6, groan:mr(3,10) };
  zombies.push(zz); if (horde) state.hordeAlive++;
  return zz;
}
// Random reachable tile whose distance from the player is within [minD, maxD].
export function findSpawnTile(minD, maxD){
  const g = world.city.grid;
  for (let i=0;i<70;i++){
    const tx = 1 + Math.floor(Math.random()*(N-3)), tz = 1 + Math.floor(Math.random()*(N-2));
    const id = tz*N+tx;
    if (!walkable(g[id]) || distField[id] < 0) continue;
    const wx = (tx+0.5)*TILE, wz = (tz+0.5)*TILE;
    const d = Math.hypot(wx-player.pos.x, wz-player.pos.z);
    if (d >= minD && d <= maxD) return { x:wx + mr(-0.4,0.4), z:wz + mr(-0.4,0.4) };
  }
  return null;
}
export function disposeZombie(z){ scene.remove(z.g); for (const m of z.mats) m.dispose(); }
// Alerts every unalerted zombie within r of (x,z).
export function makeNoise(x, z, r){
  for (const o of zombies) if (!o.alert && Math.hypot(o.pos.x-x, o.pos.z-z) < r) o.alert = true;
}
// quiet = damage over time (fire): no blood burst or hit sound.
export function damageZombie(z, dmg, dx, dz, quiet){
  z.hp -= dmg; z.alert = true; z.flash = 0.08;
  for (const m of z.mats) m.emissive.setHex(quiet ? 0x804010 : 0x663333);
  const kb = z.type === 'brute' ? 1.2 : 3.5;
  z.vel.x += dx*kb; z.vel.z += dz*kb;
  if (!quiet){ burst(new THREE.Vector3(z.pos.x, 1.2, z.pos.z), 'blood', 4, 3); sfx.hit(); }
  if (z.hp <= 0) killZombie(z);
}
function killZombie(z){
  const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i,1);
  if (z.horde) state.hordeAlive--;
  state.kills++; state.cityKills++;
  addDecal(z.pos.x, z.pos.z);
  burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 'blood', 10, 4);
  for (const m of z.mats) m.emissive.setHex(0);
  dying.push({ z, t:0 });
  // Health drops are rare on purpose: most healing comes from searching the city.
  const chance = 0.025 + (player.hp < player.maxHp*0.4 ? 0.03 : 0) + (z.type === 'brute' ? 0.1 : 0);
  if (Math.random() < chance) spawnPickup(z.pos.x, z.pos.z);
  else if (Math.random() < 0.07) dropZombieAmmo(z.pos.x, z.pos.z);
}
export function updateZombies(dt){
  const p = player.pos, lure = world.lure;
  for (let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    const dx = p.x - z.pos.x, dz = p.z - z.pos.z, dist = Math.hypot(dx,dz) || 0.0001;
    if (!z.alert && dist < 15) z.alert = true;
    if (!z.alert && !z.horde && !z.guard && dist > 62){ disposeZombie(z); zombies.splice(i,1); continue; }
    let desX = 0, desZ = 0, spd = z.speed;
    const lx = lure ? lure.x - z.pos.x : 0, lz = lure ? lure.z - z.pos.z : 0, ld = lure ? Math.hypot(lx,lz) : 1e9;
    if (z.alert && ld < 32 && dist > 3.5){
      // A beeping pipe bomb pulls alerted zombies off the player.
      if (ld > 0.9){ desX = lx/ld; desZ = lz/ld; }
    } else if (z.alert){
      if (dist < 4.5){ desX = dx/dist; desZ = dz/dist; }
      else {
        // Step toward the neighbouring tile with the lowest flow-field distance.
        const tx = Math.floor(z.pos.x/TILE), tz = Math.floor(z.pos.z/TILE);
        let best = (tx>=0&&tz>=0&&tx<N&&tz<N) ? distField[tz*N+tx] : -1, bx = -1, bz = -1;
        for (const [ox,oz] of DIRS8){
          const nx = tx+ox, nz = tz+oz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const d = distField[nz*N+nx]; if (d < 0) continue;
          if (ox !== 0 && oz !== 0 && (isBlockedTile(tx+ox,tz) || isBlockedTile(tx,tz+oz))) continue;
          if (best < 0 || d < best){ best = d; bx = nx; bz = nz; }
        }
        if (bx >= 0){ const ax = (bx+0.5)*TILE - z.pos.x, az = (bz+0.5)*TILE - z.pos.z, l = Math.hypot(ax,az) || 1; desX = ax/l; desZ = az/l; }
        else { desX = dx/dist; desZ = dz/dist; }
      }
    } else {
      z.wanderT -= dt;
      if (z.wanderT <= 0){
        const a = Math.random()*Math.PI*2;
        const hx = z.hx - z.pos.x, hz = z.hz - z.pos.z, hd = Math.hypot(hx,hz);
        if (z.guard && hd > 6){ z.wx = hx/hd; z.wz = hz/hd; }
        else if (Math.random() < 0.35){ z.wx = 0; z.wz = 0; } else { z.wx = Math.sin(a); z.wz = Math.cos(a); }
        z.wanderT = mr(2,4);
      }
      desX = z.wx; desZ = z.wz; spd *= 0.3;
    }
    // Separation from other zombies
    let sx = 0, sz = 0;
    for (const o of zombies){
      if (o === z) continue;
      const ox = z.pos.x - o.pos.x, oz = z.pos.z - o.pos.z, rr = z.r + o.r, d2 = ox*ox + oz*oz;
      if (d2 < rr*rr && d2 > 1e-6){ const d = Math.sqrt(d2), f = (rr-d)/rr; sx += ox/d*f; sz += oz/d*f; }
    }
    desX += sx*1.6; desZ += sz*1.6;
    const k = Math.min(1, dt*6);
    z.vel.x += (desX*spd - z.vel.x)*k; z.vel.z += (desZ*spd - z.vel.z)*k;
    z.pos.x += z.vel.x*dt; z.pos.z += z.vel.z*dt;
    const minD = z.r + player.radius;
    const ndx = p.x - z.pos.x, ndz = p.z - z.pos.z, nd = Math.hypot(ndx,ndz);
    if (nd < minD && nd > 1e-4){ z.pos.x = p.x - ndx/nd*minD; z.pos.z = p.z - ndz/nd*minD; }
    resolveCircle(z.pos, z.r);
    const vl = Math.hypot(z.vel.x, z.vel.z);
    if (vl > 0.2) z.g.rotation.y = lerpAngle(z.g.rotation.y, Math.atan2(z.vel.x, z.vel.z), Math.min(1, dt*8));
    z.phase += dt*(vl*2.4 + 0.5);
    const sw = Math.sin(z.phase)*0.6*Math.min(1, vl/1.5);
    z.legs[0].rotation.x = sw; z.legs[1].rotation.x = -sw;
    z.arms[0].rotation.x = -0.1 + Math.sin(z.phase*0.5)*0.15; z.arms[1].rotation.x = -0.1 - Math.sin(z.phase*0.5+1)*0.15;
    z.b.rotation.z = Math.sin(z.phase*0.5)*0.06;
    z.atkCd -= dt;
    if (nd < minD + 0.35 && z.atkCd <= 0){ z.atkCd = 1.0; hurtPlayer(z.dmg, z); if (state.mode !== 'play') return; }
    if (z.flash > 0){ z.flash -= dt; if (z.flash <= 0) for (const m of z.mats) m.emissive.setHex(0); }
    if (z.alert){ z.groan -= dt; if (z.groan <= 0){ z.groan = mr(5,11); if (dist < 14) sfx.groan(); } }
  }
}
export function updateDying(dt){
  for (let i=dying.length-1;i>=0;i--){
    const d = dying[i]; d.t += dt;
    d.z.b.rotation.x = -Math.min(1, d.t/0.35)*Math.PI/2;
    d.z.b.position.y = d.t < 0.35 ? 0 : -Math.min(1,(d.t-0.9)/0.8)*0.6*(d.t > 0.9 ? 1 : 0);
    if (d.t > 1.7){ disposeZombie(d.z); dying.splice(i,1); }
  }
}
