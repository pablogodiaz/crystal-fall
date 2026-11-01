// ---------- FX ----------
// Particles, blood decals, health pickups (zombie drops), and building fade.
import * as THREE from 'three';
import { TILE, N, T } from './config.js';
import { mr } from './utils.js';
import { scene, camera } from './renderer.js';
import { SH } from './assets.js';
import { state, world, particles, decals, pickups, rings, players } from './state.js';
import { viewed } from './player.js';
import { floatText } from './hud.js';
import { freeSpot } from './loot.js';
import { emit, emitTo, sfxFor, nextId } from './host.js';
import { groundAt } from './grid.js';

// Shared effects (burst, addDecal, rings, shake) are sent to clients too, unless `local` (effects
// clients make themselves: ambient particles of things they mirror, corpses, the menu).
const r2 = v => Math.round(v*100)/100;
export function burst(pos, kind, n, spd, local){
  if (!local) emit(['b', r2(pos.x), r2(pos.y), r2(pos.z), kind, n, spd]);
  for (let i=0;i<n;i++){
    if (particles.length > 280) break;
    const m = new THREE.Mesh(SH.partGeo, SH.partMats[kind]);
    m.position.copy(pos); m.scale.setScalar(mr(0.6,1.4));
    const a = Math.random()*Math.PI*2, s = mr(0.3,1)*spd;
    scene.add(m);
    particles.push({ m, vx:Math.sin(a)*s, vy:mr(1.5,4.5), vz:Math.cos(a)*s, life:mr(0.35,0.8), fl:groundAt(pos.x, pos.z) + 0.12 });
  }
}
export function updateParticles(dt){
  for (let i=particles.length-1;i>=0;i--){
    const p = particles[i]; p.life -= dt;
    p.vy -= 12*dt; p.m.position.x += p.vx*dt; p.m.position.y += p.vy*dt; p.m.position.z += p.vz*dt;
    if (p.m.position.y < p.fl){ p.m.position.y = p.fl; p.vx *= 0.6; p.vz *= 0.6; p.vy = 0; }
    if (p.life < 0.2) p.m.scale.multiplyScalar(0.9);
    if (p.life <= 0){ scene.remove(p.m); particles.splice(i,1); }
  }
}
// Blood splat by default; s scales it, mat swaps it (SH.holeMat dirt, SH.scorchMat blast marks).
const DECALS = () => ({ blood:SH.decalMat, hole:SH.holeMat, scorch:SH.scorchMat, brew:SH.brewMat });
export function addDecal(x, z, s = 1, mat = SH.decalMat, local){
  if (typeof mat === 'string') mat = DECALS()[mat];
  if (!local){ const D = DECALS(); emit(['dc', r2(x), r2(z), r2(s), Object.keys(D).find(k => D[k] === mat)]); }
  const m = new THREE.Mesh(SH.decalGeo, mat);
  m.rotation.x = -Math.PI/2; m.rotation.z = Math.random()*6;
  const t = world.city.grid[Math.floor(z/TILE)*N + Math.floor(x/TILE)];
  m.position.set(x, groundAt(x, z) + (t === T.ROAD ? 0.02 + Math.random()*0.004 : 0.09 + Math.random()*0.004), z);
  m.scale.set(s*mr(0.8,1.6), s*mr(0.7,1.3), 1);
  scene.add(m); decals.push(m);
  if (decals.length > 80) scene.remove(decals.shift());
}
// Flat ring (plus a fading fill disc) that sweeps out to radius r at ground level: shows exactly
// how far a blast reached. Entries live in `rings`, animated in specials.js.
export function shockwave(x, z, r, color){
  addRing('blast', color, x, 0.14, z, r*0.25, r, 0.6, 0.95); addRing('fill', color, x, 0.14, z, r*0.25, r, 0.6, 0.4);
}
// A flat ring (geo: 'mark' thin ring, 'blast' blast ring, 'fill' disc) easing out from r0 to r1 over T s
// while fading from opacity op. Entries live in `rings` (they own their material).
export function addRing(geo, color, x, y, z, r0, r1, T, op, local){
  if (!local) emit(['rg', geo, color, r2(x), r2(y), r2(z), r0, r1, T, op]);
  const G = { mark:SH.markGeo, blast:SH.blastRingGeo, fill:SH.blastFillGeo }[geo];
  const m = new THREE.Mesh(G, new THREE.MeshBasicMaterial({ color, transparent:true, opacity:op, depthWrite:false, side:THREE.DoubleSide }));
  m.rotation.x = -Math.PI/2; m.position.set(x, y, z); m.scale.setScalar(r0);
  scene.add(m); rings.push({ mesh:m, t:0, T, r0, r1, op });
}
export function animateRings(dt){
  for (let i=rings.length-1;i>=0;i--){
    // Expanding rings (screams, shockwaves): ease out from r0 to r1 over T s while fading.
    const r = rings[i]; r.t += dt; const k = Math.min(1, r.t/r.T);
    r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0)*(1 - (1-k)**3)); r.mesh.material.opacity = r.op*(1 - k*k);
    if (r.t >= r.T){ scene.remove(r.mesh); r.mesh.material.dispose(); rings.splice(i,1); }
  }
}
// Screen shake: for player p only (their screen, wherever they play), or for everyone without p.
export function shake(a, p){
  if (p){ if (p === viewed()) state.shake = Math.max(state.shake, a); emitTo(p, ['sh', a]); return; }
  state.shake = Math.max(state.shake, a); emit(['sh', a]);
}
// Health crosses (zombie drops): pickupMesh builds one (clients mirror them), nid = its id on the wire.
export function spawnPickup(x,z){
  [x, z] = freeSpot(x, z);  // not on top of other drops
  const p = pickupMesh(x, z, nextId()); emit(['h+', p.nid, r2(x), r2(z)]);
  return p;
}
export function pickupMesh(x, z, nid){
  const g = new THREE.Group(); g.position.set(x, groundAt(x, z), z);
  const c = new THREE.Group(); c.position.y = 0.8;
  c.add(new THREE.Mesh(SH.crossA, SH.crossMat), new THREE.Mesh(SH.crossB, SH.crossMat));
  const ring = new THREE.Mesh(SH.ringGeo, SH.healGlow); ring.rotation.x = -Math.PI/2; ring.position.y = 0.12;
  g.add(c, ring); scene.add(g);
  const p = { g, c, life:25, t:Math.random()*6, nid };
  pickups.push(p); return p;
}
export function animatePickup(p, dt){
  p.life -= dt; p.t += dt;
  p.c.rotation.y += dt*2.2; p.c.position.y = 0.8 + Math.sin(p.t*3)*0.12;
  p.g.visible = p.life > 4 || Math.floor(p.t*6)%2 === 0;
}
export function updatePickups(dt){
  for (let i=pickups.length-1;i>=0;i--){
    const p = pickups[i]; animatePickup(p, dt);
    // The first hurt player to step on it gets it.
    const pl = players.find(o => !o.dead && o.hp < o.maxHp && Math.hypot(p.g.position.x - o.pos.x, p.g.position.z - o.pos.z) < 1.3);
    if (pl){
      const k = Math.ceil(Math.min(20, pl.maxHp - pl.hp));
      pl.hp = Math.min(pl.maxHp, pl.hp + 20); sfxFor(pl, 'pickup'); floatText(`+${k} health`, 'good', pl);
      burst(new THREE.Vector3(p.g.position.x, 1, p.g.position.z), 'heal', 8, 2);
      scene.remove(p.g); pickups.splice(i,1); emit(['h-', p.nid]); continue;
    }
    if (p.life <= 0){ scene.remove(p.g); pickups.splice(i,1); emit(['h-', p.nid]); }
  }
}

// ---------- Building fade (keeps the watched player and their surroundings visible) ----------
// Rays run from the camera to the player and to sample points on a disc around them. A building
// they hit fades out, but (apart from ones hiding the player) only if its center is on the camera
// side of the player, so buildings beyond you stay solid. Opacity eases in and out.
// A building made of several meshes (walk-in landmarks) names one of them userData.fadeKey, which
// holds the materials (userData.mats) and stands for all of them; userData.center overrides its
// position for the camera-side test. A cut-away landmark (you're inside) doesn't fade.
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
    const o = h.object.userData.fadeKey || h.object, p = o.userData.center || o.position;
    if (o.userData.cut) continue;
    if (!cameraSideOnly || (p.x - fadeAt.x)*-camDir.x + (p.z - fadeAt.z)*-camDir.z > 0) want.add(o);
  }
}
let fadeAt = null;
export function updateFade(dt){
  want.clear();
  camera.getWorldDirection(camDir);
  fadeAt = viewed().pos;
  const px = fadeAt.x, pz = fadeAt.z;
  castFade(px, 0.4, pz, false); castFade(px, 1.8, pz, false);
  for (const [ox,oz] of SAMPLES) castFade(px + ox, 0.5, pz + oz, true);
  for (const m of want) if (!faded.has(m)) faded.set(m, 1);
  for (const [m, o] of faded){
    const n = want.has(m) ? Math.max(FADE_MIN, o - dt*FADE_SPEED) : Math.min(1, o + dt*FADE_SPEED);
    setOpacity(m, n);
    if (n >= 1) faded.delete(m); else faded.set(m, n);
  }
}

// ---------- Walk-in landmarks ----------
// While the watched player is inside one, its roof lifts off and its walls sink to knee height (they still block).
export function updateInteriors(dt){
  if (!world.interiorAt) return;
  const v = viewed().pos, tx = Math.floor(v.x/TILE), tz = Math.floor(v.z/TILE);
  const inside = tx >= 0 && tz >= 0 && tx < N && tz < N ? world.interiorAt[tz*N+tx] - 1 : -1;
  world.interiors.forEach((it, i) => {
    const want = i === inside ? 1 : 0;
    if (it.k === want) return;
    it.k = want > it.k ? Math.min(1, it.k + dt*4) : Math.max(0, it.k - dt*4);
    it.shell.scale.y = 1 - 0.8*it.k; it.roof.visible = it.k < 0.35; it.key.userData.cut = it.k > 0.1;
  });
}
