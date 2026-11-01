// ---------- Upgrades ----------
// Gunsmithing between cities: every card works on your weapons. A card with on(w) is played on one
// weapon you choose (only the ones it can change are offered, and a card none of your weapons takes is
// never dealt); `mod` cards then choose one of that weapon's modifiers. Cards without on(w) work on you,
// gated by can(p). apply(p, slot, mod) changes things in place (host only: the random parts are rolled
// there) and returns { text, w } for the result screen: what happened and the weapon as it is now.
import { WEAPONS, GUNS, RARITY, WMODS } from './items.js';
import { RARITIES, makeWeapon, rollMods, freeMods, modValue, weaponTitle, modText } from './weapons.js';
import { magSize, addAmmo } from './inventory.js';
import { refreshGun } from './player.js';
import { state } from './state.js';
import { mpick } from './utils.js';

const MAX_UNIQUE_MODS = 3;
const isUnique = w => w.rarity === 'unique';
const kinds = w => w.mods.map(m => m.k);
const txt = (m, w) => modText(m, w.id);
const list = w => w.mods.length ? w.mods.map(m => txt(m, w)).join(' · ') : 'no modifiers';
const tierUp = w => RARITIES[RARITIES.indexOf(w.rarity) + 1];
const tierDown = w => RARITIES[RARITIES.indexOf(w.rarity) - 1];
// A smaller tank or magazine can't hold what was in it.
const fit = w => { w.mag = Math.min(w.mag, magSize(w)); return w; };

export const UPGRADES = [
  { id:'gunsmith', icon:'🔧', name:'Gunsmith', desc:'Pick one of a weapon’s modifiers: it’s replaced by a new random one it doesn’t have yet. Good or bad', mod:true,
    on:w => w.mods.length > 0 && freeMods(w).length > 0,
    apply:(p, w, i) => {
      const old = w.mods[i], m = rollMods(1, w.id, kinds(w))[0];
      w.mods[i] = m; fit(w);
      return `${txt(old, w)} → ${txt(m, w)}`;
    } },
  { id:'masterwork', icon:'⭐', name:'Masterwork', desc:'Raise a gun one rarity tier. It rolls the new tier’s extra modifier: good or bad',
    on:w => !isUnique(w) && w.rarity !== 'legendary',
    apply:(p, w) => {
      const from = weaponTitle(w), m = rollMods(1, w.id, kinds(w))[0];
      w.rarity = tierUp(w); if (m) w.mods.push(m); fit(w);
      return `${from} → ${weaponTitle(w)}${m ? `. New: ${txt(m, w)}` : ''}`;
    } },
  { id:'tinker', icon:'🎲', name:'Tinker', desc:'Reroll every modifier on a weapon: new kinds, new strengths. Same rarity, same number of modifiers',
    on:w => w.mods.length > 0,
    apply:(p, w) => { w.mods = rollMods(w.mods.length, w.id); fit(w); return `New modifiers: ${list(w)}`; } },
  { id:'calibrate', icon:'📐', name:'Calibrate', desc:'Keep a weapon’s modifiers but reroll how strong each one is. Good stays good, bad stays bad',
    on:w => w.mods.length > 0,
    apply:(p, w) => { for (const m of w.mods) m.v = modValue(m.k, m.s); fit(w); return `Recalibrated: ${list(w)}`; } },
  { id:'strip', icon:'🪛', name:'Strip down', desc:'Remove one random modifier from a weapon, good or bad. A gun drops one rarity tier with it',
    on:w => w.mods.length > 0,
    apply:(p, w) => {
      const [m] = w.mods.splice(Math.floor(Math.random()*w.mods.length), 1);
      if (!isUnique(w)) w.rarity = tierDown(w);
      fit(w);
      return `Removed: ${txt(m, w)}${isUnique(w) ? '' : `. Now a ${weaponTitle(w)}`}`;
    } },
  { id:'wild', icon:'🃏', name:'Wild card', desc:'Flip one random modifier on a weapon: good turns bad, bad turns good, just as strong',
    on:w => w.mods.some(m => WMODS[m.k].bad),
    apply:(p, w) => {
      const m = mpick(w.mods.filter(m => WMODS[m.k].bad)), was = txt(m, w), M = WMODS[m.k], [a, b] = M[m.s > 0 ? 'good' : 'bad'];
      const t = b > a ? (m.v - a)/(b - a) : 0.5;  // as far up the other side's range as it was up its own
      m.s = -m.s; m.v = modValue(m.k, m.s, Math.min(1, Math.max(0, t))); fit(w);
      return `${was} → ${txt(m, w)}`;
    } },
  { id:'prototype', icon:'⚗️', name:'Prototype', desc:`Add a random modifier to a unique weapon, from the ones that suit it. Good or bad, up to ${MAX_UNIQUE_MODS}`,
    on:w => isUnique(w) && w.mods.length < MAX_UNIQUE_MODS && freeMods(w).length > 0,
    apply:(p, w) => { const m = rollMods(1, w.id, kinds(w))[0]; w.mods.push(m); fit(w); return `New: ${txt(m, w)}`; } },
  { id:'tradein', icon:'🔄', name:'Trade-in', desc:'Swap a gun for a different type at the same rarity, with new modifiers and some ammo for it',
    on:w => !isUnique(w),
    apply:(p, w, i, slot) => {
      const id = mpick(GUNS.filter(g => g !== w.id)), nw = makeWeapon(id, w.rarity, rollMods(RARITY[w.rarity].mods, id));
      p.weapons[slot] = nw; addAmmo(p, id, WEAPONS[id].find[1]*2);
      if (slot === p.cur){ p.reloadT = 0; refreshGun(p); }
      return { text:`${weaponTitle(w)} → ${weaponTitle(nw)}${nw.mods.length ? `: ${list(nw)}` : ''}`, w:nw };
    } },
  { id:'supply', icon:'📦', name:'Supply drop', desc:'A weapon find (one city’s luck better) lands next to you at the start of the next city',
    apply:p => { p.supply++; return `A weapon will be waiting for you at the start of City ${state.level + 1}`; } },
  { id:'holster', icon:'🎒', name:'Holster', desc:'A third weapon slot. Q cycles through them',
    can:p => p.weapons.length < 3,
    apply:p => { p.weapons.push(null); return 'You can carry three weapons now. Q cycles through them'; } }
];
export const card = id => UPGRADES.find(u => u.id === id);

// Slots of p's weapons card u can be played on.
export const targets = (p, u) => p.weapons.map((w, i) => w && u.on(w) ? i : -1).filter(i => i >= 0);
export const cardFits = (p, u) => u.on ? targets(p, u).length > 0 : !u.can || u.can(p);
// Three cards that fit p's weapons, preferring ones nobody else in `taken` (ids) was dealt (all = every one).
export function dealCards(p, taken, all){
  const fits = UPGRADES.filter(u => cardFits(p, u));
  if (all) return fits.map(u => u.id);
  fits.sort(() => Math.random() - 0.5);
  return fits.filter(u => !taken.has(u.id)).concat(fits.filter(u => taken.has(u.id))).slice(0, 3).map(u => u.id);
}
// A choice is [card id, weapon slot, modifier index]: checked against what p was dealt and carries.
export function validChoice(p, c){
  if (!Array.isArray(c) || !p.offer || !p.offer.includes(c[0])) return false;
  const u = card(c[0]); if (!u || !cardFits(p, u)) return false;
  if (!u.on) return true;
  if (!targets(p, u).includes(c[1])) return false;
  return !u.mod || (Number.isInteger(c[2]) && c[2] >= 0 && c[2] < p.weapons[c[1]].mods.length);
}
// A random valid choice from p's cards (companions, a player who dropped out, the ?bot autopilot).
export function autoChoice(p){
  const u = card(mpick(p.offer.filter(id => cardFits(p, card(id)))) || p.offer[0]); if (!u) return null;
  if (!u.on) return [u.id, -1, -1];
  const s = mpick(targets(p, u));
  return [u.id, s, u.mod ? Math.floor(Math.random()*p.weapons[s].mods.length) : -1];
}
// Plays choice c (validated) for p: { text, w } (w = the weapon afterwards, a copy so the result screen
// keeps showing it as it was right after; null for cards that work on you).
export function applyCard(p, c){
  const u = card(c[0]), w = u.on ? p.weapons[c[1]] : null;
  let r = u.apply(p, w, c[2], c[1]);
  if (typeof r === 'string') r = { text:r, w };
  return { name:u.name, icon:u.icon, text:r.text, w:r.w ? JSON.parse(JSON.stringify(r.w)) : null };
}
