// ---------- Items, weapons, loot tables ----------
// Pure data, no imports. Inventory logic lives in inventory.js, searching in loot.js.

// Each weapon draws from its own reserve (player.ammo[id]). gun = barrel length scale on the player mesh.
// find = [min,max] rounds per ammo find; maxAmmo caps the reserve.
export const WEAPONS = {
  pistol:  { name:'Pistol',        ammo:'9mm rounds',   dmg:1.5, rate:0.24,  mag:12, reload:1.3, pellets:1, spread:0,    jitter:0.025, speed:46, life:0.75, pierce:0, noise:28, gun:0.75, maxAmmo:120, find:[6,14],  sound:'pistol' },
  shotgun: { name:'Shotgun',       ammo:'shells',       dmg:1,   rate:0.8,   mag:6,  reload:2.2, pellets:6, spread:0.09, jitter:0.04,  speed:40, life:0.34, pierce:0, noise:34, gun:1.6,  maxAmmo:40,  find:[3,8],   sound:'shotgun' },
  smg:     { name:'SMG',           ammo:'SMG rounds',   dmg:0.9, rate:0.085, mag:30, reload:1.8, pellets:1, spread:0,    jitter:0.07,  speed:48, life:0.6,  pierce:0, noise:30, gun:1.2,  maxAmmo:180, find:[14,28], sound:'smg' },
  rifle:   { name:'Hunting rifle', ammo:'rifle rounds', dmg:4,   rate:0.9,   mag:5,  reload:2.0, pellets:1, spread:0,    jitter:0.004, speed:70, life:1.0,  pierce:2, noise:40, gun:2.0,  maxAmmo:30,  find:[3,6],   sound:'rifle' }
};
export const FOUND_WEAPONS = ['shotgun','smg','rifle'];
// Which gun an ammo find (search or zombie drop) is for: `held` = the gun in your hands, `carried`
// = your other gun (both skip a full reserve; with one gun it gets both shares), the rest any gun.
// Fixed shares, so adding weapons doesn't dilute the ammo you actually need.
export const AMMO_ODDS = { held:0.55, carried:0.25 };

export const INV_SLOTS = 8;
export const ITEMS = {
  bandage:  { name:'Bandage',     icon:'🩹', max:5,  desc:'Stops bleeding, +10 health' },
  medkit:   { name:'Medkit',      icon:'💉', max:3,  desc:'+50 health, stops bleeding' },
  drink:    { name:'Energy drink', icon:'🥤', max:4, desc:'Refills stamina; sprinting costs 60% less for 20 s' },
  scrap:    { name:'Scrap',       icon:'🔩', max:12, desc:'Crafting material (C)' },
  molotov:  { name:'Molotov',     icon:'🍾', max:3,  desc:'Throw at the cursor: sets the area on fire' },
  pipebomb: { name:'Pipe bomb',   icon:'💣', max:3,  desc:'Throw at the cursor: beeps to lure the dead, then a blast stuns them' }
};
// Thrown with G from wherever they sit in the pack; the mouse wheel / T picks which one.
export const THROWABLES = ['molotov','pipebomb'];
export const RECIPES = [
  { id:'molotov', scrap:3, desc:'Burns everything in a small area for 6 s.' },
  { id:'pipebomb', scrap:4, desc:'Draws zombies to it for 3.5 s, then stuns everything nearby. No damage.' }
];

// Searchable containers. time = seconds holding E; noise = alert radius while searching.
// rolls = [min,max] draws from the weighted table; empty = chance of finding nothing.
// shelf/locker/desk/armory stand inside the walk-in landmarks; cruiser = a police car's trunk.
export const LOOT = {
  trunk:    { name:'car trunk',  time:1.5, noise:10, rolls:[1,2], empty:0.2,  table:[['ammo',4],['scrap',3],['drink',1],['bandage',1.5],['molotov',0.3]] },
  dumpster: { name:'dumpster',   time:1.5, noise:9,  rolls:[1,2], empty:0.25, table:[['scrap',4],['drink',2],['ammo',1.5],['bandage',1]] },
  crate:    { name:'crate',      time:1.5, noise:8,  rolls:[2,3], empty:0,    table:[['ammo',5],['scrap',4],['weapon',0.5],['molotov',0.4],['pipebomb',0.4]] },
  door:     { name:'house',      time:1.5, noise:8,  rolls:[1,2], empty:0.2,  table:[['drink',1.5],['bandage',2],['ammo',3],['scrap',1.5],['medkit',0.4]] },
  shelf:    { name:'shelf',      time:1.2, noise:6,  rolls:[1,2], empty:0.15, table:[['drink',4],['bandage',1.5],['scrap',1.5],['molotov',0.3]] },
  locker:   { name:'locker',     time:1.5, noise:8,  rolls:[1,2], empty:0.1,  table:[['ammo',6],['bandage',1.5],['pipebomb',0.5],['medkit',0.3]] },
  desk:     { name:'desk',       time:1.2, noise:5,  rolls:[1,1], empty:0.3,  table:[['ammo',3],['bandage',1],['drink',1],['scrap',1]] },
  armory:   { name:'armory',     time:2.5, noise:12 },
  cruiser:  { name:'police car', time:1.5, noise:10, rolls:[1,2], empty:0.15, table:[['ammo',6],['bandage',1],['pipebomb',0.3],['scrap',1]] }
};
// Landmarks (each city has a police station, a supermarket, a hardware store and 1-2 each of
// pharmacies and gas stations). Walk-in ones (enter) are looted from the shelves/lockers inside;
// the rest through their front door. wall/band/trim are building colours. Loot is in loot.js.
export const LANDMARKS = {
  police:      { name:'Police station', icon:'🚔', color:0x2f6fd8, css:'#2f6fd8', time:2.5, noise:12, enter:true, wall:0xc9ccd2, band:0x1d3f7a, floor:0x8a929c },
  supermarket: { name:'Supermarket',    icon:'🛒', color:0xd9822b, css:'#d9822b', time:2.5, noise:10, enter:true, wall:0xcdbf9e, band:0xc8521f, floor:0xd8d4c8 },
  pharmacy:    { name:'Pharmacy',       icon:'💊', color:0x2f9e5a, css:'#2f9e5a', time:2.5, noise:10, wall:0xd9d9d2, band:0x2f9e5a },
  hardware:    { name:'Hardware store', icon:'🔧', color:0xb8961a, css:'#b8961a', time:2.5, noise:10, wall:0x8c7a5e, band:0xd9822b },
  gas:         { name:'Gas station',    icon:'⛽', color:0xd33b2c, css:'#d33b2c', time:2.5, noise:10, wall:0xe6e3dc, band:0xd33b2c }
};
