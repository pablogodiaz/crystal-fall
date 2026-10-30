// ---------- Upgrades ----------
// Offered three at a time after each city. apply() mutates the player's stats.
export const UPGRADES = [
  { icon:'🔩', name:'Hollow points', desc:'+1 damage per bullet', apply:p => p.damage += 1 },
  { icon:'⚡', name:'Hair trigger', desc:'Fire 20% faster', apply:p => p.fireRate *= 0.8 },
  { icon:'📦', name:'Extended mag', desc:'+6 rounds per magazine', apply:p => p.magSize += 6 },
  { icon:'❤️', name:'Thick skin', desc:'+25 max health, healed now', apply:p => { p.maxHp += 25; p.hp += 25; } },
  { icon:'👟', name:'Running shoes', desc:'Move 12% faster', apply:p => p.speed *= 1.12 },
  { icon:'🔱', name:'Spread shot', desc:'+1 bullet per shot', apply:p => p.pellets += 1 },
  { icon:'🎯', name:'Armor piercing', desc:'Bullets pass through one more zombie', apply:p => p.pierce += 1 },
  { icon:'✋', name:'Quick hands', desc:'Reload 30% faster', apply:p => p.reloadTime *= 0.7 },
  { icon:'🩹', name:'Second wind', desc:'Slowly regenerate health', apply:p => p.regen += 1 }
];
