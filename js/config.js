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
// Every block belongs to one. density weights both the zombies living there (resident spawns
// are picked with probability = density of the tile) and how much loot it's built with.
// blocks = weighted block types; dumpster = [chance of one, chance of a second] per block;
// door = chance an ordinary building has a searchable door.
// name/note = shown under the city name while you're in it.
export const DISTRICTS = {
  downtown:    { name:'Downtown', note:'crowded', density:1,    blocks:[['towers',9],['lot',1],['park',0.7]], dumpster:[0.85,0.4], door:0.35 },
  industrial:  { name:'Industrial park', note:'busy', density:0.55, blocks:[['warehouses',5],['yard',3],['ruins',1.5],['lot',1]], dumpster:[0.4,0], door:0.3 },
  residential: { name:'Suburbs', note:'', density:0.4,  blocks:[['houses',7],['park',2],['lot',1]], dumpster:[0.2,0], door:0.42 },
  outskirts:   { name:'Outskirts', note:'quiet', density:0.1,  blocks:[['field',5],['ruins',2],['farm',1.6],['park',1],['lot',0.6]], dumpster:[0.1,0], door:0.35 }
};
// Resident zombies per city (base + perLevel*city), spawned no closer than startGap to the start.
export const POP = { base:40, perLevel:9, startGap:26 };
