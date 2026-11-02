// ---------- City generation ----------
// Pure data: builds the tile grid and prop lists from a seed. No Three.js here.
// A city is b×b blocks of 5×5 tiles between 2-tile roads (b grows in later cities, cityBlocks in
// config.js), drawn into the top-left of the N×N tile arrays. Each block belongs to a district
// (DISTRICTS in config.js, laid out by LAYOUT) that decides what gets built on it and how many
// zombies (block.density, residents per block) and how much loot it holds. Landmarks are stamped from the ASCII TEMPLATES below;
// the police station and supermarket take a 2×2 group of blocks (the roads between them become
// part of the lot) and can be walked into.
import { N, T, CITY_NAMES, PALETTE, HOUSE_PALETTE, ROOF_PALETTE, WAREHOUSE_PALETTE, DISTRICTS, LAYOUT, CONDITIONS, CLOSURES, BLOCK_DENSITY, cityBlocks, walkable } from './config.js';
import { LANDMARKS } from './items.js';
import { rng, seedRng, rand, randi, pick } from './utils.js';

const I = (x,z) => z*N + x;
const D4 = [[0,1],[1,0],[0,-1],[-1,0]];  // +z first, so props facing a tie turn toward the camera
const wpick = table => {
  let s = 0; for (const e of table) s += e[1];
  let r = rng()*s; for (const e of table){ r -= e[1]; if (r <= 0) return e[0]; }
  return table[0][0];
};
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j = Math.floor(rng()*(i+1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const WRECK_COLORS = [0x4a3a33,0x3a3f45,0x5b4636,0x444038,0x6b2b2b,0x2b4a6b];
// A wrecked car: some lie on their roof or side, some are burnt out.
const wreck = (x, z, rot, o) => Object.assign({ x, z, rot, color:pick(WRECK_COLORS), wreck:true, pose:rng() < 0.12 ? 'flip' : rng() < 0.1 ? 'side' : null, burnt:rng() < 0.22 }, o);
// The condition comes first off the seeded RNG, so the dev tools can find a seed for one cheaply.
const rollCondition = () => wpick(Object.keys(CONDITIONS).map(k => [k, CONDITIONS[k].w]));
export function cityCondition(seed){ seedRng(seed); return rollCondition(); }

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

// ---------- Districts ----------
// Random each city: downtown cores anywhere but near the start, each ringed by suburbs, plus
// industrial pockets; whatever's left is outskirts. Later cities get more and bigger cores (and
// bigger cities more of everything), and every district holds more zombies per block.
function assignDistricts(blocks, level, nb){
  const L = LAYOUT, k = level - 1, area = nb*nb/100, spot = (gap, others, apart) => {
    for (let i=0;i<60;i++){
      const x = rand(0.5, nb-0.5), z = rand(0.5, nb-0.5);
      if (Math.hypot(x, z) >= gap && others.every(o => Math.hypot(o.x - x, o.z - z) >= apart)) return { x, z };
    }
    return null;
  };
  const cores = [], pockets = [];
  for (let n=Math.min(Math.round(L.cores[2]*area), Math.floor((L.cores[0] + L.cores[1]*k)*area + rng()));n>0;n--){
    const p = spot(L.startGap, cores, L.coreGap);
    if (p) cores.push(Object.assign(p, { r:rand(L.core[0], L.core[1]) + L.coreGrow*k, ring:rand(L.ring[0], L.ring[1]) + L.ringGrow*k }));
  }
  for (let n=Math.floor(rand(L.pockets[0], L.pockets[1] + 1)*area);n>0;n--){
    const p = spot(L.pocketGap, cores.concat(pockets), 2.5);
    if (p) pockets.push(Object.assign(p, { r:rand(L.pocket[0], L.pocket[1]) }));
  }
  for (const b of blocks){
    // Distance past the edge of the nearest core / pocket (negative = inside), with ragged edges.
    const n = rand(-0.6, 0.6), edge = (list, f) => Math.min(1e9, ...list.map(o => Math.hypot(b.bx - o.x, b.bz - o.z) - f(o))) + n;
    const dc = edge(cores, o => o.r), ds = edge(cores, o => o.r + o.ring), di = edge(pockets, o => o.r);
    b.district = b.bx + b.bz <= 1 ? 'outskirts' : dc < 0 ? 'downtown' : di < 0 ? 'industrial' : ds < 0 ? 'residential' : 'outskirts';
    const D = DISTRICTS[b.district];
    b.density = (D.density + D.perLevel*k) * rand(0.75, 1.25);
  }
}

export function generateCity(level, seed){
  seedRng(seed);
  const cond = rollCondition(), C = CONDITIONS[cond];
  const nb = cityBlocks(level), n = 7*nb + 4;
  // Walls everywhere, roads inside the city's own n×n corner (its border stays wall).
  const grid = new Uint8Array(N*N).fill(T.WALL);
  for (let z=1;z<n-1;z++) for (let x=1;x<n-1;x++) grid[I(x,z)] = T.ROAD;
  const blocks = [];
  for (let bz=0;bz<nb;bz++) for (let bx=0;bx<nb;bx++) blocks.push({ bx, bz, x0:3+7*bx, z0:3+7*bz, type:null });
  assignDistricts(blocks, level, nb);
  const exitZ = 1 + 7*randi(1, nb-1);
  grid[I(n-1,exitZ)] = T.BARRICADE; grid[I(n-1,exitZ+1)] = T.BARRICADE;
  // overlays: tiles drawn with their own ground (parking asphalt, forecourt concrete, outpost dirt);
  // floors: walk-in landmark type -> its floor tiles.
  // overlays.scorch: burnt ground; debris: loose rubble (no collision); smoke: rising plumes;
  // ponds/craters: water and blast holes; closures: road closures (for the dev tools).
  const c = { grid, blocks, b:nb, n, cond, buildings:[], trees:[], cars:[], rubble:[], pillars:[], props:[], containers:[], landmarks:[], interiors:[],
    overlays:{ lot:[], pad:[], dirt:[], scorch:[] }, floors:{}, debris:[], smoke:[], ponds:[], craters:[], closures:[], exitZ };

  const cb = pick(blocks.filter(b => b.bx + b.bz >= nb));
  cb.type = 'plaza';
  placeLandmarks(c, level);
  for (const b of blocks) if (!b.type){
    const start = b.bx + b.bz <= 1;
    b.type = wpick(DISTRICTS[b.district].blocks.filter(([t]) => !start || !EVENTFUL.has(t)).map(([t, w]) => [t, w*(C.mul[t] ?? 1)]));
    b.density *= BLOCK_DENSITY[b.type] || 1;
    buildBlock(c, b);
  }
  for (const b of blocks) if (b.type === 'plaza') buildBlock(c, b);
  const road = new Uint8Array(N*N);
  for (let i=0;i<N*N;i++) road[i] = grid[i] === T.ROAD ? 1 : 0;
  damage(c, C);
  addCrashes(c, C);
  addClosures(c, C, level);
  addWrecks(c, C, exitZ, n);
  placeLoot(c);
  return Object.assign(c, { road, crystalTile:{ x:cb.x0+2, z:cb.z0+2 }, start:{ x:2, z:2 }, name:pick(CITY_NAMES) });
}
// Block types kept away from the start's own blocks.
const EVENTFUL = new Set(['cemetery','camp','crater','construction']);

// ---------- Ordinary blocks ----------
function buildBlock(c, b){
  const { grid } = c, { x0, z0 } = b, D = b.district;
  const fill = t => { for (let z=z0;z<z0+5;z++) for (let x=x0;x<x0+5;x++) grid[I(x,z)] = t; };
  const spot = (t, f) => { const x = x0 + randi(0,4), z = z0 + randi(0,4); if (grid[I(x,z)] === t){ grid[I(x,z)] = T.OBSTACLE; f(x, z); } };
  const tree = (x, z) => c.trees.push({ x, z, s:rand(0.8,1.3), m:Math.floor(rng()*3) });
  const dirt = () => { for (let z=z0;z<z0+5;z++) for (let x=x0;x<x0+5;x++) c.overlays.dirt.push([x,z]); };
  const put = (L, h, o) => {
    for (let z=L.z;z<L.z+L.d;z++) for (let x=L.x;x<L.x+L.w;x++) grid[I(x,z)] = T.BUILDING;
    c.buildings.push(Object.assign({ x:L.x, z:L.z, w:L.w, d:L.d, h, district:D }, o));
  };
  const t = b.type;
  if (t === 'towers' || t === 'ruins'){
    fill(T.SIDEWALK);
    const lots = []; splitLots(x0,z0,5,5,lots,0);
    const ruined = t === 'ruins';
    for (const L of lots){
      if (rng() < (ruined ? 0.08 : 0.05)) continue;
      if (ruined && rng() < 0.35){
        const rx = L.x + Math.floor(rng()*L.w), rz = L.z + Math.floor(rng()*L.d);
        grid[I(rx,rz)] = T.OBSTACLE; c.rubble.push({ x:rx, z:rz }); continue;
      }
      const h = ruined ? rand(1.2,3) : rand(5,9) + rng()*rng()*12;
      put(L, h, { style:ruined ? 'ruin' : 'tower', color:pick(PALETTE), ruined, win:Math.floor(rng()*3), ac:rng() < 0.5 });
    }
  } else if (t === 'houses' || t === 'farm'){
    // Low houses with yards around them: lots shrink to leave grass, some stay empty.
    fill(T.GRASS);
    const lots = []; splitLots(x0,z0,5,5,lots,0);
    for (const L of lots){
      if (rng() < (t === 'farm' ? 0.6 : 0.2)) continue;
      if (L.w >= 3){ L.w--; if (rng() < 0.5) L.x++; }
      if (L.d >= 3){ L.d--; if (rng() < 0.5) L.z++; }
      put(L, rand(2.3,3.3), { style:'house', color:pick(HOUSE_PALETTE), roof:pick(ROOF_PALETTE), win:Math.floor(rng()*3) });
    }
    for (let i=randi(0,2);i>0;i--) spot(T.GRASS, tree);
  } else if (t === 'warehouses'){
    fill(T.SIDEWALK);
    const lots = []; splitLots(x0,z0,5,5,lots,2);
    for (const L of lots){
      if (rng() < 0.12) continue;
      put(L, rand(3,4.6), { style:'warehouse', color:pick(WAREHOUSE_PALETTE), ac:rng() < 0.6 });
    }
  } else if (t === 'park' || t === 'field'){
    fill(T.GRASS);
    for (let i=t === 'park' ? randi(3,6) : randi(0,2);i>0;i--) spot(T.GRASS, tree);
    if (t === 'field' && rng() < 0.3) spot(T.GRASS, (x, z) => c.rubble.push({ x, z }));
  } else if (t === 'lot'){
    fill(T.SIDEWALK);
    for (let i=D === 'downtown' ? randi(3,5) : D === 'outskirts' ? randi(1,2) : randi(2,4);i>0;i--)
      spot(T.SIDEWALK, (x, z) => c.cars.push({ x, z, rot:(rng()<0.5?0:Math.PI/2) + rand(-0.15,0.15), color:pick([0x6b2b2b,0x2b4a6b,0x9a9a92,0x3a3f45,0x6b5a2b,0x2f5a3c]), burnt:rng() < 0.08*CONDITIONS[c.cond].wrecks }));
  } else if (t === 'yard'){
    // Industrial storage: pallets of lumber, plus crates from placeLoot().
    fill(T.SIDEWALK);
    for (let i=randi(1,3);i>0;i--) spot(T.SIDEWALK, (x, z) => c.props.push({ kind:'lumber', x, z, rot:rng() < 0.5 ? 0 : Math.PI/2 }));
  } else if (t === 'construction'){
    // Building site on dirt: a steel frame going up, a tower crane, concrete pipes and lumber,
    // chain-link fence along one or two sides (crates from placeLoot()).
    fill(T.SIDEWALK); dirt();
    const fw = randi(2,3), fd = randi(2,3);
    put({ x:x0 + randi(0, 5-fw), z:z0 + randi(0, 5-fd), w:fw, d:fd }, rand(6,12), { style:'frame', color:0x8a8780, floors:randi(2,4) });
    spot(T.SIDEWALK, (x, z) => c.props.push({ kind:'crane', x, z, rot:Math.floor(rng()*4)*Math.PI/2 + rand(-0.3,0.3), h:rand(15,20), jib:rand(9,13) }));
    for (let i=randi(1,2);i>0;i--) spot(T.SIDEWALK, (x, z) => c.props.push({ kind:rng() < 0.5 ? 'pipes' : 'lumber', x, z, rot:rng() < 0.5 ? 0 : Math.PI/2 }));
    for (let i=randi(1,2);i>0;i--) fenceSide(c, b, Math.floor(rng()*4), 'chain');
  } else if (t === 'cemetery'){
    // Iron fence round the edge with a gate in the middle of each side, graves in the corners and a
    // crypt (or an old tree) in the middle.
    fill(T.GRASS);
    for (let side=0;side<4;side++) fenceSide(c, b, side, 'iron', true);
    for (const [gx,gz] of [[1,1],[3,1],[1,3],[3,3]]){ grid[I(x0+gx,z0+gz)] = T.LOW; c.props.push({ kind:'grave', x:x0+gx, z:z0+gz, rot:0, n:randi(2,3), seed:Math.floor(rng()*1e6) }); }
    if (rng() < 0.6) put({ x:x0+2, z:z0+2, w:1, d:1 }, rand(2.2,2.8), { style:'crypt', color:pick([0x8f8c86,0x7d7a74,0x99948a]), roof:0x45464b });
    else { grid[I(x0+2,z0+2)] = T.OBSTACLE; tree(x0+2, z0+2); }
  } else if (t === 'camp'){
    // Abandoned relief camp: rows of tents on dirt (one a first-aid tent), burn barrels, a fence.
    fill(T.GRASS); dirt();
    const spots = shuffle([[1,1],[3,1],[1,3],[3,3]]);
    spots.forEach(([gx,gz], i) => {
      if (i > 0 && rng() < 0.25) return;
      grid[I(x0+gx,z0+gz)] = T.OBSTACLE; c.props.push({ kind:i === 0 ? 'medtent' : 'tent', x:x0+gx, z:z0+gz, rot:rng() < 0.5 ? 0 : Math.PI });
    });
    for (let i=randi(1,2);i>0;i--) spot(T.GRASS, (x, z) => { const lit = rng() < 0.65; c.props.push({ kind:'barrel', x, z, lit }); if (lit) c.smoke.push({ x:x+0.5, z:z+0.5, s:0.5 }); });
    if (rng() < 0.6) fenceSide(c, b, Math.floor(rng()*4), 'chain');
  } else if (t === 'pond'){
    // A park around a pond (water blocks walking, not sight), with trees.
    fill(T.GRASS);
    const pw = randi(2,3), pd = randi(2,3), px = x0 + 1 + randi(0, 3-pw), pz = z0 + 1 + randi(0, 3-pd);
    for (let z=pz;z<pz+pd;z++) for (let x=px;x<px+pw;x++) grid[I(x,z)] = T.WATER;
    c.ponds.push({ x0:px, z0:pz, x1:px+pw, z1:pz+pd });
    for (let i=randi(2,4);i>0;i--) spot(T.GRASS, tree);
  } else if (t === 'crater'){
    // A shell hit: a blast hole in the middle (some flooded), scorched ground, rubble, a burnt car.
    fill(T.SIDEWALK);
    const cx = x0+2, cz = z0+2, wet = rng() < 0.3;
    grid[I(cx,cz)] = wet ? T.WATER : T.LOW;
    c.craters.push({ x:cx+0.5, z:cz+0.5, r:rand(2.6,3.4), wet });
    for (let z=cz-1;z<=cz+1;z++) for (let x=cx-1;x<=cx+1;x++) if (x !== cx || z !== cz) c.overlays.scorch.push([x,z]);
    for (let i=randi(1,3);i>0;i--) spot(T.SIDEWALK, (x, z) => c.rubble.push({ x, z }));
    for (let i=randi(2,4);i>0;i--) c.debris.push([x0 + rand(0,5), z0 + rand(0,5)]);
    if (rng() < 0.5) spot(T.SIDEWALK, (x, z) => c.cars.push(wreck(x, z, rand(0,6.3), { burnt:true })));
    if (rng() < 0.5) c.smoke.push({ x:cx+0.5, z:cz+0.5, s:0.8 });
  } else if (t === 'plaza'){
    fill(T.PLAZA);
    grid[I(x0+2,z0+2)] = T.CRYSTAL;
    for (const [px,pz] of [[0,0],[4,0],[0,4],[4,4]]){ grid[I(x0+px,z0+pz)] = T.OBSTACLE; c.pillars.push({ x:x0+px, z:z0+pz, h:rand(1.4,3.6) }); }
  }
}

// ---------- Wrecks, damage and road closures ----------
// Which block a tile belongs to (roads count toward the block south-east of them).
const blockAt = (c, x, z) => { const f = v => Math.min(c.b-1, Math.max(0, Math.floor((v-1)/7))); return c.blocks[f(z)*c.b + f(x)]; };
const BASIC_T = new Set(['towers','ruins','houses','farm','warehouses','park','field','lot','yard','construction','camp','crater','pond']);
// Keeps the start corner, the exit and landmark entrances clear of anything that blocks a road.
function clearSpot(c, x, z){
  if (x < 11 && z < 11) return false;
  if (x > c.n - 10 && Math.abs(z - c.exitZ) < 6) return false;
  return c.landmarks.every(l => Math.abs(l.ox - x) + Math.abs(l.oz - z) > 3);
}
// Tiles reachable on foot from the start: { n, at } (at[i] = 1 if reachable).
function reach(c){
  const at = new Uint8Array(N*N), q = [I(2,2)]; at[q[0]] = 1;
  for (let h=0;h<q.length;h++){
    const cx = q[h] % N, cz = (q[h]-cx)/N;
    for (const [dx,dz] of D4){ const ni = I(cx+dx,cz+dz); if (!at[ni] && walkable(c.grid[ni])){ at[ni] = 1; q.push(ni); } }
  }
  return { n:q.length, at };
}
// Sets cells [[x, z, tile]] if that cuts nobody off: every tile reachable before still is (except
// the ones it fills). Returns true when placed; otherwise the grid is left as it was.
function tryBlock(c, cells){
  const R = c.reach || (c.reach = reach(c)), old = cells.map(([x,z]) => c.grid[I(x,z)]);
  let lost = 0;
  for (const [x,z,t] of cells){ if (R.at[I(x,z)]) lost++; c.grid[I(x,z)] = t; }
  const r = reach(c);
  if (r.n === R.n - lost){ c.reach = r; return true; }
  cells.forEach(([x,z], i) => { c.grid[I(x,z)] = old[i]; });
  return false;
}

// Collapsed and burnt-out buildings. Broken towers and warehouses stop at `cut` of their height with
// jagged chunks above (chunks = [x, z, w, d] fractions of the footprint + height), holes in the
// walls and rubble at their feet; burnt houses are charred with their roof caved in.
function breakBuilding(c, b){
  if (b.cut || b.burnt) return;
  if (b.style === 'house'){
    b.burnt = true; b.caved = rng() < 0.6;
    for (let z=b.z-1;z<=b.z+b.d;z++) for (let x=b.x-1;x<=b.x+b.w;x++) if (walkable(c.grid[I(x,z)]) && rng() < 0.5) c.overlays.scorch.push([x,z]);
    if (rng() < 0.55) c.smoke.push({ x:b.x + b.w/2, z:b.z + b.d/2, s:0.9 });
    return;
  }
  b.cut = b.h*rand(0.4,0.7); b.chunks = []; b.holes = randi(1,3); b.seed = Math.floor(rng()*1e6);
  for (let k=randi(2,4);k>0;k--){ const w = rand(0.25,0.55), d = rand(0.25,0.55); b.chunks.push([rand(0,1-w), rand(0,1-d), w, d, rand(0.25,1)*(b.h - b.cut)]); }
  for (let z=b.z-1;z<=b.z+b.d;z++) for (let x=b.x-1;x<=b.x+b.w;x++) if (walkable(c.grid[I(x,z)]) && rng() < 0.35) c.debris.push([x + rand(0.1,0.9), z + rand(0.1,0.9)]);
  if (rng() < 0.4) c.smoke.push({ x:b.x + b.w/2, z:b.z + b.d/2, s:1.3, y:b.cut });
}
function damage(c, C){
  for (const b of c.buildings){
    if (b.lm || b.ruined || b.style === 'frame' || b.style === 'crypt') continue;
    const k = b.style === 'house' ? 0.08 : b.style === 'warehouse' ? 0.08 : 0.1;
    if (rng() < k*C.broken) breakBuilding(c, b);
    else if (b.style === 'tower' && rng() < 0.08*C.broken) b.soot = true;  // fire-blackened, windows out
  }
}

// Crashes: two cars smashed together at a crossing (one tile in the crossing, one in a lane
// leading out of it), and cars driven into buildings.
function addCrashes(c, C){
  const { grid } = c, nb = c.b;
  for (let k=Math.round(nb*nb/100*rand(2,4)*C.wrecks);k>0;k--){
    const a = 1 + 7*randi(0, nb), bz = 1 + 7*randi(0, nb), i = randi(0,1), j = randi(0,1), x = a + i, z = bz + j;
    if (!clearSpot(c, x, z) || grid[I(x,z)] !== T.ROAD) continue;
    const alongX = rng() < 0.5, x2 = alongX ? (i ? x+1 : x-1) : x, z2 = alongX ? z : (j ? z+1 : z-1);
    if (grid[I(x2,z2)] !== T.ROAD) continue;
    const axis = alongX ? 0 : Math.PI/2, burnt = rng() < 0.35;
    if (!tryBlock(c, [[x,z,T.OBSTACLE],[x2,z2,T.OBSTACLE]])) continue;
    c.cars.push(wreck(x, z, axis + Math.PI/2 + rand(-0.5,0.5), { pose:null, burnt }), wreck(x2, z2, axis + rand(-0.35,0.35), { pose:null, burnt:burnt && rng() < 0.5 }));
    for (const [sx,sz] of [[x,z],[x2,z2]]) for (const [dx,dz] of D4) if (rng() < 0.4) c.debris.push([sx + dx*0.5 + rand(0.2,0.8), sz + dz*0.5 + rand(0.2,0.8)]);
    if (burnt){ c.overlays.scorch.push([x,z]); if (rng() < 0.7) c.smoke.push({ x:x+0.5, z:z+0.5, s:0.8 }); }
  }
  // Into a building: on a free tile next to a tower, house or warehouse, nose against the wall.
  for (const b of c.buildings){
    if (b.lm || b.style === 'frame' || b.style === 'crypt' || rng() > 0.035*C.wrecks) continue;
    const opts = [];
    for (let z=b.z;z<b.z+b.d;z++) for (let x=b.x;x<b.x+b.w;x++) for (const [dx,dz] of D4){
      const tx = x+dx, tz = z+dz, g = grid[I(tx,tz)];
      if ((g === T.SIDEWALK || g === T.GRASS) && BASIC_T.has(blockAt(c, tx, tz).type) && clearSpot(c, tx, tz)) opts.push([tx, tz, -dx, -dz]);
    }
    if (!opts.length) continue;
    const [tx, tz, dx, dz] = pick(opts);
    if (!tryBlock(c, [[tx,tz,T.OBSTACLE]])) continue;
    c.cars.push(wreck(tx, tz, Math.atan2(-dz, dx) + rand(-0.3,0.3), { pose:null, burnt:rng() < 0.4, ox:dx*0.35, oz:dz*0.35, crash:true }));
    for (let i=randi(1,3);i>0;i--) c.debris.push([tx + 0.5 + dx*0.6 + rand(-0.4,0.4), tz + 0.5 + dz*0.6 + rand(-0.4,0.4)]);
  }
}

// Road closures: something blocks both lanes of a road (and the sidewalks beside it when they're
// open), at the mouth of a street (turning it into a dead end) or halfway along. Kinds (weights in
// the city's condition, nudged by district): concrete barriers or sawhorses, a chain-link fence, an
// army checkpoint (sandbags, a truck, maybe a military crate), a pileup of wrecks, a crashed bus,
// rubble from a collapsed building. Fences, barriers and sandbags are LOW: shots and sight pass.
const KIND_D = { barrier:{ downtown:1.4, residential:1.4 }, fence:{ industrial:1.5, outskirts:1.4 }, checkpoint:{ outskirts:1.6, industrial:1.4, downtown:0.7 },
  bus:{ downtown:1.6, residential:1.2, outskirts:0.4 }, pileup:{}, collapse:{ downtown:2, industrial:1.2, residential:0.3, outskirts:0.2 } };
function addClosures(c, C, level){
  const { grid } = c, nb = c.b;
  let want = Math.round((CLOSURES.base + CLOSURES.perCity*(level-1))*nb*nb/100*C.closures*rand(0.8,1.2));
  const cuts = [];
  for (let k=0;k<=nb;k++) for (let j=0;j<nb;j++) for (const at of [0, 4, 0, 4, 2]){
    const a = 1 + 7*k, s = 3 + 7*j + at;
    cuts.push({ along:'x', x:s, z:a }, { along:'z', x:a, z:s });
  }
  const done = [];
  for (const cut of shuffle(cuts)){
    if (want <= 0) break;
    const { x, z } = cut, ax = cut.along === 'x';
    // Lane tiles across the road, then the sidewalk tile on each side.
    const lanes = ax ? [[x,z],[x,z+1]] : [[x,z],[x+1,z]], flanks = ax ? [[x,z-1],[x,z+2]] : [[x-1,z],[x+2,z]];
    if (lanes.some(([lx,lz]) => grid[I(lx,lz)] !== T.ROAD || !clearSpot(c, lx, lz))) continue;
    if (done.some(d => Math.abs(d[0] - x) + Math.abs(d[1] - z) < 7)) continue;
    const side = flanks.filter(([fx,fz]) => { const g = grid[I(fx,fz)]; return (g === T.SIDEWALK || g === T.GRASS) && BASIC_T.has(blockAt(c, fx, fz).type) && clearSpot(c, fx, fz); });
    const dist = blockAt(c, flanks[1][0], flanks[1][1]).district;
    const kind = wpick(Object.keys(C.kinds).map(k => [k, C.kinds[k]*(KIND_D[k][dist] ?? 1)]));
    // rot: the line the closure runs along (across the road).
    const rot = ax ? Math.PI/2 : 0, all = lanes.concat(side), cells = [], add = [];
    const low = (x, z, kd, o) => { cells.push([x, z, T.LOW]); add.push(() => c.props.push(Object.assign({ kind:kd, x, z, rot }, o))); };
    const solid = (x, z, f) => { cells.push([x, z, T.OBSTACLE]); add.push(f); };
    const car = (x, z, o) => solid(x, z, () => c.cars.push(wreck(x, z, rot + Math.PI/2 + rand(-0.9,0.9), o)));
    if (kind === 'barrier'){ const style = dist === 'residential' || dist === 'outskirts' ? 'sawhorse' : 'jersey'; for (const [tx,tz] of all) low(tx, tz, style); }
    else if (kind === 'fence') for (const [tx,tz] of all) low(tx, tz, 'fence', { style:'chain', sign:tx === lanes[0][0] && tz === lanes[0][1] });
    else if (kind === 'checkpoint'){
      const ti = randi(0,1);
      lanes.forEach(([tx,tz], i) => i === ti
        ? solid(tx, tz, () => { c.cars.push({ x:tx, z:tz, rot:rot + rand(-0.25,0.25) + (rng() < 0.5 ? 0 : Math.PI), style:'military', tpl:true, color:0 }); if (rng() < 0.6) c.containers.push({ kind:'humvee', x:tx, z:tz }); })
        : low(tx, tz, 'sandbag'));
      side.forEach(([tx,tz]) => rng() < 0.3
        ? solid(tx, tz, () => { c.props.push({ kind:'milcrate', x:tx, z:tz, rot, search:true }); c.containers.push({ kind:'milcrate', x:tx, z:tz }); })
        : low(tx, tz, 'sandbag'));
    }
    else if (kind === 'pileup'){ for (const [tx,tz] of lanes) car(tx, tz); for (const [tx,tz] of side) if (rng() < 0.6) car(tx, tz, { pose:null }); else low(tx, tz, 'jersey'); }
    else if (kind === 'bus'){
      const [l0, l1] = lanes, school = rng() < 0.45;
      cells.push([l0[0], l0[1], T.OBSTACLE], [l1[0], l1[1], T.OBSTACLE]);
      add.push(() => c.props.push({ kind:'bus', x:l0[0], z:l0[1], cx:(l0[0] + l1[0])/2 + 0.5, cz:(l0[1] + l1[1])/2 + 0.5, rot:rot + rand(-0.2,0.2), color:school ? 0xd9a21b : pick([0xd8d8d0,0x2d5f8a,0x8a2d2d]),
        stripe:school ? 0x1a1a1a : 0xd8d8d0, side:rng() < 0.35, burnt:rng() < 0.3 }));
      for (const [tx,tz] of side) if (rng() < 0.5) car(tx, tz, { pose:null }); else solid(tx, tz, () => c.rubble.push({ x:tx, z:tz }));
    }
    else if (kind === 'collapse'){
      for (const [tx,tz] of all) solid(tx, tz, () => c.props.push({ kind:'heap', x:tx, z:tz, rot:rand(0,6.3), seed:Math.floor(rng()*1e6) }));
      add.push(() => { for (const b of c.buildings) if (!b.lm && (b.style === 'tower' || b.style === 'warehouse') && all.some(([tx,tz]) => tx >= b.x-2 && tx < b.x+b.w+2 && tz >= b.z-2 && tz < b.z+b.d+2)) breakBuilding(c, b); });
    }
    if (!tryBlock(c, cells)) continue;
    for (const f of add) f();
    done.push([x, z]); c.closures.push({ kind, x, z }); want--;
    if (kind === 'pileup' || kind === 'collapse' || kind === 'bus') for (let i=randi(1,3);i>0;i--) c.debris.push([x + 0.5 + rand(-1.5,1.5), z + 0.5 + rand(-1.5,1.5)]);
    if ((kind === 'pileup' || kind === 'bus') && rng() < 0.4) c.smoke.push({ x:x+0.5, z:z+0.5, s:1 });
  }
}

// Fence along one side of a block (0 north, 1 east, 2 south, 3 west) on its edge tiles that are
// still open ground, with a gap for a gate (the middle tile when `mid`).
function fenceSide(c, b, side, style, mid){
  const gap = mid ? 2 : randi(1,3), rot = side % 2 ? Math.PI/2 : 0;
  for (let i=0;i<5;i++){
    if (i === gap) continue;
    const [x, z] = side === 0 ? [b.x0+i, b.z0] : side === 1 ? [b.x0+4, b.z0+i] : side === 2 ? [b.x0+i, b.z0+4] : [b.x0, b.z0+i], g = c.grid[I(x,z)];
    if (g !== T.SIDEWALK && g !== T.GRASS) continue;
    c.grid[I(x,z)] = T.LOW; c.props.push({ kind:'fence', x, z, rot, style });
  }
}
// Wrecked cars on roads, never blocking both lanes; badly hit cities get many more, some of them
// in jams (a row of cars stuck in one lane).
function addWrecks(c, C, exitZ, n){
  const { grid } = c, nb = c.b;
  const laneOk = (x, z) => {
    if (grid[I(x,z)] !== T.ROAD || !clearSpot(c, x, z)) return false;
    const rx = (x-1)%7 < 2, rz = (z-1)%7 < 2;
    if (rx && rz) return false;
    if (rz){ const pz = ((z-1)%7 === 0) ? z+1 : z-1; for (let dx=-1;dx<=1;dx++) if (grid[I(x+dx,pz)] !== T.ROAD) return false; }
    else { const px = ((x-1)%7 === 0) ? x+1 : x-1; for (let dz=-1;dz<=1;dz++) if (grid[I(px,z+dz)] !== T.ROAD) return false; }
    return true;
  };
  const place = (x, z, o) => {
    const rz = (z-1)%7 < 2, flip = rng() < 0.5 ? 0 : Math.PI, j = o && o.jam ? rand(-0.12,0.12) : rand(-0.5,0.5);
    grid[I(x,z)] = T.OBSTACLE; c.cars.push(wreck(x, z, (rz ? 0 : Math.PI/2) + flip + j, o && o.jam ? { pose:null } : null));
  };
  const p = 0.035*C.wrecks;
  for (let z=1;z<n-1;z++) for (let x=1;x<n-1;x++) if (rng() <= p && laneOk(x, z)) place(x, z);
  // Jams: 2–4 cars nose to tail along one lane of a street.
  for (let k=Math.round(nb*nb/100*rand(1,2)*Math.max(0, C.wrecks - 0.6)*2);k>0;k--){
    const ax = rng() < 0.5, lane = 1 + 7*randi(0, nb) + randi(0,1), s0 = 3 + 7*randi(0, nb-1), len = randi(2,4), st = randi(0, 5-len);
    for (let i=0;i<len;i++){ const x = ax ? s0+st+i : lane, z = ax ? lane : s0+st+i; if (laneOk(x, z)) place(x, z, { jam:true }); }
  }
}

// ---------- Landmark templates ----------
// Rows run from the back of the lot to its front (+z); stamp() mirrors and/or transposes them,
// so the front always faces +z or +x (the sides the camera sees).
// Ground: '.' sidewalk, ',' parking, 'g' forecourt, 'r' parking with a cart, 'f' sidewalk with a flagpole.
// Walk-in buildings: '#' wall, '_' floor, 'E' entrance, 'z' cell floor (a prisoner may stand there).
// Solid buildings: 'B', with 'D' its searchable front door.
// Blocking props: 'S' shelf ('s' searchable), 'C' checkout, 'L' locker, 'A' armory, 'k' desk
// (searchable; 'K' not), '|' cell bars (shots and sight pass), 'P' fuel pump, 'Y' price sign,
// 'c' car, 'p' police car, 'a' ambulance, 'v' army truck, 't' tree, 'w' lumber, 'x' crate,
// 'h' hospital bed, 'u' gurney, 'M' medicine cabinet (searchable).
// Open-air landmarks: '=' sandbag wall, 'G' gate, 'T' tent, 'W' watchtower, 'X' military crate (searchable).
const TEMPLATES = {
  police: [
    '############',
    '#A_L#zz#zz##',
    '#___#||#||##',
    '##_##______#',
    '#__________#',
    '#_kK____Kk_#',
    '#L________L#',
    '#####EE#####',
    '....f.......',
    '.p..t....p..',
    '............',
    '...p....t...'
  ],
  supermarket: [
    '############',
    '#__________#',
    '#_SsS__SsS_#',
    '#__________#',
    '#_sSs__sSs_#',
    '#__________#',
    '#_C_C__C_C_#',
    '#####EE#####',
    '..r......r..',
    ',c,,,,,c,,,,',
    ',,,,,r,,,,,,',
    ',,,c,,,,,,c,'
  ],
  pharmacy: [
    '.....',
    '.BBB.',
    '.BBB.',
    '.BDB.',
    't...t'
  ],
  hardware: [
    'BBBBB',
    'BBBBB',
    'BBDBB',
    '.....',
    'wx..w'
  ],
  gas: [
    'BBB.Y',
    'BBD..',
    '.....',
    'gPgPg',
    'ggggg'
  ],
  hospital: [
    '############',
    '#h_h_#M_M_M#',
    '#____#_____#',
    '#h_h_##_####',
    '#__________#',
    '#_kK__u__u_#',
    '#M________M#',
    '#####EE#####',
    '............',
    '.a.......a..',
    '.....t......',
    '..t......t..'
  ],
  gunshop: [
    't...t',
    '.BBB.',
    '.BBB.',
    '.BDB.',
    '.....'
  ],
  outpost: [
    '............',
    '.==========.',
    '.=X..T..T.=.',
    '.=........=.',
    '.=.W....x.=.',
    '.=........=.',
    '.=.T..v.X.=.',
    '.=........=.',
    '.=X..T....=.',
    '.====GG====.',
    '............',
    '..t......t..'
  ]
};
const TILE_OF = { '.':T.SIDEWALK, ',':T.SIDEWALK, 'g':T.SIDEWALK, 'r':T.SIDEWALK, 'f':T.SIDEWALK, 'G':T.SIDEWALK, '_':T.FLOOR, 'E':T.FLOOR, 'z':T.FLOOR,
  '#':T.BUILDING, 'B':T.BUILDING, 'D':T.BUILDING, '|':T.BARS };
// Searchable props -> container kind (loot table in items.js LOOT).
const SEARCH = { s:'shelf', L:'locker', A:'armory', k:'desk', M:'medcab', X:'milcrate' };
const PROP = { S:'shelf', s:'shelf', C:'counter', L:'locker', A:'armory', k:'desk', K:'desk', '|':'bars', P:'pump', Y:'pylon', w:'lumber', r:'cart', f:'flag',
  h:'bed', u:'gurney', M:'medcab', '=':'sandbag', T:'tent', W:'tower', X:'milcrate' };
// Trunks of landmark vehicles: template char -> [car style, container kind, chance].
const VEHICLE = { c:[null, 'trunk', 0.55], p:['police', 'cruiser', 0.65], a:['ambulance', 'ambulance', 0.75], v:['military', 'humvee', 0.75] };
// size = blocks per side; n = [min, max] per city; more = extra copies likely in bigger cities;
// score = how much each district suits it. Which city a kind first appears in is LANDMARKS[].from.
const LM_SPEC = {
  police:      { size:2, h:4.6, n:[1,1], score:{ downtown:2, residential:1, industrial:0.5, outskirts:0 } },
  supermarket: { size:2, h:5,   n:[1,1], more:true, score:{ downtown:1, residential:2, industrial:0.5, outskirts:0.3 } },
  hospital:    { size:2, h:5.4, n:[1,1], score:{ downtown:2, residential:1.5, industrial:0.3, outskirts:0.3 } },
  outpost:     { size:2, h:0,   n:[1,1], score:{ downtown:0, residential:0.5, industrial:1.5, outskirts:2 } },
  pharmacy:    { size:1, h:3.6, n:[1,2], more:true, score:{ downtown:2, residential:2, industrial:0.3, outskirts:0.5 } },
  hardware:    { size:1, h:4.2, n:[1,1], score:{ downtown:0.5, residential:1.5, industrial:3, outskirts:1 } },
  gas:         { size:1, h:3,   n:[1,2], more:true, score:{ downtown:0.3, residential:1.5, industrial:1.5, outskirts:2 } },
  gunshop:     { size:1, h:3.4, n:[1,1], more:true, score:{ downtown:1.5, residential:1, industrial:1, outskirts:0.8 } }
};

// Every kind unlocked by this city (LANDMARKS[].from), n[min..max] of each (plus likely one more
// of the `more` kinds in a bigger city), big ones first, each on the best-scoring free spot for
// its kind (with some randomness), kept apart.
function placeLandmarks(c, level){
  const { blocks } = c, nb = c.b, area = nb*nb/100, placed = [], want = [];
  for (const type in LM_SPEC){
    const S = LM_SPEC[type];
    if (level < LANDMARKS[type].from) continue;
    for (let k=randi(S.n[0], S.n[1]) + (S.more ? Math.floor(rng() + area - 1) : 0);k>0;k--) want.push(type);
  }
  for (const type of want){
    const S = LM_SPEC[type], n = S.size;
    let best = null, top = -1e9;
    for (let bz=0;bz<=nb-n;bz++) for (let bx=0;bx<=nb-n;bx++){
      if (bx + bz < 2) continue;
      const g = [];
      for (let j=0;j<n;j++) for (let i=0;i<n;i++) g.push(blocks[(bz+j)*nb + bx+i]);
      if (g.some(b => b.type)) continue;
      const cx = bx + n/2, cz = bz + n/2;
      let s = g.reduce((a, b) => a + S.score[b.district], 0)/n/n + rng()*1.2;
      for (const p of placed) if (Math.hypot(p.x - cx, p.z - cz) < 3.2) s -= 6;
      if (s > top){ top = s; best = { g, bx, bz, cx, cz }; }
    }
    if (!best) continue;
    const g0 = best.g[0], lot = { x0:g0.x0, z0:g0.z0, s:7*n - 2 };
    for (const b of best.g){ b.type = 'landmark'; b.lot = lot; }
    placed.push({ x:best.cx, z:best.cz });
    stamp(c, type, best.g[0].x0, best.g[0].z0, best.g[0].district);
  }
}

function stamp(c, type, x0, z0, district){
  const tpl = TEMPLATES[type], S = tpl.length, v = randi(0,3), spec = LM_SPEC[type], { grid } = c;
  const at = (col, row) => v === 0 ? [col,row] : v === 1 ? [S-1-col,row] : v === 2 ? [row,col] : [row,S-1-col];
  const front = v < 2 ? [0,1] : [1,0], frontRot = v < 2 ? 0 : Math.PI/2;
  const cells = [], chs = new Map();
  for (let r=0;r<S;r++) for (let col=0;col<S;col++){
    const [lx,lz] = at(col, r), x = x0+lx, z = z0+lz, ch = tpl[r][col];
    cells.push([x, z, ch]); chs.set(I(x,z), ch);
    grid[I(x,z)] = TILE_OF[ch] ?? T.OBSTACLE;
  }
  const chAt = (x, z) => chs.get(I(x,z)) || '';
  const face = (x, z) => D4.find(([dx,dz]) => walkable(grid[I(x+dx,z+dz)])) || front;
  const faceRot = (x, z) => { const [dx,dz] = face(x, z); return Math.atan2(dx, dz); };
  // Long props (shelves, checkouts, bars) run along their neighbours of the same kind.
  const along = (x, z, set) => set.includes(chAt(x+1,z)) || set.includes(chAt(x-1,z)) ? 0
    : set.includes(chAt(x,z+1)) || set.includes(chAt(x,z-1)) ? Math.PI/2 : frontRot;
  const lm = { type, cts:[], district };
  const walls = [], ent = [], floor = [], yard = [], cells2 = [], box = [], pads = [], bags = [], gate = [];
  for (const [x, z, ch] of cells){
    if (ch === '#') walls.push([x,z]);
    else if (ch === 'E') ent.push([x,z]);
    else if (ch === '_') floor.push([x,z]);
    else if (ch === 'z') cells2.push([x,z]);
    else if (ch === 'B' || ch === 'D') box.push([x,z]);
    else if (ch === '.' || ch === 'f') yard.push([x,z]);
    else if (ch === '=') bags.push([x,z]);
    else if (ch === 'G') gate.push([x,z]);
    if (ch === ',' || ch === 'r' || ch === 'c') c.overlays.lot.push([x,z,frontRot]);  // stall lines run along the cars
    if (ch === 'g' || ch === 'P') { c.overlays.pad.push([x,z]); pads.push([x,z]); }
    if (ch === 't') c.trees.push({ x, z, s:rand(0.9,1.3), m:Math.floor(rng()*3) });
    if (VEHICLE[ch]){
      const [style, kind, chance] = VEHICLE[ch];
      c.cars.push({ x, z, rot:frontRot + Math.PI/2 + rand(-0.12,0.12) + (style ? rand(-0.5,0.5) : 0), style, tpl:true, color:pick([0x6b2b2b,0x2b4a6b,0x9a9a92,0x3a3f45,0x6b5a2b]) });
      if (rng() < chance) c.containers.push({ kind, x, z });
    }
    if (ch === 'x') c.containers.push({ kind:'crate', x, z, rot:0 });
    if (PROP[ch]){
      const kind = PROP[ch];
      const rot = kind === 'shelf' || kind === 'counter' ? along(x, z, 'SsC') : kind === 'bars' ? along(x, z, '|#') : kind === 'sandbag' ? along(x, z, '=G')
        : kind === 'cart' ? rand(0,6.3) : kind === 'lumber' || kind === 'bed' || kind === 'tent' ? frontRot + (rng() < 0.5 ? 0 : Math.PI) : faceRot(x, z);
      c.props.push({ kind, x, z, rot, search:!!SEARCH[ch], lm:type });
    }
    if (SEARCH[ch]){ lm.cts.push(c.containers.length); c.containers.push({ kind:SEARCH[ch], x, z }); }
  }
  if (pads.length) c.props.push(Object.assign({ kind:'canopy' }, bounds(pads)));
  if (box.length){
    // Solid shop: one building box, searched through its front door.
    const r = bounds(box), d = cells.find(e => e[2] === 'D'), [dx,dz] = face(d[0], d[1]);
    c.buildings.push({ x:r.x0, z:r.z0, w:r.x1-r.x0+1, d:r.z1-r.z0+1, h:spec.h, style:type, lm:type, face:[dx,dz], door:[d[0],d[1]], color:0, win:Math.floor(rng()*2), district });
    lm.cts.push(c.containers.length);
    c.containers.push({ kind:'door', x:d[0], z:d[1], dx, dz, lm:type });
    Object.assign(lm, { ox:d[0]+dx, oz:d[1]+dz, cx:(r.x0 + r.x1 + 1)/2, cz:(r.z0 + r.z1 + 1)/2 });
  } else if (bags.length){
    // Open-air compound: sandbag walls with a gate, everything inside out in the open on dirt.
    const r = bounds(bags), inside = [];
    for (let z=r.z0+1;z<r.z1;z++) for (let x=r.x0+1;x<r.x1;x++){ c.overlays.dirt.push([x,z]); if (walkable(grid[I(x,z)])) inside.push([x,z]); }
    const gx = (gate[0][0] + gate[1][0])/2, gz = (gate[0][1] + gate[1][1])/2;
    c.props.push({ kind:'gate', x:gx, z:gz, rot:frontRot, lm:type });
    Object.assign(lm, { ox:gate[0][0]+front[0], oz:gate[0][1]+front[1], cx:(r.x0 + r.x1 + 1)/2, cz:(r.z0 + r.z1 + 1)/2, floor:inside, yard });
  } else {
    // Walk-in building: walls on the tile grid, floor inside, open entrance on the front wall.
    const r = bounds(walls), inside = [];
    for (let z=r.z0;z<=r.z1;z++) for (let x=r.x0;x<=r.x1;x++) if (grid[I(x,z)] !== T.BUILDING) inside.push([x,z]);
    c.floors[type] = (c.floors[type] || []).concat(inside);
    c.interiors.push(Object.assign({ lm:type, walls, ent, front, h:spec.h }, r));
    Object.assign(lm, { interior:c.interiors.length-1, ox:ent[0][0]+front[0], oz:ent[0][1]+front[1], cx:(r.x0 + r.x1 + 1)/2, cz:(r.z0 + r.z1 + 1)/2,
      floor, cells:cells2, yard });
  }
  c.landmarks.push(lm);
}
const bounds = tiles => {
  let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
  for (const [x,z] of tiles){ x0 = Math.min(x0,x); z0 = Math.min(z0,z); x1 = Math.max(x1,x); z1 = Math.max(z1,z); }
  return { x0, z0, x1, z1 };
};

// ---------- Containers ----------
// Dumpsters, crates, car trunks and ordinary doors, in amounts set by the block's district.
const BASIC = new Set(['towers','ruins','houses','farm','warehouses','park','field','lot','yard','construction','camp','crater','pond','cemetery']);
const LABEL = { tower:'shop', house:'house', warehouse:'warehouse', crypt:'crypt' };
function placeLoot(c){
  const { grid, blocks, buildings, cars, containers } = c;
  for (const b of blocks){
    if (!BASIC.has(b.type)) continue;
    const D = DISTRICTS[b.district], free = [];
    for (let z=b.z0;z<b.z0+5;z++) for (let x=b.x0;x<b.x0+5;x++){
      const edge = x === b.x0 || x === b.x0+4 || z === b.z0 || z === b.z0+4, g = grid[I(x,z)];
      if ((g === T.SIDEWALK || g === T.GRASS) && edge) free.push([x,z]);
    }
    let n = 0, kind = 'crate';
    const t = b.type, outer = b.district === 'outskirts';
    if (t === 'towers' || t === 'houses' || t === 'farm'){ kind = 'dumpster'; n = (rng() < D.dumpster[0] ? 1 : 0) + (rng() < D.dumpster[1] ? 1 : 0); }
    else if (t === 'warehouses') n = rng() < 0.5 ? 1 : 0;
    else if (t === 'lot') n = outer ? (rng() < 0.4 ? 1 : 0) : randi(1,2);
    else if (t === 'yard') n = randi(2,3);
    else if (t === 'ruins') n = rng() < (outer ? 0.4 : 0.7) ? 1 : 0;
    else if (t === 'field' || t === 'pond') n = rng() < 0.12 ? 1 : 0;
    else if (t === 'construction') n = randi(1,2);
    else if (t === 'camp') n = rng() < 0.7 ? 1 : 0;
    else if (t === 'crater') n = rng() < 0.3 ? 1 : 0;
    for (let i=0;i<n && free.length;i++){
      const [x,z] = free.splice(Math.floor(rng()*free.length),1)[0];
      grid[I(x,z)] = T.OBSTACLE;
      containers.push({ kind, x, z, rot:(x === b.x0 || x === b.x0+4) ? Math.PI/2 : 0 });
    }
  }
  // Car trunks (landmark parking lots already rolled theirs in stamp()).
  for (const cr of cars) if (!cr.tpl && rng() < (cr.burnt ? 0.2 : 0.55)) containers.push({ kind:'trunk', x:cr.x, z:cr.z });
  // Tiles reachable on foot from the start, so doors always face somewhere you can stand.
  const reach = new Uint8Array(N*N), q = [I(2,2)]; reach[q[0]] = 1;
  for (let h=0;h<q.length;h++){
    const cx = q[h] % N, cz = (q[h]-cx)/N;
    for (const [dx,dz] of D4){ const ni = I(cx+dx,cz+dz); if (!reach[ni] && walkable(grid[ni])){ reach[ni] = 1; q.push(ni); } }
  }
  for (const b of buildings){
    if (b.ruined || b.lm || b.style === 'frame' || b.burnt || b.cut || rng() >= (b.style === 'crypt' ? 0.5 : DISTRICTS[b.district].door)) continue;
    const spots = [];
    for (let z=b.z;z<b.z+b.d;z++) for (let x=b.x;x<b.x+b.w;x++) for (const [dx,dz] of D4) if (reach[I(x+dx,z+dz)]) spots.push({ x, z, dx, dz });
    if (!spots.length) continue;
    const s = pick(spots);
    containers.push({ kind:'door', x:s.x, z:s.z, dx:s.dx, dz:s.dz, label:LABEL[b.style] });
  }
}
