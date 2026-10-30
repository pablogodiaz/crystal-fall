// ---------- Constants ----------
// World units per grid tile, and grid size (N x N tiles).
export const TILE = 2, N = 46;
export const T = { ROAD:0, BUILDING:1, WALL:2, BARRICADE:3, EXIT:4, SIDEWALK:5, GRASS:6, PLAZA:7, OBSTACLE:8, CRYSTAL:9 };
export const walkable = t => t === 0 || t === 4 || t === 5 || t === 6 || t === 7;
export const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
export const CITY_NAMES = ['Ashford','Greyhaven','Millbrook','Port Sable','Redwater','Hollow Pines','Cinder Bay','Northgate','Dunmore','Ravenfield','Saltmarsh','Kingsreach'];
export const PALETTE = [0x8a7f72,0x7b8088,0x9a8a74,0x6f7a72,0x8c6f62,0x7d7468,0x5f6670,0x86796a];
