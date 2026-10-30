// ---------- Throwables ----------
// Molotovs (burning area) and pipe bombs (beeping noise lure, then a stunning concussion blast).
// explosion()/queueBlast() are the damaging blasts of exploding zombies.
import * as THREE from 'three';
import { TILE } from './config.js';
import { mr } from './utils.js';
import { scene, fxLight } from './renderer.js';
import { SH } from './assets.js';
import { state, world, zombies, throwns, hazards } from './state.js';
import { isBlockedTile } from './grid.js';
import { player, aimPoint } from './player.js';
import { damageZombie, stunZombie, makeNoise } from './zombies.js';
import { hurtPlayer, hitCrystal, CRYSTAL_R } from './combat.js';
import { selectedThrowable, countItem } from './inventory.js';
import { burst, shockwave, addDecal } from './fx.js';
import { sfx } from './audio.js';

const FIRE_R = 2.6, FIRE_TIME = 6, FIRE_DPS = 2.4, BOMB_FUSE = 3.5, BOMB_R = 6, STUN_TIME = 2.5, LURE_R = 32;
let flash = 0;

// Flight path of a throw toward the cursor: max 13 units, landing short of the first wall in the way.
// T = flight time; arcY(k, T) = height at progress k. Shared by the throw and the aim preview.
function throwPath(){
  const px = player.pos.x, pz = player.pos.z;
  let dx = aimPoint.x - px, dz = aimPoint.z - pz, d = Math.hypot(dx,dz);
  if (d < 0.5){ dx = Math.sin(player.angle); dz = Math.cos(player.angle); d = 1; }
  const ux = dx/d, uz = dz/d, max = Math.min(13, Math.max(2, d));
  let land = 0;
  for (let s=0.5;s<=max;s+=0.25){ if (isBlockedTile(Math.floor((px+ux*s)/TILE), Math.floor((pz+uz*s)/TILE))) break; land = s; }
  return { sx:px, sz:pz, ex:px + ux*land, ez:pz + uz*land, T:0.3 + land/24 };
}
const arcY = (k, T) => 1.3*(1-k) + Math.sin(k*Math.PI)*(1 + T*3) + 0.12;
export function throwItem(id){
  const p = throwPath();
  const m = new THREE.Mesh(id === 'molotov' ? SH.bottleGeo : SH.pipeGeo, id === 'molotov' ? SH.bottleMat : SH.pipeMat);
  m.position.set(p.sx, 1.3, p.sz); scene.add(m);
  throwns.push(Object.assign({ id, mesh:m, t:0 }, p));
  sfx.throw();
  return true;
}

// ---------- Aim preview (hold G) ----------
// Outline of the area the throwable will affect (fire / blast radius) plus a dotted flight arc.
// Drawn without depth testing so it stays visible behind buildings. Built once, never disposed.
const PREVIEW = { molotov:{ r:FIRE_R, color:0xff8a2a }, pipebomb:{ r:BOMB_R, color:0x8cc8ff } };
let preview = null;
function buildPreview(){
  const mat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.85, depthTest:false, depthWrite:false, side:THREE.DoubleSide });
  const fillMat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.14, depthTest:false, depthWrite:false, side:THREE.DoubleSide });
  const g = new THREE.Group(); g.visible = false; g.renderOrder = 10;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 56), mat); ring.rotation.x = -Math.PI/2;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 56), fillMat); fill.rotation.x = -Math.PI/2;
  const center = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.22, 20), mat); center.rotation.x = -Math.PI/2;
  const dotGeo = new THREE.SphereGeometry(0.07, 6, 4), dots = [];
  for (let i=0;i<16;i++){ const d = new THREE.Mesh(dotGeo, mat); dots.push(d); g.add(d); }
  g.add(ring, fill, center);
  g.traverse(o => { o.renderOrder = 10; });
  scene.add(g);
  return { g, ring, fill, center, dots, mat, fillMat };
}
// Called every frame in play: shows the preview while player.aiming, hides it otherwise.
export function updateThrowPreview(){
  const id = player.aiming && state.mode === 'play' ? selectedThrowable() : null;
  if (player.aiming && !countItem(id)) player.aiming = false;
  if (!player.aiming || !id){ if (preview) preview.g.visible = false; return; }
  preview = preview || buildPreview();
  const p = throwPath(), P = PREVIEW[id];
  preview.mat.color.setHex(P.color); preview.fillMat.color.setHex(P.color);
  for (const o of [preview.ring, preview.fill]){ o.position.set(p.ex, 0.13, p.ez); o.scale.setScalar(P.r); }
  preview.center.position.set(p.ex, 0.13, p.ez);
  preview.dots.forEach((d, i) => {
    const k = (i+1)/(preview.dots.length+1);
    d.position.set(p.sx + (p.ex-p.sx)*k, arcY(k, p.T), p.sz + (p.ez-p.sz)*k);
  });
  preview.g.visible = true;
}
function land(o){
  const x = o.ex, z = o.ez;
  if (o.id === 'molotov'){
    const m = new THREE.Mesh(SH.fireGeo, SH.fireMat); m.rotation.x = -Math.PI/2; m.position.set(x, 0.12, z); m.scale.setScalar(FIRE_R);  // above block slabs (top at 0.08) and decals
    scene.add(m);
    hazards.push({ kind:'fire', x, z, mesh:m, t:FIRE_TIME, tick:0 });
    burst(new THREE.Vector3(x, 0.5, z), 'fire', 16, 4); burst(new THREE.Vector3(x, 0.5, z), 'spark', 8, 4);
    sfx.ignite(); makeNoise(x, z, 14);
  } else {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const pipe = new THREE.Mesh(SH.pipeGeo, SH.pipeMat); pipe.rotation.z = Math.PI/2; pipe.position.y = 0.12;
    const led = new THREE.Mesh(SH.beepGeo, SH.beepMat); led.position.y = 0.26;
    g.add(pipe, led); scene.add(g);
    const h = { kind:'bomb', x, z, mesh:g, led, t:BOMB_FUSE, beep:0 };
    hazards.push(h); world.lure = h;
    makeNoise(x, z, LURE_R);
  }
}
// Blast at (x,z): zombies take zDmg (scaled by city) and the player pDmg, both falling off with distance.
export function explosion(x, z, R, zDmg, pDmg, noise){
  const lv = 1 + 0.3*(state.level-1);
  for (const o of zombies.slice()){
    const dx = o.pos.x - x, dz = o.pos.z - z, d = Math.hypot(dx,dz);
    if (d < R) damageZombie(o, zDmg*lv*(1 - d/(R*1.25)), dx/(d||1)*2.5, dz/(d||1)*2.5, 'blast');
  }
  const pd = Math.hypot(player.pos.x - x, player.pos.z - z);
  if (pd < R) hurtPlayer(pDmg*(1 - pd/(R*1.1)), null);
  const p = new THREE.Vector3(x, 0.6, z);
  burst(p, 'fire', 24, 8); burst(p, 'spark', 16, 9); burst(p, 'dust', 16, 6);
  shockwave(x, z, R, 0xff6a1a); addDecal(x, z, R*0.75, SH.scorchMat);
  fxLight.position.set(x, 2, z); flash = 7;
  state.shake = Math.max(state.shake, 0.7);
  sfx.boom(); makeNoise(x, z, noise);
}
// Pipe bomb: a concussion that stuns zombies within BOMB_R (longest at the center) and shoves
// them back. Deals no damage to anyone.
function stunBlast(x, z){
  for (const o of zombies){
    const dx = o.pos.x - x, dz = o.pos.z - z, d = Math.hypot(dx,dz);
    if (d >= BOMB_R) continue;
    stunZombie(o, STUN_TIME*(1 - 0.4*d/BOMB_R));
    o.vel.x += dx/(d||1)*o.kb*1.2; o.vel.z += dz/(d||1)*o.kb*1.2;
  }
  const p = new THREE.Vector3(x, 0.6, z);
  burst(p, 'spark', 22, 9); burst(p, 'dust', 20, 7); shockwave(x, z, BOMB_R, 0x8cc8ff);
  fxLight.position.set(x, 2, z); flash = 7;
  state.shake = Math.max(state.shake, 0.6);
  sfx.boom(); makeNoise(x, z, 40);
}
// Delayed blast (exploding zombies), so chain reactions ripple instead of going off in one frame.
export function queueBlast(x, z, delay, R, zDmg, pDmg){ hazards.push({ kind:'blast', x, z, t:delay, R, zDmg, pDmg }); }
export function updateThrowables(dt){
  for (let i=throwns.length-1;i>=0;i--){
    const o = throwns[i]; o.t += dt;
    const k = Math.min(1, o.t/o.T);
    o.mesh.position.set(o.sx + (o.ex-o.sx)*k, arcY(k, o.T), o.sz + (o.ez-o.sz)*k);
    o.mesh.rotation.x += dt*14;
    if (k >= 1){ scene.remove(o.mesh); throwns.splice(i,1); land(o); }
  }
  let fire = null;
  for (let i=hazards.length-1;i>=0;i--){
    const h = hazards[i]; h.t -= dt;
    if (h.kind === 'fire'){
      fire = fire || h;
      h.mesh.scale.setScalar(FIRE_R*(h.t < 1 ? Math.max(0.1, h.t) : 1) + Math.sin(h.t*20)*0.08);
      if (Math.random() < dt*22) burst(new THREE.Vector3(h.x + mr(-1.8,1.8), 0.2, h.z + mr(-1.8,1.8)), 'fire', 1, 0.6);
      h.tick -= dt;
      if (h.tick <= 0){
        h.tick = 0.25;
        const dmg = FIRE_DPS*0.25*(1 + 0.3*(state.level-1));
        for (const z of zombies.slice()) if (Math.hypot(z.pos.x - h.x, z.pos.z - h.z) < FIRE_R + z.r*0.5) damageZombie(z, dmg, 0, 0, 'fire');
        const cr = world.crystal;
        if (cr && cr.alive && Math.hypot(cr.pos.x - h.x, cr.pos.z - h.z) < FIRE_R + CRYSTAL_R) hitCrystal(dmg);
        if (Math.hypot(player.pos.x - h.x, player.pos.z - h.z) < FIRE_R) hurtPlayer(2, null);
        if (state.mode !== 'play') return;
      }
      if (h.t <= 0){ scene.remove(h.mesh); hazards.splice(i,1); }
    } else if (h.kind === 'blast'){
      if (h.t <= 0){
        hazards.splice(i,1);
        explosion(h.x, h.z, h.R, h.zDmg, h.pDmg, 30);
        if (state.mode !== 'play') return;
      }
    } else {
      h.beep -= dt;
      if (h.beep <= 0){ h.beep = 0.12 + h.t*0.12; sfx.beep(); h.led.visible = true; makeNoise(h.x, h.z, LURE_R*0.6); }
      else if (h.beep < 0.06) h.led.visible = false;
      if (h.t <= 0){
        scene.remove(h.mesh); hazards.splice(i,1);
        if (world.lure === h) world.lure = null;
        stunBlast(h.x, h.z);
        if (state.mode !== 'play') return;
      }
    }
  }
  if (fire && flash < 2) fxLight.position.set(fire.x, 1.5, fire.z);
  flash = Math.max(0, flash - dt*18);
  fxLight.intensity = Math.max(flash, fire ? 1.6 + Math.sin(performance.now()*0.02)*0.3 : 0);
}
