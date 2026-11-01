// ---------- Constants ----------
// World units per grid tile. A city is b×b blocks of 5×5 tiles between 2-tile roads, n = 7b + 4
// tiles across (city.b, city.n). Tile arrays are always sized for the biggest city (B blocks, N
// tiles, index z*N + x); a smaller city fills the top-left n×n and the rest is wall.
export const TILE = 2, B = 14, N = 7*B + 4;
// City size by city number: [from city, blocks], last match wins (must not exceed B).
export const CITY_BLOCKS = [[1, 10], [3, 12], [6, 14]];
export const cityBlocks = level => CITY_BLOCKS.reduce((b, [from, n]) => level >= from ? n : b, CITY_BLOCKS[0][1]);
// OBSTACLE blocks walking, sight and shots; BARS, LOW (jersey barriers, sandbags, graves), WATER and
// FENCE (fences and plank barricades, which zombies can break down: breakables.js) block walking only.
export const T = { ROAD:0, BUILDING:1, WALL:2, BARRICADE:3, EXIT:4, SIDEWALK:5, GRASS:6, PLAZA:7, OBSTACLE:8, CRYSTAL:9, FLOOR:10, BARS:11, LOW:12, WATER:13, FENCE:14 };
export const walkable = t => t === 0 || t === 4 || t === 5 || t === 6 || t === 7 || t === 10;
// Bullets and sight also pass through cell bars, low obstacles, water and fences.
export const seeThrough = t => walkable(t) || t === 11 || t === 12 || t === 13 || t === 14;
// Raised ground (hills, loading docks, terraces): city.level per tile is 0 ground, 1 ramp/stairs,
// 2 raised (RAISE units up). Anyone can step up one level (onto a ramp, off a ramp onto the top) or
// drop down any amount; nobody climbs straight from the ground onto raised tiles.
export const RAISE = 1.1;
// Breakable fences and barricades (T.FENCE, breakables.js), by style: hp, wood (molotov fire burns it;
// planks repair it), name for prompts. Zombie AI tuning for them is in AI (threats.js).
export const BREAKABLES = {
  picket: { hp:8,  wood:true, name:'picket fence' },
  rail:   { hp:9,  wood:true, name:'farm fence' },
  chain:  { hp:20, name:'chain-link fence' },
  iron:   { hp:28, name:'iron fence' },
  planks: { hp:24, wood:true, name:'barricade' }
};
// Plank barricades: repair = health a plank puts back (hold E with planks in the pack).
export const BARRICADE = { repair:12, takeDown:1.2, build:0.4 };
export const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
export const CITY_NAMES = ['Ashford','Greyhaven','Millbrook','Port Sable','Redwater','Hollow Pines','Cinder Bay','Northgate','Dunmore','Ravenfield','Saltmarsh','Kingsreach'];
export const PALETTE = [0x8a7f72,0x7b8088,0x9a8a74,0x6f7a72,0x8c6f62,0x7d7468,0x5f6670,0x86796a];
export const HOUSE_PALETTE = [0xb9a98e,0xa6b0a4,0xc2b8a3,0x9fa7b3,0xb59b84,0xa89f8a];
export const ROOF_PALETTE = [0x6b3a2e,0x4a3c34,0x3f4650,0x5a4a3a,0x7a4a32];
export const WAREHOUSE_PALETTE = [0x6c7378,0x7a7468,0x5f6b70,0x80786a];

// ---------- Districts ----------
// Every block belongs to one. density = resident zombies per block in City 1 (+ perLevel for each
// city after), ×0.75–1.25 per block; the district also sets how much loot gets built there.
// blocks = weighted block types; dumpster = [chance of one, chance of a second] per block;
// door = chance an ordinary building has a searchable door.
// name/note = shown under the city name while you're in it.
export const DISTRICTS = {
  downtown:    { name:'Downtown', note:'crowded', density:1.4, perLevel:0.18, blocks:[['towers',9],['lot',1],['park',0.5],['construction',0.7],['crater',0.25],['pond',0.2]], dumpster:[0.85,0.4], door:0.35 },
  industrial:  { name:'Industrial park', note:'busy', density:0.75, perLevel:0.1, blocks:[['warehouses',5],['yard',3],['ruins',1.5],['lot',1],['construction',1],['camp',0.3],['crater',0.35]], dumpster:[0.4,0], door:0.3 },
  residential: { name:'Suburbs', note:'', density:0.5, perLevel:0.08, blocks:[['houses',7],['park',1.4],['pond',0.8],['lot',1],['cemetery',0.35],['camp',0.2]], dumpster:[0.2,0], door:0.42 },
  outskirts:   { name:'Outskirts', note:'quiet', density:0.12, perLevel:0.04, blocks:[['field',4],['ruins',2],['farm',1.6],['park',0.6],['pond',0.5],['lot',0.6],['cemetery',0.4],['camp',0.35],['crater',0.3]], dumpster:[0.1,0], door:0.35 }
};
// Block types that hold more residents than their district's density (a cemetery is crowded).
export const BLOCK_DENSITY = { cemetery:1.8, camp:1.3, construction:1.2 };
// What happened to a city before you got there, rolled per city (weights w). It scales the damage
// passes in cityGen.js: closures = road closures / dead ends, wrecks = wrecked cars, broken = damaged
// and burnt-out buildings, kinds = weights of the closure kinds, mul = block type weight multipliers.
// name/note show in the city banner and the dev tools.
export const CONDITIONS = {
  intact:    { w:1.1, name:'Holding up', note:'still mostly standing', closures:0.8, wrecks:0.9, broken:0.6, kinds:{ barrier:3, fence:2, pileup:2, checkpoint:1, bus:1, collapse:1 }, mul:{} },
  evacuated: { w:1, name:'Evacuated', note:'checkpoints and closed roads', closures:2.2, wrecks:0.7, broken:0.8, kinds:{ barrier:3, fence:3, checkpoint:4, pileup:1, bus:0.5, collapse:0.5 }, mul:{ camp:4, cemetery:0.6 } },
  gridlock:  { w:1, name:'Gridlock', note:'everyone tried to drive out', closures:1.5, wrecks:2, broken:1, kinds:{ pileup:5, bus:3, barrier:1, checkpoint:1, fence:0.5, collapse:0.5 }, mul:{ lot:1.6 } },
  shelled:   { w:0.9, name:'Shelled', note:'the army tried to burn it out', closures:1.5, wrecks:1.2, broken:2.8, kinds:{ collapse:5, checkpoint:2, pileup:1.5, barrier:0.5, fence:0.5, bus:0.5 }, mul:{ crater:4, ruins:2.2, towers:0.8, construction:0.4 } }
};
// Road closures per 100 blocks in City 1, plus perCity for each city after (× the condition's closures).
export const CLOSURES = { base:7, perCity:0.8 };
// Where districts go, rolled per city (block units). cores = downtown centres [base, perCity, max]
// (count = floor((base + perCity*(city-1))*area + random 0..1), capped at max*area, where area =
// the city's block count / 100, so bigger cities get more of them), each `core` blocks in radius
// (+coreGrow per city) inside a ring of suburbs `ring` blocks wide (+ringGrow per city), so later
// cities sprawl. pockets = industrial areas ([min, max] × area), `pocket` blocks in radius. Cores keep `startGap` blocks
// from the start corner and `coreGap` from each other; pockets keep `pocketGap` from the start.
// The start's own blocks (bx + bz <= 1) are always outskirts.
export const LAYOUT = { cores:[1, 0.15, 3], core:[1.5, 2.3], coreGrow:0.08, ring:[1.4, 2.1], ringGrow:0.1,
  pockets:[1, 2], pocket:[1.2, 1.9], startGap:3.5, coreGap:3.5, pocketGap:2.5 };
// Residents spawn at least startGap units from the start; respawns at least respawnGap from you.
export const POP = { startGap:26, respawnGap:32 };
