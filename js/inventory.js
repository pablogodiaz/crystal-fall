// ---------- Inventory & weapons ----------
// Item stacks in p.inv (INV_SLOTS slots of { id, n } or null), two weapon slots in p.weapons (three with
// the Holster upgrade; weapon instances, see weapons.js, or null), reserve ammo per weapon type in p.ammo. Every player has their
// own, all of it on the player object, so it carries over between cities.
import { WEAPONS, ITEMS, RECIPES, THROWABLES } from './items.js';
import { refreshGun } from './player.js';
import { canAct } from './combat.js';
import { spawnDrop } from './loot.js';
import { throwItem } from './throwables.js';
import { toast, floatText } from './hud.js';
import { weaponStats, weaponTitle } from './weapons.js';
import { sfxFor } from './host.js';

export const curWeapon = p => p.weapons[p.cur];
export const magSize = w => weaponStats(w).mag;
export const carried = p => p.weapons.filter(Boolean).map(w => w.id);
// The slot Q goes to next from the held one (null if there's no other weapon).
export function nextSlot(p){
  const n = p.weapons.length;
  for (let k=1;k<n;k++){ const i = (p.cur + k) % n; if (p.weapons[i]) return i; }
  return null;
}
// The weapons you aren't holding, in the order Q reaches them.
export function otherWeapons(p){
  const out = [], n = p.weapons.length;
  for (let k=1;k<n;k++){ const w = p.weapons[(p.cur + k) % n]; if (w) out.push(w); }
  return out;
}
export function countItem(p, id){ let n = 0; for (const s of p.inv) if (s && s.id === id) n += s.n; return n; }

// Fills existing stacks first, then empty slots. Returns how many were added.
export function addItem(p, id, n){
  const max = ITEMS[id].max; let left = n;
  for (const s of p.inv){ if (!left) break; if (s && s.id === id && s.n < max){ const k = Math.min(left, max - s.n); s.n += k; left -= k; } }
  for (let i=0;i<p.inv.length && left > 0;i++) if (!p.inv[i]){ const k = Math.min(left, max); p.inv[i] = { id, n:k }; left -= k; }
  return n - left;
}
export function removeItem(p, id, n){
  for (let i=p.inv.length-1;i>=0 && n>0;i--){
    const s = p.inv[i]; if (!s || s.id !== id) continue;
    const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) p.inv[i] = null;
  }
}
// Returns how many rounds fit under the reserve cap (0 for weapons without reserve ammo).
export function addAmmo(p, id, n){
  const k = Math.max(0, Math.min(n, (WEAPONS[id].maxAmmo || 0) - p.ammo[id]));
  p.ammo[id] += k; return k;
}
// Puts a weapon instance in a free slot. Every find is its own gun (rarity and modifiers), so a
// second shotgun is a second gun, not ammo. Returns false when every slot is taken.
export function giveWeapon(p, w){
  const i = p.weapons.indexOf(null);
  if (i < 0) return false;
  p.weapons[i] = w;
  // A bow comes with a quiver: its first arrows go to the reserve.
  const W = WEAPONS[w.id]; if (W.start && !w.started){ w.started = true; addAmmo(p, w.id, W.start); }
  return true;
}
// Swaps the held weapon for one on the ground; returns the weapon put down.
export function replaceWeapon(p, w){
  const old = curWeapon(p); old.out = false; old.charge = 0;  // a drone docks, a railgun charge drops
  p.weapons[p.cur] = w; p.reloadT = 0; p.fireCd = 0.3; refreshGun(p);
  const W = WEAPONS[w.id]; if (W.start && !w.started){ w.started = true; addAmmo(p, w.id, W.start); }
  return old;
}
// G: put the held weapon on the ground and switch to the next one (you always keep one).
export function dropWeapon(p){
  if (!canAct(p)) return;
  const o = nextSlot(p);
  if (o === null) return toast('That’s your only weapon', '', p);
  const w = curWeapon(p); w.out = false; w.charge = 0;
  p.weapons[p.cur] = null; p.cur = o; p.reloadT = 0; p.fireCd = 0.3; p.aiming = false; refreshGun(p);
  spawnDrop('weapon', w, 0, p.pos.x, p.pos.z, p);
  sfxFor(p, 'swap'); floatText(`Dropped ${weaponTitle(w)}`, 'dim', p);
}
// Q: the next weapon, or slot i if given (companions pick the loaded one).
export function swapWeapon(p, i){
  if (!canAct(p)) return;
  const o = Number.isInteger(i) && i !== p.cur && p.weapons[i] ? i : nextSlot(p); if (o === null) return;
  p.cur = o; p.reloadT = 0; p.fireCd = 0.3; refreshGun(p); sfxFor(p, 'swap');
}

const heal = (p, n) => { p.hp = Math.min(p.maxHp, p.hp + n); };
const consume = (p, i) => { const s = p.inv[i]; s.n--; if (!s.n) p.inv[i] = null; };
export function useSlot(p, i){
  if (!canAct(p)) return;
  const s = p.inv[i]; if (!s) return;
  switch (s.id){
    case 'bandage':
      if (!p.bleeding && p.hp >= p.maxHp) return toast('You don’t need a bandage', '', p);
      consume(p, i); heal(p, 10); sfxFor(p, 'use');
      toast(p.bleeding ? 'Bleeding stopped' : 'Bandaged up', 'good', p); p.bleeding = false; return;
    case 'medkit':
      if (!p.bleeding && p.hp >= p.maxHp) return toast('Already at full health', '', p);
      consume(p, i); heal(p, 50); p.bleeding = false; sfxFor(p, 'use'); return toast('+50 health', 'good', p);
    case 'drink':
      if (p.boost > 2 && p.stamina > 0.95) return toast('Already wired', '', p);
      consume(p, i); p.stamina = 1; p.winded = false; p.boost = 20; sfxFor(p, 'use'); return toast('Energized: sprinting is cheap for 20 s', 'good', p);
    case 'scrap': return toast('Press C to craft with scrap', '', p);
    case 'molotov': case 'pipebomb':
      if (throwItem(p, s.id)) consume(p, i); return;
  }
}
// ---------- Throwables ----------
// The selection is a preference: if you have none of the selected kind but some of another,
// a throw (and the HUD) uses the one you have.
export function selectedThrowable(p){
  if (countItem(p, p.throwSel)) return p.throwSel;
  return THROWABLES.find(id => countItem(p, id)) || p.throwSel;
}
// Hold right click to aim (throwables.js draws the landing preview), release to throw, left click cancels.
export function startAim(p){
  if (!canAct(p)) return;
  if (!countItem(p, selectedThrowable(p))) return toast('No throwables. Craft some with scrap (C)', '', p);
  p.aiming = true;
}
export function releaseThrow(p){
  if (!p.aiming) return;
  p.aiming = false;
  const id = selectedThrowable(p);
  if (canAct(p) && countItem(p, id) && throwItem(p, id)) removeItem(p, id, 1);
}
export function cancelAim(p){ p.aiming = false; }
// Picks the next throwable kind you're carrying. Carrying none just changes the preference.
export function cycleThrowable(p, dir){
  if (!canAct(p)) return;
  const n = THROWABLES.length, cur = THROWABLES.indexOf(selectedThrowable(p));
  const order = Array.from({ length:n-1 }, (_, i) => THROWABLES[((cur + dir*(i+1)) % n + n) % n]);
  const next = order.find(id => countItem(p, id));
  if (next){ p.throwSel = next; sfxFor(p, 'swap'); }
  else if (countItem(p, THROWABLES[cur])) toast(`Only ${ITEMS[THROWABLES[cur]].name.toLowerCase()}s in your pack`, '', p);
  else p.throwSel = order[0];
}
// Right-click a slot: drop the whole stack at your feet (a teammate can pick it up straight away).
export function dropSlot(p, i){
  if (!canAct(p)) return;
  const s = p.inv[i]; if (!s) return;
  p.inv[i] = null;
  spawnDrop('item', s.id, s.n, p.pos.x, p.pos.z, p);
  toast(`Dropped ${s.n} ${ITEMS[s.id].name}`, '', p);
}
// Returns an error message, or null on success.
export function craft(p, id){
  const r = RECIPES.find(r => r.id === id);
  if (countItem(p, 'scrap') < r.scrap) return `Needs ${r.scrap} scrap`;
  removeItem(p, 'scrap', r.scrap);
  if (!addItem(p, id, 1)){ addItem(p, 'scrap', r.scrap); return 'No room in your pack'; }
  sfxFor(p, 'craft');
  return null;
}
