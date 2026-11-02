// ---------- Weapon instances ----------
// A weapon in a slot or on the ground is { id, rarity, mods:[{ k, s:±1, v }], mag, uid } plus
// per-kind state: cd (Turncoat flask cooldown), idle (Arc caster recharge delay).
// Standard guns roll a rarity and one random modifier per step above Common, each good or bad;
// uniques are found without modifiers (the Prototype upgrade adds them: the stat kinds in WEAPONS[id].mods
// plus that unique's own SPECIALS, effects stored as { k, s:1, v:0 }).
// weaponStats() folds base stats and modifiers together; the upgrades in upgrades.js edit the instance.
import { WEAPONS, GUNS, UNIQUES, RARITY, WMODS, SPECIALS, SPECIAL_W, WEAPON_ODDS, CRIT } from './items.js';
import { mr, mpick } from './utils.js';
import { state } from './state.js';

export const RARITIES = ['common','uncommon','rare','legendary'];
let uid = 0;
export function makeWeapon(id, rarity = 'common', mods = []){
  const u = !!WEAPONS[id].unique;
  const w = { id, rarity:u ? 'unique' : rarity, mods:u ? [] : mods, mag:0, uid:++uid, cd:0, idle:0 };
  w.mag = weaponStats(w).mag;
  return w;
}
// luck = extra cities' worth of rarity odds (armories, military crates, the gun shop).
export function rollRarity(luck = 0){
  const lv = state.level - 1 + luck, ws = RARITIES.map(k => {
    const [b, per, lim] = RARITY[k].w, v = b + per*lv;
    return [k, per < 0 ? Math.max(lim, v) : Math.min(lim, v)];
  });
  let r = Math.random()*ws.reduce((s, e) => s + e[1], 0);
  for (const [k, w] of ws){ r -= w; if (r <= 0) return k; }
  return 'common';
}
// The modifiers weapon type `id` can roll: every stat kind for standard guns; a unique's own list plus its specials.
export const modPool = id => WEAPONS[id].unique ? (WEAPONS[id].mods || []).concat(Object.keys(SPECIALS).filter(k => SPECIALS[k].on === id)) : Object.keys(WMODS);
export const isSpecial = k => !!SPECIALS[k];
export const hasMod = (w, k) => w.mods.some(m => m.k === k);
const weight = k => isSpecial(k) ? SPECIAL_W : WMODS[k].w || 1;
// Modifier kinds weapon w could still get (it never has two of one kind).
export const freeMods = w => modPool(w.id).filter(k => !w.mods.some(m => m.k === k));
// A strength for modifier k rolling good (s = 1) or bad (-1); t = where in its range (random if not given).
export function modValue(k, s, t = Math.random()){
  const M = WMODS[k], [a, b] = M[s > 0 ? 'good' : 'bad'], v = a + (b - a)*t;
  return M.int ? Math.round(v) : Math.round(v*100)/100;
}
// One new modifier of kind k: good or bad by WEAPON_ODDS.good (always good for kinds without a bad side;
// a special is just there).
export function rollMod(k){
  if (isSpecial(k)) return { k, s:1, v:0 };
  const s = !WMODS[k].bad || Math.random() < WEAPON_ODDS.good ? 1 : -1;
  return { k, s, v:modValue(k, s) };
}
// Up to n different modifiers for weapon type id, none of the kinds in `have`, picked by their weight.
export function rollMods(n, id = 'pistol', have = []){
  const pool = modPool(id).filter(k => !have.includes(k)), out = [];
  while (out.length < n && pool.length){
    let r = Math.random()*pool.reduce((s, k) => s + weight(k), 0), i = 0;
    while (i < pool.length - 1 && (r -= weight(pool[i])) > 0) i++;
    out.push(rollMod(pool.splice(i, 1)[0]));
  }
  return out;
}
// A weapon find for player p. Sometimes a unique p doesn't carry yet; otherwise `prefer` (or any standard gun).
export function rollWeapon(luck = 0, prefer, p){
  const [b, per, max] = WEAPON_ODDS.unique, own = p ? p.weapons.filter(Boolean).map(w => w.id) : [];
  const fresh = UNIQUES.filter(u => !own.includes(u));
  if (fresh.length && Math.random() < Math.min(max, b + per*(state.level - 1))*(luck ? WEAPON_ODDS.luckUnique : 1)) return makeWeapon(mpick(fresh));
  const rarity = rollRarity(luck), id = prefer || mpick(GUNS);
  return makeWeapon(id, rarity, rollMods(RARITY[rarity].mods, id));
}
// Effective numbers for weapon w: base stats with its modifiers applied. Uniques read the ones that
// mean something for them: range (reach, or the splash radius), mag (tank / charge / battery / wells),
// rate (railgun: charge time, flask: brew time), reload, noise, kb, pellets, pierce.
export function weaponStats(w){
  const W = WEAPONS[w.id];
  const S = { dmg:W.dmg, rate:W.rate, mag:W.mag, reload:W.reload, jitter:W.jitter, spread:W.spread, life:W.life, speed:W.speed,
    noise:W.noise, pierce:W.pierce || 0, pellets:W.pellets || 1, kb:1, free:0, waste:0, crit:0, jam:0,
    range:W.range || W.radius, charge:W.charge, cooldown:W.cooldown };
  for (const m of w.mods){
    const sv = m.s*m.v;
    switch (m.k){
      case 'dmg': S.dmg *= 1 + sv; break;
      case 'rate': if (S.rate) S.rate /= 1 + sv; if (S.charge) S.charge /= 1 + sv; if (S.cooldown) S.cooldown /= 1 + sv; break;
      case 'mag': { const n = Math.max(1, Math.round(W.mag*(1 + sv))); S.mag = n === W.mag ? Math.max(1, W.mag + m.s) : n; break; }
      case 'reload': S.reload *= 1 - sv; break;
      case 'acc': S.jitter *= 1 - sv; S.spread *= 1 - sv*0.6; break;
      case 'range': if (S.life) S.life *= 1 + sv; if (S.range) S.range *= 1 + sv; break;
      case 'noise': S.noise *= 1 - sv; break;
      case 'kb': S.kb *= 1 + sv; break;
      case 'thrift': if (m.s > 0) S.free = m.v; else S.waste = m.v; break;
      case 'crit': if (m.s > 0) S.crit = m.v; else S.jam = m.v; break;
      case 'pellets': S.pellets += m.v; break;
      case 'pierce': S.pierce += m.v; break;
    }
  }
  return S;
}
// Damage per second while firing (ignores reloads); null for uniques that don't shoot bullets.
export function weaponDps(w){
  if (WEAPONS[w.id].kind) return null;
  const S = weaponStats(w);
  return S.dmg*S.pellets*(1 + S.crit*(CRIT - 1))/S.rate;
}
// "Rare Shotgun"; commons and uniques go by their plain name.
export function weaponTitle(w){
  const n = WEAPONS[w.id].name;
  return w.rarity === 'common' || w.rarity === 'unique' ? n : `${RARITY[w.rarity].name} ${n}`;
}
const pct = v => Math.round(v*100) + '%';
// What `mag`, `rate` and `range` are called on each unique.
const MOD_WORDS = { flamer:{ mag:'fuel tank' }, cryo:{ mag:'coolant tank' }, tesla:{ mag:'charge capacity' }, shard:{ mag:'shard capacity' },
  drone:{ mag:'battery' }, railgun:{ rate:'charge speed' }, potion:{ rate:'brewing speed', range:'splash radius' } };
// Modifier m as card text, worded for weapon type id.
export function modText(m, id){
  if (isSpecial(m.k)) return `${SPECIALS[m.k].name}: ${SPECIALS[m.k].desc}`;
  const g = m.s > 0, p = pct(m.v), sign = g ? '+' : '−', word = k => (MOD_WORDS[id] || {})[k];
  switch (m.k){
    case 'dmg': return `${sign}${p} damage`;
    case 'rate': return `${sign}${p} ${word('rate') || 'fire rate'}`;
    case 'mag': return id === 'gravity' ? `${sign}1 gravity well` : `${sign}${p} ${word('mag') || 'magazine size'}`;
    case 'reload': return `${p} ${g ? 'faster' : 'slower'} reload`;
    case 'acc': return `${sign}${p} accuracy`;
    case 'range': return `${sign}${p} ${word('range') || 'range'}`;
    case 'noise': return `${p} ${g ? 'quieter' : 'louder'}`;
    case 'kb': return `${sign}${p} knockback`;
    case 'thrift': return g ? `${p} chance a shot costs no ammo` : `${p} chance a shot wastes a round`;
    case 'crit': return g ? `${p} chance of a ×${CRIT} critical hit` : `${p} chance to jam`;
    case 'pellets': return `+${m.v} ${id === 'shard' ? 'shard' : 'bullet'}${m.v > 1 ? 's' : ''} per shot`;
    case 'pierce': return `Pierces ${m.v} more zombie${m.v > 1 ? 's' : ''}`;
  }
  return m.k;
}
