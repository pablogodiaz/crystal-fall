// ---------- FX ----------
// Particles, blood decals, health pickups (zombie drops), and building fade.
import * as THREE from 'three';
import { TILE, N, T } from './config.js';
import { mr } from './utils.js';
import { scene, camera } from './renderer.js';
import { SH } from './assets.js';
import { world, particles, decals, pickups, rings } from './state.js';
import { player } from './player.js';
import { sfx } from './audio.js';
import { floatText } from './hud.js';

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
// Blood splat by default; s scales it, mat swaps it (SH.holeMat dirt, SH.scorchMat blast marks).
export function addDecal(x, z, s = 1, mat = SH.decalMat){
  const m = new THREE.Mesh(SH.decalGeo, mat);
  m.rotation.x = -Math.PI/2; m.rotation.z = Math.random()*6;
  const t = world.city.grid[Math.floor(z/TILE)*N + Math.floor(x/TILE)];
  m.position.set(x, t === T.ROAD ? 0.02 + Math.random()*0.004 : 0.09 + Math.random()*0.004, z);
  m.scale.set(s*mr(0.8,1.6), s*mr(0.7,1.3), 1);
  scene.add(m); decals.push(m);
  if (decals.length > 80) scene.remove(decals.shift());
}
// Flat ring (plus a fading fill disc) that sweeps out to radius r at ground level: shows exactly
// how far a blast reached. Entries live in `rings`, animated in specials.js.
export function shockwave(x, z, r, color){
  for (const [geo, op] of [[SH.blastRingGeo, 0.95], [SH.blastFillGeo, 0.4]]){
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent:true, opacity:op, depthWrite:false, side:THREE.DoubleSide }));
    m.rotation.x = -Math.PI/2; m.position.set(x, 0.14, z); m.scale.setScalar(r*0.25);
    scene.add(m); rings.push({ mesh:m, t:0, T:0.6, r0:r*0.25, r1:r, op });
  }
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
      const k = Math.ceil(Math.min(20, player.maxHp - player.hp));
      player.hp = Math.min(player.maxHp, player.hp + 20); sfx.pickup(); floatText(`+${k} health`, 'good');
      burst(new THREE.Vector3(p.g.position.x, 1, p.g.position.z), 'heal', 8, 2);
      scene.remove(p.g); pickups.splice(i,1); continue;
    }
    if (p.life <= 0){ scene.remove(p.g); pickups.splice(i,1); }
  }
}

// ---------- Building fade (keeps the player and their surroundings visible) ----------
// Rays run from the camera to the player and to sample points on a disc around them. A building
// they hit fades out, but (apart from ones hiding the player) only if its center is on the camera
// side of the player, so buildings beyond you stay solid. Opacity eases in and out.
export const faded = new Map();  // mesh -> current opacity
const FADE_R = 7, FADE_MIN = 0.2, FADE_SPEED = 5;
const SAMPLES = [];
for (const r of [3.5, FADE_R]) for (let i=0;i<10;i++){ const a = i/10*Math.PI*2; SAMPLES.push([Math.cos(a)*r, Math.sin(a)*r]); }
const camDir = new THREE.Vector3(), fadeOrigin = new THREE.Vector3();
const fadeRay = new THREE.Raycaster(), want = new Set();
function setOpacity(mesh, o){
  for (const m of mesh.userData.mats){ m.transparent = o < 1; m.opacity = o; m.depthWrite = o >= 1; }
}
function castFade(x, y, z, cameraSideOnly){
  fadeOrigin.set(x, y, z).addScaledVector(camDir, -120);
  fadeRay.set(fadeOrigin, camDir); fadeRay.far = 119.5;
  for (const h of fadeRay.intersectObjects(world.buildingMeshes, false)){
    const p = h.object.position;
    if (!cameraSideOnly || (p.x - player.pos.x)*-camDir.x + (p.z - player.pos.z)*-camDir.z > 0) want.add(h.object);
  }
}
export function updateFade(dt){
  want.clear();
  camera.getWorldDirection(camDir);
  const px = player.pos.x, pz = player.pos.z;
  castFade(px, 0.4, pz, false); castFade(px, 1.8, pz, false);
  for (const [ox,oz] of SAMPLES) castFade(px + ox, 0.5, pz + oz, true);
  for (const m of want) if (!faded.has(m)) faded.set(m, 1);
  for (const [m, o] of faded){
    const n = want.has(m) ? Math.max(FADE_MIN, o - dt*FADE_SPEED) : Math.min(1, o + dt*FADE_SPEED);
    setOpacity(m, n);
    if (n >= 1) faded.delete(m); else faded.set(m, n);
  }
}
