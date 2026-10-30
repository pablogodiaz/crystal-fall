// ---------- Looting ----------
// Searching containers (hold E), loot rolls, ground drops, landmark discovery.
import * as THREE from 'three';
import { N } from './config.js';
import { mr, mri, mpick } from './utils.js';
import { scene } from './renderer.js';
import { SH } from './assets.js';
import { world, keys, drops } from './state.js';
import { player } from './player.js';
import { WEAPONS, ITEMS, LOOT, LANDMARKS, FOUND_WEAPONS, AMMO_ODDS } from './items.js';
import { addItem, addAmmo, giveWeapon, replaceWeapon, carried, curWeapon } from './inventory.js';
import { makeNoise } from './zombies.js';
import { burst } from './fx.js';
import { toast, floatText } from './hud.js';
import { sfx } from './audio.js';

// What E would act on right now; read by the HUD for the prompt and progress ring.
// target is a container or a ground weapon drop; both carry px/pz.
export const interact = { target:null, p:0, label:'', noiseT:0 };

// ---------- Loot rolls ----------
function wpick(table){
  let sum = 0; for (const e of table) sum += e[1];
  let r = Math.random()*sum;
  for (const e of table){ r -= e[1]; if (r <= 0) return e[0]; }
  return table[0][0];
}
// Ammo finds lean toward the gun in your hands, then your other one (see AMMO_ODDS).
function ammoType(){
  const held = curWeapon().id, r = Math.random();
  const want = [held, ...carried().filter(w => w !== held)].filter(w => player.ammo[w] < WEAPONS[w].maxAmmo);
  if (want.length && r < AMMO_ODDS.held + AMMO_ODDS.carried) return r < AMMO_ODDS.held ? want[0] : want[want.length - 1];
  return mpick(Object.keys(WEAPONS));
}
const ammoRoll = (w, f) => ({ ammo:w, n:Math.ceil(mri(WEAPONS[w].find[0], WEAPONS[w].find[1]) * (f || 1)) });
function rollEntry(k){
  if (k === 'ammo') return ammoRoll(ammoType());
  if (k === 'weapon') return { weapon:mpick(FOUND_WEAPONS) };
  return { item:k, n:k === 'scrap' ? mri(1,3) : 1 };
}
// Door-searched landmarks give fixed loot; walk-in ones are looted from their shelves and lockers.
function landmarkLoot(type){
  if (type === 'pharmacy') return [{ item:'bandage', n:mri(2,4) }, { item:'medkit', n:mri(1,2) }];
  if (type === 'gas') return [{ item:'molotov', n:mri(1,2) }, { item:'scrap', n:mri(2,4) }].concat(Math.random() < 0.5 ? [{ item:'drink', n:1 }] : []);
  const out = [{ item:'scrap', n:mri(5,8) }];
  if (Math.random() < 0.5) out.push({ item:'pipebomb', n:1 });
  return out;
}
// The police armory: a gun you don't carry yet (if there is one) with plenty of its ammo.
function armoryLoot(){
  const own = carried(), fresh = FOUND_WEAPONS.filter(w => !own.includes(w));
  const w = mpick(fresh.length ? fresh : FOUND_WEAPONS);
  return [{ weapon:w }, ammoRoll(w, 1.5), ammoRoll(ammoType()), { item:'bandage', n:1 }];
}
export function rollLoot(c){
  if (c.kind === 'door' && c.lm) return landmarkLoot(c.lm);
  if (c.kind === 'armory') return armoryLoot();
  const L = LOOT[c.kind];
  if (Math.random() < L.empty) return [];
  const out = [], n = mri(L.rolls[0], L.rolls[1]);
  for (let i=0;i<n;i++) out.push(rollEntry(wpick(L.table)));
  return out;
}
// Hands loot to the player: each gain floats up over them; anything that doesn't fit lands on the
// ground. Returns notes worth a toast (full pack, new gun) and whether anything was found.
function grantLoot(raw){
  const notes = [], x = player.pos.x, z = player.pos.z, list = [];
  for (const e of raw){  // merge repeated finds so "+2 scrap" reads as one line
    const same = list.find(o => !e.weapon && o.item === e.item && o.ammo === e.ammo);
    if (same) same.n += e.n; else list.push(Object.assign({}, e));
  }
  for (const e of list){
    if (e.ammo){
      const k = addAmmo(e.ammo, e.n);
      if (k) floatText(`+${k} ${WEAPONS[e.ammo].ammo}`, 'good'); else notes.push(`${WEAPONS[e.ammo].ammo} full`);
    } else if (e.weapon){
      const r = giveWeapon(e.weapon);
      const name = WEAPONS[e.weapon].name;
      if (r === 'new'){ floatText(`+ ${name}`, 'good'); notes.push(`${name}! Press Q to swap`); }
      else if (r === 'ammo') floatText(`+ ${name} (ammo)`, 'good');
      else { spawnDrop('weapon', e.weapon, WEAPONS[e.weapon].mag, x, z, true); notes.push(`${name} found, hands full: dropped`); }
    } else {
      const k = addItem(e.item, e.n), I = ITEMS[e.item];
      if (k) floatText(`+${k} ${I.icon} ${I.name}`, 'good');
      if (k < e.n){ spawnDrop('item', e.item, e.n - k, x, z, true); notes.push(`Pack full: ${e.n - k} ${I.name} dropped`); }
    }
  }
  return { notes, found:list.length > 0 };
}
// ---------- Ground drops ----------
// kind: 'item' (id = item id, n = count), 'ammo' (id = weapon id, n = rounds), 'weapon' (n = rounds in its mag).
// held = spawned under the player; it isn't picked up again until they step away.
export function spawnDrop(kind, id, n, x, z, held){
  const g = new THREE.Group(); g.position.set(x + mr(-0.3,0.3), 0, z + mr(-0.3,0.3));
  const box = new THREE.Group(); box.position.y = 0.45;
  const m = new THREE.Mesh(kind === 'weapon' ? SH.dropGunGeo : SH.dropGeo, SH.dropMats[kind]); m.castShadow = true; box.add(m);
  const ring = new THREE.Mesh(SH.ringGeo, SH.dropGlow); ring.rotation.x = -Math.PI/2; ring.position.y = 0.1;
  g.add(box, ring); scene.add(g);
  const d = { kind, id, n, g, box, t:Math.random()*6, held:!!held, px:g.position.x, pz:g.position.z };
  drops.push(d); return d;
}
export function dropZombieAmmo(x, z){ const a = ammoRoll(ammoType(), 0.5); spawnDrop('ammo', a.ammo, a.n, x, z); }
// Short tag shown under a drop when you're near it.
export function dropName(d){
  if (d.kind === 'item') return `${ITEMS[d.id].icon} ${ITEMS[d.id].name}` + (d.n > 1 ? ` ×${d.n}` : '');
  if (d.kind === 'ammo') return `${WEAPONS[d.id].ammo} ×${d.n}`;
  return WEAPONS[d.id].name;
}
function removeDrop(d){ scene.remove(d.g); drops.splice(drops.indexOf(d), 1); }
// Walk-over pickup. Weapons only auto-pick when there's a free slot or you already carry one.
function tryCollect(d){
  if (d.kind === 'item'){
    const k = addItem(d.id, d.n); if (!k) return;
    d.n -= k; floatText(`+${k} ${ITEMS[d.id].icon} ${ITEMS[d.id].name}`, 'good'); sfx.pickup();
    if (!d.n) removeDrop(d);
  } else if (d.kind === 'ammo'){
    const k = addAmmo(d.id, d.n); if (!k) return;
    d.n -= k; floatText(`+${k} ${WEAPONS[d.id].ammo}`, 'good'); sfx.pickup();
    if (!d.n) removeDrop(d);
  } else if (carried().includes(d.id) || player.weapons.includes(null)){
    const r = giveWeapon(d.id, d.n);
    if (r === 'new'){ floatText(`+ ${WEAPONS[d.id].name}`, 'good'); toast(`${WEAPONS[d.id].name}! Press Q to swap`, 'good'); }
    else floatText(`+${d.n} ${WEAPONS[d.id].ammo}`, 'good');
    sfx.pickup();
    removeDrop(d);
  }
}
export function updateDrops(dt){
  for (let i=drops.length-1;i>=0;i--){
    const d = drops[i]; d.t += dt;
    d.box.rotation.y += dt*1.6; d.box.position.y = 0.45 + Math.sin(d.t*3)*0.08;
    const dist = Math.hypot(d.px - player.pos.x, d.pz - player.pos.z);
    if (d.held){ if (dist > 1.8) d.held = false; continue; }
    if (dist < 1.2) tryCollect(d);
  }
}

// ---------- Searching ----------
const isDrop = t => t && t.kind === 'weapon' && t.g;
export function updateInteract(dt){
  const city = world.city, px = player.pos.x, pz = player.pos.z;
  let best = null, bd = 1e9;
  for (const c of city.containers){
    if (c.searched) continue;
    const d = Math.hypot(c.px - px, c.pz - pz);
    if (d < c.range && d < bd){ best = c; bd = d; }
  }
  // A weapon on the ground you can't auto-pick (both slots full): hold E to swap it for the one in hand.
  for (const d of drops){
    if (d.kind !== 'weapon' || d.held || carried().includes(d.id) || player.weapons.includes(null)) continue;
    const dd = Math.hypot(d.px - px, d.pz - pz);
    if (dd < 1.5 && dd < bd){ best = d; bd = dd; }
  }
  if (best !== interact.target){ interact.target = best; interact.p = 0; }
  if (!best) return;
  const drop = isDrop(best);
  interact.label = drop ? `Swap ${WEAPONS[player.weapons[player.cur].id].name} for ${WEAPONS[best.id].name}` : `Search ${best.name}`;
  if (!keys.KeyE){ interact.p = 0; return; }
  if (drop){
    interact.p += dt/0.35;
    if (interact.p >= 1){
      const old = replaceWeapon(best.id, best.n);
      removeDrop(best); spawnDrop('weapon', old.id, old.mag, px, pz, true);
      sfx.swap(); floatText(`+ ${WEAPONS[best.id].name}`, 'good');
      interact.target = null; interact.p = 0;
    }
    return;
  }
  // Rummaging is loud: zombies nearby may hear it.
  if (interact.p === 0){ makeNoise(best.px, best.pz, best.noise*0.6); sfx.search(); interact.noiseT = 0.5; }
  interact.noiseT -= dt;
  if (interact.noiseT <= 0){ interact.noiseT = 0.5; sfx.search(); if (Math.random() < 0.5) makeNoise(best.px, best.pz, best.noise); }
  interact.p += dt/best.time;
  if (interact.p >= 1) finishSearch(best);
}
function finishSearch(c){
  c.searched = true; c.open(); c.glint.visible = false;
  interact.target = null; interact.p = 0;
  burst(new THREE.Vector3(c.px, 0.8, c.pz), 'dust', 6, 2);
  const { notes, found } = grantLoot(rollLoot(c));
  if (found) sfx.loot(); else floatText(`Nothing useful in this ${c.name}`, 'dim');
  if (notes.length) toast(notes.join('. '), 'info');
  if (c.kind === 'trunk' && Math.random() < 0.12){
    sfx.alarm(); makeNoise(c.px, c.pz, 32); toast('Car alarm! Everything nearby heard that', 'bad');
  }
}

// ---------- Landmarks ----------
// A landmark is discovered once the tile in front of its door (or entrance) has been revealed.
export function updateLandmarks(){
  for (const l of world.city.landmarks){
    if (l.found || !world.explored[l.oz*N + l.ox]) continue;
    l.found = true; world.mmDirty = true;
    const L = LANDMARKS[l.type];
    toast(`Discovered: ${L.icon} ${L.name}` + (l.type === 'police' ? ' (guarded)' : '') + (L.enter ? '. Walk in to search it' : ''), 'info');
  }
}
export function animateContainers(t){
  if (!world.city || !world.city.containers) return;
  for (const c of world.city.containers){
    if (c.searched || !c.glint) continue;
    c.glint.rotation.y = t*2; c.glint.position.y = c.gy + Math.sin(t*3 + c.px)*0.1;
  }
}
