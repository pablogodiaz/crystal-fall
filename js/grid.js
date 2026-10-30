// ---------- Grid queries: collision, flow field, fog of war ----------
import { TILE, N, walkable, seeThrough, DIRS8 } from './config.js';
import { clamp } from './utils.js';
import { world } from './state.js';
import { player } from './player.js';

// BFS distance (in tiles) from the player's tile; -1 = unreachable. Zombies hunting you descend it.
export const distField = new Int16Array(N*N);
const bfsQueue = new Int32Array(N*N);

export function isBlockedTile(tx,tz){
  if (tx < 0 || tz < 0 || tx >= N || tz >= N) return true;
  return !walkable(world.city.grid[tz*N+tx]);
}
// Pushes a circle at p (radius r) out of any blocked tiles.
export function resolveCircle(p, r){
  const tx0 = Math.floor((p.x-r)/TILE), tx1 = Math.floor((p.x+r)/TILE), tz0 = Math.floor((p.z-r)/TILE), tz1 = Math.floor((p.z+r)/TILE);
  for (let tz=tz0;tz<=tz1;tz++) for (let tx=tx0;tx<=tx1;tx++){
    if (!isBlockedTile(tx,tz)) continue;
    const minX = tx*TILE, maxX = minX+TILE, minZ = tz*TILE, maxZ = minZ+TILE;
    const cx = clamp(p.x,minX,maxX), cz = clamp(p.z,minZ,maxZ);
    const dx = p.x-cx, dz = p.z-cz, d2 = dx*dx+dz*dz;
    if (d2 >= r*r) continue;
    if (d2 > 1e-8){ const d = Math.sqrt(d2), push = (r-d)/d; p.x += dx*push; p.z += dz*push; }
    else {
      const l = p.x-minX, rr = maxX-p.x, t = p.z-minZ, b = maxZ-p.z, m = Math.min(l,rr,t,b);
      if (m === l) p.x = minX - r; else if (m === rr) p.x = maxX + r; else if (m === t) p.z = minZ - r; else p.z = maxZ + r;
    }
  }
}
// Tiles bullets fly and zombies see through (open ground and cell bars).
export function isOpaqueTile(tx,tz){
  if (tx < 0 || tz < 0 || tx >= N || tz >= N) return true;
  return !seeThrough(world.city.grid[tz*N+tx]);
}
// BFS from tile (sx,sz) into field (-1 = unreachable). A blocked start (a crate, a door) seeds
// its walkable neighbours instead, so noises made at containers can still be walked to.
function bfs(field, sx, sz){
  field.fill(-1);
  const grid = world.city.grid;
  let head = 0, tail = 0;
  if (isBlockedTile(sx,sz)){
    for (let k=0;k<4;k++){
      const nx = sx + DIRS8[k][0], nz = sz + DIRS8[k][1];
      if (!isBlockedTile(nx,nz)){ field[nz*N+nx] = 1; bfsQueue[tail++] = nz*N+nx; }
    }
  } else { field[sz*N+sx] = 0; bfsQueue[tail++] = sz*N+sx; }
  while (head < tail){
    const cur = bfsQueue[head++], cx = cur % N, cz = (cur - cx)/N, cd = field[cur];
    for (let k=0;k<4;k++){
      const nx = cx + DIRS8[k][0], nz = cz + DIRS8[k][1];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz*N+nx;
      if (field[ni] !== -1 || !walkable(grid[ni])) continue;
      field[ni] = cd + 1; bfsQueue[tail++] = ni;
    }
  }
}
export function updateFlow(){ bfs(distField, Math.floor(player.pos.x/TILE), Math.floor(player.pos.z/TILE)); }
// Flow fields toward other tiles (a noise, where a zombie lost you, its home), shared by every
// zombie headed to the same tile. Least recently used ones are dropped; callers keep a reference,
// so a dropped field is never reused for another tile. Cleared for every new city / grid change.
const flowCache = new Map();
export function flowTo(tx, tz){
  const key = tz*N + tx;
  let f = flowCache.get(key);
  if (f){ flowCache.delete(key); flowCache.set(key, f); return f; }
  f = new Int16Array(N*N); bfs(f, tx, tz);
  flowCache.set(key, f);
  if (flowCache.size > 32) flowCache.delete(flowCache.keys().next().value);
  return f;
}
export function clearFlowCache(){ flowCache.clear(); }
// Marks tiles within radius R as explored (minimap fog of war).
export function reveal(tx,tz,R){
  for (let dz=-R;dz<=R;dz++) for (let dx=-R;dx<=R;dx++){
    if (dx*dx+dz*dz > R*R) continue;
    const x = tx+dx, z = tz+dz;
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    if (!world.explored[z*N+x]){ world.explored[z*N+x] = 1; world.mmDirty = true; }
  }
}
// True if no opaque tile lies on the segment between two world points (sampled every ~0.6 units).
export function lineOfSight(x0, z0, x1, z1){
  const n = Math.ceil(Math.hypot(x1-x0, z1-z0)/0.6);
  for (let i=1;i<n;i++){ const k = i/n; if (isOpaqueTile(Math.floor((x0 + (x1-x0)*k)/TILE), Math.floor((z0 + (z1-z0)*k)/TILE))) return false; }
  return true;
}
