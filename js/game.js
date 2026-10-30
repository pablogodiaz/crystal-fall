// ---------- Game flow ----------
// Run/city lifecycle (explore -> horde -> open -> upgrade), spawning, per-frame update.
import * as THREE from 'three';
import { TILE, N, T, walkable } from './config.js';
import { $, mr, fmtTime } from './utils.js';
import { camFocus, muzzleLight, fxLight } from './renderer.js';
import { state, world, zombies, mouse } from './state.js';
import { generateCity } from './cityGen.js';
import { buildCityScene, buildExitMarker, teardownCity } from './cityScene.js';
import { updateFlow, reveal } from './grid.js';
import { player, resetPlayerStats, refreshGun, updatePlayer } from './player.js';
import { spawnZombieAt, findSpawnTile, updateZombies, updateDying } from './zombies.js';
import { updateBullets } from './combat.js';
import { burst, updateParticles, updatePickups } from './fx.js';
import { showScreen, banner, renderCraft } from './hud.js';
import { interact, updateInteract, updateDrops, updateLandmarks, animateContainers } from './loot.js';
import { updateThrowables } from './throwables.js';
import { setupThreats, shuffleThreats, updateSpecials } from './specials.js';
import { UPGRADES } from './upgrades.js';
import { initAudio, sfx } from './audio.js';

export const newSeed = () => Math.floor(Math.random()*1e9);
export function startCity(level, seed){
  teardownCity();
  state.level = level;
  const city = world.city = generateCity(level, seed);
  buildCityScene(city);
  world.explored = new Uint8Array(N*N); world.mmDirty = true; world.lastTile = -1;
  player.pos.set((city.start.x+0.5)*TILE, 0, (city.start.z+0.5)*TILE); player.vel.set(0,0,0);
  camFocus.copy(player.pos);
  Object.assign(state, { phase:'explore', crystalFound:false, hordeToSpawn:0, hordeAlive:0, cityKills:0, cityTime:0, spawnTimer:3, flowTimer:0 });
  updateFlow();
  interact.target = null; interact.p = 0; fxLight.intensity = 0;
  setupThreats(level);
  const n = 10 + 4*level;
  for (let i=0;i<n;i++){ const s = findSpawnTile(24, 200); if (s) spawnZombieAt(s.x, s.z, false, false); }
  // Police stations are guarded by a pack that stays near the door.
  for (const l of city.landmarks){
    if (l.type !== 'police') continue;
    for (let i=0, tries=0, g=3+level; i<g && tries<80; tries++){
      const tx = l.ox + Math.round(mr(-3,3)), tz = l.oz + Math.round(mr(-3,3));
      if (tx < 1 || tz < 1 || tx >= N-1 || tz >= N-1 || !walkable(city.grid[tz*N+tx])) continue;
      spawnZombieAt((tx+0.5)*TILE + mr(-0.4,0.4), (tz+0.5)*TILE + mr(-0.4,0.4), false, false, true); i++;
    }
  }
  $('cityName').textContent = `City ${level}: ${city.name}`;
  if (state.mode === 'play') banner(`City ${level}`, city.name);
}
export function newRun(){
  initAudio();
  resetPlayerStats(); refreshGun();
  state.kills = 0; state.runTime = 0;
  shuffleThreats();
  state.mode = 'play';
  showScreen(null);
  $('hud').classList.remove('hidden');
  startCity(1, newSeed());
}
export function foundCrystal(){
  state.crystalFound = true;
  reveal(world.city.crystalTile.x, world.city.crystalTile.z, 3);
  banner('The Crystal', 'Shoot it to shatter it, then survive what comes');
}
export function breakCrystal(){
  const crystal = world.crystal;
  crystal.alive = false;
  crystal.mesh.visible = false; crystal.beam.visible = false; crystal.glow.visible = false;
  for (const s of crystal.shards) s.visible = false;
  crystal.light.intensity = 0;
  world.mmDirty = true;
  burst(crystal.pos.clone(), 'crystal', 40, 7);
  sfx.shatter(); setTimeout(sfx.roar, 500);
  state.shake = 0.8;
  state.phase = 'horde';
  state.hordeToSpawn = 28 + 12*(state.level-1);
  state.spawnTimer = 2.2;
  for (const z of zombies) z.alert = true;
  banner('The horde is coming', 'Hold out until the last of them falls');
}
function openRoad(){
  const city = world.city;
  state.phase = 'open';
  for (const z of [city.exitZ, city.exitZ+1]){ city.grid[z*N + N-1] = T.EXIT; world.explored[z*N + N-1] = 1; }
  world.mmDirty = true;
  if (world.barricade){
    world.barricade.children.forEach(c => burst(c.getWorldPosition(new THREE.Vector3()), 'dust', 4, 3));
    world.cityGroup.remove(world.barricade); world.barricade = null;
  }
  world.exitMarker = buildExitMarker();
  state.spawnTimer = 4;
  sfx.open();
  banner('The road is open', 'Follow the green light to leave ' + city.name);
}
function completeCity(){
  state.mode = 'upgrade'; mouse.down = false;
  player.hp = Math.min(player.maxHp, player.hp + player.maxHp*0.4);
  $('clearTitle').textContent = `${world.city.name} cleared`;
  $('clearStats').innerHTML = statHTML([[`City ${state.level}`, 'Cleared'], [state.cityKills, 'Kills here'], [fmtTime(state.cityTime), 'Time here'], [Math.ceil(player.hp)+' / '+player.maxHp, 'Health']]);
  const pool = UPGRADES.slice(); const chosen = [];
  while (chosen.length < 3 && pool.length) chosen.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  const wrap = $('upgradeCards'); wrap.innerHTML = '';
  for (const u of chosen){
    const b = document.createElement('button'); b.className = 'upg';
    b.innerHTML = `<div class="ic">${u.icon}</div><b>${u.name}</b><span>${u.desc}</span>`;
    b.addEventListener('click', () => {
      u.apply(player); player.reloadT = 0;
      state.mode = 'play'; showScreen(null);
      startCity(state.level + 1, newSeed());
    });
    wrap.appendChild(b);
  }
  showScreen('upgradeScreen');
  setTimeout(() => { const f = wrap.querySelector('button'); if (f) f.focus(); }, 50);
}
function statHTML(rows){ return rows.map(([v,l]) => `<div><b>${v}</b>${l}</div>`).join(''); }

// Best run persisted in localStorage under 'crystal-fall-best'.
export function loadBest(){ try { const v = localStorage.getItem('crystal-fall-best'); return v ? JSON.parse(v) : null; } catch(e){ return null; } }
function saveBest(r){ try { localStorage.setItem('crystal-fall-best', JSON.stringify(r)); } catch(e){} }
export function bestLine(b){ return b ? `Best run: reached city ${b.city} with ${b.kills} kills.` : ''; }

export function die(){
  state.mode = 'dead'; mouse.down = false;
  burst(new THREE.Vector3(player.pos.x, 1, player.pos.z), 'blood', 20, 4);
  const rec = { city:state.level, kills:state.kills };
  const best = loadBest();
  let isBest = false;
  if (!best || rec.city > best.city || (rec.city === best.city && rec.kills > best.kills)){ saveBest(rec); isBest = true; }
  $('deathStats').innerHTML = statHTML([[`City ${state.level}`, 'Reached'], [state.kills, 'Total kills'], [fmtTime(state.runTime), 'Survived']]);
  $('deathBest').textContent = isBest ? 'New best run.' : bestLine(best);
  setTimeout(() => { if (state.mode === 'dead'){ showScreen('deathScreen'); $('retryBtn').focus(); } }, 900);
}
export function toggleCraft(){
  if (state.mode === 'play'){ state.mode = 'craft'; mouse.down = false; renderCraft(); showScreen('craftScreen'); }
  else if (state.mode === 'craft'){ state.mode = 'play'; showScreen(null); }
}
export function togglePause(){
  if (state.mode === 'play'){ state.mode = 'paused'; mouse.down = false; showScreen('pauseScreen'); $('resumeBtn').focus(); }
  else if (state.mode === 'paused'){ state.mode = 'play'; showScreen(null); }
}

// ---------- Update ----------
function updateSpawning(dt){
  state.spawnTimer -= dt;
  const lv = state.level;
  if (state.phase === 'horde'){
    if (state.hordeToSpawn > 0 && state.spawnTimer <= 0 && zombies.length < 40 + 5*lv){
      const s = findSpawnTile(15, 30);
      if (s){ spawnZombieAt(s.x, s.z, true, true); state.hordeToSpawn--; }
      state.spawnTimer = Math.max(0.12, 0.32 - 0.03*lv);
    }
    if (state.hordeToSpawn <= 0 && state.hordeAlive <= 0) openRoad();
    return;
  }
  if (state.spawnTimer <= 0){
    let ambient = 0; for (const z of zombies) if (!z.horde) ambient++;
    const cap = (state.phase === 'open' ? 8 : 12) + 4*lv;
    if (ambient < cap){ const s = findSpawnTile(24, 42); if (s) spawnZombieAt(s.x, s.z, false, Math.random() < 0.45); }
    state.spawnTimer = Math.max(0.7, 2.6 - 0.3*(lv-1)) * mr(0.7,1.3);
  }
}
// Simulation step; only called while state.mode === 'play'.
export function update(dt){
  const crystal = world.crystal;
  state.runTime += dt; state.cityTime += dt;
  updatePlayer(dt);
  if (state.mode !== 'play') return;
  state.flowTimer -= dt;
  if (state.flowTimer <= 0){ state.flowTimer = 0.25; updateFlow(); }
  if (crystal && crystal.alive && !state.crystalFound && Math.hypot(player.pos.x - crystal.pos.x, player.pos.z - crystal.pos.z) < 19) foundCrystal();
  updateSpawning(dt);
  updateZombies(dt);
  if (state.mode !== 'play') return;
  updateBullets(dt);
  updateThrowables(dt);
  if (state.mode !== 'play') return;
  updateSpecials(dt);
  if (state.mode !== 'play') return;
  updatePickups(dt);
  updateDrops(dt);
  updateInteract(dt);
  updateLandmarks();
  if (state.phase === 'open' && Math.floor(player.pos.x/TILE) >= N-1) completeCity();
}
// Cosmetic animation; runs every frame in every mode.
export function animateWorld(dt, t){
  const crystal = world.crystal, exitMarker = world.exitMarker;
  if (crystal && crystal.alive){
    crystal.mesh.rotation.y += dt*0.8;
    crystal.mesh.position.y = 2.1 + Math.sin(t*1.6)*0.15;
    crystal.beam.material.opacity = 0.16 + Math.sin(t*2.2)*0.05;
    crystal.light.intensity = 2.2 + Math.sin(t*3)*0.4 + (crystal.flash > 0 ? 3 : 0);
    crystal.mat.emissiveIntensity = crystal.flash > 0 ? 2.2 : 0.9;
    if (crystal.flash > 0) crystal.flash -= dt;
    const shakeAmt = state.crystalFound ? (1 - crystal.hp/crystal.maxHp)*0.08 : 0;
    crystal.mesh.position.x = mr(-shakeAmt, shakeAmt);
  }
  if (exitMarker){
    exitMarker.gm.opacity = 0.25 + Math.sin(t*4)*0.12;
    exitMarker.chev.forEach((c,i) => { c.position.y = 0.35 + Math.max(0, Math.sin(t*5 - i*0.8))*0.25; });
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt*30);
  animateContainers(t);
  updateParticles(dt);
  updateDying(dt);
}
