// ---------- Constants ----------
// World units per grid tile; the map is B×B blocks of 5×5 tiles between 2-tile roads (N×N tiles).
export const TILE = 2, B = 10, N = 7*B + 4;
export const T = { ROAD:0, BUILDING:1, WALL:2, BARRICADE:3, EXIT:4, SIDEWALK:5, GRASS:6, PLAZA:7, OBSTACLE:8, CRYSTAL:9, FLOOR:10, BARS:11 };
export const walkable = t => t === 0 || t === 4 || t === 5 || t === 6 || t === 7 || t === 10;
// Bullets and sight also pass through cell bars.
export const seeThrough = t => walkable(t) || t === 11;
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
  downtown:    { name:'Downtown', note:'crowded', density:1.4, perLevel:0.18, blocks:[['towers',9],['lot',1],['park',0.7]], dumpster:[0.85,0.4], door:0.35 },
  industrial:  { name:'Industrial park', note:'busy', density:0.75, perLevel:0.1, blocks:[['warehouses',5],['yard',3],['ruins',1.5],['lot',1]], dumpster:[0.4,0], door:0.3 },
  residential: { name:'Suburbs', note:'', density:0.5, perLevel:0.08, blocks:[['houses',7],['park',2],['lot',1]], dumpster:[0.2,0], door:0.42 },
  outskirts:   { name:'Outskirts', note:'quiet', density:0.12, perLevel:0.04, blocks:[['field',5],['ruins',2],['farm',1.6],['park',1],['lot',0.6]], dumpster:[0.1,0], door:0.35 }
};
// Where districts go, rolled per city (block units). cores = downtown centres [base, perCity, max]
// (count = floor(base + perCity*(city-1) + random 0..1), capped), each `core` blocks in radius
// (+coreGrow per city) inside a ring of suburbs `ring` blocks wide (+ringGrow per city), so later
// cities sprawl. pockets = industrial areas, `pocket` blocks in radius. Cores keep `startGap` blocks
// from the start corner and `coreGap` from each other; pockets keep `pocketGap` from the start.
// The start's own blocks (bx + bz <= 1) are always outskirts.
export const LAYOUT = { cores:[1, 0.15, 3], core:[1.5, 2.3], coreGrow:0.08, ring:[1.4, 2.1], ringGrow:0.1,
  pockets:[1, 2], pocket:[1.2, 1.9], startGap:3.5, coreGap:3.5, pocketGap:2.5 };
// Residents spawn at least startGap units from the start; respawns at least respawnGap from you.
export const POP = { startGap:26, respawnGap:32 };
