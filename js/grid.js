// ---------- Grid queries: collision, flow field, fog of war ----------
import { TILE, N, T, RAISE, walkable, seeThrough, DIRS8 } from './config.js';
import { AI } from './threats.js';
import { clamp } from './utils.js';
import { world, players } from './state.js';

// Each player has its own BFS distance field p.dist (in tiles from their tile; -1 = unreachable),
// refreshed by updateFlow(). Zombies hunting a player descend that player's field.
const bfsQueue = new Int32Array(N*N);

export function isBlockedTile(tx,tz){
  if (tx < 0 || tz < 0 || tx >= N || tz >= N) return true;
  return !walkable(world.city.grid[tz*N+tx]);
}
// ---------- Raised ground ----------
// Height of the ground at world point (x,z): level/2 × RAISE on flat tiles (0 ground, 2 raised, 4 the
// second tier), a slope up to the next tier across ramps (odd levels; city.rampDir = the D4 direction you climb in).
const D4 = [[1,0],[-1,0],[0,1],[0,-1]];
export function groundAt(x, z){
  const c = world.city; if (!c || !c.level) return 0;
  const tx = Math.floor(x/TILE), tz = Math.floor(z/TILE);
  if (tx < 0 || tz < 0 || tx >= N || tz >= N) return 0;
  const l = c.level[tz*N+tx];
  if (!(l & 1)) return l*RAISE/2;
  const [dx, dz] = D4[c.rampDir[tz*N+tx]], fx = x/TILE - tx, fz = z/TILE - tz;
  return (l - 1)*RAISE/2 + RAISE*(dx > 0 ? fx : dx < 0 ? 1 - fx : dz > 0 ? fz : 1 - fz);
}
// Level (0 ground, 1 ramp, 2 raised, 3 ramp, 4 second tier) of something standing at height y.
export const levelOf = y => { const h = y/RAISE, f = Math.floor(h + 1e-6), k = h - f; return k < 0.3 ? 2*f : k > 0.7 ? 2*f + 2 : 2*f + 1; };
export const tileLevel = (tx, tz) => world.city.level ? world.city.level[tz*N+tx] : 0;
// Snaps a position's height to the ground under it (after a teleport or a spawn).
export function toGround(p){ p.y = groundAt(p.x, p.z); return p; }
// True if someone at height y can walk in a straight line from (x0,z0) to (x1,z1): nothing blocking
// on the way and no ledge to climb (fences and raised ground let sight through but not feet).
export function walkClear(x0, z0, x1, z1, y = 0){
  let lv = levelOf(y);
  const n = Math.ceil(Math.hypot(x1-x0, z1-z0)/0.5);
  for (let i=1;i<=n;i++){
    const k = i/n, tx = Math.floor((x0 + (x1-x0)*k)/TILE), tz = Math.floor((z0 + (z1-z0)*k)/TILE);
    if (isBlockedTile(tx, tz)) return false;
    const l = tileLevel(tx, tz); if (l > lv + 1) return false; lv = l;
  }
  return true;
}
// Pushes a circle at p (radius r) out of any blocked tiles, and out of raised tiles it can't step up
// onto from its height p.y; then sets p.y to the ground under it (stepping up a ramp, dropping off a ledge).
export function resolveCircle(p, r){
  const tx0 = Math.floor((p.x-r)/TILE), tx1 = Math.floor((p.x+r)/TILE), tz0 = Math.floor((p.z-r)/TILE), tz1 = Math.floor((p.z+r)/TILE);
  const L = world.city.level, lv = levelOf(p.y);
  for (let tz=tz0;tz<=tz1;tz++) for (let tx=tx0;tx<=tx1;tx++){
    if (!isBlockedTile(tx,tz) && !(L && L[tz*N+tx] > lv + 1)) continue;
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
  if (L) p.y = groundAt(p.x, p.z);
}
// Tiles bullets fly and zombies see through (open ground and cell bars).
export function isOpaqueTile(tx,tz){
  if (tx < 0 || tz < 0 || tx >= N || tz >= N) return true;
  return !seeThrough(world.city.grid[tz*N+tx]);
}
// Distance field from tile (sx,sz) into field (-1 = unreachable): how far each tile is from it on
// foot. Steps cost 1, but stepping onto a fence or barricade costs extra (it has to be broken down:
// breakCost() from its health), so a field leads through one only when walking round is longer. Edges
// follow the raised-ground rule (no climbing a ledge; dropping off one is fine). Most steps cost 1, so
// it's a BFS with the dearer steps held back in `held` until their turn (a small Dijkstra).
// A blocked start (a crate, a door) seeds its walkable neighbours instead, so noises made at
// containers can still be walked to.
const held = [];
export const breakCost = b => 1 + Math.ceil(b.hp*AI.breakCost);
function bfs(field, sx, sz){
  field.fill(-1);
  const c = world.city, grid = c.grid, L = c.level, br = world.breaks;
  let head = 0, tail = 0;
  held.length = 0;
  if (isBlockedTile(sx,sz)){
    for (let k=0;k<4;k++){
      const nx = sx + DIRS8[k][0], nz = sz + DIRS8[k][1];
      if (!isBlockedTile(nx,nz)){ field[nz*N+nx] = 1; bfsQueue[tail++] = nz*N+nx; }
    }
  } else { field[sz*N+sx] = 0; bfsQueue[tail++] = sz*N+sx; }
  let hi = -1;  // index of the cheapest held-back step (-1: none)
  const pickHeld = () => { hi = -1; for (let i=0;i<held.length;i++) if (hi < 0 || held[i][1] < held[hi][1]) hi = i; };
  for (;;){
    let cur;
    // Next: the queue's head, unless a held-back breakable is due first.
    if (hi >= 0 && (head >= tail || held[hi][1] <= field[bfsQueue[head]])){
      const [id, d] = held[hi]; held[hi] = held[held.length-1]; held.length--; pickHeld();
      if (field[id] !== -1 && field[id] <= d) continue;
      field[id] = d; cur = id;
    } else if (head < tail) cur = bfsQueue[head++];
    else break;
    const cx = cur % N, cz = (cur - cx)/N, cd = field[cur], cl = L ? L[cur] : 0;
    for (let k=0;k<4;k++){
      const nx = cx + DIRS8[k][0], nz = cz + DIRS8[k][1];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz*N+nx;
      if (field[ni] !== -1) continue;
      // Someone on ni walks to cur: they can't climb more than one level.
      if (L && cl > L[ni] + 1) continue;
      const g = grid[ni];
      if (g === T.FENCE){
        const b = br && br.get(ni); if (!b) continue;
        held.push([ni, cd + breakCost(b)]);
        if (hi < 0 || cd + breakCost(b) < held[hi][1]) hi = held.length - 1;
        continue;
      }
      if (!walkable(g)) continue;
      field[ni] = cd + 1; bfsQueue[tail++] = ni;
    }
  }
}
export function updateFlow(){ for (const p of players) if (!p.dead) bfs(p.dist, Math.floor(p.pos.x/TILE), Math.floor(p.pos.z/TILE)); }
// True if a living player can walk to tile index id (spawns only go where someone could meet them).
export function reachable(id){ for (const p of players) if (!p.dead && p.dist[id] >= 0) return true; return false; }
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
// Index into city.blocks of the block a world point belongs to (city.blockOf per tile: a block that took
// over a street owns it; other streets count toward the block south-east of them).
export function blockIndex(x, z){
  const c = world.city, tx = Math.floor(x/TILE), tz = Math.floor(z/TILE);
  if (c.blockOf && tx >= 0 && tz >= 0 && tx < N && tz < N) return c.blockOf[tz*N + tx];
  const b = c.b, f = v => Math.min(b-1, Math.max(0, Math.floor((v/TILE - 1)/7)));
  return f(z)*b + f(x);
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
// True if no opaque tile lies on the segment between two world points (sampled every ~0.6 units).
export function lineOfSight(x0, z0, x1, z1){
  const n = Math.ceil(Math.hypot(x1-x0, z1-z0)/0.6);
  for (let i=1;i<n;i++){ const k = i/n; if (isOpaqueTile(Math.floor((x0 + (x1-x0)*k)/TILE), Math.floor((z0 + (z1-z0)*k)/TILE))) return false; }
  return true;
}
