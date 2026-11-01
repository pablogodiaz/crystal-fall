// ---------- Weapon instances ----------
// A weapon in a slot or on the ground is { id, rarity, mods:[{ k, s:±1, v }], mag, uid } plus
// per-kind state: cd (Turncoat flask cooldown), idle (Arc caster recharge delay).
// Standard guns roll a rarity and one random modifier per step above Common, each good or bad;
// uniques never have modifiers. weaponStats() folds base stats, modifiers and upgrades together.
import { WEAPONS, GUNS, UNIQUES, RARITY, WMODS, WEAPON_ODDS, CRIT } from './items.js';
import { mr, mpick } from './utils.js';
import { state } from './state.js';

export const RARITIES = ['common','uncommon','rare','legendary'];
let uid = 0;
export function makeWeapon(id, rarity = 'common', mods = []){
  const u = !!WEAPONS[id].unique;
  const w = { id, rarity:u ? 'unique' : rarity, mods:u ? [] : mods, mag:0, uid:++uid, cd:0, idle:0 };
  w.mag = weaponStats(w, null).mag;
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
export function rollMods(n){
  const pool = Object.keys(WMODS), out = [];
  while (out.length < n && pool.length){
    const k = pool.splice(Math.floor(Math.random()*pool.length), 1)[0], s = Math.random() < WEAPON_ODDS.good ? 1 : -1;
    const [a, b] = WMODS[k][s > 0 ? 'good' : 'bad'];
    out.push({ k, s, v:Math.round(mr(a, b)*100)/100 });
  }
  return out;
}
// A weapon find for player p. Sometimes a unique p doesn't carry yet; otherwise `prefer` (or any standard gun).
export function rollWeapon(luck = 0, prefer, p){
  const [b, per, max] = WEAPON_ODDS.unique, own = p ? p.weapons.filter(Boolean).map(w => w.id) : [];
  const fresh = UNIQUES.filter(u => !own.includes(u));
  if (fresh.length && Math.random() < Math.min(max, b + per*(state.level - 1))*(luck ? WEAPON_ODDS.luckUnique : 1)) return makeWeapon(mpick(fresh));
  const rarity = rollRarity(luck);
  return makeWeapon(prefer || mpick(GUNS), rarity, rollMods(RARITY[rarity].mods));
}
// Effective numbers for a weapon in player p's hands (p's upgrades on top; null = no upgrades).
// Uniques only take damage (and fire-rate) upgrades.
export function weaponStats(w, p){
  const W = WEAPONS[w.id];
  const S = { dmg:W.dmg, rate:W.rate, mag:W.mag, reload:W.reload, jitter:W.jitter, spread:W.spread, life:W.life, speed:W.speed,
    noise:W.noise, pierce:W.pierce, pellets:W.pellets, kb:1, free:0, waste:0, crit:0, jam:0 };
  for (const m of w.mods){
    const sv = m.s*m.v;
    switch (m.k){
      case 'dmg': S.dmg *= 1 + sv; break;
      case 'rate': S.rate /= 1 + sv; break;
      case 'mag': { const n = Math.max(1, Math.round(W.mag*(1 + sv))); S.mag = n === W.mag ? Math.max(1, W.mag + m.s) : n; break; }
      case 'reload': S.reload *= 1 - sv; break;
      case 'acc': S.jitter *= 1 - sv; S.spread *= 1 - sv*0.6; break;
      case 'range': S.life *= 1 + sv; break;
      case 'noise': S.noise *= 1 - sv; break;
      case 'kb': S.kb *= 1 + sv; break;
      case 'thrift': if (m.s > 0) S.free = m.v; else S.waste = m.v; break;
      case 'crit': if (m.s > 0) S.crit = m.v; else S.jam = m.v; break;
    }
  }
  if (!p) return S;
  S.dmg *= p.dmgMul;
  if (S.rate) S.rate *= p.fireMul;
  if (W.kind){ if (S.reload) S.reload *= p.reloadMul; return S; }
  S.mag = Math.max(1, Math.round(S.mag*p.magMul)); S.reload *= p.reloadMul; S.pellets += p.pellets; S.pierce += p.pierce;
  return S;
}
// Damage per second while firing for player p (ignores reloads); null for uniques that don't shoot bullets.
export function weaponDps(w, p){
  if (WEAPONS[w.id].kind) return null;
  const S = weaponStats(w, p);
  return S.dmg*S.pellets*(1 + S.crit*(CRIT - 1))/S.rate;
}
// "Rare Shotgun"; commons and uniques go by their plain name.
export function weaponTitle(w){
  const n = WEAPONS[w.id].name;
  return w.rarity === 'common' || w.rarity === 'unique' ? n : `${RARITY[w.rarity].name} ${n}`;
}
const pct = v => Math.round(v*100) + '%';
export function modText(m){
  const g = m.s > 0, p = pct(m.v), sign = g ? '+' : '−';
  switch (m.k){
    case 'dmg': return `${sign}${p} damage`;
    case 'rate': return `${sign}${p} fire rate`;
    case 'mag': return `${sign}${p} magazine size`;
    case 'reload': return `${p} ${g ? 'faster' : 'slower'} reload`;
    case 'acc': return `${sign}${p} accuracy`;
    case 'range': return `${sign}${p} range`;
    case 'noise': return `${p} ${g ? 'quieter' : 'louder'}`;
    case 'kb': return `${sign}${p} knockback`;
    case 'thrift': return g ? `${p} chance a shot costs no ammo` : `${p} chance a shot wastes a round`;
    case 'crit': return g ? `${p} chance of a ×${CRIT} critical hit` : `${p} chance to jam`;
  }
  return m.k;
}
