// ---------- Dev tools ----------
// Debug/cheat panel toggled with the ` key (the key left of 1, Backquote). Cheat flags live on
// `dev` (state.js) and are read by gameplay code; everything else here calls the game's own
// functions. Using any of it marks the run as cheated (a "Dev" chip in the HUD, best run not saved).
// Player cheats are remembered in localStorage['crystal-fall-dev'] and only apply to the player you
// control (P() = me()). Add new tools to a section in buildPanel() and list them in CLAUDE.md.
import * as THREE from 'three';
import { TILE, N, walkable, DISTRICTS, CONDITIONS, BREAKABLES } from './config.js';
import { WEAPONS, ITEMS, LANDMARKS, GUNS, UNIQUES, RARITY, SPECIALS } from './items.js';
import { ZTYPES, ZMODS, THREAT_BASE, THREAT_POOL, AI, VAULT } from './threats.js';
import { $, clamp, fmtTime, mpick } from './utils.js';
import { camera, camFocus } from './renderer.js';
import { state, world, zombies, dev, mouse, mouseNDC, players } from './state.js';
import { me, refreshGun, addPlayer, removePlayer, MAX_PLAYERS } from './player.js';
import { addItem, countItem, giveWeapon, replaceWeapon, magSize, curWeapon } from './inventory.js';
import { makeWeapon, rollWeapon, rollRarity, rollMods, RARITIES, weaponTitle } from './weapons.js';
import { spawnDrop } from './loot.js';
import { spawnZombieAt, findSpawnNear, killZombie, alertZombie, turnZombie, freezeZombie } from './zombies.js';
import { hitCrystal } from './combat.js';
import { foundCrystal } from './crystal.js';
import { updateFlow, reveal, blockIndex, toGround } from './grid.js';
import { startCity, newRun, newSeed, openRoad, completeCity, killPlayer, revivePlayer, spectate } from './game.js';
import { showScreen, toast } from './hud.js';
import { UPGRADES, targets as cardTargets, modChoices, destChoices, cardFits, applyCard, cardOdds, CARD_TIERS } from './upgrades.js';
import { roster } from './host.js';
import { cityCondition } from './cityGen.js';
import { placeBarricade, hitBreak } from './breakables.js';
import { padReport } from './gamepad.js';
// Runs f on every breakable within 12 units of you.
function nearBreaks(f){ ensureRun(); mark(); const p = P(); for (const b of [...world.breaks.values()]) if (Math.hypot((b.x + 0.5)*TILE - p.pos.x, (b.z + 0.5)*TILE - p.pos.z) < 12) f(b); }

const P = me;
const PREFS = 'crystal-fall-dev', SAVED = ['god','ammo','stamina','noclip','ignored','oneHit','speed'];
// Flags that count as cheating while they're on (zoom and click-teleport only when used).
const cheating = () => dev.god || dev.ammo || dev.stamina || dev.noclip || dev.ignored || dev.oneHit || dev.freeze || dev.speed !== 1 || dev.timeScale !== 1 || dev.zoom !== 1;
const mark = () => { if (state.mode !== 'menu') state.cheated = true; };
function savePrefs(){ try { const o = {}; for (const k of SAVED) o[k] = dev[k]; localStorage.setItem(PREFS, JSON.stringify(o)); } catch(e){} }
function loadPrefs(){ try { const o = JSON.parse(localStorage.getItem(PREFS) || '{}'); for (const k of SAVED) if (typeof o[k] === typeof dev[k]) dev[k] = o[k]; } catch(e){} }

export const isDevKey = e => e.code === 'Backquote' || e.key === '`';
// True while typing into one of the panel's fields (game keys are ignored then).
export const devTypingIn = t => !!(t && t.closest && t.closest('#devtools') && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== 'checkbox');
export function toggleDev(){
  dev.open = !dev.open;
  $('devtools').classList.toggle('hidden', !dev.open);
  if (dev.open){ syncPanel(); readT = 0; }
  else if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#devtools')) document.activeElement.blur();
}

// ---------- Actions ----------
// Starts a run first when there isn't one (menu, death screen).
function ensureRun(){ if (state.mode === 'menu' || state.mode === 'dead') newRun(); }
function closeOverlays(){ if (state.mode !== 'play' && state.mode !== 'menu'){ state.mode = 'play'; showScreen(null); } }
// cond: a CONDITIONS key to look for a random seed with (ignored when a seed is given).
function goCity(level, seed, cond){
  level = clamp(Math.floor(level) || 1, 1, 99);
  if (!Number.isFinite(seed)){ seed = newSeed(); for (let i=0;cond && i<200 && cityCondition(seed) !== cond;i++) seed = newSeed(); }
  if (state.mode === 'menu' || state.mode === 'dead') newRun(level, seed);
  else { closeOverlays(); startCity(level, seed); }
}
// Nearest walkable tile inside the city (exit column excluded) within r tiles, or null.
function nearestOpen(tx, tz, r = 14){
  const c = world.city, ok = (x, z) => x > 0 && z > 0 && x < c.n - 1 && z < c.n - 1 && walkable(c.grid[z*N + x]);
  for (let d=0;d<=r;d++) for (let dz=-d;dz<=d;dz++) for (let dx=-d;dx<=d;dx++)
    if (Math.max(Math.abs(dx), Math.abs(dz)) === d && ok(tx+dx, tz+dz)) return [tx+dx, tz+dz];
  return null;
}
// Moves the player to world point (x,z), snapped to the nearest open tile unless noclip is on.
export function teleport(x, z){
  ensureRun(); closeOverlays();
  const n = world.city.n;
  let tx = clamp(Math.floor(x/TILE), 1, n - 2), tz = clamp(Math.floor(z/TILE), 1, n - 2);
  if (dev.noclip){ x = clamp(x, TILE, (n - 1)*TILE - 0.1); z = clamp(z, TILE, (n - 1)*TILE - 0.1); }
  else {
    const t = nearestOpen(tx, tz); if (!t) return toast('Nowhere to stand there', 'bad');
    [tx, tz] = t; x = (tx + 0.5)*TILE; z = (tz + 0.5)*TILE;
  }
  const p = P(); if (p.dead) return toast('You’re dead: revive first', 'bad');
  toGround(p.pos.set(x, 0, z)); p.vel.set(0, 0, 0); p.g.position.copy(p.pos); camFocus.copy(p.pos);
  p.lastTile = -1; reveal(tx, tz, 8); updateFlow();
  mark();
}
const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
export function teleportToCursor(){
  ray.setFromCamera(mouseNDC, camera);
  ground.constant = -P().pos.y;  // roughly the ground: on the level of the player
  if (ray.ray.intersectPlane(ground, hitV)) teleport(hitV.x, hitV.z);
}
const tileTp = (tx, tz) => teleport((tx + 0.5)*TILE, (tz + 0.5)*TILE);
// Teleport targets for the current city: start, Crystal, exit, every landmark.
function targets(){
  const c = world.city; if (!c) return [];
  const out = [['Start', () => tileTp(c.start.x, c.start.z)], ['💎 Crystal', () => tileTp(c.crystalTile.x, c.crystalTile.z)], ['🚪 Exit', () => tileTp(c.n - 3, c.exitZ)]];
  const seen = {};
  for (const l of c.landmarks){
    const L = LANDMARKS[l.type], k = seen[l.type] = (seen[l.type] || 0) + 1;
    out.push([`${L.icon} ${L.name}${k > 1 ? ' ' + k : ''}`, () => tileTp(l.ox, l.oz)]);
  }
  // The nearest of each kind of road closure and unusual block, and a broken tower.
  const near = list => { const p = P(); let best = null, bd = 1e9; for (const o of list){ const d = Math.hypot((o.x + 0.5)*TILE - p.pos.x, (o.z + 0.5)*TILE - p.pos.z); if (d < bd){ bd = d; best = o; } } return best; };
  for (const k of ['barrier','fence','checkpoint','pileup','bus','collapse']){
    const n = c.closures.filter(o => o.kind === k).length;
    if (n) out.push([`🚧 ${titleCase(k)} (${n})`, () => { const o = near(c.closures.filter(o => o.kind === k)); tileTp(o.x, o.z); }]);
  }
  for (const k of ['construction','cemetery','camp','pond','crater']){
    const bs = c.blocks.filter(b => b.type === k).map(b => ({ x:b.x0 + 2, z:b.z0 + 2 }));
    if (bs.length) out.push([`▦ ${titleCase(k)} (${bs.length})`, () => { const o = near(bs); tileTp(o.x, o.z); }]);
  }
  // Big lots (several blocks merged) by type, dead ends, streets closed to cars.
  const bigs = {};
  for (const L of c.lots || []) if (L.blocks.length > 1) (bigs[L.type] = bigs[L.type] || []).push({ x:L.r.x0 + (L.r.w >> 1), z:L.r.z0 + (L.r.d >> 1) });
  for (const k in bigs) out.push([`▣ Big ${k} (${bigs[k].length})`, () => { const o = near(bigs[k]); tileTp(o.x, o.z); }]);
  if (c.deadEnds && c.deadEnds.length) out.push([`⛔ Dead end (${c.deadEnds.length})`, () => { const o = near(c.deadEnds); tileTp(o.x, o.z); }]);
  for (const k of ['walk','path','track']){
    const ss = (c.strips || []).filter(s => s.kind === k).map(s => ({ x:s.x0, z:s.z0 }));
    if (ss.length) out.push([`🚶 ${{ walk:'Pedestrian street', path:'Footpath', track:'Dirt track' }[k]} (${ss.length})`, () => { const o = near(ss); tileTp(o.x, o.z); }]);
  }
  // Terrain: hills, embankments, park terraces (and their second tier), loading docks, stairs, the
  // highest and lowest ground.
  for (const k of ['hill','embankment','terrace','second tier','dock']){
    const fs = (c.features || []).filter(f => f.kind === k);
    if (fs.length) out.push([`⛰ ${titleCase(k)} (${fs.length})`, () => { const o = near(fs); tileTp(o.x, o.z); }]);
  }
  if (c.stairs && c.stairs.length) out.push([`⛰ Stairs (${c.stairs.length})`, () => { const o = near(c.stairs); tileTp(o.x, o.z); }]);
  if (c.hc){
    let hi = 0, lo = 0;
    for (let z=1;z<c.n-1;z++) for (let x=1;x<c.n-1;x++){ const i = z*N + x; if (!walkable(c.grid[i])) continue; if (c.hc[i*4] > c.hc[hi*4]) hi = i; if (c.hc[i*4] < c.hc[lo*4] || !lo) lo = i; }
    out.push([`⛰ Highest ground (${c.hc[hi*4].toFixed(1)})`, () => tileTp(hi % N, Math.floor(hi/N))], [`⛰ Lowest ground`, () => tileTp(lo % N, Math.floor(lo/N))]);
  }
  const fences = world.breaks ? [...world.breaks.values()] : [];
  for (const k of ['picket','rail','chain','iron','planks']){
    const fs = fences.filter(b => b.kind === k);
    if (fs.length) out.push([`▥ ${BREAKABLES[k].name} (${fs.length})`, () => { const o = near(fs); tileTp(o.x, o.z + 1); }]);
  }
  for (const [k, f] of [['Gate', p => p.kind === 'fgate'], ['Broken fence', p => p.kind === 'fence' && p.broken], ['Shipping containers', p => p.kind === 'shipping'], ['Smokestack', p => p.kind === 'stack']]){
    const ps = c.props.filter(f);
    if (ps.length) out.push([`▥ ${k} (${ps.length})`, () => { const o = near(ps); tileTp(o.x, o.z + 1); }]);
  }
  const broken = c.buildings.filter(b => b.cut).map(b => ({ x:b.x, z:b.z }));
  if (broken.length) out.push([`🏚 Broken building (${broken.length})`, () => { const o = near(broken); tileTp(o.x, o.z); }]);
  return out;
}

function heal(){
  if (state.mode === 'dead'){ state.mode = 'play'; showScreen(null); }
  const p = P(); if (p.dead) revivePlayer(p, p.maxHp);
  p.hp = p.maxHp; p.bleeding = false;
}
// Full mags, full reserves, full fuel and charge, the flask brewed.
function refillAmmo(p = P()){ for (const w of p.weapons) if (w){ w.mag = magSize(w); w.cd = 0; p.ammo[w.id] = WEAPONS[w.id].maxAmmo || 0; } }
// rarity: a RARITIES entry or 'random' (rolled with this city's odds); modifiers are random.
function giveGun(id, rarity){
  ensureRun();
  if (rarity === 'random') rarity = rollRarity();
  const w = makeWeapon(id, rarity, rollMods(RARITY[rarity] ? RARITY[rarity].mods : 0, id));
  const p = P();
  if (!giveWeapon(p, w)) replaceWeapon(p, w);
  w.mag = magSize(w); p.ammo[id] = WEAPONS[id].maxAmmo || 0; refreshGun(p);
  toast(`+ ${weaponTitle(w)}`, 'good');
}
// New modifiers for the held weapon, as many as it has (a gun: as many as its rarity gives).
function rerollHeld(){
  ensureRun();
  const w = curWeapon(P()), n = w.rarity === 'unique' ? w.mods.length : RARITY[w.rarity].mods;
  if (!n) return toast(w.rarity === 'unique' ? 'No modifiers yet: play Prototype on it (Upgrades)' : 'Commons have no modifiers');
  w.mods = rollMods(n, w.id); w.mag = Math.min(w.mag, magSize(w));
}
// Plays upgrade card u right away: on the held weapon if it fits (else the first one it fits), a random
// modifier (Gunsmith, Transplant) and destination (Transplant). Shows what it did.
function playCard(u){
  ensureRun();
  const p = P();
  if (!cardFits(p, u)) return toast(`${u.name} doesn’t fit any of your weapons`, 'bad');
  let slot = -1, mod = -1, dest = -1;
  if (u.on){
    const t = cardTargets(p, u); slot = t.includes(p.cur) ? p.cur : t[0];
    if (u.mod) mod = mpick(modChoices(p, u, p.weapons[slot]));
    if (u.dests) dest = mpick(destChoices(p, u, p.weapons[slot], mod));
  }
  toast(`${u.icon} ${applyCard(p, [u.id, slot, mod, dest]).text}`, 'good');
}
// Puts special k on its unique (given first, with full ammo, if you don't carry it), past the usual cap of 3.
function giveSpecial(k){
  ensureRun();
  const id = SPECIALS[k].on, p = P();
  if (!p.weapons.some(w => w && w.id === id)) giveGun(id, 'unique');
  const w = p.weapons.find(w => w && w.id === id);
  if (!w.mods.some(m => m.k === k)) w.mods.push({ k, s:1, v:0 });
  toast(`✦ ${SPECIALS[k].name} on your ${WEAPONS[id].name}`, 'good');
}
// A ring of random weapon finds around you (with luck), to try the tooltip and pickups.
function scatterWeapons(n, luck){
  ensureRun(); closeOverlays();
  for (let i=0;i<n;i++){
    const a = i/n*Math.PI*2, x = P().pos.x + Math.sin(a)*2.6, z = P().pos.z + Math.cos(a)*2.6;
    const g = walkable(world.city.grid[Math.floor(z/TILE)*N + Math.floor(x/TILE)]);
    spawnDrop('weapon', rollWeapon(luck, undefined, P()), 0, g ? x : P().pos.x, g ? z : P().pos.z, g ? null : P());
  }
}
function giveItem(id, fill){
  ensureRun();
  const k = addItem(P(), id, fill ? ITEMS[id].max : 1);
  if (!k) toast('Pack full', 'bad');
}
function spawnSome(type, mods, n, alert, rise){
  ensureRun(); closeOverlays();
  dev.spawn = { type, mods };
  try {
    for (let i=0;i<n;i++){
      const s = findSpawnNear(P().pos.x, P().pos.z, 5, 11); if (!s) continue;
      spawnZombieAt(s.x, s.z, false, alert, false, null, rise ? undefined : 0);
    }
  } finally { dev.spawn = null; }
}
function killAll(){ for (const z of zombies.slice()) if (!z.dead){ z.rise = 0; killZombie(z, false, 'bullet'); } }
// Everyone forgets you and walks home (takeover zombies stop tracking you too).
function calmAll(){
  for (const z of zombies){ Object.assign(z, { mode:'return', alert:false, tracked:false, sees:false, mem:0, giveUp:AI.giveUp*2, percT:0, markT:0 }); z.mark.visible = false; }
}
function crystalAction(kind){
  ensureRun(); closeOverlays();
  const cr = world.crystal;
  if (kind === 'find'){ if (!state.crystalFound) foundCrystal(); return; }
  if (kind === 'half'){ if (cr.alive && cr.hp > cr.maxHp*0.5) hitCrystal(cr.hp - cr.maxHp*0.5 + 0.01); return; }
  if (kind === 'break'){ if (cr.alive) hitCrystal(cr.hp); return; }
  if (kind === 'skip'){ if (state.phase === 'takeover'){ state.takeover = Math.min(state.takeover, 10); state.tick = Math.min(state.tick, 10); } else toast('No takeover running'); return; }
  if (kind === 'open' && state.phase !== 'open'){ if (cr.alive) hitCrystal(cr.hp); openRoad(); }
}

// ---------- Panel ----------
let built = false, shownCity = null, shownPlayers = 0, readT = 0, frames = 0, fpsT0 = performance.now(), fps = 0;
const refs = {};
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function section(root, title, open = true){
  const d = h('details'); d.open = open; d.appendChild(h('summary', '', title)); root.appendChild(d);
  const b = h('div', 'dv-body'); d.appendChild(b); return b;
}
const row = (p, cls) => p.appendChild(h('div', 'dv-row' + (cls ? ' ' + cls : '')));
function btn(p, label, fn, title){
  const b = h('button', 'dv-btn', label); b.type = 'button'; if (title) b.title = title;
  b.addEventListener('click', e => { b.blur(); fn(e); mark(); syncPanel(); });
  return p.appendChild(b);
}
function check(p, key, label, title, onChange){
  const l = h('label', 'dv-check'), c = h('input'); c.type = 'checkbox'; c.checked = !!dev[key];
  if (title) l.title = title;
  c.addEventListener('change', () => { c.blur(); dev[key] = c.checked; if (onChange) onChange(c.checked); savePrefs(); mark(); });
  l.append(c, document.createTextNode(label)); p.appendChild(l);
  (refs.checks = refs.checks || []).push([c, key]);
  return c;
}
function pick(p, label, key, values, fmt){
  const l = h('label', 'dv-pick', label), s = h('select');
  for (const v of values){ const o = h('option', '', fmt(v)); o.value = v; s.appendChild(o); }
  s.value = dev[key];
  s.addEventListener('change', () => { s.blur(); dev[key] = +s.value; savePrefs(); mark(); });
  l.appendChild(s); p.appendChild(l);
  (refs.picks = refs.picks || []).push([s, key]);
}
const titleCase = s => s[0].toUpperCase() + s.slice(1);
const threatName = id => (ZTYPES[id] || ZMODS[id]).name || titleCase(id) + 's';

function buildPanel(){
  built = true;
  const root = $('devtools');
  const head = row(root, 'dv-head');
  head.append(h('b', 'display', 'Dev tools'), h('small', '', '` to close'));
  btn(head, '✕', toggleDev, 'Close');
  refs.read = root.appendChild(h('pre', 'dv-read'));

  let s = section(root, 'Player');
  let r = row(s, 'dv-checks');
  check(r, 'god', 'God mode', 'No damage, no bleeding');
  check(r, 'ammo', 'Infinite ammo', 'Mags and reserves stay full');
  check(r, 'stamina', 'Infinite stamina');
  check(r, 'noclip', 'Noclip', 'Walk through walls and buildings');
  check(r, 'ignored', 'Ignored by zombies', 'They can’t see you or attack you (noise still draws them)', on => { if (on) calmAll(); });
  check(r, 'oneHit', 'One-hit kills', 'Every hit kills (shields too)');
  check(r, 'clickTp', 'Click to teleport', 'Left click on the ground teleports you instead of shooting');
  pick(row(s), 'Move speed', 'speed', [0.5, 1, 1.5, 2, 3], v => v + '×');
  r = row(s);
  btn(r, 'Heal / revive', heal); btn(r, 'Cure bleeding', () => { P().bleeding = false; });
  btn(r, '+25 max HP', () => { P().maxHp += 25; P().hp += 25; });
  r = row(s);
  btn(r, 'Hurt 25', () => { if (state.mode === 'play' && !dev.god){ P().hp = Math.max(1, P().hp - 25); } }, 'Leaves at least 1 HP; off in god mode');
  btn(r, 'Bleed', () => { P().bleeding = true; });
  btn(r, 'Die', () => { if (state.mode === 'play') killPlayer(P()); }, 'You turn into a zombie; with companions alive you spectate until the next city');

  s = section(root, 'Players');
  s.appendChild(h('small', 'dv-note', 'Companions stand in for other players until there’s networking: they follow you, shoot and heal themselves. Zombie numbers scale with the session.'));
  r = row(s);
  btn(r, '+ Companion', () => { ensureRun(); const p = addPlayer(); if (!p) return toast(`At most ${MAX_PLAYERS} players`); const m = P(); p.pos.copy(m.pos).add(new THREE.Vector3(0.8, 0, 0.8)); p.g.position.copy(p.pos); p.ctl.aim.copy(m.ctl.aim); updateFlow(); roster(); }, 'Adds a bot player next to you');
  btn(r, '− Companion', () => { const p = players.slice().reverse().find(o => o !== P() && !o.remote); if (p) removePlayer(p); roster(); }, 'Removes the last companion (never someone playing on another machine)');
  btn(r, 'Kill one', () => { const p = players.find(o => o !== P() && !o.dead); if (p && state.mode === 'play') killPlayer(p); }, 'A living companion turns into a zombie');
  btn(r, 'Revive all', () => { for (const p of players) revivePlayer(p, p.maxHp); }, 'Everyone dead stands up again where they fell');
  refs.players = row(s, 'dv-grid');

  s = section(root, 'City');
  r = row(s);
  const lv = refs.level = h('input'); lv.type = 'number'; lv.min = 1; lv.max = 99; lv.title = 'City number';
  const sd = refs.seed = h('input'); sd.type = 'text'; sd.placeholder = 'random seed'; sd.title = 'Seed (blank = random)'; sd.className = 'dv-seed';
  const cd = refs.cond = h('select'); cd.title = 'City condition (finds a random seed with it; ignored with a seed)';
  for (const k of ['', ...Object.keys(CONDITIONS)]){ const o = h('option', '', k ? CONDITIONS[k].name : 'any condition'); o.value = k; cd.appendChild(o); }
  cd.addEventListener('change', () => cd.blur());
  const go = () => goCity(+lv.value, sd.value.trim() === '' ? NaN : parseInt(sd.value, 10), cd.value);
  for (const i of [lv, sd]) i.addEventListener('keydown', e => { if (e.key === 'Enter'){ i.blur(); go(); mark(); syncPanel(); } if (e.key === 'Escape') i.blur(); });
  r.append(h('span', 'dv-lbl', 'City'), lv, sd);
  btn(r, 'Go', go, 'Start this city (inventory carries over)');
  r = row(s); r.append(h('span', 'dv-lbl', 'Condition'), cd);
  r = row(s);
  btn(r, '◂ Prev', () => goCity(state.level - 1)); btn(r, 'Next ▸', () => goCity(state.level + 1));
  btn(r, 'Restart', () => goCity(state.level, state.seed), 'Same city, same seed');
  btn(r, 'Clear city', () => { ensureRun(); closeOverlays(); completeCity(); }, 'Go to the upgrade screen');
  r = row(s);
  btn(r, 'Find Crystal', () => crystalAction('find')); btn(r, 'Crystal 50%', () => crystalAction('half'), 'Triggers the pulse from City 3');
  btn(r, 'Break it', () => crystalAction('break'));
  r = row(s);
  btn(r, 'Takeover → 10 s', () => crystalAction('skip')); btn(r, 'Open road', () => crystalAction('open'));
  btn(r, 'Reveal map', () => { ensureRun(); world.explored.fill(1); world.mmDirty = true; });
  s = section(root, 'Threats this city', false);
  refs.threats = row(s, 'dv-checks');
  refs.order = s.appendChild(h('small', 'dv-note'));

  s = section(root, 'Teleport');
  r = row(s);
  const tp = refs.tp = h('select'); tp.addEventListener('change', () => tp.blur());
  r.appendChild(tp);
  btn(r, 'Go', () => { const t = targets()[+tp.value]; if (t) t[1](); });
  s.appendChild(h('small', 'dv-note', 'Tick “Click to teleport” under Player to jump to the cursor.'));

  s = section(root, 'Zombies');
  r = row(s);
  const ty = h('select'); for (const id in ZTYPES){ const o = h('option', '', titleCase(id)); o.value = id; ty.appendChild(o); }
  const cnt = h('select'); for (const v of [1, 5, 10, 25, 50]){ const o = h('option', '', '×' + v); o.value = v; cnt.appendChild(o); }
  for (const e of [ty, cnt]) e.addEventListener('change', () => e.blur());
  r.append(ty, cnt);
  const mods = {}; for (const id in ZMODS) mods[id] = false;
  const sp = { alert:true, rise:true };
  r = row(s, 'dv-checks');
  const opt = (obj, k, label) => {
    const l = h('label', 'dv-check'), c = h('input'); c.type = 'checkbox'; c.checked = obj[k];
    c.addEventListener('change', () => { c.blur(); obj[k] = c.checked; });
    l.append(c, document.createTextNode(label)); r.appendChild(l);
  };
  for (const id in ZMODS) opt(mods, id, titleCase(id));
  opt(sp, 'alert', 'Hunting'); opt(sp, 'rise', 'Rise from ground');
  r = row(s);
  btn(r, 'Spawn near me', () => spawnSome(ty.value, mods, +cnt.value, sp.alert, sp.rise));
  r = row(s);
  btn(r, 'Kill all', killAll, 'No kills or drops counted; exploders still blow'); btn(r, 'Calm all', calmAll);
  btn(r, 'Alert all', () => { for (const z of zombies) alertZombie(z); });
  r = row(s, 'dv-checks');
  check(r, 'freeze', 'Freeze zombies', 'Skip their update: no movement, senses or attacks');

  s = section(root, 'Items & weapons');
  r = row(s, 'dv-grid');
  for (const id in ITEMS) btn(r, `${ITEMS[id].icon} ${ITEMS[id].name}`, e => giveItem(id, e.shiftKey), 'Click +1, shift-click a full stack');
  r = row(s);
  const rar = h('select'); for (const k of ['random', ...RARITIES]){ const o = h('option', '', k === 'random' ? 'Random rarity' : RARITY[k].name); o.value = k; rar.appendChild(o); }
  rar.addEventListener('change', () => rar.blur()); r.appendChild(rar);
  r = row(s, 'dv-grid');
  for (const id of GUNS) btn(r, WEAPONS[id].name, () => giveGun(id, rar.value), 'Give it at the picked rarity with random modifiers (replaces the held gun when both slots are full)');
  for (const id of UNIQUES) btn(r, '★ ' + WEAPONS[id].name, () => giveGun(id, 'unique'), 'Unique weapon (replaces the held gun when both slots are full)');
  r = row(s);
  btn(r, 'Reroll mods', rerollHeld, 'New random modifiers for the gun in your hands');
  btn(r, 'Scatter 6 guns', () => scatterWeapons(6, 0), 'Random weapon finds on the ground around you (this city’s odds)');
  btn(r, 'Lucky ×6', () => scatterWeapons(6, 8), 'Same with armory-grade luck (more rares, legendaries and uniques)');
  r = row(s);
  btn(r, 'Refill gas pumps', () => { if (world.city) for (const l of world.city.landmarks) l.refueled = false; }, 'Every gas station can refuel the flamethrower again');
  btn(r, 'Turn nearby', () => { for (const z of zombies) if (Math.hypot(z.pos.x - P().pos.x, z.pos.z - P().pos.z) < 8 && !(z.rise > 0)) turnZombie(z, WEAPONS.potion.turn); }, 'Zombies within 8 units turn on their own kind (Turncoat flask)');
  btn(r, 'Freeze nearby', () => { for (const z of zombies) if (Math.hypot(z.pos.x - P().pos.x, z.pos.z - P().pos.z) < 8) freezeZombie(z, WEAPONS.cryo.freeze); }, 'Zombies within 8 units freeze solid (Cryo sprayer): any hit shatters them');
  r = row(s);
  btn(r, 'Refill ammo', () => { ensureRun(); refillAmmo(); });
  btn(r, 'Refill everyone', () => { ensureRun(); for (const p of players) refillAmmo(p); }, 'Your companions’ ammo too');
  btn(r, 'Fill pack', () => { ensureRun(); for (const id in ITEMS) addItem(P(), id, Math.max(0, ITEMS[id].max - countItem(P(), id))); }, 'Tops every item up to one full stack');
  btn(r, 'Empty pack', () => { P().inv.fill(null); });

  s = section(root, 'Upgrades', false);
  r = row(s);
  btn(r, 'Upgrade screen: every card', () => { ensureRun(); closeOverlays(); completeCity(true); }, 'Clear the city and get dealt every card that fits your weapons');
  btn(r, 'Card odds', () => {
    const lv = Math.max(1, state.level), rows = cardOdds(lv).sort((a, b) => b[1] - a[1]);
    odds.textContent = `Chance in a hand after City ${lv} (if it fits):\n` + rows.map(([u, q]) => `${u.icon} ${u.name.padEnd(12)} ${String(Math.round(q*100)).padStart(3)}%  ${u.tier} ×${CARD_TIERS[u.tier]}`).join('\n');
    odds.classList.remove('hidden');
  }, 'How often each card is dealt at this city (4000 simulated hands); cards that don’t fit become the Ammo cache');
  const odds = h('pre', 'dv-read hidden'); s.appendChild(odds);
  r = row(s, 'dv-grid');
  for (const u of UPGRADES) btn(r, `${u.icon} ${u.name}`, () => playCard(u), `${u.tier} card${u.from ? `, dealt from City ${u.from}` : ''}${u.fallback ? ', only dealt in place of one you can’t use' : ''}. ${u.desc}. Plays it now on the held weapon (or the first it fits), random modifier (and target) where it asks`);
  r = row(s, 'dv-grid');
  for (const k in SPECIALS) btn(r, `✦ ${SPECIALS[k].name}`, () => giveSpecial(k), `${WEAPONS[SPECIALS[k].on].name}: ${SPECIALS[k].desc}. Gives the weapon if you don’t carry it`);

  s = section(root, 'Fences & barricades', false);
  r = row(s);
  btn(r, 'Put up barricade', () => { ensureRun(); closeOverlays(); placeBarricade(P()); }, 'Boards up the tile in front of you (no item needed)');
  btn(r, 'Hit fences 50%', () => nearBreaks(b => hitBreak(b, b.max/2, b.x*TILE - P().pos.x, b.z*TILE - P().pos.z)), 'Every fence and barricade within 12 units loses half its health');
  btn(r, 'Break fences', () => nearBreaks(b => hitBreak(b, 999, b.x*TILE - P().pos.x, b.z*TILE - P().pos.z)), 'Knocks down every fence and barricade within 12 units');
  r = row(s, 'dv-checks');
  check(r, 'noVault', 'No vaulting', 'Players can’t climb over low fences (picket, rail)');
  check(r, 'noClimb', 'Runners don’t climb', 'Runners bang on low fences like everyone else instead of climbing over');
  r = row(s);
  btn(r, 'Stun me', () => { ensureRun(); const p = P(); p.stun = VAULT.stun; }, 'What a hit mid-vault does: dazed, can’t move or act');
  s.appendChild(h('small', 'dv-note', 'Walk into a picket or rail fence to vault it; a hit on the way over knocks you off, stunned. Zombies bang on a fence when their way to you goes through it. “+1 of any item” has planks and barricades.'));

  s = section(root, 'World');
  r = row(s);
  pick(r, 'Time', 'timeScale', [0, 0.25, 0.5, 1, 2, 3], v => v ? v + '×' : 'Stopped');
  pick(r, 'Zoom', 'zoom', [0.4, 0.6, 0.8, 1, 1.3], v => v + '×');
  r = row(s, 'dv-checks');
  const hud = h('label', 'dv-check'), hc = h('input'); hc.type = 'checkbox';
  hc.addEventListener('change', () => { hc.blur(); document.body.classList.toggle('dv-nohud', hc.checked); });
  hud.append(hc, document.createTextNode('Hide HUD')); r.appendChild(hud);
}

// Refreshes everything that depends on the current city or on values changed elsewhere.
function syncPanel(){
  if (!built || !dev.open) return;
  for (const [c, k] of refs.checks) c.checked = !!dev[k];
  for (const [s, k] of refs.picks) s.value = dev[k];
  if (document.activeElement !== refs.level) refs.level.value = state.level;
  if (world.city !== shownCity){
    shownCity = world.city;
    refs.tp.innerHTML = '';
    targets().forEach(([name], i) => { const o = h('option', '', name); o.value = i; refs.tp.appendChild(o); });
  }
  // Threat unlocks: ticking one makes it roll from this city on (until the next city resets them).
  const box = refs.threats; box.innerHTML = '';
  for (const id of THREAT_BASE.concat(THREAT_POOL)){
    const l = h('label', 'dv-check'), c = h('input'); c.type = 'checkbox'; c.checked = !!state.threatIntro[id];
    c.addEventListener('change', () => { c.blur(); if (c.checked) state.threatIntro[id] = state.level; else delete state.threatIntro[id]; mark(); });
    l.append(c, document.createTextNode(threatName(id))); box.appendChild(l);
  }
  // Which player you control: the others become companions (bots).
  const pr = refs.players; pr.innerHTML = '';
  if (players.length > 1) players.forEach((p, i) => {
    const b = btn(pr, `${i === state.me ? '● ' : ''}Play as ${p.name}${p.dead ? ' †' : ''}`, () => { if (p.remote) return toast(`${p.name} plays on another machine`); state.me = i; state.view = i; mouse.down = false; if (p.dead) spectate(1); }, 'Take control of this player');
    b.style.color = p.css;
  });
  refs.order.textContent = state.threatOrder.length ? 'Run order: ' + state.threatOrder.map((id, i) => `${i + 2} ${threatName(id).toLowerCase()}`).join(', ') : '';
}
function readout(){
  const c = world.city, cr = world.crystal; if (!c) return '';
  const tx = Math.floor(P().pos.x/TILE), tz = Math.floor(P().pos.z/TILE), D = DISTRICTS[c.blocks[blockIndex(P().pos.x, P().pos.z)].district];
  const crys = cr && cr.alive ? `Crystal ${Math.ceil(cr.hp)}/${cr.maxHp}${state.crystalFound ? '' : ' (hidden)'}` : state.phase === 'takeover' ? `Takeover ${fmtTime(Math.ceil(state.takeover))}` : 'Road open';
  return `${fps} fps · ${state.mode}${dev.timeScale !== 1 ? ` · time ${dev.timeScale}×` : ''}\n` +
    `City ${state.level} (${c.n}×${c.n}) · seed ${state.seed} · ${CONDITIONS[c.cond].name}\n` +
    `${zombies.length} zombies (${state.hordeAlive} takeover) · ${state.kills} kills\n` +
    (players.length > 1 ? players.map(p => `${p.name}${p === P() ? '*' : ''} ${p.dead ? 'dead' : Math.ceil(p.hp) + 'hp'} ${p.kills}k`).join(' · ') + '\n' : '') +
    `Tile ${tx}, ${tz} · ${D.name} · ${crys}\n` + padReport();
}

export function initDev(){ loadPrefs(); buildPanel(); }
// Every frame, in every mode: keeps cheats applied and the readout current.
export function updateDev(dt){
  const now = performance.now(); frames++;
  if (now - fpsT0 >= 500){ fps = Math.round(frames*1000/(now - fpsT0)); frames = 0; fpsT0 = now; }
  if (dev.ammo && players.length) refillAmmo();
  if (dev.stamina){ P().stamina = 1; P().winded = false; }
  if (dev.god) P().bleeding = false;
  if (camera.zoom !== dev.zoom){ camera.zoom = dev.zoom; camera.updateProjectionMatrix(); }
  if (cheating()) mark();
  if (!dev.open) return;
  if (world.city !== shownCity || players.length !== shownPlayers){ shownPlayers = players.length; syncPanel(); }
  readT -= dt;
  if (readT <= 0){ readT = 0.25; const t = readout(); if (refs.read.textContent !== t) refs.read.textContent = t; }
}
