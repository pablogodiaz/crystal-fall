// ---------- Client ----------
// A machine that joined someone else's game. It never runs the simulation (update() in game.js):
// it builds the same city from the host's seed, then mirrors everything that moves from the host's
// ticks (host.js): events create and remove things and play effects, snapshots move players and
// zombies (each eases from where it's drawn to its new spot over one tick, ~50 ms behind) and full
// state fills the HUD. Its own player is predicted: moved here at once with the same movement code
// (movePlayer) and reported to the host, which accepts it unless it's far off (then p.tp changes and
// we snap to the host's position). Firing, searching and everything else happens on the host.
import * as THREE from 'three';
import { TILE, N } from './config.js';
import { $ } from './utils.js';
import { muzzleLight, camFocus } from './renderer.js';
import { droneModel } from './assets.js';
import { state, world, net, players, zombies, drops, pickups, hazards, puddles, mouse } from './state.js';
import { onNet, connect, disconnect, send, VERSION } from './net.js';
import { playSfx, initAudio } from './audio.js';
import { me, viewed, addPlayer, removePlayer, readLocal, movePlayer, animateLegs, refreshGun, poseMelee, resetPlayerStats } from './player.js';
import { reveal, updateFlow, groundAt, toGround } from './grid.js';
import { mirrorBreak } from './breakables.js';
import { updateBot } from './bots.js';
import { mirrorSpawn, mirrorKill, mirrorHit, animateMirror } from './zombies.js';
import { addBullet, hurtFx, updateBullets, MELEE_TIME } from './combat.js';
import { burst, addDecal, addRing, animateRings, pickupMesh, animatePickup } from './fx.js';
import { dropMesh, animateDrop } from './loot.js';
import { throwMesh, fireMesh, bombMesh, flashAt, animateThrowGhosts } from './throwables.js';
import { spitMesh, puddleMesh, animateAcid, spotThreats } from './specials.js';
import { drawBolt, beamFx, orbMesh, wellMesh, removeWell, sprayFx, chargeFx, animateUniques } from './uniques.js';
import { crystalFx } from './crystal.js';
import { toast, floatText, banner, showScreen, renderCraft } from './hud.js';
import { startCity, newSeed, enterRun, roadFx, showUpgrades, showUpgradeResult, showGameOver, spectate } from './game.js';
import { autoChoice } from './upgrades.js';
import { ACTS } from './host.js';
import { clock, syncClock, track, resetTrack, at } from './smooth.js';

const zs = new Map(), ds = new Map(), hs = new Map(), hz = new Map();  // nid -> mirrored zombie / drop / cross / hazard
let mySlot = -1, myTp = -1, ctlT = 0, pending = null;
// The host's clock; other players and zombies are drawn DELAY s behind it, between two of its ticks (smooth.js).
const hostClock = clock(), DELAY = 0.1;
const bySlot = s => players.find(p => p.slot === s);

// One-shot actions from this machine's input: sent to the host, or done right here when we are it.
export function act(a, v){
  if (net.role === 'client') send(0, { t:'a', a, v });
  else if (ACTS[a]) ACTS[a](me(), v);
}

// ---------- Session ----------
// Resolves once the host welcomed us (rejects with a reason a player can read).
export function joinGame(){
  onNet({ ready:hello, message:onMessage, close:why => leaveSession(why), join(){}, leave(){} });
  return new Promise((resolve, reject) => { pending = { resolve, reject }; connect('client').catch(why => { pending = null; reject(why); }); });
}
function hello(){ send(0, { t:'hello', name:net.name, v:VERSION }); }
function settle(ok, why){ if (!pending) return; const p = pending; pending = null; ok ? p.resolve() : p.reject(why); }
// Back to a solo menu (the host left, we left, or the connection is gone for good).
export function leaveSession(why){
  disconnect();
  settle(false, why);
  for (const p of players.slice()) if (p !== me()) removePlayer(p, true);
  state.me = state.view = 0; mySlot = -1; myTp = -1;
  const p = me(); resetPlayerStats(p); refreshGun(p); p.dead = false; p.g.visible = true;
  $('retryBtn').classList.remove('hidden');
  state.mode = 'menu'; mouse.down = false;
  $('hud').classList.add('hidden'); showScreen('menuScreen');
  startCity(1, newSeed());
  if (why) toast(why, 'bad');
}
function onMessage(from, m){
  if (m.t === 'nohost'){ if (pending){ settle(false, 'Nobody is hosting on this server yet. Ask the host to click Host co-op'); disconnect(); } return; }
  if (m.t === 'rej'){ settle(false, m.why === 'version' ? 'The host runs a different version of the game. Reload the page' : 'The game is full (4 players)'); disconnect(); return; }
  if (m.t === 'w'){
    mySlot = m.you; myTp = -1;
    applyRoster(m.list);
    settle(true);
    if (m.sync) for (const e of m.sync) handle(e);
    return;
  }
  if (m.t === 'r') return applyRoster(m.list);
  if (m.t === 'k') tick(m);
}
// The host's players, in its order: [slot, name, lost, isHost]. Ours is the one with mySlot.
let rosterHook = null;
export const onClientRoster = f => { rosterHook = f; };
export const rosterInfo = () => players.map(p => ({ name:p.name, css:p.css, you:p.slot === mySlot, host:!!p.isHost, lost:!!p.lost }));
function applyRoster(list){
  const want = new Set(list.map(r => r[0]));
  // Our boot-time player becomes whichever slot it already has a match for; everyone else is built.
  if (!want.has(me().slot) && !bySlot(mySlot)){ const p = me(); p.slot = mySlot; }
  for (const p of players.slice()) if (!want.has(p.slot)) removePlayer(p, true);
  for (const [slot, name, lost, host] of list){
    let p = bySlot(slot);
    if (!p){ p = addPlayer(slot, name); if (!p) continue; }
    p.name = name; p.lost = lost; p.isHost = !!host;
  }
  const order = list.map(r => bySlot(r[0])).filter(Boolean);
  players.length = 0; players.push(...order);
  state.me = Math.max(0, players.findIndex(p => p.slot === mySlot));
  if (!players[state.view] || state.view === state.me || viewed().dead === false) state.view = state.me;
  if (rosterHook) rosterHook();
}

// ---------- Ticks ----------
function tick(m){
  syncClock(hostClock, m.ts); tickT = m.ts;
  for (const e of m.e) handle(e);
  for (const e of m.pe) handle(e);
  for (const s in m.f) applyFull(bySlot(+s), m.f[s]);
  applyRun(m.s);
  for (const e of m.p) applyPlayer(e);
  for (const e of m.z){
    const z = zs.get(e[0]); if (!z) continue;
    track(z, m.ts, e[1], e[2], e[3]); z.f = e[4]; mirrorHit(z, e[5]);
  }
}
let tickT = 0;  // host time of the tick being applied
// Draws o where it was DELAY s ago on the host (blended between two ticks); returns its speed.
function smooth(o){
  const s = at(o, hostClock, DELAY); if (!s) return 0;
  o.pos.x = s.x; o.pos.z = s.z; o.pos.y = groundAt(s.x, s.z); o.g.rotation.y = s.r;
  if (o.vel){ o.vel.x = s.vx; o.vel.z = s.vz; }
  return Math.hypot(s.vx, s.vz);
}
function applyRun(s){
  state.level = s.lv; state.phase = s.ph; state.takeover = s.tk; state.exitT = s.ex; state.exitIn = s.ei;
  state.kills = s.k; state.cityKills = s.ck; state.runTime = s.rt; state.cityTime = s.ct; state.cheated = s.ch;
  if (s.cf && !state.crystalFound) crystalFx('found');
  const cr = world.crystal;
  if (cr && s.cr){ if (s.cr[0] < cr.hp) cr.flash = 0.1; cr.hp = s.cr[0]; cr.maxHp = s.cr[1]; }
}
// [slot, x, z, angle, vx, vz, hp, maxHp, flags, weapon id, rarity, uid, meleeT, stamina, tp, drone, charge]
function applyPlayer(e){
  const p = bySlot(e[0]); if (!p) return;
  const [, x, z, a, vx, vz, hp, maxHp, f, wid, rar, uid, meleeT, st, tp, drone, charge] = e, dead = !!(f & 1);
  const mine = p === me();
  p.hp = hp; p.maxHp = maxHp; p.bleeding = !!(f & 2); p.winded = !!(f & 4); p.spraying = f & 8 ? wid : null;
  p.charge = charge; p.meleeT = meleeT;
  if (!mine || Math.abs(p.stamina - st) > 0.05) p.stamina = st;
  if (!(f & 16)) p.boost = 0; else if (!(p.boost > 0)) p.boost = 1;
  if (!(f & 32) && !mine) p.reloadT = 0;
  // A weapon stub for players we have no full state for (their model, name on the HUD).
  if (!p.weapons[p.cur] || p.weapons[p.cur].uid !== uid){
    const i = p.weapons.findIndex(w => w && w.uid === uid);
    if (i >= 0) p.cur = i; else p.weapons[p.cur] = { id:wid, rarity:rar, mods:[], mag:0, uid, cd:0, idle:0 };
  }
  refreshGun(p);
  if (meleeT > 0) poseMelee(p, 1 - meleeT/MELEE_TIME);
  if (dead !== p.dead){
    p.dead = dead; p.g.visible = !dead;
    if (mine && dead){ mouse.down = false; p.aiming = false; p.crafting = false; spectate(1); banner('You turned', `Watching ${viewed().name}. You come back in the next city`, 3600); }
    if (mine && !dead) state.view = state.me;
    if (!mine && dead && viewed() === p) spectate(1);
  }
  if (mine){
    // Our own position is ours, unless the host moved us (city start, a correction).
    if (tp !== myTp){ myTp = tp; toGround(p.pos.set(x, 0, z)); p.vel.set(0, 0, 0); p.g.position.copy(p.pos); camFocus.copy(p.pos); p.lastTile = -1; }
  } else {
    if (tp !== p.tpSeen){ p.tpSeen = tp; resetTrack(p); }  // teleported: no sliding across the map
    track(p, tickT, x, z, a);
  }
  if (drone){
    if (!p.drone){ p.drone = droneModel(); p.g.parent.add(p.drone); p.droneY = { trk:null }; }
    if (!p.drone.visible){ p.drone.visible = true; resetTrack(p.droneY); p.drone.position.set(drone[0], drone[1], drone[2]); }
    track(p.droneY, tickT, drone[0], drone[2], drone[3]); p.droneY.y = drone[1];
  } else if (p.drone) p.drone.visible = false;
}
// Everything the HUD shows about player p (ours, or the one we watch).
function applyFull(p, s){
  if (!p) return;
  Object.assign(p, { hp:s.hp, maxHp:s.mh, winded:s.wd, boost:s.bo, bleeding:s.bl, inv:s.inv, cur:s.cur, reloadT:s.rl, throwSel:s.ts, kills:s.k });
  if (p !== me()) p.stamina = s.st;
  Object.assign(p.ammo, s.am);
  // Weapons are merged by uid so the model in their hands isn't rebuilt every tick.
  p.weapons = s.w.map(w => { if (!w) return null; const o = p.weapons.find(x => x && x.uid === w.uid); return o ? Object.assign(o, w) : w; });
  const it = p.interact;
  if (s.it){ it.target = it.target && it.target.px === s.it[0] && it.target.pz === s.it[1] ? it.target : { px:s.it[0], pz:s.it[1] }; it.label = s.it[2]; it.p = s.it[3]; }
  else { it.target = null; it.p = 0; }
  refreshGun(p);
  if (p === me() && p.crafting) renderCraft();
}

// ---------- Events ----------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function handle(e){
  const [k, a, b, c, d, f, g, h, i, j] = e;
  switch (k){
    case 's': playSfx(a, ...(b || [])); break;
    case 'b': burst(V(a, b, c), d, f, g, true); break;
    case 'dc': addDecal(a, b, c, d || 'blood', true); break;
    case 'rg': addRing(a, b, c, d, f, g, h, i, j, true); break;
    case 'sh': state.shake = Math.max(state.shake, a); break;
    case 'fl': flashAt(a, b); break;
    case 'mz': muzzleLight.position.set(a, 1.3, b); muzzleLight.intensity = Math.max(muzzleLight.intensity, c); break;
    case 't': toast(a, b); break;
    case 'ft': floatText(a, b); break;
    case 'bn': banner(a, b, c); break;
    case 'hurt': hurtFx(); break;
    case 'kick': me().vel.x += a; me().vel.z += b; break;
    case 'z+': {
      if (zs.has(a)) break;
      const z = mirrorSpawn(a, b, c, d, f, g, h, i, j);
      zs.set(a, z);
      const v = viewed(); if (h > 0 && v && Math.hypot(v.pos.x - d, v.pos.z - f) < 22) playSfx('dig');
      break;
    }
    case 'z-': { const z = zs.get(a); if (z){ zs.delete(a); mirrorKill(z, b, c, d, f); } break; }
    case 'bu': addBullet(a, b, c, d, f, g, h, { pierce:i, bounce:j, ghost:true }); break;
    case 'bolt': drawBolt(a); break;
    case 'beam': beamFx(a, b, c, d); break;
    case 'th': throwMesh(a, b, c, d, f, g, true); break;
    case 'orb': orbMesh(a, b, c, d, f, true); break;
    case 'spit': spitMesh(a, b, c, d, f, true); break;
    case 'hz+': {
      if (hz.has(a)) break;
      const o = b === 'fire' ? fireMesh(c, d, f, a, true) : b === 'bomb' ? bombMesh(c, d, f, a, true) : b === 'acid' ? puddleMesh(c, d, f, a, true) : b === 'well' ? wellMesh(c, d, f, a, true) : null;
      if (o) hz.set(a, { kind:b, o });
      break;
    }
    case 'hz-': {
      const r = hz.get(a); if (!r) break;
      hz.delete(a);
      if (r.kind === 'well') removeWell(a);
      else { const arr = r.kind === 'acid' ? puddles : hazards, n = arr.indexOf(r.o); if (n >= 0){ r.o.mesh.parent && r.o.mesh.parent.remove(r.o.mesh); arr.splice(n, 1); } }
      break;
    }
    case 'd+': {
      if (ds.has(a)) break;
      const held = j >= 0 ? bySlot(j) : null;
      ds.set(a, dropMesh(b, c, d, f, g, held, h !== null && h !== undefined ? { x:h, z:i } : null, a));
      break;
    }
    case 'd-': { const o = ds.get(a); if (o){ ds.delete(a); o.g.parent && o.g.parent.remove(o.g); const n = drops.indexOf(o); if (n >= 0) drops.splice(n, 1); } break; }
    case 'dn': { const o = ds.get(a); if (o) o.n = b; break; }
    case 'h+': if (!hs.has(a)) hs.set(a, pickupMesh(b, c, a)); break;
    case 'h-': { const o = hs.get(a); if (o){ hs.delete(a); o.g.parent && o.g.parent.remove(o.g); const n = pickups.indexOf(o); if (n >= 0) pickups.splice(n, 1); } break; }
    case 'open': { const ct = world.city.containers[a]; if (ct && !ct.searched){ ct.searched = true; ct.open(); ct.glint.visible = false; } break; }
    case 'lm': { const l = world.city.landmarks[a]; if (l){ l.found = true; world.mmDirty = true; } break; }
    case 'fog': {
      const s = atob(a), ex = world.explored;
      for (let n=0;n<N*N;n++) if (s.charCodeAt(n >> 3) & (1 << (n & 7))) ex[n] = 1;
      world.mmDirty = true; break;
    }
    case 'cr': crystalFx(a); break;
    case 'road': state.phase = 'open'; roadFx(); break;
    case 'run': initAudio(); enterRun(); state.kills = 0; break;
    case 'city':
      zs.clear(); ds.clear(); hs.clear(); hz.clear();
      if (state.mode !== 'play' && state.mode !== 'paused'){ state.mode = 'play'; showScreen(null); }
      startCity(a, b);
      break;
    case 'mode':
      mouse.down = false;
      if (a === 'paused'){ state.mode = 'paused'; showScreen('pauseScreen'); $('resumeBtn').classList.add('hidden'); $('pauseNote').classList.remove('hidden'); }
      else if (a === 'play'){ state.mode = 'play'; showScreen(null); }
      else if (a === 'upgrade'){ state.mode = 'upgrade'; me().crafting = false; me().aiming = false; showUpgrades(me(), [], () => {}, () => {}); }
      break;
    case 'upg':
      state.cityKills = b; state.cityTime = c; me().offer = a;
      showUpgrades(me(), a, ch => act('upgrade', ch), () => act('ready'));
      if (net.bot) setTimeout(() => act('upgrade', autoChoice(me())), 1500);  // the autopilot picks for itself
      break;
    case 'upgr': showUpgradeResult(a); if (net.bot) setTimeout(() => act('ready'), 1000); break;
    case 'wait': $('upgradeNote').textContent = a; break;
    case 'over': showGameOver(a, b, c, d); break;
    case 'br+': case 'brh': case 'br-': mirrorBreak(e); break;
  }
}

// ---------- Per frame ----------
// Called by main.js instead of update(): our player, controls to the host, and every mirror.
const CTL = 1/30;
let botFlowT = 0;
export function clientUpdate(dt, t){
  const p = me();
  if (!p || !world.city) return;
  const play = state.mode === 'play';
  if (play && !p.dead){
    if (net.bot){
      // Autopilot: the companions' brain fills our controls (it follows the players' flow fields).
      botFlowT -= dt; if (botFlowT <= 0){ botFlowT = 0.25; updateFlow(); }
      updateBot(p, dt);
    } else readLocal(p);
    movePlayer(p, dt);
    if (p.meleeT > 0){ p.meleeT = Math.max(0, p.meleeT - dt); poseMelee(p, p.meleeT > 0 ? 1 - p.meleeT/MELEE_TIME : 0); }
  } else { const c = p.ctl; c.mx = c.mz = 0; c.sprint = c.fire = c.use = false; }
  ctlT -= dt;
  if (ctlT <= 0 && state.mode !== 'menu'){
    ctlT = CTL;
    const c = p.ctl;
    send(0, { t:'c', ts:Math.round(performance.now())/1000, a:Math.round(p.angle*1000)/1000, mx:c.mx, mz:c.mz, sp:c.sprint, f:c.fire, u:c.use, ax:r2(c.aim.x), az:r2(c.aim.z), x:r2(p.pos.x), z:r2(p.pos.z), vx:r2(p.vel.x), vz:r2(p.vel.z), tp:myTp, v:viewed().slot });
  }
  // Rail whine for our own charge (the host only plays it for its own screen).
  if (p.charge > 0 && !p.railStop) p.railStop = playSfx('charge');
  else if (!(p.charge > 0) && p.railStop){ p.railStop(); p.railStop = null; }
  for (const o of players){
    if (o.dead) continue;
    if (o !== p){
      const v = smooth(o);
      o.g.position.copy(o.pos); o.angle = o.g.rotation.y;
      animateLegs(o, dt, v);
    }
    if (o !== p && o.drone && o.drone.visible){
      const s = at(o.droneY, hostClock, DELAY), d = o.drone;
      if (s){ d.position.x = s.x; d.position.z = s.z; d.rotation.y = s.r; }
      d.position.y += (o.droneY.y - d.position.y)*Math.min(1, dt*8);
    }
    if (o.spraying) sprayFx(o, o.spraying, dt);
    if (o.charge > 0) chargeFx(o, o.charge, dt);
    if (o.bleeding){ o.bleedFx = (o.bleedFx || 0) - dt; if (o.bleedFx <= 0){ o.bleedFx = 0.35; burst(V(o.pos.x, 0.9, o.pos.z), 'blood', 1, 1, true); } }
    if (o.drone && o.drone.visible) for (const r of o.drone.rotors) r.rotation.y += dt*40;
    // The explored map is shared: everyone uncovers it.
    const tx = Math.floor(o.pos.x/TILE), tz = Math.floor(o.pos.z/TILE), ti = tz*N + tx;
    if (ti !== o.lastTile){ o.lastTile = ti; reveal(tx, tz, 8); }
  }
  const v = viewed();
  for (const z of zombies){
    const vl = smooth(z);
    animateMirror(z, dt, t, Math.hypot(v.pos.x - z.pos.x, v.pos.z - z.pos.z), vl);
  }
  if (play) for (const d of drops) animateDrop(d, dt);
  for (const h of pickups) animatePickup(h, dt);
  if (play) spotThreats(dt);
}
const r2 = v => Math.round(v*100)/100;
// Ghost bullets, throws, acid, unique-weapon effects and rings (every frame, whatever the mode).
export function clientEffects(dt){
  if (!world.city) return;
  updateBullets(dt); animateThrowGhosts(dt); animateAcid(dt); animateUniques(dt); animateRings(dt);
}
