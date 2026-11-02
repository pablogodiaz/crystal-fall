// ---------- Game flow ----------
// Run/city lifecycle (explore -> takeover -> open -> upgrade), spawning, per-frame update.
import * as THREE from 'three';
import { TILE, N, T, POP, CONDITIONS, cityBlocks, walkable } from './config.js';
import { LANDMARKS, RARITY } from './items.js';
import { $, mr, mpick, fmtTime } from './utils.js';
import { camFocus, muzzleLight, fxLight } from './renderer.js';
import { SH } from './assets.js';
import { CRYSTAL } from './threats.js';
import { state, world, zombies, mouse, dev, players, net } from './state.js';
import { generateCity } from './cityGen.js';
import { buildCityScene, buildExitMarker, teardownCity, animateCity } from './cityScene.js';
import { updateFlow, clearFlowCache, blockIndex, toGround } from './grid.js';
import { animateBreaks } from './breakables.js';
import { me, viewed, nearestDist, crowd, residents, zombieCap, resetPlayerStats, refreshGun, updatePlayers } from './player.js';
import { spawnZombieAt, spawnTurnedPlayer, findSpawnTile, findBlockTile, updateZombies, updateDying } from './zombies.js';
import { updateBullets } from './combat.js';
import { burst, updateParticles, updatePickups } from './fx.js';
import { foundCrystal, endTakeover, resetTakeover, animateCrystal } from './crystal.js';
import { showScreen, banner, bannerAll, queueBanner, renderCraft, toast, toastAll, floatText, weaponCard } from './hud.js';
import { emit, emitTo } from './host.js';
import { updateInteract, updateDrops, updateLandmarks, animateContainers } from './loot.js';
import { updateThrowables, updateThrowPreview } from './throwables.js';
import { setupThreats, shuffleThreats, updateSpecials } from './specials.js';
import { updateUniques, resetUniques } from './uniques.js';
import { card, targets, modChoices, destChoices, dealCards, validChoice, autoChoice, applyCard } from './upgrades.js';
import { rollWeapon, weaponTitle, modText, isSpecial } from './weapons.js';
import { spawnDrop } from './loot.js';
import { initAudio, sfx } from './audio.js';

export const newSeed = () => Math.floor(Math.random()*1e9);
// Clients run this too when the host's city event arrives: same seed, same city; their zombies, drops
// and everything else then come from the host (client.js), so they skip populating it.
export function startCity(level, seed){
  const client = net.role === 'client';
  if (!client) emit(['city', level, seed]);
  teardownCity();
  state.level = level; state.seed = seed;
  const city = world.city = generateCity(level, seed);
  clearFlowCache();
  buildCityScene(city);
  world.explored = new Uint8Array(N*N); world.mmDirty = true;
  placePlayers(city);
  state.view = state.me; camFocus.copy(viewed().pos);
  Object.assign(state, { phase:'explore', crystalFound:false, takeover:0, surge:0, hordeAlive:0, cityKills:0, cityTime:0, spawnTimer:3, flowTimer:0, exitT:0, exitIn:0 });
  fxLight.intensity = 0; resetTakeover(); resetUniques();
  if (!client){ updateFlow(); setupThreats(level); populate(city, level); supplyDrops(); }
  $('cityName').textContent = `City ${level}: ${city.name}`;
  if (state.mode !== 'play') return;
  const Cd = CONDITIONS[city.cond];
  banner(`City ${level}`, `${city.name} · ${Cd.name}: ${Cd.note}`, 3200);
  // Bigger city or a new kind of landmark: say so after the city banner.
  if (level > 1 && cityBlocks(level) > cityBlocks(level - 1)) queueBanner('The cities are getting bigger', 'More ground to cover, and more of them waiting in it', 3600);
  for (const t in LANDMARKS){ const L = LANDMARKS[t]; if (L.from === level && level > 1) queueBanner(`${L.icon} ${L.name}`, `New landmark. ${L.tip}`, 4200); }
}
// ---------- Players ----------
// Everyone starts the city together on the start tile's corner of road, and anyone who died in the
// last city is back (with REVIVE of their max health).
const REVIVE = 0.5, START_SPOTS = [[0,0],[-1,0],[0,-1],[-1,-1],[1,0],[0,1],[1,-1],[-1,1]];
function placePlayers(city){
  let k = 0;
  for (const p of players){
    if (p.dead) revivePlayer(p, Math.max(1, Math.round(p.maxHp*REVIVE)));
    let x = city.start.x, z = city.start.z;
    while (k < START_SPOTS.length){
      const [ox, oz] = START_SPOTS[k++];
      if (walkable(city.grid[(city.start.z + oz)*N + city.start.x + ox])){ x = city.start.x + ox; z = city.start.z + oz; break; }
    }
    toGround(p.pos.set((x+0.5)*TILE, 0, (z+0.5)*TILE)); p.vel.set(0,0,0); p.g.position.copy(p.pos); p.tp++;
    p.lastTile = -1; p.crafting = false; p.aiming = false; p.interact.target = null; p.interact.p = 0;
  }
}
// Supply drop upgrades: a weapon find (one city's luck better) tossed out next to each player who took one.
function supplyDrops(){
  for (const p of players) for (;p.supply > 0;p.supply--){
    const w = rollWeapon(1, undefined, p);
    spawnDrop('weapon', w, 0, p.pos.x + 2.2, p.pos.z + 2.2, null, { x:p.pos.x, z:p.pos.z });
    floatText(`Supply drop: ${weaponTitle(w)}!`, 'r-' + w.rarity, p);
  }
}
export function revivePlayer(p, hp){
  if (!p.dead) return;
  Object.assign(p, { dead:false, hp, bleeding:false, stamina:1, winded:false, boost:0, reloadT:0, meleeT:0, lastTile:-1 });
  p.g.visible = true;
  if (p === me()) state.view = state.me;
}
// Player p is killed: they get back up as a zombie where they fell. While anyone is still alive the
// run goes on and the dead spectate (spectate()); they return at the start of the next city.
export function killPlayer(p){
  if (p.dead) return;
  Object.assign(p, { dead:true, hp:0, aiming:false, crafting:false, reloadT:0, meleeT:0, bleeding:false });
  p.interact.target = null; p.interact.p = 0; p.vel.set(0, 0, 0);
  for (const w of p.weapons) if (w){ w.out = false; w.charge = 0; }
  p.g.visible = false;
  spawnTurnedPlayer(p);
  if (p === me()) mouse.down = false;
  if (!players.some(o => !o.dead)) return gameOver();
  if (p === me()){
    if (state.mode === 'play') showScreen(null);
    spectate(1);
    banner('You turned', `Watching ${viewed().name}. You come back in the next city`, 3600);
  } else {
    toastAll(`${p.name} turned. They come back in the next city`, 'bad');
    if (viewed() === p) spectate(1);
  }
}
// While you're dead: watch the next (dir 1) or previous (-1) living player.
export function spectate(dir){
  const n = players.length;
  for (let k=1;k<=n;k++){
    const i = ((state.view + dir*k) % n + n) % n;
    if (!players[i].dead){ state.view = i; return; }
  }
}

// Residents (block.density per block, on average), plus each walk-in landmark's own: police guards
// (half inside, half out front), a prisoner in some cells, shoppers wandering the supermarket aisles.
// More players, more of everything (residents(), COOP in threats.js).
function populate(city, level){
  const cr = residents(), more = n => Math.round(n*cr);
  for (const b of city.blocks) for (let n=Math.floor(b.density*cr + Math.random());n>0;n--){
    const s = findBlockTile(b, POP.startGap); if (s) spawnZombieAt(s.x, s.z, false, false, false, null, 0);
  }
  const some = (list, n, guard) => {
    const l = list.slice();
    for (let i=0;i<n && l.length;i++){ const [x, z] = l.splice(Math.floor(Math.random()*l.length), 1)[0]; spawnZombieAt((x+0.5)*TILE + mr(-0.4,0.4), (z+0.5)*TILE + mr(-0.4,0.4), false, false, guard, null, 0); }
  };
  for (const l of city.landmarks){
    if (l.type === 'police'){
      const g = more(3 + level);
      some(l.floor, Math.ceil(g/2), 'police'); some(l.yard.filter(([x, z]) => Math.hypot(x - l.ox, z - l.oz) < 5), Math.floor(g/2), 'police');
      for (let k=0;k<l.cells.length;k+=2) if (Math.random() < 0.6) some(l.cells.slice(k, k+2), 1, 'cell');  // two tiles per cell
    } else if (l.type === 'supermarket' || l.type === 'hospital') some(l.floor, more(2 + Math.ceil(level/2)), 'shop');
    else if (l.type === 'outpost') some(l.floor, more(3 + Math.ceil(level/2)), 'police');  // soldiers: riot gear odds like police guards
  }
}
export function newRun(level = 1, seed = newSeed()){
  if (net.role === 'client') return;  // the host starts runs
  initAudio();
  for (const p of players){ resetPlayerStats(p); refreshGun(p); }
  state.kills = 0; state.runTime = 0; state.cheated = false;
  shuffleThreats();
  enterRun();
  emit(['run']);
  startCity(level, seed);
}
// Into the game screen (host: newRun; clients: the host's run event).
export function enterRun(){
  state.mode = 'play'; state.seenThreats = new Set();
  showScreen(null);
  $('hud').classList.remove('hidden');
}
export function openRoad(){
  const city = world.city;
  endTakeover();
  state.phase = 'open';
  roadFx(); emit(['road']);
  state.spawnTimer = 4;
  sfx.open();
  bannerAll('The road is open', 'Follow the green light to leave ' + city.name);
}
// The barricade comes down and the exit tiles open (clients run this on the road event).
export function roadFx(){
  const city = world.city;
  for (const z of [city.exitZ, city.exitZ+1]){ city.grid[z*N + city.n-1] = T.EXIT; world.explored[z*N + city.n-1] = 1; }
  world.mmDirty = true; clearFlowCache();
  if (world.barricade){
    world.barricade.children.forEach(c => burst(c.getWorldPosition(new THREE.Vector3()), 'dust', 4, 3, true));
    world.cityGroup.remove(world.barricade); world.barricade = null;
  }
  if (!world.exitMarker) world.exitMarker = buildExitMarker();
}
// ---------- Leaving a city ----------
// The road out only counts once every living player stands in the exit column, for EXIT_WAIT s
// in a row (anyone stepping out resets the clock).
export const EXIT_WAIT = 3;
function updateExit(dt){
  const n = world.city.n;
  let alive = 0, inn = 0;
  for (const p of players) if (!p.dead){ alive++; if (Math.floor(p.pos.x/TILE) >= n-1) inn++; }
  if (inn && !state.exitIn) sfx.swap();
  state.exitIn = inn;
  if (!alive || inn < alive){ state.exitT = 0; return; }
  const before = Math.ceil(EXIT_WAIT - state.exitT);
  state.exitT += dt;
  if (Math.ceil(EXIT_WAIT - state.exitT) < before && state.exitT < EXIT_WAIT) sfx.tick(Math.ceil(EXIT_WAIT - state.exitT));
  if (state.exitT >= EXIT_WAIT) completeCity();
}
// Every player gets their own three upgrade cards (ones that fit their weapons, different for each while
// there are enough to go round); the living heal 40%, the dead pick too and come back next city. A player
// picks a card (and the weapon / modifier it works on), sees what came of it, then presses Continue; the
// next city starts once everyone has. Remote players play theirs on their own screen (host.js);
// companions pick at random right away. every = dev tools: deal you every card that fits.
export function completeCity(every){
  state.mode = 'upgrade'; mouse.down = false;
  const taken = new Set();
  for (const p of players){
    Object.assign(p, { crafting:false, aiming:false, picked:false, ready:false });
    if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + p.maxHp*0.4);
    p.offer = dealCards(p, taken, every && p === me()); for (const id of p.offer) taken.add(id);
  }
  emit(['mode', 'upgrade']);
  const P = me();
  showUpgrades(P, P.offer, c => { const r = pickUpgrade(P, c); if (r) showUpgradeResult(r); }, () => readyUp(P));
  for (const p of players){
    if (p.remote) emitTo(p, ['upg', p.offer, state.cityKills, state.cityTime]);
    else if (p !== P){ pickUpgrade(p, autoChoice(p)); readyUp(p); }
  }
}
// ---------- Upgrade screen ----------
// For player P (this machine's): the cards, then the weapon a card works on, then (Gunsmith, Transplant)
// the modifier, then (Transplant) the weapon it goes to, then what came of it. choose(choice) plays the choice (here, or sent to the host, which
// answers with showUpgradeResult); ready() is Continue.
let upg = null;
export function showUpgrades(P, ids, choose, ready){
  $('clearTitle').textContent = `${world.city.name} cleared`;
  $('clearStats').innerHTML = statHTML([[`City ${state.level}`, 'Cleared'], [state.cityKills, 'Kills here'], [fmtTime(state.cityTime), 'Time here'],
    P.dead ? ['Turned', `Back with ${REVIVE*100}% health`] : [Math.ceil(P.hp)+' / '+P.maxHp, 'Health']]);
  $('upgradeNote').textContent = '';
  upg = { P, ids, choose, ready, busy:false };
  upgCards();
  showScreen('upgradeScreen');
}
function upgStep(lead, cls, back){
  $('upgradeLead').innerHTML = lead;
  const wrap = $('upgradeCards'); wrap.className = cls; wrap.innerHTML = '';
  const nav = $('upgradeNav'); nav.innerHTML = '';
  if (back) nav.appendChild(upgButton('btn ghost', '← Back', back));
  setTimeout(() => { const f = wrap.querySelector('button:not(:disabled)'); if (f) f.focus(); }, 50);
  return wrap;
}
function upgButton(cls, html, click){
  const b = document.createElement('button'); b.className = cls; b.innerHTML = html;
  b.addEventListener('click', () => { if (!upg.busy) click(b); });
  return b;
}
function upgCards(){
  const wrap = upgStep('Pick one upgrade for your weapons. You also recover 40% of your health.', 'cards');
  for (const id of upg.ids){
    const u = card(id), b = upgButton('upg upg-card', `<div class="ic">${u.icon}<em>${RARITY[u.tier].name}</em></div><b>${u.name}</b><span>${u.desc}</span>`, () => u.on ? upgWeapon(u) : upgPlay([u.id, -1, -1, -1]));
    b.dataset.r = u.tier;  // its draw tier, in the weapon rarity colours
    wrap.appendChild(b);
  }
}
function upgWeapon(u){
  const P = upg.P, wrap = upgStep(`${u.icon} <b>${u.name}</b>: which weapon?`, 'cards', upgCards);
  for (const i of targets(P, u)){
    const w = P.weapons[i], tag = i === P.cur ? '<span class="wc-held">In hand</span>' : '';
    wrap.appendChild(upgButton('upg-w', weaponCard(w, tag, '', false, P), () => u.mod ? upgMod(u, i) : upgPlay([u.id, i, -1, -1])));
  }
}
function upgMod(u, i){
  const P = upg.P, w = P.weapons[i], wrap = upgStep(`${u.icon} <b>${u.name}</b>: ${u.ask(w)}`, 'cards', () => upgWeapon(u));
  for (const k of modChoices(P, u, w)){
    const m = w.mods[k], sp = isSpecial(m.k);
    wrap.appendChild(upgButton('upg upg-mod ' + (sp ? 'spc' : m.s > 0 ? 'pos' : 'neg'), `<b>${sp ? '✦' : m.s > 0 ? '▲' : '▼'} ${modText(m, w.id)}</b><span>${u.hint}</span>`,
      () => u.dests ? upgDest(u, i, k) : upgPlay([u.id, i, k, -1])));
  }
}
function upgDest(u, i, k){
  const P = upg.P, w = P.weapons[i], wrap = upgStep(`${u.icon} <b>${u.name}</b>: which weapon gets <b>${modText(w.mods[k], w.id)}</b>?`, 'cards', () => upgMod(u, i));
  for (const d of destChoices(P, u, w, k)){
    const o = P.weapons[d], tag = d === P.cur ? '<span class="wc-held">In hand</span>' : '';
    wrap.appendChild(upgButton('upg-w', weaponCard(o, tag, '', false, P), () => upgPlay([u.id, i, k, d])));
  }
}
function upgPlay(c){
  upg.busy = true;
  upgStep(`${card(c[0]).icon} <b>${card(c[0]).name}</b>…`, 'cards');
  upg.choose(c);
}
// What the picked card did: r = { icon, name, text, w } (from applyCard, here or from the host).
export function showUpgradeResult(r){
  if (!upg) return;
  upg.busy = false;
  const wrap = upgStep(`${r.icon} <b>${r.name}</b>`, 'upg-result');
  wrap.innerHTML = `<p class="upg-text">${r.text}</p>` + (r.w ? weaponCard(r.w, '', '', false, upg.P) : '');
  const go = upgButton('btn', 'Continue', b => { b.disabled = true; upg.busy = true; upg.ready(); });
  $('upgradeNav').appendChild(go);
  setTimeout(() => go.focus(), 50);
}
// Player p plays choice c ([card, slot, modifier], validated): returns the result (sent to a remote
// player's screen too), or null if it wasn't a valid choice.
export function pickUpgrade(p, c){
  if (state.mode !== 'upgrade' || p.picked || !validChoice(p, c)) return null;
  p.picked = true; p.reloadT = 0;
  const r = applyCard(p, c);
  if (p.remote) emitTo(p, ['upgr', r]);
  return r;
}
// Continue: once everyone has, the next city starts.
export function readyUp(p){
  if (state.mode !== 'upgrade' || !p.picked || p.ready) return;
  p.ready = true;
  const waiting = players.filter(o => !o.ready);
  if (waiting.length){
    const note = `Waiting for ${waiting.map(o => o.name).join(', ')}…`;
    if (me().ready) $('upgradeNote').textContent = note;
    emit(['wait', note]);
    return;
  }
  state.mode = 'play'; showScreen(null); upg = null;
  startCity(state.level + 1, newSeed());
}
function statHTML(rows){ return rows.map(([v,l]) => `<div><b>${v}</b>${l}</div>`).join(''); }

// Best run persisted in localStorage under 'crystal-fall-best'.
export function loadBest(){ try { const v = localStorage.getItem('crystal-fall-best'); return v ? JSON.parse(v) : null; } catch(e){ return null; } }
function saveBest(r){ try { localStorage.setItem('crystal-fall-best', JSON.stringify(r)); } catch(e){} }
export function bestLine(b){ return b ? `Best run: reached city ${b.city} with ${b.kills} kills.` : ''; }

// Everyone is dead: the run is over (clients show the same screen from the host's event).
function gameOver(){
  const p = me(); burst(new THREE.Vector3(p.pos.x, 1, p.pos.z), 'blood', 20, 4);
  emit(['over', state.level, state.kills, state.runTime, state.cheated]);
  showGameOver(state.level, state.kills, state.runTime, state.cheated);
}
export function showGameOver(level, kills, runTime, cheated){
  state.mode = 'dead'; mouse.down = false;
  const rec = { city:level, kills };
  const best = loadBest();
  let isBest = false;
  if (!cheated && (!best || rec.city > best.city || (rec.city === best.city && rec.kills > best.kills))){ saveBest(rec); isBest = true; }
  $('deathTitle').textContent = players.length > 1 ? 'Everyone turned' : 'You didn’t make it';
  $('deathStats').innerHTML = statHTML([[`City ${level}`, 'Reached'], [kills, players.length > 1 ? 'Team kills' : 'Total kills'], [fmtTime(runTime), 'Survived']]);
  $('deathBest').textContent = (isBest ? 'New best run.' : (cheated ? 'Dev tools were used, so this run doesn’t count. ' : '') + bestLine(best))
    + (net.role === 'client' ? ' Waiting for the host to start a new run.' : '');
  $('retryBtn').classList.toggle('hidden', net.role === 'client');
  setTimeout(() => { if (state.mode === 'dead'){ showScreen('deathScreen'); $('retryBtn').focus(); } }, 900);
}
// Alone, the workbench pauses the game. With others in it the world keeps going (only the host can
// pause): you just stand there while it's open (p.crafting; player.js ignores your controls).
export function toggleCraft(){
  const p = me();
  if (p.crafting || (players.length > 1 && state.mode === 'play')){
    if (p.crafting){ p.crafting = false; showScreen(null); }
    else if (!p.dead){ p.crafting = true; p.aiming = false; mouse.down = false; renderCraft(); showScreen('craftScreen'); }
    return;
  }
  if (state.mode === 'play' && !p.dead){ state.mode = 'craft'; mouse.down = false; renderCraft(); showScreen('craftScreen'); }
  else if (state.mode === 'craft'){ state.mode = 'play'; showScreen(null); }
}
export const crafting = () => state.mode === 'craft' || !!(me() && me().crafting);
// Pauses everyone; only the host may (it runs the simulation).
export function togglePause(){
  if (!state.host) return toast('Only the host can pause');
  if (state.mode === 'play'){ me().crafting = false; state.mode = 'paused'; mouse.down = false; showScreen('pauseScreen'); $('resumeBtn').focus(); emit(['mode', 'paused']); }
  else if (state.mode === 'paused'){ state.mode = 'play'; showScreen(null); emit(['mode', 'play']); }
}

// ---------- Update ----------
function updateSpawning(dt){
  state.spawnTimer -= dt;
  const lv = state.level;
  if (state.phase === 'takeover'){
    // Everything spawned now is alert and counts as the takeover's (state.hordeAlive): a quick
    // surge first, then a steady stream that speeds up as the clock runs down.
    const C = CRYSTAL;
    state.takeover -= dt;
    if (state.takeover <= state.tick && state.tick > 0){ sfx.tick(state.tick); state.tick--; }
    if (state.takeover <= 0){ openRoad(); return; }
    // The takeover's own cap is below; zombieCap() guards frame time. More living players: a bigger
    // surge (breakCrystal), a faster stream and a higher cap (crowd()).
    const cr = crowd(true);
    if (state.spawnTimer > 0 || zombies.length >= zombieCap()) return;
    if (state.surge > 0){
      const s = findSpawnTile(15, 30);
      if (s){ spawnZombieAt(s.x, s.z, true, true); state.surge--; }
      state.spawnTimer = Math.max(0.12, 0.32 - 0.03*lv)/cr;
    } else {
      if (state.hordeAlive < (C.cap[0] + C.cap[1]*lv)*cr){ const s = findSpawnTile(16, 32); if (s) spawnZombieAt(s.x, s.z, true, true); }
      const k = 1 - state.takeover/C.takeover, [b, per, min] = C.interval;
      state.spawnTimer = Math.max(min, b - per*(lv-1)) * (1 - C.ramp*k) * mr(0.7,1.3)/cr;
    }
    return;
  }
  // Killed residents are slowly replaced, out of sight of everyone, in the blocks furthest below their
  // share (counted by home; 70% of it once the road is open; more with more players).
  if (state.spawnTimer <= 0){
    const blocks = world.city.blocks, have = new Float32Array(blocks.length), f = (state.phase === 'open' ? 0.7 : 1)*residents();
    let n = 0, want = 0, sum = 0;
    for (const z of zombies) if (!z.horde && !z.guard){ have[blockIndex(z.hx, z.hz)]++; n++; }
    const need = blocks.map((b, i) => { want += b.density*f; const d = Math.max(0, b.density*f - have[i]); sum += d; return d; });
    if (n < want && sum > 0){
      let r = Math.random()*sum, i = 0;
      while (i < need.length - 1 && (r -= need[i]) > 0) i++;
      const s = findBlockTile(blocks[i], POP.respawnGap); if (s) spawnZombieAt(s.x, s.z, false, false);
    }
    state.spawnTimer = Math.max(1.5, 4 - 0.3*(lv-1)) * mr(0.7,1.3)/residents();
  }
}
// Simulation step; only called while state.mode === 'play'.
export function update(dt){
  const crystal = world.crystal;
  state.runTime += dt; state.cityTime += dt;
  updatePlayers(dt);
  if (state.mode !== 'play') return;
  state.flowTimer -= dt;
  if (state.flowTimer <= 0){ state.flowTimer = 0.25; updateFlow(); }
  if (crystal && crystal.alive && !state.crystalFound && nearestDist(crystal.pos.x, crystal.pos.z) < 19) foundCrystal();
  updateSpawning(dt);
  if (!dev.freeze) updateZombies(dt);
  if (state.mode !== 'play') return;
  updateBullets(dt);
  updateUniques(dt);
  updateThrowables(dt);
  if (state.mode !== 'play') return;
  updateSpecials(dt);
  if (state.mode !== 'play') return;
  updatePickups(dt);
  updateDrops(dt);
  for (const p of players) if (!p.dead) updateInteract(p, dt);
  updateLandmarks();
  if (state.phase === 'open') updateExit(dt);
}
// Cosmetic animation; runs every frame in every mode.
export function animateWorld(dt, t){
  const exitMarker = world.exitMarker;
  animateCrystal(dt, t);
  if (exitMarker){
    exitMarker.gm.opacity = 0.25 + Math.sin(t*4)*0.12;
    exitMarker.chev.forEach((c,i) => { c.position.y = 0.35 + Math.max(0, Math.sin(t*5 - i*0.8))*0.25; });
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt*30);
  const flip = Math.floor(t*3) % 2;  // police lightbars
  SH.sirenR.emissiveIntensity = flip ? 1.6 : 0.15; SH.sirenB.emissiveIntensity = flip ? 0.15 : 1.6;
  animateContainers(t); animateCity(dt, t); animateBreaks(dt);
  updateThrowPreview();
  updateParticles(dt);
  updateDying(dt);
}
