// ---------- HUD, minimap, banner, toasts, inventory bar, overlay screens ----------
import * as THREE from 'three';
import { TILE, N, T } from './config.js';
import { $, fmtTime } from './utils.js';
import { camera } from './renderer.js';
import { WEAPONS, ITEMS, RECIPES, LANDMARKS, INV_SLOTS } from './items.js';
import { state, world, zombies } from './state.js';
import { player } from './player.js';
import { useSlot, dropSlot, craft, countItem, magSize, selectedThrowable } from './inventory.js';
import { interact } from './loot.js';

const mm = $('minimap'), mctx = mm.getContext('2d');
// Explored tiles are cached on an offscreen layer, redrawn only when world.mmDirty.
const tileLayer = document.createElement('canvas'); tileLayer.width = N*4; tileLayer.height = N*4;
const tctx = tileLayer.getContext('2d');
const MM_COLORS = { 0:'#3c3f46', 1:'#15171b', 2:'#0b0c0f', 3:'#d64545', 4:'#4ade80', 5:'#6a6862', 6:'#3f5a33', 7:'#8a8273', 8:'#24262b', 9:'#a070ff' };
let mmTimer = 0, hudCache = {};
function setText(id, v){ if (hudCache[id] !== v){ hudCache[id] = v; $(id).textContent = v; } }
function drawMinimap(t){
  const s = 4, city = world.city, crystal = world.crystal, explored = world.explored;
  if (world.mmDirty){
    world.mmDirty = false;
    tctx.fillStyle = '#07080a'; tctx.fillRect(0,0,N*s,N*s);
    for (let z=0;z<N;z++) for (let x=0;x<N;x++){
      if (!explored[z*N+x]) continue;
      let ty = city.grid[z*N+x];
      if (ty === T.CRYSTAL && !(crystal && crystal.alive && state.crystalFound)) ty = T.PLAZA;
      tctx.fillStyle = MM_COLORS[ty]; tctx.fillRect(x*s, z*s, s, s);
    }
  }
  mctx.drawImage(tileLayer, 0, 0);
  mctx.fillStyle = '#ff4d4d';
  for (const z of zombies){
    const tx = Math.floor(z.pos.x/TILE), tz = Math.floor(z.pos.z/TILE);
    if (tx < 0 || tz < 0 || tx >= N || tz >= N || !explored[tz*N+tx]) continue;
    if (Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z) > 26) continue;
    mctx.fillRect(z.pos.x/TILE*s - 1.5, z.pos.z/TILE*s - 1.5, 3, 3);
  }
  if (crystal && crystal.alive && state.crystalFound){
    const r = 4 + Math.sin(t*5)*1.5;
    mctx.strokeStyle = '#c4a1ff'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.arc(crystal.pos.x/TILE*s, crystal.pos.z/TILE*s, r, 0, Math.PI*2); mctx.stroke();
  }
  // Discovered landmarks; icons are counter-rotated against the minimap's 45° CSS rotation.
  mctx.font = '10px sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  for (const l of city.landmarks){
    if (!l.found) continue;
    const L = LANDMARKS[l.type];
    mctx.save(); mctx.translate(l.cx*s, l.cz*s); mctx.rotate(-Math.PI/4);
    mctx.globalAlpha = city.containers[l.door].searched ? 0.45 : 1;
    mctx.fillStyle = L.css; mctx.beginPath(); mctx.arc(0, 0, 7, 0, Math.PI*2); mctx.fill();
    mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 1; mctx.stroke();
    mctx.fillText(L.icon, 0, 0.5);
    mctx.restore();
  }
  if (state.phase === 'open'){
    const r = 4 + Math.sin(t*5)*1.5;
    mctx.strokeStyle = '#4ade80'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.arc((N-0.5)*s, (city.exitZ+1)*s, r, 0, Math.PI*2); mctx.stroke();
  }
  const px = player.pos.x/TILE*s, pz = player.pos.z/TILE*s;
  mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 1.5;
  mctx.beginPath(); mctx.moveTo(px, pz); mctx.lineTo(px + Math.sin(player.angle)*7, pz + Math.cos(player.angle)*7); mctx.stroke();
  mctx.fillStyle = '#ffffff'; mctx.beginPath(); mctx.arc(px, pz, 2.6, 0, Math.PI*2); mctx.fill();
}
export function updateHUD(dt, t){
  const crystal = world.crystal;
  $('hpFill').style.width = (player.hp/player.maxHp*100) + '%';
  setText('hpText', Math.ceil(player.hp) + ' / ' + player.maxHp);
  $('stFill').style.width = (player.stamina*100) + '%';
  $('huFill').style.width = (player.hunger*100) + '%';
  const st = (player.bleeding ? '<span>Bleeding</span>' : '') + (player.hunger <= 0 ? '<span>Starving</span>' : player.hunger < 0.2 ? '<span class="warn">Hungry</span>' : '');
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
  let obj, sub = '';
  if (state.phase === 'explore'){
    if (!state.crystalFound){ obj = 'Find the Crystal'; sub = 'Follow the violet light. Gunfire draws the dead.'; }
    else { obj = 'Shatter the Crystal'; sub = 'Breaking it will summon a horde.'; }
  } else if (state.phase === 'horde'){ obj = `Survive the horde: ${state.hordeToSpawn + state.hordeAlive} left`; sub = 'Keep moving and watch your ammo.'; }
  else { obj = 'Reach the exit'; sub = 'The road east is open. Follow the green light.'; }
  setText('objText', obj); setText('objSub', sub);
  const showCr = !!(crystal && crystal.alive && state.crystalFound);
  $('crystalBar').classList.toggle('hidden', !showCr);
  if (showCr) $('crFill').style.width = (crystal.hp/crystal.maxHp*100) + '%';
  const v = $('vignette'); const vo = parseFloat(v.style.opacity || 0);
  const low = player.hp < player.maxHp*0.3 ? 0.25 + Math.sin(t*5)*0.08 : 0;
  v.style.opacity = Math.max(low, vo - dt*1.5);
  mmTimer -= dt;
  if (mmTimer <= 0){ mmTimer = 0.1; drawMinimap(t); }
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
