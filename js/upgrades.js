// ---------- Upgrades ----------
// Gunsmithing between cities: every card works on your weapons. A card with on(w, p) is played on one
// weapon you choose (only the ones it can change are offered, and a card none of your weapons takes is
// never dealt); `mod` cards then choose one of that weapon's modifiers (mods(p, w): which ones may be
// picked, ask/hint: the screen's wording), and Transplant then the weapon that gets it (dests). Cards
// without on() work on you, gated by can(p). apply(p, w, mod, slot, dest) changes things in place (host
// only: the random parts are rolled there) and returns the result line, or { text, w } for the weapon
// the result screen shows. Rarity always follows modifier count on standard guns.
//
// Dealing: each card has a tier (CARD_TIERS: its draw weight, and the colour it's shown in) and maybe
// `from` (the first city whose end deals it). A hand is drawn from the whole deck whatever you carry, and
// a drawn card that can't change anything you carry becomes the Ammo cache (`fallback`, never drawn
// itself), so dropping weapons before the exit can't push the odds toward the cards you want.
import { WEAPONS, GUNS, RARITY, WMODS } from './items.js';
import { RARITIES, makeWeapon, rollMods, freeMods, modPool, modValue, isSpecial, weaponTitle, modText } from './weapons.js';
import { magSize, addAmmo } from './inventory.js';
import { refreshGun } from './player.js';
import { state } from './state.js';
import { mpick } from './utils.js';

const MAX_UNIQUE_MODS = 3;
export const CARD_TIERS = { common:1, uncommon:0.7, rare:0.5, legendary:0.35 };
export const HAND = 3;
const isUnique = w => w.rarity === 'unique';
const kinds = w => w.mods.map(m => m.k);
const txt = (m, w) => modText(m, w.id);
const list = w => w.mods.length ? w.mods.map(m => txt(m, w)).join(' · ') : 'no modifiers';
const an = s => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;  // "an Uncommon Pistol"
const tierUp = w => RARITIES[RARITIES.indexOf(w.rarity) + 1];
const tierDown = w => RARITIES[RARITIES.indexOf(w.rarity) - 1];
// A smaller tank or magazine can't hold what was in it.
const fit = w => { w.mag = Math.min(w.mag, magSize(w)); return w; };
const flippable = m => WMODS[m.k] && WMODS[m.k].bad;
// Transplant: weapon o can take a modifier of kind k if it suits it, it doesn't have one, and there's
// room (a gun goes up a tier with it, so not a Legendary; a unique holds up to MAX_UNIQUE_MODS).
const canTake = (o, k) => modPool(o.id).includes(k) && !kinds(o).includes(k) && (isUnique(o) ? o.mods.length < MAX_UNIQUE_MODS : o.rarity !== 'legendary');
const takers = (p, w, k) => p.weapons.map((o, i) => o && o !== w && canTake(o, k) ? i : -1).filter(i => i >= 0);
// The modifiers of w that Transplant can move: not specials, and some other weapon of p's can take them.
const movable = (p, w) => w.mods.map((m, i) => !isSpecial(m.k) && takers(p, w, m.k).length ? i : -1).filter(i => i >= 0);

export const UPGRADES = [
  { id:'gunsmith', tier:'common', icon:'🔧', name:'Gunsmith', desc:'Pick one of a weapon’s modifiers: it’s replaced by a new random one it doesn’t have yet. Good or bad', mod:true,
    ask:w => `which modifier of your ${weaponTitle(w)} gets replaced?`, hint:'Replace it with a random new one',
    on:w => w.mods.length > 0 && freeMods(w).length > 0,
    apply:(p, w, i) => {
      const old = w.mods[i], m = rollMods(1, w.id, kinds(w))[0];
      w.mods[i] = m; fit(w);
      return `${txt(old, w)} → ${txt(m, w)}`;
    } },
  { id:'masterwork', tier:'uncommon', icon:'⭐', name:'Masterwork', desc:'Raise a gun one rarity tier. It rolls the new tier’s extra modifier: good or bad',
    on:w => !isUnique(w) && w.rarity !== 'legendary',
    apply:(p, w) => {
      const from = weaponTitle(w), m = rollMods(1, w.id, kinds(w))[0];
      w.rarity = tierUp(w); if (m) w.mods.push(m); fit(w);
      return `${from} → ${weaponTitle(w)}${m ? `. New: ${txt(m, w)}` : ''}`;
    } },
  { id:'tinker', tier:'common', icon:'🎲', name:'Tinker', desc:'Reroll every modifier on a weapon: new kinds, new strengths. Same rarity, same number of modifiers',
    on:w => w.mods.length > 0,
    apply:(p, w) => { w.mods = rollMods(w.mods.length, w.id); fit(w); return `New modifiers: ${list(w)}`; } },
  { id:'calibrate', tier:'common', icon:'📐', name:'Calibrate', desc:'Keep a weapon’s modifiers but reroll how strong each one is. Good stays good, bad stays bad',
    on:w => w.mods.some(m => !isSpecial(m.k)),
    apply:(p, w) => { for (const m of w.mods) if (!isSpecial(m.k)) m.v = modValue(m.k, m.s); fit(w); return `Recalibrated: ${list(w)}`; } },
  { id:'strip', tier:'common', icon:'🪛', name:'Strip down', desc:'Remove one random modifier from a weapon, good or bad. A gun drops one rarity tier with it',
    on:w => w.mods.length > 0,
    apply:(p, w) => {
      const [m] = w.mods.splice(Math.floor(Math.random()*w.mods.length), 1);
      if (!isUnique(w)) w.rarity = tierDown(w);
      fit(w);
      return `Removed: ${txt(m, w)}${isUnique(w) ? '' : `. Now ${an(weaponTitle(w))}`}`;
    } },
  { id:'wild', tier:'common', icon:'🃏', name:'Wild card', desc:'Flip one random modifier on a weapon: good turns bad, bad turns good, just as strong',
    on:w => w.mods.some(flippable),
    apply:(p, w) => {
      const m = mpick(w.mods.filter(flippable)), was = txt(m, w), M = WMODS[m.k], [a, b] = M[m.s > 0 ? 'good' : 'bad'];
      const t = b > a ? (m.v - a)/(b - a) : 0.5;  // as far up the other side's range as it was up its own
      m.s = -m.s; m.v = modValue(m.k, m.s, Math.min(1, Math.max(0, t))); fit(w);
      return `${was} → ${txt(m, w)}`;
    } },
  { id:'prototype', tier:'uncommon', icon:'⚗️', name:'Prototype', desc:`Add a random modifier to a unique weapon: a stat change that suits it (good or bad) or one of its own special effects (✦). Up to ${MAX_UNIQUE_MODS}`,
    on:w => isUnique(w) && w.mods.length < MAX_UNIQUE_MODS && freeMods(w).length > 0,
    apply:(p, w) => { const m = rollMods(1, w.id, kinds(w))[0]; w.mods.push(m); fit(w); return `New: ${txt(m, w)}`; } },
  { id:'tradein', tier:'common', icon:'🔄', name:'Trade-in', desc:'Swap a gun for a different type at the same rarity, with new modifiers and some ammo for it',
    on:w => !isUnique(w),
    apply:(p, w, i, slot) => {
      const id = mpick(GUNS.filter(g => g !== w.id)), nw = makeWeapon(id, w.rarity, rollMods(RARITY[w.rarity].mods, id));
      p.weapons[slot] = nw; addAmmo(p, id, WEAPONS[id].find[1]*2);
      if (slot === p.cur){ p.reloadT = 0; refreshGun(p); }
      return { text:`${weaponTitle(w)} → ${weaponTitle(nw)}${nw.mods.length ? `: ${list(nw)}` : ''}`, w:nw };
    } },
  { id:'transplant', tier:'rare', icon:'🧬', name:'Transplant', desc:'Move a modifier from one weapon to another, which goes up a rarity tier with it. The weapon it came from is destroyed. Special (✦) modifiers can’t be moved',
    mod:true, mods:movable, dests:(p, w, i) => takers(p, w, w.mods[i].k),
    ask:w => `which modifier moves? Your ${weaponTitle(w)} is destroyed`, hint:'Move it to another weapon',
    on:(w, p) => movable(p, w).length > 0,
    apply:(p, w, i, slot, dest) => {
      const m = w.mods[i], o = p.weapons[dest], from = weaponTitle(o);
      o.mods.push({ k:m.k, s:m.s, v:m.v }); if (!isUnique(o)) o.rarity = tierUp(o);
      w.out = false; w.charge = 0; p.weapons[slot] = null;
      if (p.cur === slot){ p.cur = dest; p.reloadT = 0; refreshGun(p); }
      return { text:`${txt(m, o)} moved to your ${from}${isUnique(o) ? '' : `, now ${an(weaponTitle(o))}`}. Your ${weaponTitle(w)} is gone`, w:o };
    } },
  // The fallback for a drawn card you can't use: fills the reserve of every weapon you carry that has one.
  { id:'ammo', tier:'common', fallback:true, icon:'🧰', name:'Ammo cache', desc:'Fills the ammo reserve of every weapon you carry. Dealt in place of a card none of your weapons could use',
    apply:p => {
      const got = [];
      for (const w of p.weapons) if (w && WEAPONS[w.id].maxAmmo && !got.includes(w.id)){ const k = addAmmo(p, w.id, WEAPONS[w.id].maxAmmo); if (k) got.push(w.id); }
      return got.length ? `Reserves full: ${got.map(id => WEAPONS[id].ammo).join(', ')}` : 'Your reserves were already full';
    } },
  { id:'supply', tier:'uncommon', icon:'📦', name:'Supply drop', desc:'A weapon find (one city’s luck better) lands next to you at the start of the next city',
    apply:p => { p.supply++; return `A weapon will be waiting for you at the start of City ${state.level + 1}`; } },
  { id:'holster', tier:'legendary', from:3, icon:'🎒', name:'Holster', desc:'A third weapon slot. Q cycles through them',
    can:p => p.weapons.length < 3,
    apply:p => { p.weapons.push(null); return 'You can carry three weapons now. Q cycles through them'; } }
];
export const card = id => UPGRADES.find(u => u.id === id);

// Slots of p's weapons card u can be played on; the modifiers of w it can pick; where Transplant can put mod i.
export const targets = (p, u) => p.weapons.map((w, i) => w && u.on(w, p) ? i : -1).filter(i => i >= 0);
export const modChoices = (p, u, w) => u.mods ? u.mods(p, w) : w.mods.map((m, i) => i);
export const destChoices = (p, u, w, i) => u.dests ? u.dests(p, w, i) : [];
export const cardFits = (p, u) => u.on ? targets(p, u).length > 0 : !u.can || u.can(p);
// The cards that can be drawn after city `level`, with their weights.
export const deck = (level = state.level) => UPGRADES.filter(u => !u.fallback && (u.from || 1) <= level);
const weightOf = u => CARD_TIERS[u.tier];
function draw(cards){
  let r = Math.random()*cards.reduce((s, u) => s + weightOf(u), 0);
  for (const u of cards){ r -= weightOf(u); if (r <= 0) return u; }
  return cards[cards.length - 1];
}
// p's hand: HAND weighted draws from the deck without repeats (a card already dealt to another player in
// `taken` is redrawn once, so co-op hands differ without changing the odds much); a drawn card that doesn't
// fit p's weapons turns into the Ammo cache (one per hand at most, so the hand gets smaller).
// all = dev tools: every card that fits.
export function dealCards(p, taken, all){
  if (all) return UPGRADES.filter(u => cardFits(p, u)).map(u => u.id);
  const pool = deck(), hand = [];
  for (let n=0;n<HAND && pool.length;n++){
    let u = draw(pool);
    if (taken.has(u.id) && pool.length > 1){ const v = draw(pool.filter(o => o !== u)); if (!taken.has(v.id)) u = v; }
    pool.splice(pool.indexOf(u), 1);
    const id = cardFits(p, u) ? u.id : 'ammo';
    if (!hand.includes(id)) hand.push(id);
  }
  return hand;
}
// How often each card shows up in a hand after city `level` for a player whose weapons fit everything (dev tools).
export function cardOdds(level, hands = 4000){
  const pool0 = deck(level), seen = Object.fromEntries(pool0.map(u => [u.id, 0]));
  for (let h=0;h<hands;h++){ const pool = pool0.slice(); for (let n=0;n<HAND && pool.length;n++){ const u = draw(pool); pool.splice(pool.indexOf(u), 1); seen[u.id]++; } }
  return pool0.map(u => [u, seen[u.id]/hands]);
}
// A choice is [card id, weapon slot, modifier index, destination slot]: checked against what p was dealt and carries.
export function validChoice(p, c){
  if (!Array.isArray(c) || !p.offer || !p.offer.includes(c[0])) return false;
  const u = card(c[0]); if (!u || !cardFits(p, u)) return false;
  if (!u.on) return true;
  if (!targets(p, u).includes(c[1])) return false;
  const w = p.weapons[c[1]];
  if (u.mod && !modChoices(p, u, w).includes(c[2])) return false;
  return !u.dests || destChoices(p, u, w, c[2]).includes(c[3]);
}
// A random valid choice from p's cards (companions, a player who dropped out, the ?bot autopilot).
export function autoChoice(p){
  const u = card(mpick(p.offer.filter(id => cardFits(p, card(id)))) || p.offer[0]); if (!u) return null;
  if (!u.on) return [u.id, -1, -1, -1];
  const s = mpick(targets(p, u)), w = p.weapons[s], i = u.mod ? mpick(modChoices(p, u, w)) : -1;
  return [u.id, s, i, u.dests ? mpick(destChoices(p, u, w, i)) : -1];
}
// Plays choice c (validated) for p: { text, w } (w = the weapon afterwards, a copy so the result screen
// keeps showing it as it was right after; null for cards that work on you).
export function applyCard(p, c){
  const u = card(c[0]), w = u.on ? p.weapons[c[1]] : null;
  let r = u.apply(p, w, c[2], c[1], c[3]);
  if (typeof r === 'string') r = { text:r, w };
  return { name:u.name, icon:u.icon, text:r.text, w:r.w ? JSON.parse(JSON.stringify(r.w)) : null };
}
