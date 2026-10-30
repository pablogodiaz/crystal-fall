// ---------- City generation ----------
// Pure data: builds the tile grid and prop lists from a seed. No Three.js here.
import { N, T, CITY_NAMES, PALETTE } from './config.js';
import { rng, seedRng, rand, randi, pick } from './utils.js';

function splitLots(x,z,w,d,out,depth){
  const area = w*d;
  if (depth > 3 || area <= 4 || (area <= 10 && rng() < 0.5) || (w < 4 && d < 4 && rng() < 0.6)) { out.push({x,z,w,d}); return; }
  if (w >= d){
    if (w < 4) { out.push({x,z,w,d}); return; }
    const cut = randi(2, w-2), alley = w >= 5 && rng() < 0.35;
    splitLots(x,z,cut,d,out,depth+1);
    const s = cut + (alley?1:0);
    if (w - s >= 1) splitLots(x+s,z,w-s,d,out,depth+1);
  } else {
    if (d < 4) { out.push({x,z,w,d}); return; }
    const cut = randi(2, d-2), alley = d >= 5 && rng() < 0.35;
    splitLots(x,z,w,cut,out,depth+1);
    const s = cut + (alley?1:0);
    if (d - s >= 1) splitLots(x,z+s,w,d-s,out,depth+1);
  }
}

export function generateCity(level, seed){
  seedRng(seed);
  const grid = new Uint8Array(N*N).fill(T.ROAD);
  const I = (x,z) => z*N + x;
  for (let i=0;i<N;i++){ grid[I(i,0)] = grid[I(i,N-1)] = grid[I(0,i)] = grid[I(N-1,i)] = T.WALL; }
  const blocks = [];
  for (let bz=0;bz<6;bz++) for (let bx=0;bx<6;bx++) blocks.push({ bx, bz, x0:3+7*bx, z0:3+7*bz, type:null });
  const cb = pick(blocks.filter(b => b.bx + b.bz >= 7));
  cb.type = 'plaza';
  const exitZ = 1 + 7*randi(1,5);
  grid[I(N-1,exitZ)] = T.BARRICADE; grid[I(N-1,exitZ+1)] = T.BARRICADE;

  const buildings = [], trees = [], cars = [], rubble = [], pillars = [];
  for (const b of blocks){
    if (!b.type){ const r = rng(); b.type = r < 0.56 ? 'buildings' : r < 0.72 ? 'park' : r < 0.86 ? 'lot' : 'ruins'; }
    const { x0, z0 } = b;
    const fill = t => { for (let z=z0;z<z0+5;z++) for (let x=x0;x<x0+5;x++) grid[I(x,z)] = t; };
    if (b.type === 'buildings' || b.type === 'ruins'){
      fill(T.SIDEWALK);
      const lots = []; splitLots(x0,z0,5,5,lots,0);
      const ruined = b.type === 'ruins';
      for (const L of lots){
        if (rng() < 0.08) continue;
        if (ruined && rng() < 0.35){
          const rx = L.x + Math.floor(rng()*L.w), rz = L.z + Math.floor(rng()*L.d);
          grid[I(rx,rz)] = T.OBSTACLE; rubble.push({ x:rx, z:rz }); continue;
        }
        for (let z=L.z;z<L.z+L.d;z++) for (let x=L.x;x<L.x+L.w;x++) grid[I(x,z)] = T.BUILDING;
        const h = ruined ? rand(1.2,3) : rand(3,6) + rng()*rng()*9;
        buildings.push({ x:L.x, z:L.z, w:L.w, d:L.d, h, color:pick(PALETTE), ruined, win:Math.floor(rng()*3), ac:rng() < 0.5 });
      }
    } else if (b.type === 'park'){
      fill(T.GRASS);
      const n = randi(3,6);
      for (let i=0;i<n;i++){
        const x = x0 + randi(0,4), z = z0 + randi(0,4);
        if (grid[I(x,z)] !== T.GRASS) continue;
        grid[I(x,z)] = T.OBSTACLE; trees.push({ x, z, s:rand(0.8,1.3), m:Math.floor(rng()*3) });
      }
    } else if (b.type === 'lot'){
      fill(T.SIDEWALK);
      const n = randi(2,5);
      for (let i=0;i<n;i++){
        const x = x0 + randi(0,4), z = z0 + randi(0,4);
        if (grid[I(x,z)] !== T.SIDEWALK) continue;
        grid[I(x,z)] = T.OBSTACLE; cars.push({ x, z, rot:(rng()<0.5?0:Math.PI/2) + rand(-0.15,0.15), color:pick([0x6b2b2b,0x2b4a6b,0x9a9a92,0x3a3f45,0x6b5a2b,0x2f5a3c]) });
      }
    } else {
      fill(T.PLAZA);
      grid[I(x0+2,z0+2)] = T.CRYSTAL;
      for (const [px,pz] of [[0,0],[4,0],[0,4],[4,4]]){ grid[I(x0+px,z0+pz)] = T.OBSTACLE; pillars.push({ x:x0+px, z:z0+pz, h:rand(1.4,3.6) }); }
    }
  }
  // Wrecked cars on roads, never blocking both lanes
  for (let z=1;z<N-1;z++) for (let x=1;x<N-1;x++){
    if (grid[I(x,z)] !== T.ROAD) continue;
    const rx = (x-1)%7 < 2, rz = (z-1)%7 < 2;
    if (rx && rz) continue;
    if (x < 8 && z < 8) continue;
    if (x > N-6 && Math.abs(z - exitZ) < 3) continue;
    if (rng() > 0.035) continue;
    if (rz){
      const partner = ((z-1)%7 === 0) ? z+1 : z-1;
      let ok = true; for (let dx=-1;dx<=1;dx++) if (grid[I(x+dx,partner)] !== T.ROAD) ok = false;
      if (!ok) continue;
      grid[I(x,z)] = T.OBSTACLE; cars.push({ x, z, rot:(rng()<0.5?0:Math.PI) + rand(-0.5,0.5), color:pick([0x4a3a33,0x3a3f45,0x5b4636,0x444038]), wreck:true });
    } else {
      const partner = ((x-1)%7 === 0) ? x+1 : x-1;
      let ok = true; for (let dz=-1;dz<=1;dz++) if (grid[I(partner,z+dz)] !== T.ROAD) ok = false;
      if (!ok) continue;
      grid[I(x,z)] = T.OBSTACLE; cars.push({ x, z, rot:Math.PI/2 + (rng()<0.5?0:Math.PI) + rand(-0.5,0.5), color:pick([0x4a3a33,0x3a3f45,0x5b4636,0x444038]), wreck:true });
    }
  }
  return { grid, blocks, buildings, trees, cars, rubble, pillars, crystalTile:{ x:cb.x0+2, z:cb.z0+2 }, exitZ, start:{ x:2, z:2 }, name:pick(CITY_NAMES) };
}
