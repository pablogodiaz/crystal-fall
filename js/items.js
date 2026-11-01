// ---------- Items, weapons, loot tables ----------
// Pure data, no imports. Inventory logic lives in inventory.js, searching in loot.js.

// Each gun draws from its own reserve (player.ammo[id]). find = [min,max] rounds per ammo find;
// maxAmmo caps the reserve. The held model is built by gunModel() in assets.js.
// Standard guns (GUNS) roll a rarity with random modifiers when found (weapons.js). Uniques are found
// without any; only the Prototype upgrade adds them, from the unique's own `mods` list (the WMODS that mean
// something for it: `mag` = its tank/charge/battery, `rate` = charge or brew time, `range` = reach or splash).
// Uniques: kind = how it fires (combat.js/uniques.js; no kind = a regular gun, like the bow);
// desc = what its card says. Every number they use is here.
export const WEAPONS = {
  pistol:  { name:'Pistol',        ammo:'9mm rounds',   dmg:1.5, rate:0.24,  mag:12, reload:1.3, pellets:1, spread:0,    jitter:0.025, speed:46, life:0.75, pierce:0, noise:28, maxAmmo:120, find:[6,14],  sound:'pistol' },
  shotgun: { name:'Shotgun',       ammo:'shells',       dmg:1,   rate:0.8,   mag:6,  reload:2.2, pellets:6, spread:0.09, jitter:0.04,  speed:40, life:0.34, pierce:0, noise:34, maxAmmo:40,  find:[3,8],   sound:'shotgun' },
  smg:     { name:'SMG',           ammo:'SMG rounds',   dmg:0.9, rate:0.085, mag:30, reload:1.8, pellets:1, spread:0,    jitter:0.07,  speed:48, life:0.6,  pierce:0, noise:30, maxAmmo:180, find:[14,28], sound:'smg' },
  rifle:   { name:'Hunting rifle', ammo:'rifle rounds', dmg:4,   rate:0.9,   mag:5,  reload:2.0, pellets:1, spread:0,    jitter:0.004, speed:70, life:1.0,  pierce:2, noise:40, maxAmmo:30,  find:[3,6],   sound:'rifle' },
  // Uniques
  // Bow: a gun whose arrows (65% of them, `keep`) stay where they stop and can be picked back up. Nearly silent.
  bow:     { name:'Compound bow',  ammo:'arrows', unique:true, mods:['dmg','rate','reload','acc','range','noise','kb','thrift','crit','pellets','pierce'], arrow:true, keep:0.65, dmg:5, rate:0.3, mag:1, reload:0.5, pellets:1, spread:0.08, jitter:0.006, speed:34, life:0.95, pierce:1, noise:3, maxAmmo:24, find:[2,4], start:12, sound:'bow',
             desc:'Almost silent. Arrows pierce one zombie and can be picked back up where they land' },
  // Flamethrower: hold to spray a cone (range, ±cone rad) for dps (scaled by city like molotovs); everything hit
  // burns for burn s at burnDps. mag = fuel, use = fuel per second. Refuels at gas station pumps, once per station.
  flamer:  { name:'Flamethrower',  ammo:'fuel', unique:true, mods:['dmg','mag','range','noise'], kind:'flame', mag:100, use:9, dmg:6, range:6.5, cone:0.32, burn:3, burnDps:1.2, noise:20,
             desc:'Hold to spray fire; anything it touches keeps burning. Fuel only refills at gas station pumps, once per station' },
  // Turncoat flask: thrown at the cursor (like a molotov), zombies within radius turn on their own kind for
  // turn s; then it brews a new dose for cooldown s. Bites deal bite × their damage (scaled by city).
  potion:  { name:'Turncoat flask', ammo:'doses', unique:true, mods:['rate','range','noise'], kind:'potion', mag:1, cooldown:60, radius:3.5, turn:16, bite:0.14, noise:12,
             desc:'Throw it: zombies in the splash turn on their own kind for 16 s. Brews a new dose every minute' },
  // Arc caster: a bolt to the nearest zombie in front (range, ±cone) that jumps to up to `chain` more within
  // `jump` of each other, each jump doing `fall` of the last; stuns. mag = charge, cost per shot, regen/s after regenDelay s.
  tesla:   { name:'Arc caster',    ammo:'charge', unique:true, mods:['dmg','rate','mag','range','noise'], kind:'arc', mag:100, cost:20, rate:0.42, regen:14, regenDelay:1.2, dmg:2.4, range:10, cone:0.5, chain:4, jump:4.5, fall:0.8, stun:0.4, noise:16,
             desc:'Lightning that jumps between up to 5 zombies and stuns them. Recharges by itself' },
  // Gravity well launcher: an orb flies to the cursor (like a throw, max 13 units) at `speed` and opens a well
  // for `time` s that drags zombies within radius toward its middle at up to `pull` u/s (they can't act),
  // then pops, stunning them for `stun` s. No damage. mag = charges, all refilled at the start of every city.
  gravity: { name:'Gravity well launcher', ammo:'wells', unique:true, mods:['mag','noise'], kind:'grav', mag:3, speed:12, radius:7, time:4, pull:6, stun:1, noise:14,
             desc:'Fires a slow orb that opens a gravity well, dragging every zombie nearby into a tight knot for 4 s. Three wells, refilled each city' },
  // Railgun: hold to charge for `charge` s, release to fire a beam that hits everything in a line out to range,
  // through one wall (not two). Releasing early cancels. One slug per shot, reloaded from the reserve.
  railgun: { name:'Railgun',       ammo:'slugs', unique:true, mods:['dmg','rate','reload','range','noise','kb'], kind:'rail', mag:1, reload:1.4, charge:1.1, dmg:14, range:45, kb:4, noise:55, maxAmmo:12, find:[1,2], start:6,
             desc:'Hold to charge, release to fire a beam through every zombie in a line, and through one wall. Deafening' },
  // Cryo sprayer: hold to spray frost in a cone (range, ±cone); each zombie in it chills by `chill`/s (slower by up
  // to slow) and freezes solid at 1 for `freeze` s: frozen zombies can't act and shatter at the next hit
  // (fire thaws them). mag = coolant (use per s), reloaded from canisters found like ammo.
  cryo:    { name:'Cryo sprayer',  ammo:'coolant', unique:true, mods:['mag','reload','range','noise'], kind:'cryo', mag:100, use:10, reload:1.6, range:6, cone:0.36, chill:1.7, thaw:0.35, slow:0.7, freeze:4, noise:12,
             maxAmmo:200, find:[12,22], start:100,
             desc:'Hold to spray frost: zombies slow down, then freeze solid. Any hit shatters a frozen one, even a brute' },
  // Crystal shard: each shot (one charge) fans `pellets` violet shards `spread` rad apart that ricochet off walls
  // `bounce` times and pierce `pierce` zombies. mag = charges, only recharged (+refill, up to mag) when you
  // break a city's Crystal.
  shard:   { name:'Crystal shard', ammo:'shards', unique:true, mods:['dmg','rate','mag','acc','range','noise','pellets','pierce'], kind:'shard', mag:24, refill:12, dmg:3, pellets:3, spread:0.09, rate:0.3, speed:34, life:1.6, pierce:5, bounce:3, jitter:0.01, noise:14,
             desc:'Fans out three crystal splinters that pierce through crowds and ricochet off walls. Only recharges when you break a city’s Crystal' },
  // Guardian drone: click to launch or dock it. Flying, it circles you and shoots the nearest zombie it can see
  // within range every `rate` s, whatever you're holding. mag = battery: drains `drain`/s flying (40 s from full),
  // recharges `recharge`/s docked (about 2 min to full); it docks itself when flat and needs `launch` to take off.
  drone:   { name:'Guardian drone', ammo:'battery', unique:true, mods:['dmg','rate','mag','range','noise'], kind:'drone', mag:100, drain:2.5, recharge:0.8, launch:25, dmg:1.2, rate:0.45, range:11, speed:44, orbit:2.2, noise:12,
             desc:'Click to launch: it circles you and shoots on its own, even while you hold another weapon. Battery recharges while docked' }
};
export const GUNS = ['pistol','shotgun','smg','rifle'];
export const UNIQUES = ['bow','flamer','potion','tesla','gravity','railgun','cryo','shard','drone'];
// Which gun an ammo find (search or zombie drop) is for: `held` = the gun in your hands, `carried`
// = your other gun (both skip a full reserve and guns without ammo; with one gun it gets both shares),
// the rest any standard gun. Fixed shares, so adding weapons doesn't dilute the ammo you actually need.
// unique = chance a find meant for a unique's ammo (arrows, slugs, coolant) really is; otherwise it goes to
// a standard gun you carry (or any). Keeps unique ammo rare even while you hold one.
export const AMMO_ODDS = { held:0.55, carried:0.25, unique:0.25 };

// ---------- Weapon rarity ----------
// A found standard gun rolls a rarity, then `mods` random modifiers (all different). Each modifier is
// good or bad at random (WEAPON_ODDS.good), so a Legendary can roll worse than an Uncommon.
// w = [weight in City 1, change per city, floor/cap]; luck (armories, military crates) counts as extra cities.
// Unique (WEAPON_ODDS.unique = [base, perCity, max], ×luckUnique from lucky sources) replaces the gun with a
// unique you don't carry yet. css = colour token in style.css, hex = the in-world glow.
export const RARITY = {
  common:    { name:'Common',    mods:0, w:[55,-3,20], hex:0xb9b6ae },
  uncommon:  { name:'Uncommon',  mods:1, w:[28,0,28],  hex:0x4ade80 },
  rare:      { name:'Rare',      mods:2, w:[12,1.5,30], hex:0x4aa3ff },
  legendary: { name:'Legendary', mods:3, w:[5,1,16],   hex:0xff9a2a },
  unique:    { name:'Unique',    mods:0, hex:0xff5fd2 }
};
export const WEAPON_ODDS = { unique:[0.04,0.006,0.1], luckUnique:2, good:0.5 };
// Weapon modifiers: [min,max] strength when it rolls good / bad. Applied in weaponStats(), worded in
// modText() (weapons.js). thrift: good = chance a shot is free, bad = chance it burns an extra round.
// crit: good = chance of a ×CRIT hit, bad = chance to jam (scaled down for fast-firing guns).
// w = how often it rolls (default 1); no `bad` = always good; int = whole numbers (extra bullets / zombies pierced).
export const WMODS = {
  dmg:    { good:[0.12,0.35], bad:[0.1,0.3] },
  rate:   { good:[0.12,0.3],  bad:[0.1,0.25] },
  mag:    { good:[0.25,0.6],  bad:[0.2,0.4] },
  reload: { good:[0.15,0.35], bad:[0.15,0.4] },
  acc:    { good:[0.3,0.6],   bad:[0.4,1] },
  range:  { good:[0.2,0.45],  bad:[0.2,0.35] },
  noise:  { good:[0.25,0.5],  bad:[0.2,0.5] },
  kb:     { good:[0.5,1],     bad:[0.3,0.6] },
  thrift: { good:[0.15,0.35], bad:[0.1,0.25] },
  crit:   { good:[0.08,0.18], bad:[0.05,0.12] },
  pellets:{ good:[1,1.7], int:true, w:0.5 },
  pierce: { good:[1,2.4], int:true, w:0.3 }
};
// Special modifiers: an effect only one unique can have (`on`), rolled into its pool alongside its stat kinds
// (Prototype, or Gunsmith / Tinker on that unique). Always a boon, with no strength; ✦ on the weapon card,
// and Transplant never moves them. Damage numbers grow with the city like fire's.
export const SPECIALS = {
  firearrow:  { on:'bow',     name:'Fire arrows',       desc:'Arrows set what they hit on fire' },
  retriever:  { on:'bow',     name:'Retriever',         desc:'Every arrow that lands can be picked back up' },
  napalm:     { on:'flamer',  name:'Napalm',            desc:'Zombies that die burning leave a patch of fire behind', time:3 },
  sticky:     { on:'flamer',  name:'Sticky fuel',       desc:'What it sets alight burns three times as long', mul:3 },
  contagion:  { on:'potion',  name:'Contagion',         desc:'Zombies the turned ones bite turn too, for 8 s', turn:8 },
  poison:     { on:'potion',  name:'Poisoned brew',     desc:'When the turn wears off, they drop dead' },
  capacitor:  { on:'tesla',   name:'Capacitor',         desc:'Every kill gives back the charge of one shot' },
  supercool:  { on:'tesla',   name:'Supercooled',       desc:'Bolts chill what they hit: zap a zombie enough and it freezes solid', chill:0.4 },
  singularity:{ on:'gravity', name:'Singularity',       desc:'The well crushes what it holds', dps:2 },
  implosion:  { on:'gravity', name:'Implosion',         desc:'The well collapses with a blast that hurts everything in it', dmg:6 },
  phase:      { on:'railgun', name:'Phase beam',        desc:'The beam goes through every wall' },
  concussive: { on:'railgun', name:'Concussive',        desc:'Everything the beam hits is stunned for 1.5 s', stun:1.5 },
  shrapnel:   { on:'cryo',    name:'Shrapnel ice',      desc:'Zombies it froze burst when shattered, hurting the ones around them', dmg:4, r:3 },
  frostbite:  { on:'cryo',    name:'Frostbite',         desc:'The frost hurts too', dps:2.5 },
  splinter:   { on:'shard',   name:'Splinter',          desc:'A shard that kills splits into two more' },
  leech:      { on:'shard',   name:'Crystal leech',     desc:'Kills have a 25% chance to grow a shard back', odds:0.25 },
  medic:      { on:'drone',   name:'Medic drone',       desc:'Heals you 1 health a second while it flies', hps:1 },
  incendiary: { on:'drone',   name:'Incendiary rounds', desc:'Its shots set zombies on fire' }
};
export const SPECIAL_W = 0.8;  // roll weight of each special, next to the stat kinds' (WMODS[].w, default 1)
export const CRIT = 2.5;

export const INV_SLOTS = 8;
export const ITEMS = {
  bandage:  { name:'Bandage',     icon:'🩹', max:5,  desc:'Stops bleeding, +10 health' },
  medkit:   { name:'Medkit',      icon:'💉', max:3,  desc:'+50 health, stops bleeding' },
  drink:    { name:'Energy drink', icon:'🥤', max:4, desc:'Refills stamina; sprinting costs 60% less for 20 s' },
  scrap:    { name:'Scrap',       icon:'🔩', max:12, desc:'Crafting material (C)' },
  molotov:  { name:'Molotov',     icon:'🍾', max:3,  desc:'Throw at the cursor: sets the area on fire' },
  pipebomb: { name:'Pipe bomb',   icon:'💣', max:3,  desc:'Throw at the cursor: beeps to lure the dead, then a blast stuns them' },
  planks:   { name:'Planks',      icon:'🪵', max:8,  desc:'Crafting material (C); hold E at a damaged barricade or wooden fence to repair it' },
  barricade:{ name:'Barricade',   icon:'🚧', max:3,  desc:'Use to board up the tile in front of you. Zombies have to break it down' }
};
// Thrown with G from wherever they sit in the pack; the mouse wheel / T picks which one.
export const THROWABLES = ['molotov','pipebomb'];
// cost = materials (item id -> count).
export const RECIPES = [
  { id:'molotov', cost:{ scrap:3 }, desc:'Burns everything in a small area for 6 s.' },
  { id:'pipebomb', cost:{ scrap:4 }, desc:'Draws zombies to it for 3.5 s, then stuns everything nearby. No damage.' },
  { id:'barricade', cost:{ planks:2, scrap:1 }, desc:'Boards up a tile in front of you. Zombies can see and get shot through it, but must break it down to pass.' }
];

// Searchable containers. time = seconds holding E; noise = alert radius while searching.
// rolls = [min,max] draws from the weighted table; empty = chance of finding nothing.
// luck = better weapon rarity odds (extra cities, see RARITY). The gun shop gets LUCK_SHOP.
// shelf/locker/desk/armory/medcab stand inside the walk-in landmarks, milcrate at the army outpost;
// cruiser/ambulance/humvee = the trunks of landmark vehicles.
export const LOOT = {
  trunk:    { name:'car trunk',  time:1.5, noise:10, rolls:[1,2], empty:0.2,  table:[['ammo',4],['scrap',3],['drink',1],['bandage',1.5],['molotov',0.3],['weapon',0.25]] },
  dumpster: { name:'dumpster',   time:1.5, noise:9,  rolls:[1,2], empty:0.25, table:[['scrap',4],['drink',2],['ammo',1.5],['bandage',1],['planks',1.2]] },
  crate:    { name:'crate',      time:1.5, noise:8,  rolls:[2,3], empty:0,    table:[['ammo',5],['scrap',4],['weapon',0.8],['molotov',0.4],['pipebomb',0.4],['planks',1.5]] },
  door:     { name:'house',      time:1.5, noise:8,  rolls:[1,2], empty:0.2,  table:[['drink',1.5],['bandage',2],['ammo',3],['scrap',1.5],['medkit',0.4],['weapon',0.15],['planks',1.2]] },
  lumber:   { name:'lumber pile', time:1.5, noise:8, rolls:[1,1], empty:0,    table:[['planks',1]] },
  shelf:    { name:'shelf',      time:1.2, noise:6,  rolls:[1,2], empty:0.15, table:[['drink',4],['bandage',1.5],['scrap',1.5],['molotov',0.3]] },
  locker:   { name:'locker',     time:1.5, noise:8,  rolls:[1,2], empty:0.1,  luck:1, table:[['ammo',6],['bandage',1.5],['pipebomb',0.5],['medkit',0.3],['weapon',0.6]] },
  desk:     { name:'desk',       time:1.2, noise:5,  rolls:[1,1], empty:0.3,  table:[['ammo',3],['bandage',1],['drink',1],['scrap',1]] },
  armory:   { name:'armory',     time:2.5, noise:12, luck:4 },
  cruiser:  { name:'police car', time:1.5, noise:10, rolls:[1,2], empty:0.15, luck:1, table:[['ammo',6],['bandage',1],['pipebomb',0.3],['scrap',1],['weapon',0.4]] },
  medcab:   { name:'medicine cabinet', time:1.5, noise:6, rolls:[1,2], empty:0.15, table:[['bandage',4],['medkit',1.5],['drink',0.6]] },
  ambulance:{ name:'ambulance',  time:1.5, noise:10, rolls:[1,2], empty:0.1,  table:[['bandage',3],['medkit',1.2],['drink',1]] },
  milcrate: { name:'military crate', time:2,  noise:10, rolls:[2,3], empty:0, luck:3, table:[['ammo',7],['pipebomb',1],['weapon',1],['molotov',0.4],['medkit',0.4]] },
  humvee:   { name:'army truck', time:1.5, noise:10, rolls:[1,2], empty:0.1,  luck:2, table:[['ammo',6],['pipebomb',0.8],['bandage',1],['scrap',1.5],['weapon',0.6]] }
};
// Landmarks. Every city has a police station, a supermarket and a hardware store, plus 1-2 each of
// pharmacies and gas stations; from = the city where a kind first appears (with a "New landmark"
// banner, tip). Walk-in ones (enter) are looted from the shelves/cabinets inside, open ones (open)
// from the crates in their yard, the rest through their front door. wall/band/floor are building
// colours (checker = tiled floor, grille = bars over the windows). Loot is in loot.js.
export const LUCK_SHOP = 4;
export const LANDMARKS = {
  police:      { name:'Police station', icon:'🚔', color:0x2f6fd8, css:'#2f6fd8', time:2.5, noise:12, from:1, enter:true, wall:0xc9ccd2, band:0x1d3f7a, floor:0x8a929c },
  supermarket: { name:'Supermarket',    icon:'🛒', color:0xd9822b, css:'#d9822b', time:2.5, noise:10, from:1, enter:true, wall:0xcdbf9e, band:0xc8521f, floor:0xd8d4c8, checker:true },
  pharmacy:    { name:'Pharmacy',       icon:'💊', color:0x2f9e5a, css:'#2f9e5a', time:2.5, noise:10, from:1, wall:0xd9d9d2, band:0x2f9e5a },
  hardware:    { name:'Hardware store', icon:'🔧', color:0xb8961a, css:'#b8961a', time:2.5, noise:10, from:1, wall:0x8c7a5e, band:0xd9822b },
  gas:         { name:'Gas station',    icon:'⛽', color:0xd33b2c, css:'#d33b2c', time:2.5, noise:10, from:1, wall:0xe6e3dc, band:0xd33b2c },
  hospital:    { name:'Hospital',       icon:'🏥', color:0xc8102e, css:'#c8102e', time:2.5, noise:10, from:3, enter:true, wall:0xe8ecef, band:0xc8102e, floor:0xb9c8cf,
                 tip:'Medicine cabinets and ambulances full of supplies. The patients never left' },
  gunshop:     { name:'Gun shop',       icon:'🎯', color:0x8a1c1c, css:'#8a1c1c', time:2.5, noise:12, from:4, wall:0x3d3b3a, band:0x8a1c1c, grille:true,
                 tip:'Barred windows, a counter full of ammo, maybe a gun' },
  outpost:     { name:'Army outpost',   icon:'🪖', color:0x5b6b2e, css:'#5b6b2e', time:2.5, noise:12, from:6, open:true,
                 tip:'Military crates behind sandbags. The soldiers who held it are still on guard' }
};
