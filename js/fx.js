// ---------- FX ----------
// Particles, blood decals, health pickups, and building fade.
import * as THREE from 'three';
import { TILE, N, T } from './config.js';
import { mr } from './utils.js';
import { scene, camera } from './renderer.js';
import { SH } from './assets.js';
import { world, particles, decals, pickups } from './state.js';
import { player } from './player.js';
import { sfx } from './audio.js';

export function burst(pos, kind, n, spd){
  for (let i=0;i<n;i++){
    if (particles.length > 280) break;
    const m = new THREE.Mesh(SH.partGeo, SH.partMats[kind]);
    m.position.copy(pos); m.scale.setScalar(mr(0.6,1.4));
    const a = Math.random()*Math.PI*2, s = mr(0.3,1)*spd;
    scene.add(m);
    particles.push({ m, vx:Math.sin(a)*s, vy:mr(1.5,4.5), vz:Math.cos(a)*s, life:mr(0.35,0.8) });
  }
}
export function updateParticles(dt){
  for (let i=particles.length-1;i>=0;i--){
    const p = particles[i]; p.life -= dt;
    p.vy -= 12*dt; p.m.position.x += p.vx*dt; p.m.position.y += p.vy*dt; p.m.position.z += p.vz*dt;
    if (p.m.position.y < 0.12){ p.m.position.y = 0.12; p.vx *= 0.6; p.vz *= 0.6; p.vy = 0; }
    if (p.life < 0.2) p.m.scale.multiplyScalar(0.9);
    if (p.life <= 0){ scene.remove(p.m); particles.splice(i,1); }
  }
}
export function addDecal(x,z){
  const m = new THREE.Mesh(SH.decalGeo, SH.decalMat);
  m.rotation.x = -Math.PI/2; m.rotation.z = Math.random()*6;
  const t = world.city.grid[Math.floor(z/TILE)*N + Math.floor(x/TILE)];
  m.position.set(x, t === T.ROAD ? 0.02 + Math.random()*0.004 : 0.09 + Math.random()*0.004, z);
  m.scale.set(mr(0.8,1.6), mr(0.7,1.3), 1);
  scene.add(m); decals.push(m);
  if (decals.length > 80) scene.remove(decals.shift());
}
export function spawnPickup(x,z){
  const g = new THREE.Group(); g.position.set(x,0,z);
  const c = new THREE.Group(); c.position.y = 0.8;
  c.add(new THREE.Mesh(SH.crossA, SH.crossMat), new THREE.Mesh(SH.crossB, SH.crossMat));
  const ring = new THREE.Mesh(SH.ringGeo, SH.healGlow); ring.rotation.x = -Math.PI/2; ring.position.y = 0.12;
  g.add(c, ring); scene.add(g);
  pickups.push({ g, c, life:25, t:Math.random()*6 });
}
export function updatePickups(dt){
  for (let i=pickups.length-1;i>=0;i--){
    const p = pickups[i]; p.life -= dt; p.t += dt;
    p.c.rotation.y += dt*2.2; p.c.position.y = 0.8 + Math.sin(p.t*3)*0.12;
    p.g.visible = p.life > 4 || Math.floor(p.t*6)%2 === 0;
    const d = Math.hypot(p.g.position.x - player.pos.x, p.g.position.z - player.pos.z);
    if (d < 1.3 && player.hp < player.maxHp){
      player.hp = Math.min(player.maxHp, player.hp + 25); sfx.pickup();
      burst(new THREE.Vector3(p.g.position.x, 1, p.g.position.z), 'heal', 8, 2);
      scene.remove(p.g); pickups.splice(i,1); continue;
    }
    if (p.life <= 0){ scene.remove(p.g); pickups.splice(i,1); }
  }
}

// ---------- Building fade (keeps the player visible) ----------
export const faded = new Set();
const camDir = new THREE.Vector3(), fadeOrigin = new THREE.Vector3();
const fadeRay = new THREE.Raycaster();
function setOpacity(mesh, o){
  for (const m of mesh.userData.mats){ m.transparent = o < 1; m.opacity = o; m.depthWrite = o >= 1; }
}
export function updateFade(){
  const next = new Set();
  camera.getWorldDirection(camDir);
  for (const oy of [0.4, 1.8]){
    fadeOrigin.set(player.pos.x, oy, player.pos.z).addScaledVector(camDir, -120);
    fadeRay.set(fadeOrigin, camDir); fadeRay.far = 119.5;
    for (const h of fadeRay.intersectObjects(world.buildingMeshes, false)) next.add(h.object);
  }
  for (const m of faded) if (!next.has(m)) setOpacity(m, 1);
  for (const m of next) if (!faded.has(m)) setOpacity(m, 0.22);
  faded.clear(); for (const m of next) faded.add(m);
}
