// ---------- Grid queries: collision, flow field, fog of war ----------
import { TILE, N, walkable, DIRS8 } from './config.js';
import { clamp } from './utils.js';
import { world } from './state.js';
import { player } from './player.js';

// BFS distance (in tiles) from the player's tile; -1 = unreachable. Zombies descend it.
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
export function updateFlow(){
  distField.fill(-1);
  const sx = Math.floor(player.pos.x/TILE), sz = Math.floor(player.pos.z/TILE);
  if (isBlockedTile(sx,sz)) return;
  let head = 0, tail = 0; const s = sz*N+sx;
  distField[s] = 0; bfsQueue[tail++] = s;
  while (head < tail){
    const cur = bfsQueue[head++], cx = cur % N, cz = (cur - cx)/N, cd = distField[cur];
    for (let k=0;k<4;k++){
      const nx = cx + DIRS8[k][0], nz = cz + DIRS8[k][1];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz*N+nx;
      if (distField[ni] !== -1 || !walkable(world.city.grid[ni])) continue;
      distField[ni] = cd + 1; bfsQueue[tail++] = ni;
    }
  }
}
// Marks tiles within radius R as explored (minimap fog of war).
export function reveal(tx,tz,R){
  for (let dz=-R;dz<=R;dz++) for (let dx=-R;dx<=R;dx++){
    if (dx*dx+dz*dz > R*R) continue;
    const x = tx+dx, z = tz+dz;
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    if (!world.explored[z*N+x]){ world.explored[z*N+x] = 1; world.mmDirty = true; }
  }
}
