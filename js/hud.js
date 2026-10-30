// ---------- HUD, minimap, banner, toasts, inventory bar, overlay screens ----------
import * as THREE from 'three';
import { TILE, N, B, T, DISTRICTS } from './config.js';
import { $, fmtTime } from './utils.js';
import { camera } from './renderer.js';
import { WEAPONS, ITEMS, RECIPES, LANDMARKS, INV_SLOTS } from './items.js';
import { CRYSTAL } from './threats.js';
import { state, world, zombies, drops, pickups, keys } from './state.js';
import { player } from './player.js';
import { useSlot, dropSlot, craft, countItem, magSize, selectedThrowable } from './inventory.js';
import { interact, dropName } from './loot.js';

const mm = $('minimap'), mctx = mm.getContext('2d'), bm = $('bigmap'), bctx = bm.getContext('2d');
// Explored tiles are cached on an offscreen layer (MS px per tile), redrawn only when world.mmDirty.
const MS = 4, tileLayer = document.createElement('canvas'); tileLayer.width = N*MS; tileLayer.height = N*MS;
const tctx = tileLayer.getContext('2d');
const MM_COLORS = { 0:'#3c3f46', 1:'#15171b', 2:'#0b0c0f', 3:'#d64545', 4:'#4ade80', 5:'#6a6862', 6:'#3f5a33', 7:'#8a8273', 8:'#24262b', 9:'#a070ff', 10:'#57534b', 11:'#30333a' };
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
      if (Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z) > 26) continue;
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
  if (state.phase === 'open') ring(N-0.5, city.exitZ+1, '#4ade80');
  const px = X(player.pos.x/TILE), pz = Z(player.pos.z/TILE), a = big ? 10 : 7;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px + Math.sin(player.angle)*a, pz + Math.cos(player.angle)*a); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px, pz, big ? 3.5 : 2.6, 0, Math.PI*2); ctx.fill();
}
function drawMinimap(t){
  if (world.mmDirty) paintTiles();
  drawMap(mctx, mm.width, MS, player.pos.x/TILE, player.pos.z/TILE, t, false);
}
export function updateHUD(dt, t){
  const crystal = world.crystal;
  $('hpFill').style.width = (player.hp/player.maxHp*100) + '%';
  setText('hpText', Math.ceil(player.hp) + ' / ' + player.maxHp);
  $('stFill').style.width = (player.stamina*100) + '%';
  $('stFill').classList.toggle('winded', player.winded);
  const st = (player.bleeding ? '<span>Bleeding</span>' : '') + (player.winded ? '<span class="warn">Winded</span>' : '') + (player.boost > 0 ? '<span class="good">Energized</span>' : '');
  if (hudCache.status !== st){ hudCache.status = st; $('status').innerHTML = st; }
  setText('killText', state.kills + (state.kills === 1 ? ' kill' : ' kills'));
  setText('timeText', fmtTime(state.runTime));
  const w = player.weapons[player.cur], alt = player.weapons[1 - player.cur], reserve = player.ammo[w.id];
  setText('wpnName', WEAPONS[w.id].name);
  if (player.reloadT > 0){ setText('ammoText', '…'); setText('ammoSub', 'Reloading'); }
  else { setText('ammoText', String(w.mag)); setText('ammoSub', w.mag + reserve === 0 ? 'Empty: melee' : '/ ' + reserve); }
  $('ammoSub').classList.toggle('empty', w.mag + reserve === 0 && player.reloadT <= 0);
  setText('wpnAlt', alt ? `Q ⇄ ${WEAPONS[alt.id].name} (${alt.mag} / ${player.ammo[alt.id]})` : `Mag ${magSize(w)}. Second slot empty`);
  const th = selectedThrowable(), thn = countItem(th);
  setText('throwText', `${ITEMS[th].icon} ${ITEMS[th].name} ×${thn}`);
  $('throwLine').classList.toggle('none', !thn);
  renderInventory();
  updateInteractPrompt();
  updateFloaters(dt); updateTags();
  let obj, sub = '';
  if (state.phase === 'explore'){
    if (!state.crystalFound){ obj = 'Find the Crystal'; sub = 'Follow the violet light. Gunfire draws the dead.'; }
    else { obj = 'Shatter the Crystal'; sub = 'Breaking it lets it take the city.'; }
  } else if (state.phase === 'takeover'){ obj = 'Survive the takeover'; sub = 'The dead keep rising until the Crystal’s hold breaks.'; }
  else { obj = 'Reach the exit'; sub = 'The road east is open. Follow the green light.'; }
  setText('objText', obj); setText('objSub', sub);
  // The Crystal's HP while it stands, then the takeover's remaining time.
  const tk = state.phase === 'takeover', showCr = tk || !!(crystal && crystal.alive && state.crystalFound);
  $('crystalBar').classList.toggle('hidden', !showCr);
  if (showCr) $('crFill').style.width = (tk ? state.takeover/CRYSTAL.takeover : crystal.hp/crystal.maxHp)*100 + '%';
  $('countdown').classList.toggle('hidden', !tk);
  if (tk){ setText('countdown', fmtTime(Math.ceil(state.takeover))); $('countdown').classList.toggle('urgent', state.takeover <= 10); }
  const v = $('vignette'); const vo = parseFloat(v.style.opacity || 0);
  const low = player.hp < player.maxHp*0.3 ? 0.25 + Math.sin(t*5)*0.08 : 0;
  v.style.opacity = Math.max(low, vo - dt*1.5);
  mmTimer -= dt;
  if (mmTimer <= 0){ mmTimer = 0.1; drawMinimap(t); }
  // Full map while Tab is held.
  const big = !!keys.Tab && state.mode === 'play';
  $('bigmapWrap').classList.toggle('hidden', !big);
  if (big){ if (world.mmDirty) paintTiles(); drawMap(bctx, bm.width, bm.width/N, N/2, N/2, t, true); }
  // Which district you're in (roads count toward the block south-east of them).
  const bx = Math.min(B-1, Math.max(0, Math.floor((player.pos.x/TILE - 1)/7))), bz = Math.min(B-1, Math.max(0, Math.floor((player.pos.z/TILE - 1)/7)));
  const D = DISTRICTS[world.city.blocks[bz*B + bx].district];
  setText('district', D.name + (D.note ? ` · ${D.note}` : ''));
}

// ---------- Inventory bar ----------
// Slots are buttons: click uses, right-click drops. Re-rendered only when contents change.
const slotEls = [];
for (let i=0;i<INV_SLOTS;i++){
  const b = document.createElement('button'); b.className = 'slot empty'; b.tabIndex = -1;
  b.innerHTML = `<kbd>${i+1}</kbd><span class="ic"></span><small></small>`;
  b.addEventListener('click', () => { b.blur(); useSlot(i); });
  b.addEventListener('contextmenu', e => { e.preventDefault(); dropSlot(i); });
  $('inventory').appendChild(b); slotEls.push(b);
}
let invSig = '';
function renderInventory(){
  const sig = player.inv.map(s => s ? s.id + s.n : '-').join();
  if (sig === invSig) return; invSig = sig;
  player.inv.forEach((s, i) => {
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
  const t = interact.target, el = $('interact');
  el.classList.toggle('hidden', !t || state.mode !== 'play');
  if (!t || state.mode !== 'play') return;
  ipos.set(t.px, 1.2, t.pz).project(camera);
  el.style.transform = `translate(${((ipos.x+1)/2*innerWidth).toFixed(1)}px, ${((1-ipos.y)/2*innerHeight).toFixed(1)}px)`;
  setText('interactLabel', interact.label);
  $('interactRing').style.strokeDashoffset = ((1 - Math.min(1, interact.p))*RING).toFixed(1);
}

// ---------- Floating text ----------
// Pickups ("+1 🩹 Bandage") rise and fade above the player; several at once (a search) go up
// one after another. Ground drops and health crosses near the player get a small name tag.
const floaters = [], tags = [], fpos = new THREE.Vector3(), FLOAT_T = 1.6;
const toScreen = (x, y, z) => { fpos.set(x, y, z).project(camera); return [(fpos.x+1)/2*innerWidth, (1-fpos.y)/2*innerHeight]; };
export function floatText(msg, kind){
  const el = document.createElement('div');
  el.className = 'floater' + (kind ? ' ' + kind : ''); el.textContent = msg; el.style.opacity = 0;
  $('floaters').appendChild(el);
  const queued = floaters.filter(f => f.t < 0.45).length;
  floaters.push({ el, t:-0.45*queued });
}
function updateFloaters(dt){
  const [sx, sy] = toScreen(player.pos.x, 2.3, player.pos.z);
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
    const near = (x, z) => Math.hypot(x - player.pos.x, z - player.pos.z) < 2.8;
    for (const d of drops) if (n < 5 && near(d.px, d.pz)) show(d.px, d.pz, dropName(d));
    for (const p of pickups) if (n < 5 && near(p.g.position.x, p.g.position.z)) show(p.g.position.x, p.g.position.z, '✚ Health +20');
  }
  for (let i=n;i<tags.length;i++) tags[i].classList.add('hidden');
}

// ---------- Toasts ----------
// kind: '' | 'good' | 'bad' | 'info'
export function toast(msg, kind){
  const wrap = $('toasts'), el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : ''); el.textContent = msg;
  wrap.appendChild(el);
  while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

// ---------- Craft screen ----------
export function renderCraft(){
  const scrap = countItem('scrap'), wrap = $('craftCards');
  $('scrapCount').textContent = scrap;
  wrap.innerHTML = '';
  RECIPES.forEach((r, i) => {
    const I = ITEMS[r.id], b = document.createElement('button'); b.className = 'upg'; b.disabled = scrap < r.scrap;
    b.innerHTML = `<div class="ic">${I.icon}</div><b>${i+1}. ${I.name}</b><span>${r.desc}</span><span class="cost">${r.scrap} scrap · you have ${countItem(r.id)}</span>`;
    b.addEventListener('click', () => craftFromKey(i));
    wrap.appendChild(b);
  });
  const f = wrap.querySelector('button:not(:disabled)') || $('craftClose'); f.focus();
}
export function craftFromKey(i){
  const r = RECIPES[i]; if (!r || state.mode !== 'craft') return;
  const err = craft(r.id);
  toast(err || `Crafted a ${ITEMS[r.id].name}`, err ? 'bad' : 'good');
  renderCraft();
}

// Shows one overlay screen by id (or none with null).
export function showScreen(id){
  for (const s of ['menuScreen','pauseScreen','craftScreen','upgradeScreen','deathScreen']) $(s).classList.toggle('hidden', s !== id);
}
let bannerTimer = null;
const bannerQueue = [];
export function banner(t, s, dur){
  $('bannerTitle').textContent = t; $('bannerSub').textContent = s || '';
  $('banner').classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('banner').classList.remove('show'); bannerTimer = null; setTimeout(nextBanner, 450); }, dur || 2800);
}
// Waits for the current banner (e.g. "City 2") to finish instead of cutting it off.
export function queueBanner(t, s, dur){ bannerQueue.push([t, s, dur]); if (!bannerTimer) nextBanner(); }
function nextBanner(){ if (!bannerTimer && bannerQueue.length) banner(...bannerQueue.shift()); }
