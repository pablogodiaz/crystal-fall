// ---------- Throwables ----------
// Molotovs (burning area) and pipe bombs (beeping noise lure, then an explosion).
import * as THREE from 'three';
import { TILE } from './config.js';
import { mr } from './utils.js';
import { scene, fxLight } from './renderer.js';
import { SH } from './assets.js';
import { state, world, zombies, throwns, hazards } from './state.js';
import { isBlockedTile } from './grid.js';
import { player, aimPoint } from './player.js';
import { damageZombie, makeNoise } from './zombies.js';
import { hurtPlayer } from './combat.js';
import { burst } from './fx.js';
import { sfx } from './audio.js';

const FIRE_R = 2.6, FIRE_TIME = 6, FIRE_DPS = 2.4, BOMB_FUSE = 3.5, BOMB_R = 5.5, BOMB_DMG = 16, LURE_R = 32;
let flash = 0;

// Throws toward the cursor (max 13 units), landing short of the first wall in the way.
export function throwItem(id){
  const px = player.pos.x, pz = player.pos.z;
  let dx = aimPoint.x - px, dz = aimPoint.z - pz, d = Math.hypot(dx,dz);
  if (d < 0.5){ dx = Math.sin(player.angle); dz = Math.cos(player.angle); d = 1; }
  const ux = dx/d, uz = dz/d, max = Math.min(13, Math.max(2, d));
  let land = 0;
  for (let s=0.5;s<=max;s+=0.25){ if (isBlockedTile(Math.floor((px+ux*s)/TILE), Math.floor((pz+uz*s)/TILE))) break; land = s; }
  const m = new THREE.Mesh(id === 'molotov' ? SH.bottleGeo : SH.pipeGeo, id === 'molotov' ? SH.bottleMat : SH.pipeMat);
  m.position.set(px, 1.3, pz); scene.add(m);
  throwns.push({ id, mesh:m, sx:px, sz:pz, ex:px + ux*land, ez:pz + uz*land, t:0, T:0.3 + land/24 });
  sfx.throw();
  return true;
}
function land(o){
  const x = o.ex, z = o.ez;
  if (o.id === 'molotov'){
    const m = new THREE.Mesh(SH.fireGeo, SH.fireMat); m.rotation.x = -Math.PI/2; m.position.set(x, 0.07, z); m.scale.setScalar(FIRE_R);
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
function explode(h){
  const lv = 1 + 0.3*(state.level-1);
  for (const z of zombies.slice()){
    const dx = z.pos.x - h.x, dz = z.pos.z - h.z, d = Math.hypot(dx,dz);
    if (d < BOMB_R) damageZombie(z, BOMB_DMG*lv*(1 - d/(BOMB_R*1.25)), dx/(d||1)*2.5, dz/(d||1)*2.5);
  }
  const pd = Math.hypot(player.pos.x - h.x, player.pos.z - h.z);
  if (pd < BOMB_R) hurtPlayer(45*(1 - pd/(BOMB_R*1.1)), null);
  const p = new THREE.Vector3(h.x, 0.6, h.z);
  burst(p, 'fire', 24, 8); burst(p, 'spark', 16, 9); burst(p, 'dust', 16, 6);
  fxLight.position.set(h.x, 2, h.z); flash = 7;
  state.shake = Math.max(state.shake, 0.7);
  sfx.boom(); makeNoise(h.x, h.z, 40);
}
export function updateThrowables(dt){
  for (let i=throwns.length-1;i>=0;i--){
    const o = throwns[i]; o.t += dt;
    const k = Math.min(1, o.t/o.T);
    o.mesh.position.set(o.sx + (o.ex-o.sx)*k, 1.3*(1-k) + Math.sin(k*Math.PI)*(1 + o.T*3) + 0.12, o.sz + (o.ez-o.sz)*k);
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
        for (const z of zombies.slice()) if (Math.hypot(z.pos.x - h.x, z.pos.z - h.z) < FIRE_R + z.r*0.5) damageZombie(z, dmg, 0, 0, true);
        if (Math.hypot(player.pos.x - h.x, player.pos.z - h.z) < FIRE_R) hurtPlayer(2, null);
        if (state.mode !== 'play') return;
      }
      if (h.t <= 0){ scene.remove(h.mesh); hazards.splice(i,1); }
    } else {
      h.beep -= dt;
      if (h.beep <= 0){ h.beep = 0.12 + h.t*0.12; sfx.beep(); h.led.visible = true; makeNoise(h.x, h.z, LURE_R*0.6); }
      else if (h.beep < 0.06) h.led.visible = false;
      if (h.t <= 0){
        scene.remove(h.mesh); hazards.splice(i,1);
        if (world.lure === h) world.lure = null;
        explode(h);
        if (state.mode !== 'play') return;
      }
    }
  }
  if (fire && flash < 2) fxLight.position.set(fire.x, 1.5, fire.z);
  flash = Math.max(0, flash - dt*18);
  fxLight.intensity = Math.max(flash, fire ? 1.6 + Math.sin(performance.now()*0.02)*0.3 : 0);
}
