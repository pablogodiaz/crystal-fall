// ---------- Looting ----------
// Searching containers (hold E), loot rolls, ground drops, landmark discovery.
import * as THREE from 'three';
import { N, TILE } from './config.js';
import { mr, mri, mpick } from './utils.js';
import { scene } from './renderer.js';
import { SH, gunModel } from './assets.js';
import { world, drops, pickups, players } from './state.js';
import { isBlockedTile, lineOfSight, groundAt } from './grid.js';
import { WEAPONS, ITEMS, LOOT, LANDMARKS, GUNS, AMMO_ODDS, LUCK_SHOP } from './items.js';
import { addItem, addAmmo, giveWeapon, replaceWeapon, carried, curWeapon } from './inventory.js';
import { rollWeapon, weaponTitle } from './weapons.js';
import { refuel } from './uniques.js';
import { makeNoise } from './zombies.js';
import { burst } from './fx.js';
import { toast, toastAll, floatText } from './hud.js';
import { sfx } from './audio.js';
import { emit, sfxFor, nextId } from './host.js';
import { breakJobs, jobLabel, finishJob } from './breakables.js';
const r2 = v => Math.round(v*100)/100;

// What E would act on right now is per player, p.interact = { target, p, label, noiseT, lock }; the
// HUD reads the watched player's for the prompt and progress ring. target is a container, a ground
// weapon drop or a gas pump (flamethrower refuel); all carry px/pz. lock = E must be let go before
// the next interaction starts (no chaining by holding it down). Containers are shared: whoever
// finishes searching one gets what's in it, rolled for them.

// ---------- Loot rolls ----------
function wpick(table){
  let sum = 0; for (const e of table) sum += e[1];
  let r = Math.random()*sum;
  for (const e of table){ r -= e[1]; if (r <= 0) return e[0]; }
  return table[0][0];
}
// Ammo finds lean toward the gun in p's hands, then their other one (see AMMO_ODDS). Weapons without
// reserve ammo (flamethrower, flask, arc caster) don't count.
function ammoType(p){
  const r = Math.random();
  const want = [...new Set([curWeapon(p).id, ...carried(p)])].filter(w => WEAPONS[w].find && p.ammo[w] < WEAPONS[w].maxAmmo);
  let id = want.length && r < AMMO_ODDS.held + AMMO_ODDS.carried ? (r < AMMO_ODDS.held ? want[0] : want[want.length - 1]) : mpick(GUNS);
  if (WEAPONS[id].unique && Math.random() > AMMO_ODDS.unique){ const std = want.filter(w => !WEAPONS[w].unique); id = std.length ? std[0] : mpick(GUNS); }
  return id;
}
const ammoRoll = (w, f) => ({ ammo:w, n:Math.ceil(mri(WEAPONS[w].find[0], WEAPONS[w].find[1]) * (f || 1)) });
// A standard gun type p doesn't carry yet (the pistol only if there's nothing else left).
function freshGun(p){ const own = carried(p), f = GUNS.filter(w => w !== 'pistol' && !own.includes(w)); return f.length ? mpick(f) : mpick(GUNS); }
function rollEntry(k, luck, p){
  if (k === 'ammo') return ammoRoll(ammoType(p));
  if (k === 'weapon') return { weapon:rollWeapon(luck, undefined, p) };
  return { item:k, n:k === 'scrap' ? mri(1,3) : k === 'planks' ? mri(1,3) : 1 };
}
// Door-searched landmarks give fixed loot; walk-in ones are looted from their shelves and lockers.
function landmarkLoot(type, p){
  if (type === 'pharmacy') return [{ item:'bandage', n:mri(2,4) }, { item:'medkit', n:mri(1,2) }];
  if (type === 'gas') return [{ item:'molotov', n:mri(1,2) }, { item:'scrap', n:mri(2,4) }].concat(Math.random() < 0.5 ? [{ item:'drink', n:1 }] : []);
  if (type === 'gunshop'){
    const out = [ammoRoll(ammoType(p), 1.5), ammoRoll(ammoType(p)), ammoRoll(ammoType(p))];
    if (Math.random() < 0.6) out.push({ weapon:rollWeapon(LUCK_SHOP, freshGun(p), p) });
    return out;
  }
  const out = [{ item:'scrap', n:mri(5,8) }, { item:'planks', n:mri(3,5) }];
  if (Math.random() < 0.5) out.push({ item:'pipebomb', n:1 });
  return out;
}
// The police armory: a lucky roll, usually of a gun type p doesn't carry yet, with plenty of its ammo.
function armoryLoot(p){
  const w = rollWeapon(LOOT.armory.luck, freshGun(p), p);
  return [{ weapon:w }, ammoRoll(WEAPONS[w.id].find ? w.id : ammoType(p), 1.5), ammoRoll(ammoType(p)), { item:'bandage', n:1 }];
}
// What container c holds, rolled for player p (who searched it).
export function rollLoot(c, p){
  if (c.kind === 'door' && c.lm) return landmarkLoot(c.lm, p);
  if (c.kind === 'armory') return armoryLoot(p);
  const L = LOOT[c.kind];
  if (Math.random() < L.empty) return [];
  const out = [], n = mri(L.rolls[0], L.rolls[1]);
  for (let i=0;i<n;i++) out.push(rollEntry(wpick(L.table), L.luck || 0, p));
  return out;
}
// Hands loot to player p: each gain floats up over them. Weapons always land on the ground (tossed
// out of the container `from`), so a find is never missed; so does anything that doesn't fit in the
// pack. Returns notes worth a toast (full pack, new gun) and whether anything was found.
function grantLoot(p, raw, from){
  const notes = [], x = p.pos.x, z = p.pos.z, list = [];
  for (const e of raw){  // merge repeated finds so "+2 scrap" reads as one line
    const same = list.find(o => !e.weapon && o.item === e.item && o.ammo === e.ammo);
    if (same) same.n += e.n; else list.push(Object.assign({}, e));
  }
  for (const e of list){
    if (e.ammo){
      const k = addAmmo(p, e.ammo, e.n);
      if (k) floatText(`+${k} ${WEAPONS[e.ammo].ammo}`, 'good', p); else notes.push(`${WEAPONS[e.ammo].ammo} full`);
    } else if (e.weapon){
      const w = e.weapon, name = weaponTitle(w);
      spawnDrop('weapon', w, 0, x, z, null, from); sfxFor(p, 'weapon');
      floatText(`Found: ${name}!`, 'r-' + w.rarity, p); notes.push(`${name} found. It’s on the ground: hold E to pick it up`);
    } else {
      const k = addItem(p, e.item, e.n), I = ITEMS[e.item];
      if (k) floatText(`+${k} ${I.icon} ${I.name}`, 'good', p);
      if (k < e.n){ spawnDrop('item', e.item, e.n - k, x, z, p, from); notes.push(`Pack full: ${e.n - k} ${I.name} dropped`); }
    }
  }
  return { notes, found:list.length > 0 };
}
// ---------- Ground drops ----------
// kind: 'item' (id = item id, n = count), 'ammo' (id = weapon id, n = rounds), 'weapon' (id = the weapon
// instance, stored as d.w; d.id = its type). Weapons show their model, a ring in their rarity colour and,
// from Rare up, a beam of light. held = the player it was dropped under (or put down by): they don't
// pick it up again until they step away; everyone else can take it straight away.
// Every drop lands on a free spot near (x,z) (freeSpot), so piles spread out; with `from` ({ x, z }) it is
// tossed there in an arc from that point (a searched container).
const SPREAD = 1, TOSS = 0.45;
export function freeSpot(x, z){
  const ok = (sx, sz) => !isBlockedTile(Math.floor(sx/TILE), Math.floor(sz/TILE))
    && drops.every(d => Math.hypot(d.px - sx, d.pz - sz) >= SPREAD)
    && pickups.every(p => Math.hypot(p.g.position.x - sx, p.g.position.z - sz) >= SPREAD);
  if (ok(x, z)) return [x, z];
  const a0 = Math.random()*Math.PI*2;
  for (let r=0.9;r<=3.6;r+=0.6) for (let i=0;i<8;i++){
    const a = a0 + i*Math.PI/4 + r, sx = x + Math.sin(a)*r, sz = z + Math.cos(a)*r;
    if (ok(sx, sz) && lineOfSight(x, z, sx, sz)) return [sx, sz];
  }
  return [x + mr(-0.3,0.3), z + mr(-0.3,0.3)];
}
export function spawnDrop(kind, id, n, x, z, held, from){
  const [sx, sz] = freeSpot(x, z), d = dropMesh(kind, id, n, sx, sz, held, from, nextId());
  emit(dropEvent(d));
  return d;
}
// What a client needs for its copy (dropMesh); a weapon goes over whole (rarity, mods, ammo…).
export const dropEvent = d => ['d+', d.nid, d.kind, d.w || d.id, d.n, r2(d.px), r2(d.pz), d.fly > 0 ? r2(d.fx) : null, d.fly > 0 ? r2(d.fz) : null, d.held ? d.held.slot : -1];
// The drop itself at its spot (sx,sz), tossed in from `from` if given.
export function dropMesh(kind, id, n, sx, sz, held, from, nid){
  const w = kind === 'weapon' ? id : null;
  const g = new THREE.Group(); g.position.set(sx, groundAt(sx, sz), sz);
  const box = new THREE.Group(); box.position.y = 0.45;
  if (w){ const m = gunModel(w.id, w.rarity); m.scale.setScalar(1.8); m.position.z = -0.7; m.rotation.z = 0.25; box.add(m); }
  else if (kind === 'ammo' && id === 'bow'){ const m = new THREE.Mesh(SH.arrowGeo, SH.arrowMat); m.rotation.set(0.15, 0, 0.6); m.castShadow = true; box.add(m); box.position.y = 0.25; }
  else { const m = new THREE.Mesh(SH.dropGeo, SH.dropMats[kind]); m.castShadow = true; box.add(m); }
  const ring = new THREE.Mesh(SH.ringGeo, w ? SH.rarGlow[w.rarity] : SH.dropGlow); ring.rotation.x = -Math.PI/2; ring.position.y = 0.1;
  g.add(box, ring);
  if (w && w.rarity !== 'common' && w.rarity !== 'uncommon') g.add(new THREE.Mesh(SH.beamGeo, SH.rarBeam[w.rarity]));
  scene.add(g);
  const d = { kind, id:w ? w.id : id, w, n, g, box, t:Math.random()*6, held:held || null, px:sx, pz:sz, fly:0, nid };
  if (from && Math.hypot(from.x - sx, from.z - sz) > 0.3){ d.fly = TOSS; d.fx = from.x; d.fz = from.z; g.position.set(from.x, groundAt(from.x, from.z), from.z); }
  drops.push(d); return d;
}
// A spent arrow: joins one already lying close by, otherwise lands as its own pickup.
export function dropArrow(x, z){
  const d = drops.find(d => d.kind === 'ammo' && d.id === 'bow' && Math.hypot(d.px - x, d.pz - z) < 1.2);
  if (d){ d.n++; emit(['dn', d.nid, d.n]); } else spawnDrop('ammo', 'bow', 1, x, z);
}
// Ammo off a dead zombie, suited to player p's guns.
export function dropZombieAmmo(x, z, p){ const a = ammoRoll(ammoType(p), 0.5); spawnDrop('ammo', a.ammo, a.n, x, z); }
// Short tag shown under a drop when you're near it.
export function dropName(d){
  if (d.kind === 'item') return `${ITEMS[d.id].icon} ${ITEMS[d.id].name}` + (d.n > 1 ? ` ×${d.n}` : '');
  if (d.kind === 'ammo') return `${WEAPONS[d.id].ammo} ×${d.n}`;
  return weaponTitle(d.w);
}
export function removeDrop(d){ scene.remove(d.g); drops.splice(drops.indexOf(d), 1); emit(['d-', d.nid]); }
// Walk-over pickup of items and ammo by player p. Weapons are only ever taken with E (updateInteract).
// Returns true once the drop is used up.
function tryCollect(p, d){
  if (d.kind === 'item'){
    const k = addItem(p, d.id, d.n); if (!k) return false;
    d.n -= k; floatText(`+${k} ${ITEMS[d.id].icon} ${ITEMS[d.id].name}`, 'good', p); sfxFor(p, 'pickup');
  } else if (d.kind === 'ammo'){
    const k = addAmmo(p, d.id, d.n); if (!k) return false;
    d.n -= k; floatText(`+${k} ${WEAPONS[d.id].ammo}`, 'good', p); sfxFor(p, 'pickup');
  } else return false;
  if (!d.n){ removeDrop(d); return true; }
  emit(['dn', d.nid, d.n]);
  return false;
}
// Spinning, bobbing, the toss arc, and letting go of `held` (also run by clients on their copies).
// Returns false while it's in the air.
export function animateDrop(d, dt){
  d.t += dt;
  d.box.rotation.y += dt*1.6; d.box.position.y = 0.45 + Math.sin(d.t*3)*0.08;
  if (d.fly > 0){
    // Tossed: an arc from where it came from to its spot. Can't be picked up mid-air.
    d.fly = Math.max(0, d.fly - dt);
    const k = 1 - d.fly/TOSS;
    const gx = d.fx + (d.px - d.fx)*k, gz = d.fz + (d.pz - d.fz)*k; d.g.position.set(gx, groundAt(gx, gz), gz); d.box.position.y += Math.sin(k*Math.PI)*1.5;
    if (!d.fly) burst(new THREE.Vector3(d.px, 0.3, d.pz), 'dust', 4, 1.5, true);
    return false;
  }
  if (d.held && (d.held.dead || Math.hypot(d.px - d.held.pos.x, d.pz - d.held.pos.z) > 1.8)) d.held = null;
  return true;
}
export function updateDrops(dt){
  for (let i=drops.length-1;i>=0;i--){
    const d = drops[i];
    if (!animateDrop(d, dt) || d.kind === 'weapon') continue;
    for (const p of players){
      if (p.dead || p === d.held || Math.hypot(d.px - p.pos.x, d.pz - p.pos.z) >= 1.2) continue;
      if (tryCollect(p, d)) break;
    }
  }
}

// ---------- Searching ----------
const isDrop = t => t && t.kind === 'weapon' && t.g;
// Gas pumps, one refuel target each, tied to their station (city.landmarks, l.refueled once used).
function pumps(city){
  if (city.pumps) return city.pumps;
  const gas = city.landmarks.filter(l => l.type === 'gas');
  return city.pumps = city.props.filter(p => p.kind === 'pump' && gas.length).map(p => ({
    kind:'refuel', name:'pump', px:(p.x+0.5)*TILE, pz:(p.z+0.5)*TILE, time:1.5, range:3.3, noise:8,
    l:gas.reduce((a, b) => Math.hypot(b.cx - p.x, b.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? b : a)
  }));
}
// Player p's hold-E interaction (its target, progress and prompt live on p.interact).
export function updateInteract(p, dt){
  const city = world.city, px = p.pos.x, pz = p.pos.z, interact = p.interact, held = p.ctl.use;
  let best = null, bd = 1e9;
  for (const c of city.containers){
    if (c.searched) continue;
    const d = Math.hypot(c.px - px, c.pz - pz);
    if (d < c.range && d < bd){ best = c; bd = d; }
  }
  // A weapon on the ground: hold E to pick it up (free slot) or swap it for the one in your hands.
  for (const d of drops){
    if (d.kind !== 'weapon' || d.held === p || d.fly > 0) continue;
    const dd = Math.hypot(d.px - px, d.pz - pz);
    if (dd < 1.6 && dd < bd){ best = d; bd = dd; }
  }
  // Carrying a flamethrower that isn't full: a station's pumps fill it once.
  const fl = p.weapons.find(w => w && w.id === 'flamer');
  if (fl && fl.mag < WEAPONS.flamer.mag - 0.5) for (const t of pumps(city)){
    if (t.l.refueled) continue;
    const d = Math.hypot(t.px - px, t.pz - pz);
    if (d < t.range && d < bd){ best = t; bd = d; }
  }
  // Fences and barricades: repair a damaged wooden one with a plank, take your own barricade down.
  for (const [t, d] of breakJobs(p)) if (d < bd){ best = t; bd = d; }
  if (best !== interact.target){ interact.target = best; interact.p = 0; }
  if (!best) return;
  const drop = isDrop(best), free = p.weapons.includes(null);
  interact.label = drop ? (free ? `Pick up ${weaponTitle(best.w)}` : `Swap ${weaponTitle(p.weapons[p.cur])} for ${weaponTitle(best.w)}`)
    : best.kind === 'refuel' ? 'Refuel the flamethrower' : best.kind === 'repair' || best.kind === 'takedown' ? jobLabel(best) : `Search ${best.name}`;
  if (!held) interact.lock = false;
  if (!held || interact.lock){ interact.p = 0; return; }
  if (drop){
    interact.p += dt/0.35;
    if (interact.p >= 1){
      const name = weaponTitle(best.w);
      removeDrop(best);
      if (free){ giveWeapon(p, best.w); sfxFor(p, 'pickup'); toast(`${name}! Press Q to swap to it`, 'good', p); }
      else { spawnDrop('weapon', replaceWeapon(p, best.w), 0, px, pz, p); sfxFor(p, 'swap'); }
      floatText(`+ ${name}`, 'r-' + best.w.rarity, p);
      interact.target = null; interact.p = 0; interact.lock = true;
    }
    return;
  }
  // Rummaging is loud: zombies nearby may hear it.
  if (interact.p === 0){ makeNoise(best.px, best.pz, best.noise*0.6); sfxFor(p, 'search'); interact.noiseT = 0.5; }
  interact.noiseT -= dt;
  if (interact.noiseT <= 0){ interact.noiseT = 0.5; sfxFor(p, 'search'); if (Math.random() < 0.5) makeNoise(best.px, best.pz, best.noise); }
  interact.p += dt/best.time;
  if (interact.p < 1) return;
  interact.lock = true;
  if (best.kind === 'refuel'){ refuel(p, fl, best.l); interact.target = null; interact.p = 0; }
  else if (best.kind === 'repair' || best.kind === 'takedown'){ finishJob(p, best); interact.target = null; interact.p = 0; }
  else finishSearch(p, best);
}
function finishSearch(p, c){
  c.searched = true; c.open(); c.glint.visible = false;
  emit(['open', world.city.containers.indexOf(c)]);
  p.interact.target = null; p.interact.p = 0;
  burst(new THREE.Vector3(c.px, 0.8, c.pz), 'dust', 6, 2);
  const { notes, found } = grantLoot(p, rollLoot(c, p), { x:c.px, z:c.pz });
  if (found) sfxFor(p, 'loot'); else floatText(`Nothing useful in this ${c.name}`, 'dim', p);
  if (notes.length) toast(notes.join('. '), 'info', p);
  if (c.kind === 'trunk' && Math.random() < 0.12){
    sfx.alarm(); makeNoise(c.px, c.pz, 32); toastAll('Car alarm! Everything nearby heard that', 'bad');
  }
}

// ---------- Landmarks ----------
// A landmark is discovered once the tile in front of its door (or entrance) has been revealed.
export function updateLandmarks(){
  for (const l of world.city.landmarks){
    if (l.found || !world.explored[l.oz*N + l.ox]) continue;
    l.found = true; world.mmDirty = true;
    emit(['lm', world.city.landmarks.indexOf(l)]);
    const L = LANDMARKS[l.type];
    toastAll(`Discovered: ${L.icon} ${L.name}` + (l.type === 'police' ? ' (guarded)' : '') + (L.enter ? '. Walk in to search it' : ''), 'info');
  }
}
export function animateContainers(t){
  if (!world.city || !world.city.containers) return;
  for (const c of world.city.containers){
    if (c.searched || !c.glint) continue;
    c.glint.rotation.y = t*2; c.glint.position.y = c.gy + Math.sin(t*3 + c.px)*0.1;
  }
}
