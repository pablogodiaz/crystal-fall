// ---------- Dev tools ----------
// Debug/cheat panel toggled with the ` key (the key left of 1, Backquote). Cheat flags live on
// `dev` (state.js) and are read by gameplay code; everything else here calls the game's own
// functions. Using any of it marks the run as cheated (a "Dev" chip in the HUD, best run not saved).
// Player cheats are remembered in localStorage['crystal-fall-dev']. Add new tools to a section
// in buildPanel() and list them in CLAUDE.md.
import * as THREE from 'three';
import { TILE, N, walkable, DISTRICTS } from './config.js';
import { WEAPONS, ITEMS, LANDMARKS } from './items.js';
import { ZTYPES, ZMODS, THREAT_BASE, THREAT_POOL, AI } from './threats.js';
import { $, clamp, fmtTime } from './utils.js';
import { camera, camFocus } from './renderer.js';
import { state, world, zombies, dev, mouseNDC } from './state.js';
import { player, refreshGun } from './player.js';
import { addItem, countItem, giveWeapon, replaceWeapon, magSize } from './inventory.js';
import { spawnZombieAt, findSpawnNear, killZombie, alertZombie } from './zombies.js';
import { hitCrystal } from './combat.js';
import { foundCrystal } from './crystal.js';
import { updateFlow, reveal, blockIndex } from './grid.js';
import { startCity, newRun, newSeed, openRoad, completeCity, die } from './game.js';
import { showScreen, toast } from './hud.js';
import { UPGRADES } from './upgrades.js';

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
function goCity(level, seed){
  level = clamp(Math.floor(level) || 1, 1, 99);
  if (!Number.isFinite(seed)) seed = newSeed();
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
  player.pos.set(x, 0, z); player.vel.set(0, 0, 0); player.g.position.copy(player.pos); camFocus.copy(player.pos);
  world.lastTile = -1; reveal(tx, tz, 8); updateFlow();
  mark();
}
const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
export function teleportToCursor(){
  ray.setFromCamera(mouseNDC, camera);
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
  return out;
}

function heal(){
  if (state.mode === 'dead'){ state.mode = 'play'; showScreen(null); }
  player.hp = player.maxHp; player.bleeding = false;
}
function refillAmmo(){ for (const w of player.weapons) if (w){ w.mag = magSize(w); player.ammo[w.id] = WEAPONS[w.id].maxAmmo; } }
function giveGun(id){
  ensureRun();
  const r = giveWeapon(id);
  if (r === 'full' && player.weapons[player.cur].id !== id) replaceWeapon(id, WEAPONS[id].mag);
  const w = player.weapons.find(w => w && w.id === id); w.mag = magSize(w);
  player.ammo[id] = WEAPONS[id].maxAmmo; refreshGun();
}
function giveItem(id, fill){
  ensureRun();
  const k = addItem(id, fill ? ITEMS[id].max : 1);
  if (!k) toast('Pack full', 'bad');
}
function spawnSome(type, mods, n, alert, rise){
  ensureRun(); closeOverlays();
  dev.spawn = { type, mods };
  try {
    for (let i=0;i<n;i++){
      const s = findSpawnNear(player.pos.x, player.pos.z, 5, 11); if (!s) continue;
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
let built = false, shownCity = null, readT = 0, frames = 0, fpsT0 = performance.now(), fps = 0;
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
  btn(r, 'Heal / revive', heal); btn(r, 'Cure bleeding', () => { player.bleeding = false; });
  btn(r, '+25 max HP', () => { player.maxHp += 25; player.hp += 25; });
  r = row(s);
  btn(r, 'Hurt 25', () => { if (state.mode === 'play' && !dev.god){ player.hp = Math.max(1, player.hp - 25); } }, 'Leaves at least 1 HP; off in god mode');
  btn(r, 'Bleed', () => { player.bleeding = true; });
  btn(r, 'Die', () => { if (state.mode === 'play'){ player.hp = 0; die(); } });

  s = section(root, 'City');
  r = row(s);
  const lv = refs.level = h('input'); lv.type = 'number'; lv.min = 1; lv.max = 99; lv.title = 'City number';
  const sd = refs.seed = h('input'); sd.type = 'text'; sd.placeholder = 'random seed'; sd.title = 'Seed (blank = random)'; sd.className = 'dv-seed';
  const go = () => goCity(+lv.value, sd.value.trim() === '' ? NaN : parseInt(sd.value, 10));
  for (const i of [lv, sd]) i.addEventListener('keydown', e => { if (e.key === 'Enter'){ i.blur(); go(); mark(); syncPanel(); } if (e.key === 'Escape') i.blur(); });
  r.append(h('span', 'dv-lbl', 'City'), lv, sd);
  btn(r, 'Go', go, 'Start this city (inventory carries over)');
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
  r = row(s, 'dv-grid');
  for (const id in WEAPONS) btn(r, WEAPONS[id].name, () => giveGun(id), 'Give it (replaces the held gun when both slots are full)');
  r = row(s);
  btn(r, 'Refill ammo', () => { ensureRun(); refillAmmo(); });
  btn(r, 'Fill pack', () => { ensureRun(); for (const id in ITEMS) addItem(id, Math.max(0, ITEMS[id].max - countItem(id))); }, 'Tops every item up to one full stack');
  btn(r, 'Empty pack', () => { player.inv.fill(null); });

  s = section(root, 'Upgrades', false);
  r = row(s, 'dv-grid');
  for (const u of UPGRADES) btn(r, `${u.icon} ${u.name}`, () => { ensureRun(); u.apply(player); toast(u.name, 'good'); }, u.desc);

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
  refs.order.textContent = state.threatOrder.length ? 'Run order: ' + state.threatOrder.map((id, i) => `${i + 2} ${threatName(id).toLowerCase()}`).join(', ') : '';
}
function readout(){
  const c = world.city, cr = world.crystal; if (!c) return '';
  const tx = Math.floor(player.pos.x/TILE), tz = Math.floor(player.pos.z/TILE), D = DISTRICTS[c.blocks[blockIndex(player.pos.x, player.pos.z)].district];
  const crys = cr && cr.alive ? `Crystal ${Math.ceil(cr.hp)}/${cr.maxHp}${state.crystalFound ? '' : ' (hidden)'}` : state.phase === 'takeover' ? `Takeover ${fmtTime(Math.ceil(state.takeover))}` : 'Road open';
  return `${fps} fps · ${state.mode}${dev.timeScale !== 1 ? ` · time ${dev.timeScale}×` : ''}\n` +
    `City ${state.level} (${c.n}×${c.n}) · seed ${state.seed}\n` +
    `${zombies.length} zombies (${state.hordeAlive} takeover) · ${state.kills} kills\n` +
    `Tile ${tx}, ${tz} · ${D.name} · ${crys}`;
}

export function initDev(){ loadPrefs(); buildPanel(); }
// Every frame, in every mode: keeps cheats applied and the readout current.
export function updateDev(dt){
  const now = performance.now(); frames++;
  if (now - fpsT0 >= 500){ fps = Math.round(frames*1000/(now - fpsT0)); frames = 0; fpsT0 = now; }
  if (dev.ammo) refillAmmo();
  if (dev.stamina){ player.stamina = 1; player.winded = false; }
  if (dev.god) player.bleeding = false;
  if (camera.zoom !== dev.zoom){ camera.zoom = dev.zoom; camera.updateProjectionMatrix(); }
  if (cheating()) mark();
  if (!dev.open) return;
  if (world.city !== shownCity) syncPanel();
  readT -= dt;
  if (readT <= 0){ readT = 0.25; const t = readout(); if (refs.read.textContent !== t) refs.read.textContent = t; }
}
