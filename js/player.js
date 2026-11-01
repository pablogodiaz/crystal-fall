// ---------- Players ----------
// Everyone in the session is in `players` (state.js): me() is the one this machine controls, viewed()
// the one the camera and HUD follow (another living player while you're dead and spectating).
// A player moves, aims and fires from its control state p.ctl = { mx, mz (world-space move direction),
// sprint, fire, use (E held), aim (world point) }: readLocal() fills it from the keyboard and mouse for
// me(), bots.js for dev-tools companions (networking will fill it for remote players). One-shot actions
// (reload, swap, throw, items…) are plain function calls that take the player.
import * as THREE from 'three';
import { TILE, N } from './config.js';
import { scene, camera } from './renderer.js';
import { SH, gunModel } from './assets.js';
import { WEAPONS, INV_SLOTS } from './items.js';
import { state, world, players, keys, mouse, mouseNDC, dev } from './state.js';
import { resolveCircle, reveal } from './grid.js';
import { fire, drainHp, meleeStrike, MELEE_TIME, MELEE_HIT } from './combat.js';
import { curWeapon, magSize } from './inventory.js';
import { burst } from './fx.js';
import { makeNoise } from './zombies.js';
import { updateBot } from './bots.js';
import { AI, COOP } from './threats.js';

export const MAX_PLAYERS = 4;
export const me = () => players[state.me];
export const viewed = () => players[state.view] || players[state.me];
// The living player closest to (x,z), or null when everyone is dead; nearestDist = how far that is.
export function nearestPlayer(x, z){
  let best = null, bd = Infinity;
  for (const p of players){ if (p.dead) continue; const d = (p.pos.x - x)**2 + (p.pos.z - z)**2; if (d < bd){ bd = d; best = p; } }
  return best;
}
export function nearestDist(x, z){ const p = nearestPlayer(x, z); return p ? Math.hypot(p.pos.x - x, p.pos.z - z) : Infinity; }
// Zombie scaling for the session's size (COOP in threats.js): residents() for the city's population,
// crowd(alive) for mid-fight spawns (alive = count only living players), zombieCap() the frame-time ceiling.
function scale(k, alive){ let n = 0; for (const p of players) if (!alive || !p.dead) n++; return 1 + k*Math.max(0, n - 1); }
export const residents = () => scale(COOP.residents);
export const crowd = alive => scale(COOP.spawns, alive);
export const zombieCap = () => Math.round(COOP.max*residents());
// Dev-tools cheats (god mode, noclip, speed, ignored…) only ever apply to the player you control.
export const cheats = p => p === players[state.me];
// Jacket and ring colour per slot (P1 keeps the original blue jacket and cream ring); css for the HUD.
const LOOKS = [[0x2f5d8a, 0xf2e6c8, '#8ec5ff'], [0x8a3a2f, 0xffa070, '#ff9a6a'], [0x3f7a3a, 0x9ef08a, '#8fe07a'], [0x6a3f8a, 0xd0a0ff, '#c9a0ff']];

// ---------- Bodies ----------
// Geometry and the skin/cap/pack materials are shared by every player; the jacket, ring and melee
// swoosh are per player (the swoosh fades, the jacket and ring carry the player's colour).
const PG = {
  body:new THREE.CylinderGeometry(0.33,0.36,0.85,12), head:new THREE.SphereGeometry(0.24,16,12), cap:new THREE.CylinderGeometry(0.25,0.25,0.12,14),
  pack:new THREE.BoxGeometry(0.5,0.55,0.25), arm:new THREE.BoxGeometry(0.14,0.14,0.55), swish:new THREE.RingGeometry(0.75,1.75,18,1,-Math.PI/2-0.95,1.9),
  ring:new THREE.RingGeometry(0.55,0.68,28),
  skin:new THREE.MeshStandardMaterial({ color:0xd9a77c, roughness:0.7 }), dark:new THREE.MeshStandardMaterial({ color:0x22252b, roughness:0.6, metalness:0.3 }),
  packMat:new THREE.MeshStandardMaterial({ color:0x6b5537, roughness:1 })
};
export const capParts = () => [PG.cap, PG.dark];  // the cap a player keeps on after turning (zombies.js)
function buildMesh(p){
  const [jc, rc] = LOOKS[p.slot];
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const jacket = new THREE.MeshStandardMaterial({ color:jc, roughness:0.8 });
  const body = new THREE.Mesh(PG.body, jacket); body.position.y = 1.03;
  const head = new THREE.Mesh(PG.head, PG.skin); head.position.y = 1.68;
  const cap = new THREE.Mesh(PG.cap, PG.dark); cap.position.y = 1.83;
  const bp = new THREE.Mesh(PG.pack, PG.packMat); bp.position.set(0,1.1,-0.36);
  const legs = [];
  for (const sx of [-0.15,0.15]){ const l = new THREE.Mesh(SH.zLeg, SH.pantsMat); l.position.set(sx,0.62,0); inner.add(l); legs.push(l); }
  const a1 = new THREE.Mesh(PG.arm, jacket); a1.position.set(0.28,1.18,0.25);
  const a2 = new THREE.Mesh(PG.arm, jacket); a2.position.set(-0.12,1.18,0.28); a2.rotation.y = 0.5;
  const gun = new THREE.Group(); gun.position.set(0.22,1.22,0.35);  // filled with the held weapon's model by refreshGun()
  inner.add(body, head, cap, bp, a1, a2, gun);
  // Melee swoosh: a flat arc in front of the player, shown during the strike.
  const swish = new THREE.Mesh(PG.swish, new THREE.MeshBasicMaterial({ color:0xfff1d0, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide }));
  swish.rotation.x = -Math.PI/2; swish.position.y = 1.05; swish.visible = false; g.add(swish);
  inner.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const ring = new THREE.Mesh(PG.ring, new THREE.MeshBasicMaterial({ color:rc, transparent:true, opacity:0.45, depthWrite:false }));
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.1; g.add(ring);
  Object.assign(p, { g, inner, legs, gun, arms:[a1, a2], swish, gunZ:0.35, mats:[jacket, swish.material, ring.material] });
  scene.add(g);
}
// One lamp lights the area around the player being watched (lights can't be added at runtime).
const lamp = new THREE.PointLight(0xffe2b0, 0.55, 10, 2); scene.add(lamp);
export function updateLamp(){ const v = viewed(); if (v) lamp.position.set(v.pos.x, 3, v.pos.z); }

// A new player in the first free slot (null when the session is full). Spawned next to the player
// you control, or placed at the start by the next startCity().
export function addPlayer(){
  if (players.length >= MAX_PLAYERS) return null;
  let slot = 0; while (players.some(o => o.slot === slot)) slot++;
  const p = { slot, name:'P' + (slot+1), css:LOOKS[slot][2], pos:new THREE.Vector3(), vel:new THREE.Vector3(), radius:0.45, angle:0, walk:0,
    dead:false, lastTile:-1, dist:new Int16Array(N*N).fill(-1), shownGun:null,
    ctl:{ mx:0, mz:0, sprint:false, fire:false, use:false, aim:new THREE.Vector3() },
    interact:{ target:null, p:0, label:'', noiseT:0, lock:false } };
  buildMesh(p); resetPlayerStats(p); refreshGun(p);
  players.push(p);
  return p;
}
// Takes a player out of the session (never the one you control).
export function removePlayer(p){
  const i = players.indexOf(p);
  if (i < 0 || i === state.me) return;
  p.dead = true; p.gone = true;
  for (const w of p.weapons) if (w) w.out = false;
  scene.remove(p.g); if (p.drone) scene.remove(p.drone); for (const m of p.mats) m.dispose();
  players.splice(i, 1);
  if (state.me > i) state.me--;
  if (state.view === i || state.view >= players.length) state.view = state.me; else if (state.view > i) state.view--;
}

// Base stats for a fresh run; upgrades modify these in place. Weapon stats live in WEAPONS (plus each
// gun's rarity modifiers); dmgMul/fireMul/magMul/reloadMul/pellets/pierce are upgrade modifiers on top
// (weaponStats in weapons.js). Weapons are instances (see weapons.js); the starting pistol is a Common.
export function resetPlayerStats(p){
  Object.assign(p, { hp:100, maxHp:100, speed:4.6, stamina:1, staminaDelay:0, staminaRate:1, winded:false, boost:0,
    reloadT:0, fireCd:0, meleeT:0, meleeCd:0, meleeHit:false, dead:false, kills:0, crafting:false,
    dmgMul:1, fireMul:1, magMul:1, reloadMul:1, pellets:0, pierce:0, regen:0,
    bleeding:false, throwSel:'molotov', aiming:false, bleedFx:0, stepT:0,
    weapons:[{ id:'pistol', rarity:'common', mods:[], mag:12, uid:Math.random(), cd:0, idle:0 }, null], cur:0,
    ammo:Object.assign(Object.fromEntries(Object.keys(WEAPONS).map(id => [id, 0])), { pistol:36 }), flameT:0,
    inv:[{ id:'bandage', n:1 }, { id:'drink', n:1 }].concat(new Array(INV_SLOTS-2).fill(null)) });
  if (p.g) p.g.visible = true;
}
// The model in the player's hands follows the held weapon (and its rarity accent).
export function refreshGun(p){
  const w = p.weapons[p.cur];
  if (p.shownGun !== w){ p.shownGun = w; p.gun.clear(); p.gun.add(gunModel(w.id, w.rarity)); }
  poseMelee(p, 0);
}
// Melee pose for swing progress k (0 = rest): wind up with the gun turned across the chest and
// pulled back, then drive it forward stock-first with a body twist, then recover.
const ease = x => x*x*(3 - 2*x);
function poseMelee(p, k){
  let a = 0, b = 0;  // a = wind-up amount, b = thrust amount
  if (k > 0 && k < 0.35) a = ease(k/0.35);
  else if (k >= 0.35 && k < 0.55){ b = ease((k-0.35)/0.2); a = 1 - b; }
  else if (k >= 0.55 && k < 1) b = 1 - ease((k-0.55)/0.45);
  const turn = Math.max(a, b), [a1, a2] = p.arms, gun = p.gun;
  p.inner.rotation.y = 0.55*a - 0.5*b;
  gun.rotation.set(-0.4*a, 1.3*turn, 0);
  gun.position.set(0.22 - 0.22*turn, 1.22 + 0.16*a, p.gunZ - 0.3*a + 0.45*b);
  a1.position.z = 0.25 - 0.2*a + 0.35*b; a1.rotation.x = -0.5*a;
  a2.position.z = 0.28 - 0.2*a + 0.4*b; a2.rotation.y = 0.5 + 0.4*b;
  const sw = p.swish, sk = (k - 0.38)/0.4;
  sw.visible = sk > 0 && sk < 1;
  if (sw.visible){ sw.material.opacity = 0.6*(1 - sk); sw.rotation.z = -0.5 + sk*0.9; }
}

// ---------- Local control ----------
// Screen-relative WASD mapped onto the isometric grid; mouse aim is a ray from the camera onto a
// horizontal plane at gun height. Nothing moves or fires while the workbench is open.
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0,1,0), -1.1), aimHit = new THREE.Vector3();
function readLocal(p){
  const c = p.ctl, busy = p.crafting;
  let ix = 0, iz = 0;
  if (!busy){
    if (keys.KeyW || keys.ArrowUp){ ix -= 1; iz -= 1; }
    if (keys.KeyS || keys.ArrowDown){ ix += 1; iz += 1; }
    if (keys.KeyD || keys.ArrowRight){ ix += 1; iz -= 1; }
    if (keys.KeyA || keys.ArrowLeft){ ix -= 1; iz += 1; }
  }
  c.mx = ix; c.mz = iz;
  c.sprint = !busy && !!(keys.ShiftLeft || keys.ShiftRight);
  c.fire = !busy && mouse.down; c.use = !busy && !!keys.KeyE;
  raycaster.setFromCamera(mouseNDC, camera);
  if (raycaster.ray.intersectPlane(aimPlane, aimHit)) c.aim.copy(aimHit);
}
// Every living player, every simulation step: read its controls, then move and act.
export function updatePlayers(dt){
  for (const p of players.slice()){
    if (p.dead) continue;
    if (p === me()) readLocal(p); else updateBot(p, dt);
    updatePlayer(p, dt);
    if (state.mode !== 'play') return;
  }
}

// Stamina: walking is slower than a runner, so sprinting is how you get away. Sprint drains
// stamina (staminaRate upgrade, energy-drink boost cut it); it refills after a short pause,
// faster standing still. Running dry leaves you winded: no sprint and a slower walk until
// stamina is back to WINDED_OK.
const SPRINT_MUL = 1.75, SPRINT_DRAIN = 0.28, REGEN = 0.24, REGEN_STILL = 1.7, REGEN_DELAY = 1, WINDED_OK = 0.4, WINDED_MUL = 0.8, BOOST_DRAIN = 0.4;

function updatePlayer(p, dt){
  const c = p.ctl, cheat = cheats(p);
  let ix = c.mx, iz = c.mz;
  const l = Math.hypot(ix,iz), moving = l > 0;
  if (moving){ ix /= l; iz /= l; }
  let spd = p.speed*(cheat ? dev.speed : 1);
  const sprint = c.sprint && moving && !p.winded;
  if (p.boost > 0) p.boost = Math.max(0, p.boost - dt);
  if (sprint){
    spd *= SPRINT_MUL; p.staminaDelay = REGEN_DELAY;
    p.stamina = Math.max(0, p.stamina - dt*SPRINT_DRAIN*p.staminaRate*(p.boost > 0 ? BOOST_DRAIN : 1));
    if (p.stamina <= 0) p.winded = true;
    // Running footsteps carry; walking is silent (zombies only notice you by sight).
    p.stepT -= dt;
    if (p.stepT <= 0){ p.stepT = AI.stepT; makeNoise(p.pos.x, p.pos.z, AI.sprintNoise); }
  } else {
    p.staminaDelay -= dt;
    if (p.staminaDelay <= 0) p.stamina = Math.min(1, p.stamina + dt*REGEN*(moving ? 1 : REGEN_STILL));
    if (p.winded && p.stamina >= WINDED_OK) p.winded = false;
  }
  if (p.winded) spd *= WINDED_MUL;
  const k = Math.min(1, dt*14);
  p.vel.x += (ix*spd - p.vel.x)*k; p.vel.z += (iz*spd - p.vel.z)*k;
  p.pos.x += p.vel.x*dt; p.pos.z += p.vel.z*dt;
  if (!(cheat && dev.noclip)){ resolveCircle(p.pos, p.radius); resolveCircle(p.pos, p.radius); }
  else { const m = world.city.n*TILE; p.pos.x = Math.min(m - 0.1, Math.max(TILE, p.pos.x)); p.pos.z = Math.min(m - TILE, Math.max(TILE, p.pos.z)); }
  const ax = c.aim.x - p.pos.x, az = c.aim.z - p.pos.z;
  if (ax*ax + az*az > 0.04) p.angle = Math.atan2(ax, az);
  p.g.position.copy(p.pos);
  p.g.rotation.y = p.angle;
  const v = Math.hypot(p.vel.x, p.vel.z);
  p.walk += dt*v*2.2;
  const sw = Math.sin(p.walk)*0.6*Math.min(1, v/2);
  p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw;
  p.inner.position.y = Math.abs(Math.sin(p.walk))*0.05*Math.min(1, v/2);
  if (p.reloadT > 0){
    p.reloadT -= dt;
    if (p.reloadT <= 0){
      const w = curWeapon(p), k = Math.max(0, Math.min(magSize(w, p) - w.mag, p.ammo[w.id]));
      p.reloadT = 0; w.mag += k; p.ammo[w.id] -= k;
    }
  }
  p.fireCd -= dt; p.meleeCd -= dt;
  if (p.meleeT > 0){
    p.meleeT = Math.max(0, p.meleeT - dt);
    const k = 1 - p.meleeT/MELEE_TIME;
    if (!p.meleeHit && k >= MELEE_HIT){ p.meleeHit = true; meleeStrike(p); }
    poseMelee(p, p.meleeT > 0 ? k : 0);
  }
  if (c.fire) fire(p, dt);
  if (p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen*1.2*dt);
  if (p.bleeding){
    p.bleedFx -= dt;
    if (p.bleedFx <= 0){ p.bleedFx = 0.35; burst(new THREE.Vector3(p.pos.x, 0.9, p.pos.z), 'blood', 1, 1); }
  }
  if (p.bleeding && drainHp(p, 1.1*dt)) return;
  // The explored map is shared: everyone uncovers it.
  const tx = Math.floor(p.pos.x/TILE), tz = Math.floor(p.pos.z/TILE), ti = tz*N+tx;
  if (ti !== p.lastTile){ p.lastTile = ti; reveal(tx, tz, 8); }
}
