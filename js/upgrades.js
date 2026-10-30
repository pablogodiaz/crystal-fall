// ---------- Upgrades ----------
// Offered three at a time after each city. apply() mutates the player's stats.
// Weapon modifiers (dmgMul, fireMul, magMul, reloadMul, pellets, pierce) apply to every gun.
export const UPGRADES = [
  { icon:'🔩', name:'Hollow points', desc:'+30% damage with every gun', apply:p => p.dmgMul += 0.3 },
  { icon:'⚡', name:'Hair trigger', desc:'Fire 20% faster', apply:p => p.fireMul *= 0.8 },
  { icon:'📦', name:'Extended mags', desc:'+50% magazine size', apply:p => p.magMul += 0.5 },
  { icon:'❤️', name:'Thick skin', desc:'+25 max health, healed now', apply:p => { p.maxHp += 25; p.hp += 25; } },
  { icon:'👟', name:'Running shoes', desc:'Move 12% faster', apply:p => p.speed *= 1.12 },
  { icon:'🔱', name:'Spread shot', desc:'+1 bullet per shot', apply:p => p.pellets += 1 },
  { icon:'🎯', name:'Armor piercing', desc:'Bullets pass through one more zombie', apply:p => p.pierce += 1 },
  { icon:'✋', name:'Quick hands', desc:'Reload 30% faster', apply:p => p.reloadMul *= 0.7 },
  { icon:'🩹', name:'Second wind', desc:'Slowly regenerate health while fed', apply:p => p.regen += 1 },
  { icon:'🥫', name:'Iron stomach', desc:'Hunger drains 35% slower', apply:p => p.hungerRate *= 0.65 }
];
