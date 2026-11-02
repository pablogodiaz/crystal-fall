// ---------- HUD, minimap, banner, toasts, inventory bar, overlay screens ----------
import * as THREE from 'three';
import { TILE, N, T, DISTRICTS } from './config.js';
import { $, fmtTime } from './utils.js';
import { camera } from './renderer.js';
import { WEAPONS, ITEMS, RECIPES, LANDMARKS, INV_SLOTS, RARITY, SPECIALS } from './items.js';
import { CRYSTAL } from './threats.js';
import { state, world, zombies, drops, pickups, keys, players } from './state.js';
import { me, viewed } from './player.js';
import { craft, countItem, magSize, selectedThrowable, otherWeapons } from './inventory.js';
import { weaponStats, weaponDps, weaponTitle, modText, isSpecial } from './weapons.js';
import { dropName } from './loot.js';
import { EXIT_WAIT, crafting } from './game.js';
import { blockIndex } from './grid.js';
import { emit, emitTo } from './host.js';
import { act } from './client.js';

const mm = $('minimap'), mctx = mm.getContext('2d'), bm = $('bigmap'), bctx = bm.getContext('2d');
// Explored tiles are cached on an offscreen layer (MS px per tile), redrawn only when world.mmDirty.
const MS = 4, tileLayer = document.createElement('canvas'); tileLayer.width = N*MS; tileLayer.height = N*MS;
const tctx = tileLayer.getContext('2d');
// The HUD shows the player being watched (P = viewed(), set every frame): you, or whoever you're
// spectating while dead. Actions from it (inventory clicks, crafting) are always for me().
let P = null;
const MM_COLORS = { 0:'#3c3f46', 1:'#15171b', 2:'#0b0c0f', 3:'#d64545', 4:'#4ade80', 5:'#6a6862', 6:'#3f5a33', 7:'#8a8273', 8:'#24262b', 9:'#a070ff', 10:'#57534b', 11:'#30333a', 12:'#8a7350', 13:'#2d5670', 14:'#b08a4a' };
let mmTimer = 0, hudCache = {};
function setText(id, v){ if (hudCache[id] !== v){ hudCache[id] = v; $(id).textContent = v; } }
function paintTiles(){
  const city = world.city, crystal = world.crystal, explored = world.explored;
  world.mmDirty = false;
  tctx.fillStyle = '#07080a'; tctx.fillRect(0,0,N*MS,N*MS);
  for (let z=0;z<N;z++) for (let x=0;x<N;x++){
    if (!explored[z*N+x]) continue;
    let ty = city.grid[z*N+x];
    if (ty === T.CRYSTAL && !(crystal && crystal.alive && state.crystalFound)) ty = T.PLAZA;
    tctx.fillStyle = MM_COLORS[ty]; tctx.fillRect(x*MS, z*MS, MS, MS);
    if (city.level && city.level[z*N+x]){ tctx.fillStyle = city.level[z*N+x] === 2 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'; tctx.fillRect(x*MS, z*MS, MS, MS); }  // raised ground
  }
}
// Draws the explored map into a size×size canvas at s px per tile, centered on tile (cx,cz).
// The minimap follows the player; the full map (big) shows the whole city. Both canvases are
// rotated 45° in CSS to match the camera, so icons are counter-rotated. The Crystal and the exit
// stick to the minimap's edge when they're off it.
function drawMap(ctx, size, s, cx, cz, t, big){
  const city = world.city, crystal = world.crystal, explored = world.explored;
  const X = x => size/2 + (x - cx)*s, Z = z => size/2 + (z - cz)*s, edge = v => Math.max(7, Math.min(size - 7, v));
  ctx.fillStyle = '#07080a'; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tileLayer, X(0), Z(0), N*s, N*s);
  if (!big){
    ctx.fillStyle = '#ff4d4d';
    for (const z of zombies){
      const tx = Math.floor(z.pos.x/TILE), tz = Math.floor(z.pos.z/TILE);
      if (tx < 0 || tz < 0 || tx >= N || tz >= N || !explored[tz*N+tx]) continue;
      if (Math.hypot(z.pos.x - P.pos.x, z.pos.z - P.pos.z) > 26) continue;
      ctx.fillRect(X(z.pos.x/TILE) - 1.5, Z(z.pos.z/TILE) - 1.5, 3, 3);
    }
  }
  const ring = (x, z, color) => {
    const r = (big ? 6 : 4) + Math.sin(t*5)*1.5, px = X(x), pz = Z(z), off = px !== edge(px) || pz !== edge(pz);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(edge(px), edge(pz), off ? r*0.6 : r, 0, Math.PI*2); ctx.stroke();
    if (off){ ctx.fillStyle = color; ctx.beginPath(); ctx.arc(edge(px), edge(pz), 2, 0, Math.PI*2); ctx.fill(); }
  };
  if (crystal && crystal.alive && state.crystalFound) ring(crystal.pos.x/TILE, crystal.pos.z/TILE, '#c4a1ff');
  // Discovered landmarks, dimmed once everything in them has been searched.
  const R = big ? 10 : 7;
  ctx.font = (big ? 14 : 10) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of city.landmarks){
    if (!l.found) continue;
    const L = LANDMARKS[l.type], px = X(l.cx), pz = Z(l.cz);
    if (px < -R || pz < -R || px > size + R || pz > size + R) continue;
    ctx.save(); ctx.translate(px, pz); ctx.rotate(-Math.PI/4);
    ctx.globalAlpha = l.cts.every(i => city.containers[i].searched) ? 0.45 : 1;
    ctx.fillStyle = L.css; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText(L.icon, 0, 0.5);
    ctx.restore();
  }
  if (state.phase === 'open') ring(city.n-0.5, city.exitZ+1, '#4ade80');
  // Everyone else in their colour (pinned to the minimap's edge when off it), then the watched player in white.
  for (const o of players){
    if (o === P || o.dead) continue;
    const ox = edge(X(o.pos.x/TILE)), oz = edge(Z(o.pos.z/TILE));
    ctx.fillStyle = o.css; ctx.strokeStyle = '#07080a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ox, oz, big ? 3.5 : 2.6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  }
  const px = X(P.pos.x/TILE), pz = Z(P.pos.z/TILE), a = big ? 10 : 7;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px + Math.sin(P.angle)*a, pz + Math.cos(P.angle)*a); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px, pz, big ? 3.5 : 2.6, 0, Math.PI*2); ctx.fill();
}
function drawMinimap(t){
  if (world.mmDirty) paintTiles();
  drawMap(mctx, mm.width, MS, P.pos.x/TILE, P.pos.z/TILE, t, false);
}
export function updateHUD(dt, t){
  const crystal = world.crystal;
  P = viewed();
  const mine = P === me();
  $('hpFill').style.width = (P.hp/P.maxHp*100) + '%';
  setText('hpText', Math.ceil(P.hp) + ' / ' + P.maxHp);
  $('stFill').style.width = (P.stamina*100) + '%';
  $('stFill').classList.toggle('winded', P.winded);
  const st = (players.length > 1 ? `<span class="who" style="--pc:${P.css}">${P.name}${mine ? '' : ' (watching)'}</span>` : '') + (P.bleeding ? '<span>Bleeding</span>' : '') + (P.winded ? '<span class="warn">Winded</span>' : '') + (P.boost > 0 ? '<span class="good">Energized</span>' : '') + (state.cheated ? '<span class="dev">Dev</span>' : '');
  if (hudCache.status !== st){ hudCache.status = st; $('status').innerHTML = st; }
  setText('killText', state.kills + (state.kills === 1 ? ' kill' : ' kills'));
  setText('timeText', fmtTime(state.runTime));
  const w = P.weapons[P.cur], alt = otherWeapons(P), [aBig, aSub, aEmpty] = ammoState(w);
  setText('wpnName', weaponTitle(w));
  if (hudCache.rar !== w.rarity){ hudCache.rar = w.rarity; $('wpnName').dataset.r = w.rarity; }
  setText('ammoText', aBig); setText('ammoSub', aSub);
  $('ammoSub').classList.toggle('empty', aEmpty);
  setText('wpnAlt', alt.length ? `Q ⇄ ${alt.map(o => `${weaponTitle(o)} (${shortAmmo(o)})`).join(' · ')}` : WEAPONS[w.id].kind ? 'Other slot empty' : `Mag ${magSize(w)}. Other slot empty`);
  const th = selectedThrowable(P), thn = countItem(P, th);
  setText('throwText', `${ITEMS[th].icon} ${ITEMS[th].name} ×${thn}`);
  $('throwLine').classList.toggle('none', !thn);
  renderInventory();
  updateInteractPrompt();
  updateFloaters(dt); updateTags(); updateWeaponTip(); updatePlayerTags();
  const me0 = me();
  $('spectate').classList.toggle('hidden', !me0.dead || state.mode !== 'play');
  if (me0.dead) setText('spectateText', `You turned. Watching ${P.name} · click or Q for someone else · back next city`);
  let obj, sub = '';
  if (state.phase === 'explore'){
    if (!state.crystalFound){ obj = 'Find the Crystal'; sub = 'Follow the violet light. Gunfire draws the dead.'; }
    else { obj = 'Shatter the Crystal'; sub = 'Breaking it lets it take the city.'; }
  } else if (state.phase === 'takeover'){ obj = 'Survive the takeover'; sub = 'The dead keep rising until the Crystal’s hold breaks.'; }
  else if (state.exitIn && players.length > 1){
    const alive = players.filter(o => !o.dead).length;
    obj = state.exitIn < alive ? `At the exit: ${state.exitIn} / ${alive}` : `Leaving in ${Math.max(1, Math.ceil(EXIT_WAIT - state.exitT))}…`;
    sub = state.exitIn < alive ? 'Everyone still standing has to reach the road out.' : 'Stay in the exit.';
  } else if (state.exitIn){ obj = `Leaving in ${Math.max(1, Math.ceil(EXIT_WAIT - state.exitT))}…`; sub = 'Stay in the exit.'; }
  else { obj = 'Reach the exit'; sub = players.length > 1 ? 'The road east is open. Everyone still standing has to get there.' : 'The road east is open. Follow the green light.'; }
  setText('objText', obj); setText('objSub', sub);
  // The Crystal's HP while it stands, then the takeover's remaining time.
  const tk = state.phase === 'takeover', showCr = tk || !!(crystal && crystal.alive && state.crystalFound);
  $('crystalBar').classList.toggle('hidden', !showCr);
  if (showCr) $('crFill').style.width = (tk ? state.takeover/CRYSTAL.takeover : crystal.hp/crystal.maxHp)*100 + '%';
  $('countdown').classList.toggle('hidden', !tk);
  if (tk){ setText('countdown', fmtTime(Math.ceil(state.takeover))); $('countdown').classList.toggle('urgent', state.takeover <= 10); }
  const v = $('vignette'); const vo = parseFloat(v.style.opacity || 0);
  const low = P.hp < P.maxHp*0.3 ? 0.25 + Math.sin(t*5)*0.08 : 0;
  v.style.opacity = Math.max(low, vo - dt*1.5);
  mmTimer -= dt;
  if (mmTimer <= 0){ mmTimer = 0.1; drawMinimap(t); }
  // Full map while Tab is held.
  const big = !!keys.Tab && state.mode === 'play';
  $('bigmapWrap').classList.toggle('hidden', !big);
  if (big){ const n = world.city.n; if (world.mmDirty) paintTiles(); drawMap(bctx, bm.width, bm.width/n, n/2, n/2, t, true); renderLoadout(); }
  // Which district you're in (roads count toward the block south-east of them).
  const D = DISTRICTS[world.city.blocks[blockIndex(P.pos.x, P.pos.z)].district];
  setText('district', D.name + (D.note ? ` · ${D.note}` : ''));
}

// ---------- Weapons ----------
// [big number, line under it, warn] for the ammo panel, by kind of weapon.
// Fuel, charge and battery show as a share of the weapon's own tank (a modifier can make it bigger).
const tank = w => w.mag/magSize(w)*100;
function ammoState(w){
  const W = WEAPONS[w.id];
  if (W.kind === 'flame') return [String(Math.ceil(tank(w))), w.mag > 0 ? '% fuel' : 'No fuel: melee', w.mag <= 0];
  if (W.kind === 'arc') return [String(Math.floor(tank(w))), w.mag >= W.cost ? '% charge' : 'Recharging', w.mag < W.cost];
  if (W.kind === 'potion') return w.cd > 0 ? [String(Math.ceil(w.cd)), 's brewing', true] : ['Ready', 'click to throw', false];
  if (W.kind === 'grav') return [String(w.mag), `/ ${magSize(w)} wells`, w.mag < 1];
  if (W.kind === 'shard') return [String(w.mag), w.mag ? 'shards' : 'Break a Crystal', w.mag < 1];
  if (W.kind === 'drone') return [String(Math.floor(tank(w))), w.out ? '% battery · flying' : '% battery · click to launch', !w.out && w.mag < W.launch];
  if (W.kind === 'cryo' && P.reloadT <= 0) return [String(Math.ceil(w.mag)), `% coolant / ${Math.ceil(P.ammo.cryo)}`, w.mag + P.ammo.cryo < 1];
  if (W.kind === 'rail' && w.charge > 0){ const T = weaponStats(w).charge; return [Math.floor(Math.min(1, w.charge/T)*100) + '%', w.charge >= T - 1e-6 ? 'Release to fire' : 'Charging', false]; }
  const reserve = P.ammo[w.id];
  if (P.reloadT > 0) return ['…', 'Reloading', false];
  return [String(w.mag), w.mag + reserve === 0 ? 'Empty: melee' : '/ ' + reserve, w.mag + reserve === 0];
}
function shortAmmo(w){
  const W = WEAPONS[w.id];
  if (W.kind === 'flame') return `${Math.ceil(tank(w))}% fuel`;
  if (W.kind === 'arc') return `${Math.floor(tank(w))}% charge`;
  if (W.kind === 'potion') return w.cd > 0 ? `${Math.ceil(w.cd)} s` : 'ready';
  if (W.kind === 'grav') return `${w.mag} wells`;
  if (W.kind === 'shard') return `${w.mag} shards`;
  if (W.kind === 'drone') return `${Math.floor(tank(w))}%${w.out ? ', flying' : ''}`;
  if (W.kind === 'cryo') return `${Math.ceil(w.mag)}% / ${Math.ceil(P.ammo.cryo)}`;
  return `${w.mag} / ${P.ammo[w.id]}`;
}
// Card for a weapon: name, rarity, key stats, modifiers (green good, red bad), what a unique does.
// Shared by the ground tooltip and the Tab loadout. tag = chip next to the name, extra = lines after.
const f1 = v => String(+v.toFixed(1));
function statCells(w, all, p){
  const W = WEAPONS[w.id], S = weaponStats(w), c = (k, v) => `<span><small>${k}</small><b>${v}</b></span>`;
  const big = S.mag !== W.mag ? c('Capacity', Math.round(S.mag/W.mag*100) + '%') : '';  // a mag modifier on a unique
  if (W.kind === 'flame') return c('Damage', f1(S.dmg) + '/s') + c('Range', f1(S.range)) + c('Fuel', Math.ceil(tank(w)) + '%') + big;
  if (W.kind === 'arc') return c('Damage', f1(S.dmg)) + c('Jumps', W.chain) + c('Rate', f1(1/S.rate) + '/s') + c('Charge', Math.floor(tank(w)) + '%') + big;
  if (W.kind === 'potion') return c('Splash', f1(S.range)) + c('Turned', W.turn + ' s') + c('Dose', w.cd > 0 ? Math.ceil(w.cd) + ' s' : 'Ready') + (S.cooldown !== W.cooldown ? c('Brews', Math.round(S.cooldown) + ' s') : '');
  if (W.kind === 'grav') return c('Radius', W.radius) + c('Holds', W.time + ' s') + c('Wells', `${w.mag} / ${S.mag}`);
  if (W.kind === 'rail') return c('Damage', f1(S.dmg)) + c('Charge', f1(S.charge) + ' s') + c('Reload', f1(S.reload) + ' s') + (all ? c('Slugs', `${w.mag} / ${p.ammo.railgun}`) : '');
  if (W.kind === 'cryo') return c('Freezes in', f1(1/W.chill) + ' s') + c('Range', f1(S.range)) + c('Frozen', W.freeze + ' s') + c('Coolant', Math.ceil(w.mag) + (S.mag === W.mag ? '%' : ' / ' + S.mag));
  if (W.kind === 'shard') return c('Damage', f1(S.dmg) + '×' + S.pellets) + c('Pierce', S.pierce) + c('Bounces', W.bounce) + c('Shards', `${w.mag} / ${S.mag}`);
  if (W.kind === 'drone') return c('Damage', f1(S.dmg)) + c('Rate', f1(1/S.rate) + '/s') + c('Range', f1(S.range)) + c('Battery', Math.floor(tank(w)) + '%') + big;
  return c('Damage', f1(S.dmg) + (S.pellets > 1 ? '×' + S.pellets : '')) + c('Rate', f1(1/S.rate) + '/s') + c('Mag', S.mag) + c('Reload', f1(S.reload) + ' s')
    + (S.pierce ? c('Pierce', S.pierce) : '') + (all ? c('Ammo', `${w.mag} / ${p.ammo[w.id]}`) : '');
}
// p = whose ammo `all` shows (default: the player the HUD follows).
export function weaponCard(w, tag = '', extra = '', all = false, p = P || me()){
  const W = WEAPONS[w.id];
  // Specials (✦, a unique's own effects) are listed after its stat modifiers.
  const mods = w.mods.filter(m => !isSpecial(m.k)).map(m => `<li class="${m.s > 0 ? 'pos' : 'neg'}">${modText(m, w.id)}</li>`).join('')
    + w.mods.filter(m => isSpecial(m.k)).map(m => `<li class="spc"><b>${SPECIALS[m.k].name}</b>: ${SPECIALS[m.k].desc}</li>`).join('');
  return `<div class="wcard" data-r="${w.rarity}"><div class="wc-top"><b>${W.name}</b>${tag}<span class="wc-rar">${RARITY[w.rarity].name}</span></div>`
    + `<div class="wc-stats">${statCells(w, all, p)}</div>`
    + (mods ? `<ul class="wc-mods">${mods}</ul>` : w.rarity === 'common' ? '<div class="wc-none">No modifiers</div>' : '')
    + (W.desc ? `<p class="wc-desc">${W.desc}</p>` : '') + extra + '</div>';
}
// Tooltip over the nearest weapon on the ground: its card, damage per second against the gun in your
// hands, and how to take it.
let tipSig = '';
function updateWeaponTip(){
  const el = $('wpnTip');
  let best = null, bd = 3.2;
  if (state.mode === 'play' && P === me() && !P.dead) for (const d of drops){
    if (d.kind !== 'weapon') continue;
    const dd = Math.hypot(d.px - P.pos.x, d.pz - P.pos.z); if (dd < bd){ bd = dd; best = d; }
  }
  if (!best){ if (tipSig){ tipSig = ''; el.classList.add('hidden'); } return; }
  const held = P.weapons[P.cur], free = P.weapons.includes(null);
  const mineHeld = best.held === P;
  const sig = [best.w.uid, held.uid, free, mineHeld].join();
  if (sig !== tipSig){
    tipSig = sig;
    const a = weaponDps(best.w), b = weaponDps(held), diff = a !== null && b !== null ? a - b : null;
    const cmp = diff === null ? '' : `<div class="wc-cmp">DPS <b>${f1(a)}</b> <span class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '▲' : '▼'} ${f1(Math.abs(diff))}</span> vs your ${weaponTitle(held)}</div>`;
    const act = mineHeld ? 'Step away, then hold <kbd>E</kbd> to take it back' : free ? 'Hold <kbd>E</kbd> to pick it up' : `Hold <kbd>E</kbd> to swap for your ${weaponTitle(held)}`;
    el.innerHTML = weaponCard(best.w, '', cmp + `<div class="wc-act">${act}</div>`);
    el.classList.remove('hidden');
  }
  const [x, y] = toScreen(best.px, 1.3, best.pz);
  el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 30).toFixed(1)}px) translate(-50%, -100%)`;
}
// Every weapon slot, shown bottom right while the full map is open (Tab).
let loadSig = '';
function renderLoadout(){
  const sig = P.weapons.map(w => w ? [w.uid, w.rarity, JSON.stringify(w.mods), w.mag|0, Math.ceil(w.cd), P.ammo[w.id]].join(':') : '-').join() + P.cur;
  if (sig === loadSig) return; loadSig = sig;
  $('loadout').innerHTML = '<div class="lo-title">Your weapons <small>Q swaps · G drops</small></div>' + P.weapons.map((w, i) =>
    w ? weaponCard(w, i === P.cur ? '<span class="wc-held">In hand</span>' : '', '', true) : '<div class="wcard wc-empty">Empty slot</div>').join('');
}

// ---------- Inventory bar ----------
// Slots are buttons: click uses, right-click drops. Re-rendered only when contents change.
const slotEls = [];
for (let i=0;i<INV_SLOTS;i++){
  const b = document.createElement('button'); b.className = 'slot empty'; b.tabIndex = -1;
  b.innerHTML = `<kbd>${i+1}</kbd><span class="ic"></span><small></small>`;
  b.addEventListener('click', () => { b.blur(); act('use', i); });
  b.addEventListener('contextmenu', e => { e.preventDefault(); act('dropSlot', i); });
  $('inventory').appendChild(b); slotEls.push(b);
}
let invSig = '';
function renderInventory(){
  const sig = P.inv.map(s => s ? s.id + s.n : '-').join();
  if (sig === invSig) return; invSig = sig;
  P.inv.forEach((s, i) => {
    const el = slotEls[i], I = s && ITEMS[s.id];
    el.classList.toggle('empty', !s);
    el.querySelector('.ic').textContent = I ? I.icon : '';
    el.querySelector('small').textContent = s && s.n > 1 ? s.n : '';
    el.title = I ? `${I.name}: ${I.desc}. Right-click to drop.` : '';
  });
}

// ---------- Interaction prompt ----------
const ipos = new THREE.Vector3(), RING = 113.1;
function updateInteractPrompt(){
  const interact = P.interact, t = P === me() && !P.dead ? interact.target : null, el = $('interact');
  el.classList.toggle('hidden', !t || state.mode !== 'play');
  if (!t || state.mode !== 'play') return;
  ipos.set(t.px, 1.2, t.pz).project(camera);
  el.style.transform = `translate(${((ipos.x+1)/2*innerWidth).toFixed(1)}px, ${((1-ipos.y)/2*innerHeight).toFixed(1)}px)`;
  setText('interactLabel', interact.label);
  $('interactRing').style.strokeDashoffset = ((1 - Math.min(1, interact.p))*RING).toFixed(1);
}

// ---------- Floating text ----------
// Pickups ("+1 🩹 Bandage") rise and fade above the watched player; several at once (a search) go up
// one after another (p = whose gain it is: other players' are not shown). Ground drops and health
// crosses near the watched player get a small name tag.
const floaters = [], tags = [], fpos = new THREE.Vector3(), FLOAT_T = 1.6;
const toScreen = (x, y, z) => { fpos.set(x, y, z).project(camera); return [(fpos.x+1)/2*innerWidth, (1-fpos.y)/2*innerHeight]; };
export function floatText(msg, kind, p){
  if (p && p.remote) emitTo(p, ['ft', msg, kind]);
  if (p && p !== viewed()) return;
  const el = document.createElement('div');
  el.className = 'floater' + (kind ? ' ' + kind : ''); el.textContent = msg; el.style.opacity = 0;
  $('floaters').appendChild(el);
  const queued = floaters.filter(f => f.t < 0.45).length;
  floaters.push({ el, t:-0.45*queued });
}
function updateFloaters(dt){
  const [sx, sy] = toScreen(P.pos.x, 2.3, P.pos.z);
  for (let i=floaters.length-1;i>=0;i--){
    const f = floaters[i]; f.t += dt;
    if (f.t >= FLOAT_T){ f.el.remove(); floaters.splice(i,1); continue; }
    if (f.t < 0) continue;
    f.el.style.opacity = Math.min(1, f.t/0.12, (FLOAT_T - f.t)/0.5).toFixed(2);
    f.el.style.transform = `translate(${sx.toFixed(1)}px, ${(sy - f.t*40).toFixed(1)}px) translate(-50%, -100%)`;
  }
}
function updateTags(){
  let n = 0;
  const show = (x, z, text) => {
    const el = tags[n] || (tags[n] = $('floaters').appendChild(Object.assign(document.createElement('div'), { className:'droptag' })));
    n++;
    if (el.textContent !== text) el.textContent = text;
    const [tx, ty] = toScreen(x, 0, z);
    el.style.transform = `translate(${tx.toFixed(1)}px, ${(ty + 10).toFixed(1)}px) translate(-50%, 0)`;
    el.classList.remove('hidden');
  };
  if (state.mode === 'play'){
    const near = (x, z) => Math.hypot(x - P.pos.x, z - P.pos.z) < 2.8;
    for (const d of drops) if (n < 5 && d.kind !== 'weapon' && near(d.px, d.pz)) show(d.px, d.pz, dropName(d));  // weapons get a card (updateWeaponTip)
    for (const p of pickups) if (n < 5 && near(p.g.position.x, p.g.position.z)) show(p.g.position.x, p.g.position.z, '✚ Health +20');
  }
  for (let i=n;i<tags.length;i++) tags[i].classList.add('hidden');
}

// ---------- Player tags ----------
// Name and a small health bar over every other living player.
const ptags = new Map();
function updatePlayerTags(){
  for (const o of players){
    let el = ptags.get(o);
    const show = o !== P && !o.dead && state.mode !== 'menu';
    if (!el){
      if (!show) continue;
      el = $('floaters').appendChild(Object.assign(document.createElement('div'), { className:'ptag' }));
      el.innerHTML = '<b></b><i><span></span></i>'; ptags.set(o, el);
    }
    el.classList.toggle('hidden', !show);
    if (!show) continue;
    const b = el.firstChild; if (b.textContent !== o.name){ b.textContent = o.name; el.style.setProperty('--pc', o.css); }
    el.lastChild.firstChild.style.width = (o.hp/o.maxHp*100).toFixed(0) + '%';
    const [x, y] = toScreen(o.pos.x, 2.4, o.pos.z);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  for (const [o, el] of ptags) if (!players.includes(o)){ el.remove(); ptags.delete(o); }
}

// ---------- Toasts ----------
// kind: '' | 'good' | 'bad' | 'info'. p = the player it's for: shown only if that's you (and sent to
// their screen if they play on another machine). toastAll = everyone in the session.
export function toastAll(msg, kind){ emit(['t', msg, kind]); toast(msg, kind); }
export function toast(msg, kind, p){
  if (p && p.remote) emitTo(p, ['t', msg, kind]);
  if (p && p !== me()) return;
  const wrap = $('toasts'), el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : ''); el.textContent = msg;
  wrap.appendChild(el);
  while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

// ---------- Craft screen ----------
export function renderCraft(){
  const p = me(), wrap = $('craftCards');
  $('scrapCount').textContent = countItem(p, 'scrap'); $('plankCount').textContent = countItem(p, 'planks');
  wrap.innerHTML = '';
  RECIPES.forEach((r, i) => {
    const I = ITEMS[r.id], b = document.createElement('button'); b.className = 'upg';
    b.disabled = Object.keys(r.cost).some(k => countItem(p, k) < r.cost[k]);
    const cost = Object.keys(r.cost).map(k => `${r.cost[k]} ${ITEMS[k].name.toLowerCase()}`).join(' + ');
    b.innerHTML = `<div class="ic">${I.icon}</div><b>${i+1}. ${I.name}</b><span>${r.desc}</span><span class="cost">${cost} · you have ${countItem(p, r.id)}</span>`;
    b.addEventListener('click', () => craftFromKey(i));
    wrap.appendChild(b);
  });
  const f = wrap.querySelector('button:not(:disabled)') || $('craftClose'); f.focus();
}
export function craftFromKey(i){
  const r = RECIPES[i]; if (!r || !crafting()) return;
  act('craft', r.id);
  renderCraft();
}
// Player p crafts recipe id (host side; clients send it as an action).
export function craftFor(p, id){
  const r = RECIPES.find(r => r.id === id); if (!r) return;
  const err = craft(p, id);
  toast(err || `Crafted a ${ITEMS[r.id].name}`, err ? 'bad' : 'good', p);
}

// Shows one overlay screen by id (or none with null).
export function showScreen(id){
  for (const s of ['menuScreen','lobbyScreen','pauseScreen','craftScreen','upgradeScreen','deathScreen']) $(s).classList.toggle('hidden', s !== id);
}
let bannerTimer = null;
const bannerQueue = [];
export function banner(t, s, dur){
  $('bannerTitle').textContent = t; $('bannerSub').textContent = s || '';
  $('banner').classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('banner').classList.remove('show'); bannerTimer = null; setTimeout(nextBanner, 450); }, dur || 2800);
}
// A banner on everyone's screen.
export function bannerAll(t, s, dur){ emit(['bn', t, s, dur]); banner(t, s, dur); }
// Waits for the current banner (e.g. "City 2") to finish instead of cutting it off.
export function queueBanner(t, s, dur){ bannerQueue.push([t, s, dur]); if (!bannerTimer) nextBanner(); }
function nextBanner(){ if (!bannerTimer && bannerQueue.length) banner(...bannerQueue.shift()); }
