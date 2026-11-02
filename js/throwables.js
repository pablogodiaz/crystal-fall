// ---------- Throwables ----------
// Molotovs (burning area) and pipe bombs (beeping noise lure, then a stunning concussion blast).
// explosion()/queueBlast() are the damaging blasts of exploding zombies.
import * as THREE from 'three';
import { TILE } from './config.js';
import { mr } from './utils.js';
import { scene, fxLight } from './renderer.js';
import { SH } from './assets.js';
import { state, world, zombies, throwns, hazards, players } from './state.js';
import { isBlockedTile, isOpaqueTile, groundAt, onGround, gv } from './grid.js';
import { blastBreaks } from './breakables.js';
import { me } from './player.js';
import { damageZombie, stunZombie, makeNoise } from './zombies.js';
import { hurtPlayer, hitCrystal, CRYSTAL_R } from './combat.js';
import { selectedThrowable, countItem, curWeapon } from './inventory.js';
import { splashPotion } from './uniques.js';
import { WEAPONS } from './items.js';
import { weaponStats } from './weapons.js';
import { burst, shockwave, addDecal } from './fx.js';
import { sfx } from './audio.js';
import { emit, nextId } from './host.js';
import { shake } from './fx.js';
const r2 = v => Math.round(v*100)/100;

const FIRE_R = 2.6, FIRE_TIME = 6, FIRE_DPS = 2.4, BOMB_FUSE = 3.5, BOMB_R = 6, STUN_TIME = 2.5, LURE_R = 32;
let flash = 0;

// Flight path of player p's throw toward their aim point: max 13 units, landing short of the first wall
// in the way (it flies over fences, barriers and water, but never lands on them). T = flight time; arcY(k, T) = height at progress k. Shared by the throw and the aim preview.
export function throwPath(p){
  const px = p.pos.x, pz = p.pos.z;
  let dx = p.ctl.aim.x - px, dz = p.ctl.aim.z - pz, d = Math.hypot(dx,dz);
  if (d < 0.5){ dx = Math.sin(p.angle); dz = Math.cos(p.angle); d = 1; }
  const ux = dx/d, uz = dz/d, max = Math.min(13, Math.max(2, d));
  let land = 0;
  for (let s=0.5;s<=max;s+=0.25){
    const tx = Math.floor((px+ux*s)/TILE), tz = Math.floor((pz+uz*s)/TILE);
    if (isOpaqueTile(tx, tz)) break;
    if (!isBlockedTile(tx, tz)) land = s;
  }
  return { sx:px, sz:pz, ex:px + ux*land, ez:pz + uz*land, T:0.3 + land/24 };
}
// (On top of the ground at either end, blended along the way.)
const arcY = (k, T, o) => groundAt(o.sx, o.sz)*(1-k) + groundAt(o.ex, o.ez)*k + 1.3*(1-k) + Math.sin(k*Math.PI)*(1 + T*3) + 0.12;
export function throwItem(p, id){
  const path = throwPath(p);
  throwMesh(id, path.sx, path.sz, path.ex, path.ez, path.T).by = p;
  emit(['th', id, r2(path.sx), r2(path.sz), r2(path.ex), r2(path.ez), r2(path.T)]);
  sfx.throw();
  return true;
}
// Something in flight (ghost = a client's copy: it lands without doing anything).
export function throwMesh(id, sx, sz, ex, ez, T, ghost){
  const m = id === 'potion' ? new THREE.Mesh(SH.flaskGeo, SH.flaskMat) : new THREE.Mesh(id === 'molotov' ? SH.bottleGeo : SH.pipeGeo, id === 'molotov' ? SH.bottleMat : SH.pipeMat);
  m.position.set(sx, groundAt(sx, sz) + 1.3, sz); scene.add(m);
  const o = { id, mesh:m, t:0, sx, sz, ex, ez, T, ghost }; throwns.push(o); return o;
}
// Fire zones and pipe bombs on the ground (host: with their gameplay fields; clients: ghosts).
export function fireMesh(x, z, t, nid, ghost){
  const m = new THREE.Mesh(SH.fireGeo, SH.fireMat); onGround(m, x, z, 0.12, 0, true); m.scale.setScalar(FIRE_R);  // above block slabs (top at 0.08) and decals
  scene.add(m);
  const h = { kind:'fire', x, z, mesh:m, t, tick:0, nid, ghost }; hazards.push(h); return h;
}
export function bombMesh(x, z, t, nid, ghost){
  const g = new THREE.Group(); g.position.set(x, groundAt(x, z), z);
  const pipe = new THREE.Mesh(SH.pipeGeo, SH.pipeMat); pipe.rotation.z = Math.PI/2; pipe.position.y = 0.12;
  const led = new THREE.Mesh(SH.beepGeo, SH.beepMat); led.position.y = 0.26;
  g.add(pipe, led); scene.add(g);
  const h = { kind:'bomb', x, z, mesh:g, led, t, beep:0, nid, ghost }; hazards.push(h); return h;
}
export function flashAt(x, z){ fxLight.position.set(x, groundAt(x, z) + 2, z); flash = 7; }

// The Turncoat flask (a unique weapon) flies like a throwable; it splashes in uniques.js.
export const throwPotion = p => throwItem(p, 'potion');

// ---------- Aim preview (hold right click) ----------
// Outline of the area the throwable will affect (fire / blast radius) plus a dotted flight arc.
// Also shown whenever a ready Turncoat flask or a loaded gravity well launcher is in your hands.
// Drawn without depth testing so it stays visible behind buildings. Built once, never disposed.
const PREVIEW = { molotov:{ r:FIRE_R, color:0xff8a2a }, pipebomb:{ r:BOMB_R, color:0x8cc8ff }, potion:{ r:WEAPONS.potion.radius, color:0xff5fd2 }, gravity:{ r:WEAPONS.gravity.radius, color:0xa070ff } };
let preview = null;
function buildPreview(){
  const mat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.85, depthTest:false, depthWrite:false, side:THREE.DoubleSide });
  const fillMat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.14, depthTest:false, depthWrite:false, side:THREE.DoubleSide });
  const g = new THREE.Group(); g.visible = false; g.renderOrder = 10;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 56), mat); ring.rotation.x = -Math.PI/2;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 56), fillMat); fill.rotation.x = -Math.PI/2;
  const center = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.22, 20), mat); center.rotation.x = -Math.PI/2;
  const dotGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12), dots = [];
  for (let i=0;i<16;i++){ const d = new THREE.Mesh(dotGeo, mat); dots.push(d); g.add(d); }
  g.add(ring, fill, center);
  g.traverse(o => { o.renderOrder = 10; });
  scene.add(g);
  return { g, ring, fill, center, dots, mat, fillMat };
}
// Called every frame: shows the preview while the player you control is aiming, hides it otherwise.
export function updateThrowPreview(){
  const pl = me(), play = state.mode === 'play' && pl && !pl.dead;
  let id = pl && pl.aiming && play ? selectedThrowable(pl) : null;
  if (pl && pl.aiming && !countItem(pl, id)){ pl.aiming = false; id = null; }
  const w = play && curWeapon(pl);
  if (!id && w && w.id === 'potion' && w.cd <= 0) id = 'potion';
  if (!id && w && w.id === 'gravity' && w.mag >= 1) id = 'gravity';
  if (!id){ if (preview) preview.g.visible = false; return; }
  preview = preview || buildPreview();
  const p = throwPath(pl), P = PREVIEW[id], r = (id === 'potion' || id === 'gravity') && w.id === id ? weaponStats(w).range : P.r;
  preview.mat.color.setHex(P.color); preview.fillMat.color.setHex(P.color);
  for (const o of [preview.ring, preview.fill]){ onGround(o, p.ex, p.ez, 0.13, 0, true); o.scale.setScalar(r); }
  onGround(preview.center, p.ex, p.ez, 0.13, 0, true);
  preview.dots.forEach((d, i) => {
    const k = (i+1)/(preview.dots.length+1);
    d.position.set(p.sx + (p.ex-p.sx)*k, arcY(k, p.T, p), p.sz + (p.ez-p.sz)*k);
  });
  preview.g.visible = true;
}
function land(o){
  const x = o.ex, z = o.ez;
  if (o.id === 'potion'){ burst(gv(x, 0.4, z), 'brew', 6, 2); splashPotion(o.by, x, z); }
  else if (o.id === 'molotov'){
    const h = fireMesh(x, z, FIRE_TIME, nextId()); h.by = o.by;
    emit(['hz+', h.nid, 'fire', r2(x), r2(z), FIRE_TIME]);
    burst(gv(x, 0.5, z), 'fire', 16, 4); burst(gv(x, 0.5, z), 'spark', 8, 4);
    sfx.ignite(); makeNoise(x, z, 14);
  } else {
    const h = bombMesh(x, z, BOMB_FUSE, nextId()); world.lure = h;
    emit(['hz+', h.nid, 'bomb', r2(x), r2(z), BOMB_FUSE]);
    makeNoise(x, z, LURE_R, true);
  }
}
// Blast at (x,z): zombies take zDmg (scaled by city) and players pDmg, both falling off with distance.
export function explosion(x, z, R, zDmg, pDmg, noise){
  const lv = 1 + 0.3*(state.level-1);
  for (const o of zombies.slice()){
    const dx = o.pos.x - x, dz = o.pos.z - z, d = Math.hypot(dx,dz);
    if (d < R) damageZombie(o, zDmg*lv*(1 - d/(R*1.25)), dx/(d||1)*2.5, dz/(d||1)*2.5, 'blast');
  }
  for (const p of players){
    const pd = Math.hypot(p.pos.x - x, p.pos.z - z);
    if (!p.dead && pd < R) hurtPlayer(p, pDmg*(1 - pd/(R*1.1)), null);
  }
  blastBreaks(x, z, R, 12);
  const p = gv(x, 0.6, z);
  burst(p, 'fire', 24, 8); burst(p, 'spark', 16, 9); burst(p, 'dust', 16, 6);
  shockwave(x, z, R, 0xff6a1a); addDecal(x, z, R*0.75, SH.scorchMat);
  flashAt(x, z); emit(['fl', r2(x), r2(z)]);
  shake(0.7);
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
  const p = gv(x, 0.6, z);
  burst(p, 'spark', 22, 9); burst(p, 'dust', 20, 7); shockwave(x, z, BOMB_R, 0x8cc8ff);
  flashAt(x, z); emit(['fl', r2(x), r2(z)]);
  shake(0.6);
  sfx.boom(); makeNoise(x, z, 40);
}
// Delayed blast (exploding zombies), so chain reactions ripple instead of going off in one frame.
export function queueBlast(x, z, delay, R, zDmg, pDmg){ hazards.push({ kind:'blast', x, z, t:delay, R, zDmg, pDmg }); }
export function updateThrowables(dt){
  for (let i=throwns.length-1;i>=0;i--){
    const o = throwns[i]; o.t += dt;
    const k = Math.min(1, o.t/o.T);
    o.mesh.position.set(o.sx + (o.ex-o.sx)*k, arcY(k, o.T, o), o.sz + (o.ez-o.sz)*k);
    o.mesh.rotation.x += dt*14;
    if (k >= 1){ scene.remove(o.mesh); throwns.splice(i,1); land(o); }
  }
  let fire = null;
  for (let i=hazards.length-1;i>=0;i--){
    const h = hazards[i]; h.t -= dt;
    if (h.kind === 'fire'){
      fire = fire || h;
      h.mesh.scale.setScalar(FIRE_R*(h.t < 1 ? Math.max(0.1, h.t) : 1) + Math.sin(h.t*20)*0.08);
      if (Math.random() < dt*22) burst(gv(h.x + mr(-1.8,1.8), 0.2, h.z + mr(-1.8,1.8)), 'fire', 1, 0.6, true);
      h.tick -= dt;
      if (h.tick <= 0){
        h.tick = 0.25;
        const dmg = FIRE_DPS*0.25*(1 + 0.3*(state.level-1));
        for (const z of zombies.slice()) if (Math.hypot(z.pos.x - h.x, z.pos.z - h.z) < FIRE_R + z.r*0.5) damageZombie(z, dmg, 0, 0, 'fire', h.by);
        const cr = world.crystal;
        if (cr && cr.alive && Math.hypot(cr.pos.x - h.x, cr.pos.z - h.z) < FIRE_R + CRYSTAL_R) hitCrystal(dmg);
        for (const p of players) if (!p.dead && Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < FIRE_R) hurtPlayer(p, 2, null);
        if (state.mode !== 'play') return;
      }
      if (h.t <= 0){ scene.remove(h.mesh); hazards.splice(i,1); emit(['hz-', h.nid]); }
    } else if (h.kind === 'blast'){
      if (h.t <= 0){
        hazards.splice(i,1);
        explosion(h.x, h.z, h.R, h.zDmg, h.pDmg, 30);
        if (state.mode !== 'play') return;
      }
    } else {
      h.beep -= dt;
      if (h.beep <= 0){ h.beep = 0.12 + h.t*0.12; sfx.beep(); h.led.visible = true; makeNoise(h.x, h.z, LURE_R*0.6, true); }
      else if (h.beep < 0.06) h.led.visible = false;
      if (h.t <= 0){
        scene.remove(h.mesh); hazards.splice(i,1); emit(['hz-', h.nid]);
        if (world.lure === h) world.lure = null;
        stunBlast(h.x, h.z);
        if (state.mode !== 'play') return;
      }
    }
  }
  if (fire && flash < 2) fxLight.position.set(fire.x, groundAt(fire.x, fire.z) + 1.5, fire.z);
  flash = Math.max(0, flash - dt*18);
  fxLight.intensity = Math.max(flash, fire ? 1.6 + Math.sin(performance.now()*0.02)*0.3 : 0);
}
// A client's copies of throws in flight, fire zones and pipe bombs: looks only (what they do arrives
// from the host), plus the fire / explosion light.
export function animateThrowGhosts(dt){
  for (let i=throwns.length-1;i>=0;i--){
    const o = throwns[i]; o.t += dt;
    const k = Math.min(1, o.t/o.T);
    o.mesh.position.set(o.sx + (o.ex-o.sx)*k, arcY(k, o.T, o), o.sz + (o.ez-o.sz)*k);
    o.mesh.rotation.x += dt*14;
    if (k >= 1){ scene.remove(o.mesh); throwns.splice(i,1); }
  }
  let fire = null;
  for (let i=hazards.length-1;i>=0;i--){
    const h = hazards[i]; h.t -= dt;
    if (h.kind === 'fire'){
      fire = fire || h;
      h.mesh.scale.setScalar(FIRE_R*(h.t < 1 ? Math.max(0.1, h.t) : 1) + Math.sin(h.t*20)*0.08);
      if (Math.random() < dt*22) burst(gv(h.x + mr(-1.8,1.8), 0.2, h.z + mr(-1.8,1.8)), 'fire', 1, 0.6, true);
    } else if (h.kind === 'bomb'){
      h.beep -= dt;
      if (h.beep <= 0){ h.beep = 0.12 + Math.max(0, h.t)*0.12; h.led.visible = true; } else if (h.beep < 0.06) h.led.visible = false;
    }
    if (h.t <= -0.5){ scene.remove(h.mesh); hazards.splice(i,1); }  // the host's end event normally comes first
  }
  if (fire && flash < 2) fxLight.position.set(fire.x, groundAt(fire.x, fire.z) + 1.5, fire.z);
  flash = Math.max(0, flash - dt*18);
  fxLight.intensity = Math.max(flash, fire ? 1.6 + Math.sin(performance.now()*0.02)*0.3 : 0);
}
