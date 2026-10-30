// ---------- HUD, minimap, banner, overlay screens ----------
import { TILE, N, T } from './config.js';
import { $, fmtTime } from './utils.js';
import { state, world, zombies } from './state.js';
import { player } from './player.js';

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
  setText('killText', state.kills + (state.kills === 1 ? ' kill' : ' kills'));
  setText('timeText', fmtTime(state.runTime));
  if (player.reloadT > 0){ setText('ammoText', '…'); setText('ammoSub', 'Reloading'); }
  else { setText('ammoText', String(player.mag)); setText('ammoSub', '/ ' + player.magSize); }
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

// Shows one overlay screen by id (or none with null).
export function showScreen(id){
  for (const s of ['menuScreen','pauseScreen','upgradeScreen','deathScreen']) $(s).classList.toggle('hidden', s !== id);
}
let bannerTimer = null;
export function banner(t, s, dur){
  $('bannerTitle').textContent = t; $('bannerSub').textContent = s || '';
  $('banner').classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => $('banner').classList.remove('show'), dur || 2800);
}
