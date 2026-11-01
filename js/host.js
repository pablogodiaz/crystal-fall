// ---------- Host ----------
// The machine that hosts a co-op game runs the whole simulation (update() in game.js) and tells the
// others (clients, client.js) what happens. Each remote player is a normal player object with
// p.remote = their connection id: their controls arrive as 'c' messages (p.ctl, plus the position
// their machine moved them to, p.net), their one-shot actions as 'a' messages (ACTS).
// Outgoing, 20 times a second, every client gets one 'k' (tick) message: the events since the last
// tick (emit: everyone; emitTo: one player), the run state, every player, the zombies near what they
// watch, and full state (inventory, weapons, ammo…) for the players they need it for when it changed.
// Gameplay code calls emit/emitTo/sfxFor without caring whether anyone is connected.
import { state, world, net, players, zombies, drops, pickups, hazards, puddles } from './state.js';
import { N } from './config.js';
import { WEAPONS } from './items.js';
import { send, onNet, connect, disconnect, VERSION } from './net.js';
import { sfx, playSfx } from './audio.js';
import { addPlayer, removePlayer, me, viewed, MAX_PLAYERS } from './player.js';
import { zombieFlags, spawnEvent } from './zombies.js';
import { dropEvent } from './loot.js';
import { tryReload, melee } from './combat.js';
import { swapWeapon, dropWeapon, useSlot, dropSlot, releaseThrow, cycleThrowable, curWeapon } from './inventory.js';
import { craftFor, toast, toastAll } from './hud.js';
import { pickUpgrade } from './game.js';
import { mpick } from './utils.js';

let idc = 0;
export const nextId = () => ++idc;  // network ids: zombies, drops, health crosses, hazards (nid)
const peers = new Map();            // connection id -> { id, p, view (slot they watch), evs, sig }
let ev = [], tickT = 0;
const r2 = v => Math.round(v*100)/100;
export const sending = () => net.role === 'host' && peers.size > 0 && state.mode !== 'menu';
export function emit(e){ if (sending()) ev.push(e); }
export function emitTo(p, e){
  if (!p || !p.remote || !sending()) return;
  const c = peers.get(p.remote); if (c && c.p === p) c.evs.push(e);
}
// A sound for player p only: played here if p is on this screen, sent to p's machine if remote.
export function sfxFor(p, k, ...a){
  if (p === viewed()) playSfx(k, ...a);
  if (p && p.remote) emitTo(p, ['s', k, a]);
}
// Every sfx.* call reaches the clients too (wrapped once at boot); sfxFor/playSfx bypass it.
export function initHost(){
  for (const k of Object.keys(sfx)){ const raw = sfx[k]; sfx[k] = (...a) => { emit(['s', k, a]); return raw(...a); }; }
}

// ---------- Session ----------
export function startHosting(){
  onNet({ ready(){}, join(){}, message:onMessage, leave:onLeave,
    close(why){ toast(why, 'bad'); for (const id of [...peers.keys()]) onLeave(id); } });
  return connect('host');
}
export function stopHosting(){
  for (const id of [...peers.keys()]) onLeave(id, true);
  disconnect();
}
// Who's in the session, in players order (clients mirror it): [slot, name, lost].
const rosterList = () => players.map(p => [p.slot, p.name, p.remote ? 0 : p.lost > 0 ? 1 : 0, p === me() ? 1 : 0]);
export function roster(){
  const msg = { t:'r', list:rosterList() };
  for (const c of peers.values()) send(c.id, msg);
  if (rosterHook) rosterHook();
}
let rosterHook = null;
export const onRoster = f => { rosterHook = f; };

function onMessage(from, m){
  if (m.t === 'hello') return hello(from, m);
  const c = peers.get(from); if (!c) return;
  const p = c.p;
  if (m.t === 'c'){
    c.view = m.v;
    if (p.dead) return;
    const k = p.ctl;
    k.mx = +m.mx || 0; k.mz = +m.mz || 0; k.sprint = !!m.sp; k.fire = !!m.f; k.use = !!m.u; k.aim.set(+m.ax || 0, 1.1, +m.az || 0);
    p.net = { x:+m.x, z:+m.z, vx:+m.vx || 0, vz:+m.vz || 0, tp:m.tp };
  } else if (m.t === 'a' && ACTS[m.a]) ACTS[m.a](p, m.v);
}
// A client says hello: version check, then a player for them (theirs back if they just dropped out),
// the roster, and if a run is going, everything they need to build the same world.
function hello(id, m){
  if (m.v !== VERSION) return send(id, { t:'rej', why:'version' });
  if (peers.has(id)) return;
  flushNow();
  const name = String(m.name || '').trim().slice(0, 16) || 'Player';
  let p = players.find(o => !o.remote && o.lost > 0 && o.name === name);
  if (!p){
    if (players.length >= MAX_PLAYERS) return send(id, { t:'rej', why:'full' });
    p = addPlayer(); if (!p) return send(id, { t:'rej', why:'full' });
    p.name = players.some(o => o !== p && o.name === name) ? `${name} ${p.slot + 1}` : name;
    if (state.mode !== 'menu') joinRunning(p);
  }
  p.remote = id; p.lost = 0; p.net = null; p.tp++;
  peers.set(id, { id, p, view:p.slot, evs:[], sig:{} });
  send(id, { t:'w', you:p.slot, v:VERSION, list:rosterList(), sync:state.mode !== 'menu' ? syncEvents() : null });
  roster();
  toastAll(`${p.name} joined`, 'info');
}
// Joining a run that's already going: next to someone still standing, with a fresh kit. Joining
// during the upgrade screen counts as having picked; joining a lost run, they're out too.
function joinRunning(p){
  const a = players.find(o => o !== p && !o.dead);
  if (!a || state.mode === 'dead'){ p.dead = true; p.g.visible = false; return; }
  p.pos.set(a.pos.x + 0.6, 0, a.pos.z + 0.6); p.vel.set(0, 0, 0); p.g.position.copy(p.pos); p.lastTile = -1;
  if (state.mode === 'upgrade') p.picked = true;
}
// Disconnected: their player is a companion for LOST s (they can reconnect under the same name),
// then leaves. A pending upgrade pick is made for them.
const LOST = 30;
function onLeave(id, quiet){
  const c = peers.get(id); if (!c) return;
  peers.delete(id);
  const p = c.p; if (!players.includes(p)) return;
  quiet = quiet || state.mode === 'menu';
  p.remote = 0; p.net = null; p.lost = quiet ? 0.01 : LOST;
  if (state.mode === 'upgrade' && !p.picked && p.offer) pickUpgrade(p, mpick(p.offer));
  if (!quiet) toastAll(`${p.name} lost connection. A bot plays for them for ${LOST} s`, 'bad');
  roster();
}
export function updateLost(dt){
  for (const p of players.slice()){
    if (p.remote || !(p.lost > 0)) continue;
    p.lost -= dt;
    if (p.lost <= 0){ removePlayer(p); roster(); if (net.role === 'host') toastAll(`${p.name} left`, 'info'); }
  }
}

// ---------- Actions ----------
// What a remote player can do besides moving and firing: the same calls input.js makes for you.
export const ACTS = {
  reload:p => tryReload(p), swap:p => swapWeapon(p), drop:p => dropWeapon(p), melee:p => melee(p),
  cycle:(p, d) => cycleThrowable(p, d < 0 ? -1 : 1), use:(p, i) => useSlot(p, i|0), dropSlot:(p, i) => dropSlot(p, i|0),
  // [x, z, kind]: the aim point at release, and what the player had selected.
  throw:(p, v) => { if (!Array.isArray(v)) return; p.ctl.aim.set(+v[0], 1.1, +v[1]); if (v[2]) p.throwSel = v[2]; p.aiming = true; releaseThrow(p); },
  craft:(p, id) => craftFor(p, id),
  upgrade:(p, name) => { if (p.offer) pickUpgrade(p, p.offer.find(u => u.name === name)); },
  crafting:(p, on) => { p.crafting = !!on; }
};

// ---------- Ticks ----------
// Called every frame from main.js; sends a tick every TICK s.
const TICK = 0.05, NEAR = 64;
export function hostTick(dt){
  updateLost(dt);  // also after hosting stopped: players who were remote leave
  if (net.role !== 'host') return;
  tickT -= dt; if (tickT > 0) return;
  tickT = TICK; flushNow();
}
export function flushNow(){
  if (!sending()){ ev = []; return; }
  const e = JSON.stringify(ev); ev = [];
  const s = JSON.stringify(runState()), pl = JSON.stringify(players.map(playerSnap));
  for (const c of peers.values()){
    const msg = `{"t":"k","e":${e},"pe":${JSON.stringify(c.evs)},"s":${s},"p":${pl},"z":${JSON.stringify(zombieSnap(c))},"f":${JSON.stringify(fullFor(c))}}`;
    c.evs = [];
    send(c.id, msg);
  }
}
function runState(){
  const cr = world.crystal;
  return { lv:state.level, ph:state.phase, tk:r2(state.takeover), ex:r2(state.exitT), ei:state.exitIn, k:state.kills, ck:state.cityKills,
    rt:r2(state.runTime), ct:r2(state.cityTime), cf:state.crystalFound, cr:cr ? [r2(cr.hp), cr.maxHp] : null, ch:state.cheated };
}
// [slot, x, z, angle, vx, vz, hp, maxHp, flags, weapon id, rarity, uid, meleeT, stamina, tp, drone, rail charge]
// flags: 1 dead, 2 bleeding, 4 winded, 8 spraying, 16 energized, 32 reloading.
function playerSnap(p){
  const w = curWeapon(p), d = p.drone && p.drone.visible ? [r2(p.drone.position.x), r2(p.drone.position.y), r2(p.drone.position.z), r2(p.drone.rotation.y)] : 0;
  const f = (p.dead ? 1 : 0) | (p.bleeding ? 2 : 0) | (p.winded ? 4 : 0) | (p.flameT > 0 ? 8 : 0) | (p.boost > 0 ? 16 : 0) | (p.reloadT > 0 ? 32 : 0);
  return [p.slot, r2(p.pos.x), r2(p.pos.z), r2(p.angle), r2(p.vel.x), r2(p.vel.z), r2(p.hp), p.maxHp, f, w.id, w.rarity, w.uid, r2(p.meleeT), r2(p.stamina), p.tp, d,
    w.id === 'railgun' && w.charge > 0 ? r2(w.charge/WEAPONS.railgun.charge) : 0];
}
// [nid, x, z, rotY, flags, hp %] for every zombie within NEAR of the player this client watches.
function zombieSnap(c){
  const v = players.find(o => o.slot === c.view) || c.p, out = [];
  for (const z of zombies){
    if (Math.abs(z.pos.x - v.pos.x) > NEAR || Math.abs(z.pos.z - v.pos.z) > NEAR) continue;
    out.push([z.nid, r2(z.pos.x), r2(z.pos.z), r2(z.g.rotation.y), zombieFlags(z), Math.max(0, Math.round(z.hp/z.hp0*100))]);
  }
  return out;
}
// Everything a HUD shows about a player, for the client's own player and the one it watches.
function fullState(p){
  const it = p.interact.target;
  return { hp:r2(p.hp), mh:p.maxHp, st:r2(p.stamina), wd:p.winded, bo:Math.round(p.boost*10)/10, bl:p.bleeding, dead:p.dead,
    inv:p.inv, w:p.weapons.map(w => w && Object.assign({}, w, { mag:r2(w.mag), cd:Math.round(w.cd*10)/10, idle:0, charge:w.charge ? r2(w.charge) : 0 })),
    cur:p.cur, am:p.ammo, rl:Math.round(p.reloadT*10)/10, ts:p.throwSel, k:p.kills,
    it:it ? [r2(it.px), r2(it.pz), p.interact.label, r2(p.interact.p)] : 0,
    m:[p.dmgMul, p.fireMul, p.magMul, p.reloadMul, p.pellets, p.pierce, p.regen, p.speed, p.staminaRate] };
}
function fullFor(c){
  const out = {}, v = players.find(o => o.slot === c.view);
  for (const p of new Set([c.p, v])){
    if (!p || !players.includes(p)) continue;
    const s = JSON.stringify(fullState(p));
    if (c.sig[p.slot] !== s){ c.sig[p.slot] = s; out[p.slot] = JSON.parse(s); }
  }
  return out;
}
// The world as it is right now, as the events that would have built it (a client joining mid-run).
function syncEvents(){
  const city = world.city, cr = world.crystal, out = [['run'], ['city', state.level, state.seed]];
  city.containers.forEach((c, i) => { if (c.searched) out.push(['open', i]); });
  city.landmarks.forEach((l, i) => { if (l.found) out.push(['lm', i]); });
  out.push(['fog', fog()]);
  if (state.crystalFound) out.push(['cr', 'found']);
  if (cr && cr.pulsed) out.push(['cr', 'pulsed']);
  if (state.phase === 'takeover') out.push(['cr', 'tint']);
  if (state.phase === 'open') out.push(['cr', 'over'], ['road']);
  for (const z of zombies) out.push(spawnEvent(z));
  for (const d of drops) out.push(dropEvent(d));
  for (const p of pickups) out.push(['h+', p.nid, r2(p.g.position.x), r2(p.g.position.z)]);
  for (const h of hazards) if (h.nid && h.kind !== 'blast') out.push(['hz+', h.nid, h.kind, r2(h.x), r2(h.z), r2(h.t)]);
  for (const h of puddles) out.push(['hz+', h.nid, 'acid', r2(h.x), r2(h.z), r2(h.t)]);
  if (state.mode === 'paused') out.push(['mode', 'paused']);
  if (state.mode === 'upgrade') out.push(['mode', 'upgrade'], ['wait', 'You joined between cities: the next one starts once everyone has picked']);
  if (state.mode === 'dead') out.push(['over', state.level, state.kills, state.runTime, state.cheated]);
  return out;
}
// The explored map as base64 bits.
function fog(){
  const e = world.explored, b = new Uint8Array(Math.ceil(N*N/8));
  for (let i=0;i<N*N;i++) if (e[i]) b[i >> 3] |= 1 << (i & 7);
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
