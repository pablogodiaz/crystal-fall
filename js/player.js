// ---------- Players ----------
// Everyone in the session is in `players` (state.js): me() is the one this machine controls, viewed()
// the one the camera and HUD follow (another living player while you're dead and spectating).
// A player moves, aims and fires from its control state p.ctl = { mx, mz (world-space move direction),
// sprint, fire, use (E held), aim (world point) }: readLocal() fills it from the keyboard and mouse for
// me(), bots.js for dev-tools companions (networking will fill it for remote players). One-shot actions
// (reload, swap, throw, items…) are plain function calls that take the player.
import * as THREE from 'three';
import { TILE, N, BREAKABLES, walkable } from './config.js';
import { scene, camera } from './renderer.js';
import { SH, gunModel, squareFrame } from './assets.js';
import { WEAPONS, INV_SLOTS } from './items.js';
import { state, world, players, keys, mouse, mouseNDC, dev, pad } from './state.js';
import { resolveCircle, reveal, groundAt, tileLevel, levelOf, toGround } from './grid.js';
import { fire, drainHp, meleeStrike, MELEE_TIME, MELEE_HIT } from './combat.js';
import { curWeapon, magSize } from './inventory.js';
import { burst } from './fx.js';
import { makeNoise } from './zombies.js';
import { updateBot } from './bots.js';
import { AI, COOP, VAULT } from './threats.js';
import { emitTo } from './host.js';
import { playSfx } from './audio.js';
import { toast } from './hud.js';
import { at } from './smooth.js';
// A remote player is drawn this far behind their machine's reports (30 a second), so there are
// always two to blend between (smooth.js).
const REMOTE_DELAY = 0.07;

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
  // Boxes like the zombies: body, head, a cap whose box runs forward over the brow as its brim.
  body:new THREE.BoxGeometry(0.64,0.85,0.42), head:new THREE.BoxGeometry(0.42,0.42,0.42), cap:new THREE.BoxGeometry(0.44,0.1,0.48).translate(0,0,0.04),
  pack:new THREE.BoxGeometry(0.5,0.55,0.25), arm:new THREE.BoxGeometry(0.14,0.14,0.55), swish:new THREE.RingGeometry(0.75,1.75,18,1,-Math.PI/2-0.95,1.9),
  ring:squareFrame(0.6, 0.48),
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
  const cap = new THREE.Mesh(PG.cap, PG.dark); cap.position.y = 1.93;
  const bp = new THREE.Mesh(PG.pack, PG.packMat); bp.position.set(0,1.1,-0.33);
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
  Object.assign(p, { g, inner, legs, gun, arms:[a1, a2], swish, ring, gunZ:0.35, mats:[jacket, swish.material, ring.material] });
  scene.add(g);
}
// One lamp lights the area around the player being watched (lights can't be added at runtime).
const lamp = new THREE.PointLight(0xffe2b0, 0.55, 10, 2); scene.add(lamp);
export function updateLamp(){
  const v = viewed(); if (v) lamp.position.set(v.pos.x, 3, v.pos.z);
  for (const p of players) if (p.ring) p.ring.rotation.z = -p.g.rotation.y;  // the square under each player stays square to the grid
}

// A new player in the first free slot (null when the session is full). Spawned next to the player
// you control, or placed at the start by the next startCity().
// slot/name: a given slot colour and name (clients mirror the host's players). remote = the relay
// connection id of the machine playing it (host side, host.js); tp counts teleports (clients snap).
export function addPlayer(slot, name){
  if (players.length >= MAX_PLAYERS) return null;
  if (slot === undefined){ slot = 0; while (players.some(o => o.slot === slot)) slot++; }
  const p = { slot, name:name || 'P' + (slot+1), css:LOOKS[slot][2], pos:new THREE.Vector3(), vel:new THREE.Vector3(), radius:0.45, angle:0, walk:0,
    dead:false, lastTile:-1, dist:new Int16Array(N*N).fill(-1), shownGun:null, remote:0, tp:0,
    ctl:{ mx:0, mz:0, sprint:false, fire:false, use:false, aim:new THREE.Vector3() },
    interact:{ target:null, p:0, label:'', noiseT:0, lock:false } };
  buildMesh(p); resetPlayerStats(p); refreshGun(p);
  players.push(p);
  return p;
}
// Takes a player out of the session (never the one you control, unless forced: client.js mirroring).
export function removePlayer(p, force){
  const i = players.indexOf(p);
  if (i < 0 || (i === state.me && !force)) return;
  p.dead = true; p.gone = true;
  for (const w of p.weapons) if (w) w.out = false;
  scene.remove(p.g); if (p.drone) scene.remove(p.drone); for (const m of p.mats) m.dispose();
  players.splice(i, 1);
  if (state.me > i) state.me--;
  if (state.view === i || state.view >= players.length) state.view = state.me; else if (state.view > i) state.view--;
}

// Base stats for a fresh run. Weapon stats live in WEAPONS plus each weapon's own modifiers (weaponStats
// in weapons.js); the upgrades work on those weapons (upgrades.js). Weapons are instances (see weapons.js);
// the starting pistol is a Common. supply = weapon finds waiting at the next city start (Supply drop).
export function resetPlayerStats(p){
  Object.assign(p, { hp:100, maxHp:100, speed:4.6, stamina:1, staminaDelay:0, winded:false, boost:0, supply:0,
    reloadT:0, fireCd:0, meleeT:0, meleeCd:0, meleeHit:false, dead:false, kills:0, crafting:false,
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
export function poseMelee(p, k){
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
export function readLocal(p){
  const c = p.ctl, busy = p.crafting;
  let ix = 0, iz = 0;
  if (!busy){
    if (keys.KeyW || keys.ArrowUp){ ix -= 1; iz -= 1; }
    if (keys.KeyS || keys.ArrowDown){ ix += 1; iz += 1; }
    if (keys.KeyD || keys.ArrowRight){ ix += 1; iz -= 1; }
    if (keys.KeyA || keys.ArrowLeft){ ix -= 1; iz += 1; }
  }
  if (!busy && (pad.mx || pad.mz)){ ix = pad.mx; iz = pad.mz; }  // the left stick wins over keys
  c.mx = ix; c.mz = iz;
  c.sprint = !busy && !!(keys.ShiftLeft || keys.ShiftRight || pad.sprint);
  c.fire = !busy && (mouse.down || pad.fire); c.use = !busy && !!(keys.KeyE || pad.use);
  if (pad.on){ c.aim.set(p.pos.x + pad.ax*pad.aimD, 1.1, p.pos.z + pad.az*pad.aimD); return; }  // aim with the right stick (gamepad.js)
  raycaster.setFromCamera(mouseNDC, camera);
  if (raycaster.ray.intersectPlane(aimPlane, aimHit)) c.aim.copy(aimHit);
}
// Every living player, every simulation step: read its controls, then move and act.
export function updatePlayers(dt){
  for (const p of players.slice()){
    if (p.dead) continue;
    if (p === me()) readLocal(p); else if (!p.remote) updateBot(p, dt);  // remote players' controls come from host.js
    updatePlayer(p, dt);
    if (state.mode !== 'play') return;
  }
}

// Stamina: walking is slower than a runner, so sprinting is how you get away. Sprint drains
// stamina (the energy-drink boost cuts it); it refills after a short pause,
// faster standing still. Running dry leaves you winded: no sprint and a slower walk until
// stamina is back to WINDED_OK.
const SPRINT_MUL = 1.75, SPRINT_DRAIN = 0.28, REGEN = 0.24, REGEN_STILL = 1.7, REGEN_DELAY = 1, WINDED_OK = 0.4, WINDED_MUL = 0.8, BOOST_DRAIN = 0.4;

// ---------- Vaulting ----------
// Walking straight into a low fence (picket, rail: BREAKABLES[].vault) for VAULT.push s climbs over it to
// the tile beyond: VAULT.time s in an arc, busy (busy(p): no shooting, swinging, items), for some stamina
// and a little noise. Never while winded or stunned. A hit mid-vault knocks you off (knockOff). Both the
// host and a client predicting its own player run this; a client tells the host it's vaulting (`vt`).
export const busy = p => p.stun > 0 || !!p.vault || !!p.netVault;
function tryVault(p, ix, iz, dt){
  const no = () => { p.vaultPush = 0; return false; };
  if (dev.noVault || p.stun > 0 || p.winded || p.stamina < VAULT.stamina || !world.breaks) return no();
  const ax = Math.abs(ix) >= Math.abs(iz) ? Math.sign(ix) : 0, az = ax ? 0 : Math.sign(iz);
  if (Math.max(Math.abs(ix), Math.abs(iz)) < 0.75) return no();  // heading along the fence, not over it
  const r = p.radius, tx = Math.floor(p.pos.x/TILE), tz = Math.floor(p.pos.z/TILE), fx = tx + ax, fz = tz + az;
  const b = world.breaks.get(fz*N + fx);
  const gap = ax ? (ax > 0 ? (tx + 1)*TILE - p.pos.x : p.pos.x - tx*TILE) : (az > 0 ? (tz + 1)*TILE - p.pos.z : p.pos.z - tz*TILE);
  const lx = fx + ax, lz = fz + az, grid = world.city.grid;
  if (!b || !BREAKABLES[b.kind].vault || gap > r + 0.25 || !walkable(grid[lz*N + lx]) || tileLevel(lx, lz) > levelOf(p.pos.y) + 1) return no();
  p.vaultPush = (p.vaultPush || 0) + dt;
  if (p.vaultPush < VAULT.push) return false;
  p.vaultPush = 0;
  // Land just past the fence, in line with where you went over.
  const ex = ax ? (ax > 0 ? lx*TILE + r + 0.15 : (lx + 1)*TILE - r - 0.15) : Math.min((tx + 1)*TILE - r, Math.max(tx*TILE + r, p.pos.x));
  const ez = az ? (az > 0 ? lz*TILE + r + 0.15 : (lz + 1)*TILE - r - 0.15) : Math.min((tz + 1)*TILE - r, Math.max(tz*TILE + r, p.pos.z));
  p.vault = { t:0, sx:p.pos.x, sz:p.pos.z, sy:p.pos.y, ex, ez, ey:groundAt(ex, ez) };
  p.stamina -= VAULT.stamina; p.staminaDelay = REGEN_DELAY; p.vel.set(0, 0, 0); p.meleeT = 0; p.aiming = false;
  makeNoise(p.pos.x, p.pos.z, VAULT.noise);
  if (p === viewed()) playSfx('vault');
  return true;
}
function vaultStep(p, dt){
  const v = p.vault; v.t += dt;
  const k = Math.min(1, v.t/VAULT.time), up = Math.sin(k*Math.PI);
  p.pos.x = v.sx + (v.ex - v.sx)*k; p.pos.z = v.sz + (v.ez - v.sz)*k; p.pos.y = v.sy + (v.ey - v.sy)*k + up*VAULT.height;
  p.g.position.copy(p.pos); p.g.rotation.y = Math.atan2(v.ex - v.sx, v.ez - v.sz);
  // Leaning into it, legs tucked, one hand down on the fence.
  p.inner.rotation.x = up*0.45; p.legs[0].rotation.x = -up*1.1; p.legs[1].rotation.x = -up*0.7; p.arms[0].rotation.x = -up*1.2;
  if (k < 1) return;
  p.vault = null; endPose(p); resolveCircle(p.pos, p.radius);
}
function endPose(p){ p.inner.rotation.set(0, 0, 0); p.legs[0].rotation.x = p.legs[1].rotation.x = 0; p.arms[0].rotation.x = 0; }
// Hit while vaulting: dropped back to whichever side is nearer, dazed for VAULT.stun s. On the host;
// a remote player's machine is snapped there (tp) and told (`stun`).
export function knockOff(p){
  const v = p.vault;
  if (v){ const back = v.t/VAULT.time < 0.5; p.pos.x = back ? v.sx : v.ex; p.pos.z = back ? v.sz : v.ez; }
  p.vault = null; p.netVault = 0; p.stun = VAULT.stun; p.vel.set(0, 0, 0); endPose(p);
  toGround(p.pos); resolveCircle(p.pos, p.radius); p.g.position.copy(p.pos);
  if (p.remote){ p.tp++; emitTo(p, ['stun', VAULT.stun]); }
  toast('Knocked off the fence!', 'bad', p);
}
// Dazed: a slow sway (stars from the HUD side are the hurt flash).
export function poseStun(p){
  const t = performance.now()/1000;
  p.inner.rotation.z = p.stun > 0 ? Math.sin(t*7)*0.16 : 0; p.inner.rotation.x = p.stun > 0 ? 0.12 : 0;
  if (p.stun > 0 && Math.random() < 0.08) burst(new THREE.Vector3(p.pos.x, p.pos.y + 2.1, p.pos.z), 'spark', 1, 0.8, true);
}

// Knockback (and recoil) on player p; a remote player's machine moves them, so it gets told.
export function pushPlayer(p, vx, vz){
  p.vel.x += vx; p.vel.z += vz;
  if (p.remote) emitTo(p, ['kick', Math.round(vx*100)/100, Math.round(vz*100)/100]);
}
// Moving, stamina, facing and the walk cycle from p.ctl. A client predicts its own player with this;
// on the host, a remote player's position is the one their machine reports (p.net, see host.js),
// accepted while it's close to where the host thinks they are.
export function movePlayer(p, dt){
  const c = p.ctl, cheat = cheats(p);
  if (p.stun > 0){ p.stun = Math.max(0, p.stun - dt); poseStun(p); }
  if (p.vault){ vaultStep(p, dt); return; }
  let ix = p.stun > 0 ? 0 : c.mx, iz = p.stun > 0 ? 0 : c.mz;
  const l = Math.hypot(ix,iz), moving = l > 0;
  if (moving){ ix /= l; iz /= l; }
  let spd = p.speed*(cheat ? dev.speed : 1);
  const sprint = c.sprint && moving && !p.winded;
  if (p.boost > 0) p.boost = Math.max(0, p.boost - dt);
  if (sprint){
    spd *= SPRINT_MUL; p.staminaDelay = REGEN_DELAY;
    p.stamina = Math.max(0, p.stamina - dt*SPRINT_DRAIN*(p.boost > 0 ? BOOST_DRAIN : 1));
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
  if (moving && !(cheat && dev.noclip) && tryVault(p, ix, iz, dt)) return;
  const k = Math.min(1, dt*14);
  p.vel.x += (ix*spd - p.vel.x)*k; p.vel.z += (iz*spd - p.vel.z)*k;
  p.pos.x += p.vel.x*dt; p.pos.z += p.vel.z*dt;
  if (!(cheat && dev.noclip)){ resolveCircle(p.pos, p.radius); resolveCircle(p.pos, p.radius); }
  else { const m = world.city.n*TILE; p.pos.x = Math.min(m - 0.1, Math.max(TILE, p.pos.x)); p.pos.z = Math.min(m - TILE, Math.max(TILE, p.pos.z)); }
  const n = p.net, s = p.remote && n && n.tp === p.tp && p.clk ? at(p, p.clk, REMOTE_DELAY) : null;
  if (s && Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 4){ p.pos.x = s.x; p.pos.z = s.z; p.vel.x = s.vx; p.vel.z = s.vz; p.angle = s.r; }
  else {
    if (s) p.tp++;  // too far off: their machine snaps back to the host's position
    const ax = c.aim.x - p.pos.x, az = c.aim.z - p.pos.z;
    if (ax*ax + az*az > 0.04) p.angle = Math.atan2(ax, az);
  }
  p.g.position.copy(p.pos);
  p.g.rotation.y = p.angle;
  animateLegs(p, dt, Math.hypot(p.vel.x, p.vel.z));
}
export function animateLegs(p, dt, v){
  p.walk += dt*v*2.2;
  const sw = Math.sin(p.walk)*0.6*Math.min(1, v/2);
  p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw;
  p.inner.position.y = Math.abs(Math.sin(p.walk))*0.05*Math.min(1, v/2);
}
function updatePlayer(p, dt){
  const c = p.ctl;
  movePlayer(p, dt);
  if (p.reloadT > 0){
    p.reloadT -= dt;
    if (p.reloadT <= 0){
      const w = curWeapon(p), k = Math.max(0, Math.min(magSize(w) - w.mag, p.ammo[w.id]));
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
  if (c.fire && !busy(p)) fire(p, dt);
  if (p.bleeding){
    p.bleedFx -= dt;
    if (p.bleedFx <= 0){ p.bleedFx = 0.35; burst(new THREE.Vector3(p.pos.x, 0.9, p.pos.z), 'blood', 1, 1, true); }
  }
  if (p.bleeding && drainHp(p, 1.1*dt)) return;
  // The explored map is shared: everyone uncovers it.
  const tx = Math.floor(p.pos.x/TILE), tz = Math.floor(p.pos.z/TILE), ti = tz*N+tx;
  if (ti !== p.lastTile){ p.lastTile = ti; reveal(tx, tz, 8); }
}
