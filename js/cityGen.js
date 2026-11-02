// ---------- City generation ----------
// Pure data: builds the tile grid and prop lists from a seed. No Three.js here.
// A city starts as b×b blocks of 5×5 tiles between 2-tile roads (b grows in later cities, cityBlocks in
// config.js), drawn into the top-left of the N×N tile arrays. Each block belongs to a district
// (DISTRICTS in config.js, laid out by LAYOUT) that decides what gets built on it and how many
// zombies (block.density, residents per block) and how much loot it holds. Then the grid is broken up
// (layoutStreets): blocks merge into big lots, take over streets beside them (T-junctions, dead ends),
// streets close to cars. What's built goes on lots (city.lots: one block or several, rect r in tiles).
// Landmarks are stamped from the ASCII TEMPLATES below; the big ones take a 2×2 group of blocks (the
// roads between them become part of the lot) and can be walked into.
import { N, T, CITY_NAMES, PALETTE, HOUSE_PALETTE, ROOF_PALETTE, WAREHOUSE_PALETTE, DISTRICTS, LAYOUT, CONDITIONS, CLOSURES, BLOCK_DENSITY, STREETS, cityBlocks, walkable } from './config.js';
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

// Splits a w×d area into building lots (some with a 1-tile alley between them). max = how many times
// it may split; keepBig leaves some big lots whole (big towers, factory halls).
function splitLots(x,z,w,d,out,depth,max = 3,keepBig = false){
  const area = w*d;
  if (depth > max || area <= 4 || (area <= 10 && rng() < 0.5) || (w < 4 && d < 4 && rng() < 0.6) || (keepBig && area <= 30 && w <= 6 && d <= 6 && rng() < 0.3)) { out.push({x,z,w,d}); return; }
  if (w >= d){
    if (w < 4) { out.push({x,z,w,d}); return; }
    const cut = randi(2, w-2), alley = w >= 5 && rng() < 0.35;
    splitLots(x,z,cut,d,out,depth+1,max,keepBig);
    const s = cut + (alley?1:0);
    if (w - s >= 1) splitLots(x+s,z,w-s,d,out,depth+1,max,keepBig);
  } else {
    if (d < 4) { out.push({x,z,w,d}); return; }
    const cut = randi(2, d-2), alley = d >= 5 && rng() < 0.35;
    splitLots(x,z,w,cut,out,depth+1,max,keepBig);
    const s = cut + (alley?1:0);
    if (d - s >= 1) splitLots(x,z+s,w,d-s,out,depth+1,max,keepBig);
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
  // overlays: tiles drawn with their own ground (parking asphalt, forecourt concrete, outpost dirt, paved
  // paths); floors: walk-in landmark type -> its floor tiles.
  // overlays.scorch: burnt ground; debris: loose rubble (no collision); smoke: rising plumes;
  // ponds/craters: water and blast holes; closures: road closures (for the dev tools).
  // lots: what's built where ({ blocks, r:{ x0, z0, w, d }, type, district }); strips: streets closed to
  // cars ({ kind, x0, z0, w, d }); deadEnds: crossings only one road leads to; crops: farmed tiles.
  const c = { grid, blocks, b:nb, n, cond, buildings:[], trees:[], cars:[], rubble:[], pillars:[], props:[], containers:[], landmarks:[], interiors:[],
    overlays:{ lot:[], pad:[], dirt:[], scorch:[], pave:[] }, floors:{}, debris:[], smoke:[], ponds:[], craters:[], closures:[], exitZ,
    lots:[], strips:[], deadEnds:[], crops:[] };

  const cb = pick(blocks.filter(b => b.bx + b.bz >= nb));
  cb.type = 'plaza';
  placeLandmarks(c, level);
  layoutStreets(c);
  for (const L of c.lots){
    if (!L.type){
      const start = L.blocks.some(b => b.bx + b.bz <= 1), D = DISTRICTS[L.district];
      L.type = wpick((L.blocks.length > 1 ? D.merged : D.blocks).filter(([t]) => !start || !EVENTFUL.has(t)).map(([t, w]) => [t, w*(C.mul[t] ?? 1)]));
    }
    for (const b of L.blocks){ b.type = L.type; b.lot = L.r; b.density *= BLOCK_DENSITY[L.type] || 1; }
  }
  for (const L of c.lots) if (L.type !== 'plaza') buildLot(c, L);
  for (const L of c.lots) if (L.type === 'plaza') buildLot(c, L);
  for (const s of c.strips) buildStrip(c, s);
  // Which block each tile belongs to: a block that took over a street owns it, other streets count
  // toward the block south-east of them.
  const blockOf = c.blockOf = new Int16Array(N*N), bf = v => Math.min(nb-1, Math.max(0, Math.floor((v-1)/7)));
  for (let z=0;z<N;z++) for (let x=0;x<N;x++) blockOf[I(x,z)] = bf(z)*nb + bf(x);
  for (const L of c.lots) if (L.ext){ const { x0, z0, w, d } = L.r, b = L.blocks[0]; for (let z=z0;z<z0+d;z++) for (let x=x0;x<x0+w;x++) blockOf[I(x,z)] = b.bz*nb + b.bx; }
  const road = new Uint8Array(N*N);
  for (let i=0;i<N*N;i++) road[i] = grid[i] === T.ROAD ? 1 : 0;
  addHeights(c);
  damage(c, C);
  addCrashes(c, C);
  addClosures(c, C, level);
  addWrecks(c, C, exitZ, n);
  placeLoot(c);
  tidyFences(c);
  return Object.assign(c, { road, crystalTile:{ x:cb.x0+2, z:cb.z0+2 }, start:{ x:2, z:2 }, name:pick(CITY_NAMES) });
}
// Block types kept away from the start's own blocks.
const EVENTFUL = new Set(['cemetery','camp','crater','construction']);

// ---------- Street layout ----------
// The streets start as a full grid. Node (i, j) is the crossing at tiles (1+7i, 1+7j), 0..b each way;
// V[i*b + j] is the street running south from node (i, j) (tiles x 1+7i..2+7i, z 3+7j..7+7j), H[j*b + i]
// the one running east from it. Each is 0 road, 1 gone (part of a lot now) or 2 closed to cars (a walk,
// footpath or dirt track: still open on foot). In turn, at the district's odds (STREETS): blocks merge
// into big lots (the streets between them go, a 2×2 lot swallows the crossing in its middle too), single
// blocks take over a street beside them (growing by 2 tiles; T-junctions and dead ends), and streets
// close. Every change must keep every crossing reachable, every crossing on at least one road (no
// stranded squares of asphalt) and every lot on at least one street. The border streets and the ones
// round the start, the plaza and landmarks never change.
function layoutStreets(c){
  const nb = c.b, M = nb + 1, V = new Uint8Array(M*nb), H = new Uint8Array(M*nb), inner = new Uint8Array(M*M), keep = new Set();
  const blk = (bx, bz) => bx >= 0 && bz >= 0 && bx < nb && bz < nb ? c.blocks[bz*nb + bx] : null;
  // The streets round block (bx, bz): west, east, north, south, as [array, index].
  const around = (bx, bz) => [[V, bx*nb + bz], [V, (bx+1)*nb + bz], [H, bz*nb + bx], [H, (bz+1)*nb + bx]];
  const key = (A, k) => (A === V ? 'v' : 'h') + k;
  // Streets out of node (i, j): [array, index, next i, next j].
  const edges = (i, j) => { const e = []; if (j < nb) e.push([V, i*nb + j, i, j+1]); if (j > 0) e.push([V, i*nb + j-1, i, j-1]); if (i < nb) e.push([H, j*nb + i, i+1, j]); if (i > 0) e.push([H, j*nb + i-1, i-1, j]); return e; };
  const rectV = k => { const i = Math.floor(k/nb), j = k % nb; return { x0:1+7*i, z0:3+7*j, w:2, d:5 }; };
  const rectH = k => { const j = Math.floor(k/nb), i = k % nb; return { x0:3+7*i, z0:1+7*j, w:5, d:2 }; };
  for (let k=0;k<nb;k++) for (const A of [V, H]){ keep.add(key(A, k)); keep.add(key(A, nb*nb + k)); }
  for (const b of c.blocks) if (b.type || b.bx + b.bz <= 1) for (const [A, k] of around(b.bx, b.bz)) keep.add(key(A, k));
  // Big landmarks already cover the streets and the crossing inside their 2×2 lot.
  for (const b of c.blocks){
    const l = b.lot; if (b.type !== 'landmark' || l.n !== 2 || l.bx !== b.bx || l.bz !== b.bz) continue;
    V[(b.bx+1)*nb + b.bz] = V[(b.bx+1)*nb + b.bz+1] = H[(b.bz+1)*nb + b.bx] = H[(b.bz+1)*nb + b.bx+1] = 1; inner[(b.bz+1)*M + b.bx+1] = 1;
  }
  const lots = [], lotOf = new Map();
  for (const b of c.blocks) if (b.type !== 'landmark'){ const L = { blocks:[b], r:{ x0:b.x0, z0:b.z0, w:5, d:5 }, district:b.district, type:b.type === 'plaza' ? 'plaza' : null, paths:[] }; lots.push(L); lotOf.set(b, L); }
  const ok = () => {
    const seen = new Uint8Array(M*M), q = [0]; seen[0] = 1;
    for (let h=0;h<q.length;h++){ const i = q[h] % M, j = (q[h] - i)/M; for (const [A, k, ni, nj] of edges(i, j)) if (A[k] !== 1 && !seen[nj*M + ni]){ seen[nj*M + ni] = 1; q.push(nj*M + ni); } }
    for (let id=0;id<M*M;id++){ if (inner[id]) continue; const i = id % M, j = (id - i)/M; if (!seen[id] || !edges(i, j).some(([A, k]) => A[k] === 0)) return false; }
    return lots.every(L => L.blocks.some(b => around(b.bx, b.bz).some(([A, k]) => A[k] !== 1)));
  };
  // Sets streets to val (and nodes inner) if the layout stays sound; otherwise puts them back.
  const attempt = (list, val, nodes = []) => {
    const old = list.map(([A, k]) => A[k]);
    for (const [A, k] of list) A[k] = val; for (const id of nodes) inner[id] = 1;
    if (ok()) return true;
    list.forEach(([A, k], i) => { A[k] = old[i]; }); for (const id of nodes) inner[id] = 0;
    return false;
  };
  const free = b => b && !b.type && lotOf.get(b).blocks.length === 1 && !lotOf.get(b).ext && b.bx + b.bz > 1;
  // Merges: 2×1 / 1×2 pairs, 3×1 rows, 2×2 squares of blocks of one district.
  for (const b of shuffle(c.blocks.slice())){
    if (!free(b)) continue;
    const S = STREETS[b.district]; if (rng() >= S.merge) continue;
    const r = rng(), shapes = r < S.big ? [[2,2],[2,1],[1,2]] : r < S.big + S.long ? shuffle([[3,1],[1,3]]).concat([[2,1],[1,2]]) : shuffle([[2,1],[1,2]]);
    for (const [gw, gd] of shapes){
      const g = [];
      for (let j=0;j<gd;j++) for (let i=0;i<gw;i++){ const o = blk(b.bx+i, b.bz+j); if (free(o) && o.district === b.district) g.push(o); }
      if (g.length < gw*gd) continue;
      const cut = [], nodes = [];
      for (let j=0;j<gd;j++) for (let i=1;i<gw;i++) cut.push([V, (b.bx+i)*nb + b.bz+j]);
      for (let j=1;j<gd;j++) for (let i=0;i<gw;i++) cut.push([H, (b.bz+j)*nb + b.bx+i]);
      for (let j=1;j<gd;j++) for (let i=1;i<gw;i++) nodes.push((b.bz+j)*M + b.bx+i);
      const L = { blocks:g, r:{ x0:b.x0, z0:b.z0, w:7*gw - 2, d:7*gd - 2 }, district:b.district, type:null,
        paths:cut.map(([A, k]) => A === V ? rectV(k) : rectH(k)).concat(nodes.map(id => ({ x0:1 + 7*(id % M), z0:1 + 7*Math.floor(id/M), w:2, d:2 }))) };
      const olds = g.map(o => lotOf.get(o));
      for (const o of olds) lots.splice(lots.indexOf(o), 1);
      lots.push(L);
      if (attempt(cut, 1, nodes)){ for (const o of g) lotOf.set(o, L); break; }
      lots.pop(); lots.push(...olds);
    }
  }
  // Single blocks taking over the street on one side (or both sides of one axis).
  for (const b of shuffle(c.blocks.slice())){
    if (!free(b) || rng() >= STREETS[b.district].extend) continue;
    const [w, e, n, s] = around(b.bx, b.bz), L = lotOf.get(b), r = L.r;
    const sides = shuffle(rng() < 0.5 ? [[w, 'w'], [e, 'e']] : [[n, 'n'], [s, 's']]);
    for (const [[A, k], sd] of sides.slice(0, rng() < 0.25 ? 2 : 1)){
      if (keep.has(key(A, k)) || A[k] !== 0 || !attempt([[A, k]], 1)) continue;
      if (sd === 'w'){ r.x0 -= 2; r.w += 2; } else if (sd === 'e') r.w += 2; else if (sd === 'n'){ r.z0 -= 2; r.d += 2; } else r.d += 2;
      L.ext = true;
    }
  }
  // Streets closed to cars.
  const KIND = { downtown:'walk', industrial:'walk', residential:'path', outskirts:'track' };
  const closeSt = (A, k, b0, b1) => {
    if (keep.has(key(A, k)) || A[k] !== 0) return;
    const d = (rng() < 0.5 ? b0 : b1).district;
    if (rng() < STREETS[d].walk && attempt([[A, k]], 2)) c.strips.push(Object.assign({ kind:KIND[d], district:d }, A === V ? rectV(k) : rectH(k)));
  };
  for (let i=1;i<nb;i++) for (let j=0;j<nb;j++){ closeSt(V, i*nb + j, blk(i-1, j), blk(i, j)); closeSt(H, i*nb + j, blk(j, i-1), blk(j, i)); }
  for (let id=0;id<M*M;id++){
    if (inner[id]) continue;
    const i = id % M, j = (id - i)/M;
    if (edges(i, j).filter(([A, k]) => A[k] === 0).length === 1) c.deadEnds.push({ x:1 + 7*i, z:1 + 7*j });
  }
  c.lots = lots;
}

// ---------- Lots ----------
// What gets built on a lot: one block, or several merged (a big lot, `big`), or a block grown over a
// street. Everything is laid out inside its rect r; big lots get more of it and things single blocks
// can't hold (big towers and factory halls, park paths where the streets ran, big hills, embankments,
// crops, shipping containers, cemeteries full of graves).
function buildLot(c, L){
  const { grid } = c, { x0, z0, w, d } = L.r, x1 = x0 + w, z1 = z0 + d, D = L.district, t = L.type, big = L.blocks.length > 1, k = w*d/25;
  const res = new Set();  // tiles kept free for raised ground built later (addHeights)
  const fill = tt => { for (let z=z0;z<z1;z++) for (let x=x0;x<x1;x++) grid[I(x,z)] = tt; };
  const spot = (tt, f) => { const x = x0 + randi(0, w-1), z = z0 + randi(0, d-1), i = I(x,z); if (grid[i] === tt && !res.has(i)){ grid[i] = T.OBSTACLE; f(x, z); } };
  const many = (a, b) => Math.max(0, Math.round(rand(a, b)*k));  // a count that grows with the lot's area
  const tree = (x, z) => c.trees.push({ x, z, s:rand(0.8,1.3), m:Math.floor(rng()*3) });
  // A stack of lumber you can search for planks.
  const lumber = (x, z) => { c.props.push({ kind:'lumber', x, z, rot:rng() < 0.5 ? 0 : Math.PI/2, search:true }); c.containers.push({ kind:'lumber', x, z }); };
  const dirt = () => { for (let z=z0;z<z1;z++) for (let x=x0;x<x1;x++) c.overlays.dirt.push([x,z]); };
  const put = (P, h, o) => {
    for (let z=P.z;z<P.z+P.d;z++) for (let x=P.x;x<P.x+P.w;x++) grid[I(x,z)] = T.BUILDING;
    c.buildings.push(Object.assign({ x:P.x, z:P.z, w:P.w, d:P.d, h, district:D }, o));
  };
  // Keeps a hw×hd area (and a ring round it for its ramps) clear for raised ground: a hill, a terrace or
  // an embankment, raised in addHeights.
  const reserve = (kind, hw, hd) => {
    hw = Math.min(hw, w - 2); hd = Math.min(hd, d - 2); if (hw < 1 || hd < 1) return;
    const rx = x0 + 1 + randi(0, w - 2 - hw), rz = z0 + 1 + randi(0, d - 2 - hd);
    for (let z=rz-1;z<=rz+hd;z++) for (let x=rx-1;x<=rx+hw;x++) res.add(I(x,z));
    L.raise = { kind, x0:rx, z0:rz, w:hw, d:hd };
  };
  // A railway embankment along the lot's long side.
  const berm = () => w >= d ? reserve('berm', w - 2, 1) : reserve('berm', 1, d - 2);
  // A patch of crops in rows (cosmetic, walkable).
  const crops = () => {
    const cw = randi(3, Math.min(8, w - 2)), cd = randi(2, Math.min(5, d - 2)), cx = x0 + 1 + randi(0, w - 2 - cw), cz = z0 + 1 + randi(0, d - 2 - cd);
    for (let z=cz;z<cz+cd;z++) for (let x=cx;x<cx+cw;x++) if (grid[I(x,z)] === T.GRASS && !res.has(I(x,z))) c.crops.push([x, z, cw >= cd ? 1 : 0]);
  };
  // Footpaths where the streets of a merged lot used to run (one lane of each, the whole crossing).
  const paths = () => { for (const s of L.paths){ const lane = randi(0, 1); for (let z=s.z0;z<s.z0+s.d;z++) for (let x=s.x0;x<s.x0+s.w;x++){
    if (s.w === 2 && s.d === 5 && x !== s.x0 + lane || s.d === 2 && s.w === 5 && z !== s.z0 + lane || grid[I(x,z)] !== T.GRASS) continue;
    grid[I(x,z)] = T.SIDEWALK; c.overlays.pave.push([x,z]); } } };
  const grave = (x, z) => { grid[I(x,z)] = T.LOW; c.props.push({ kind:'grave', x, z, rot:0, n:randi(2,3), seed:Math.floor(rng()*1e6) }); };
  // Every other tile inside the lot's edge: grave plots, tent pitches.
  const pitches = () => { const a = []; for (let z=z0+1;z<z1-1;z+=2) for (let x=x0+1;x<x1-1;x+=2) a.push([x,z]); return a; };
  if (t === 'towers' || t === 'ruins'){
    fill(T.SIDEWALK);
    const lots = []; splitLots(x0, z0, w, d, lots, 0, big ? 6 : 3, big && t === 'towers');
    const ruined = t === 'ruins';
    for (const P of lots){
      if (rng() < (ruined ? 0.08 : big ? 0.1 : 0.05)){
        // An empty lot downtown is a little square with a tree.
        if (!ruined && P.w*P.d >= 4){ const x = P.x + randi(0, P.w-1), z = P.z + randi(0, P.d-1); grid[I(x,z)] = T.OBSTACLE; c.trees.push({ x, z, s:rand(0.8,1.1), m:Math.floor(rng()*3), planter:true }); }
        continue;
      }
      if (ruined && rng() < 0.35){
        const rx = P.x + Math.floor(rng()*P.w), rz = P.z + Math.floor(rng()*P.d);
        grid[I(rx,rz)] = T.OBSTACLE; c.rubble.push({ x:rx, z:rz }); continue;
      }
      const h = ruined ? rand(1.2,3) : rand(5,9) + rng()*rng()*12 + (P.w*P.d >= 12 ? rand(2,8) : 0);
      put(P, h, { style:ruined ? 'ruin' : 'tower', color:pick(PALETTE), ruined, win:Math.floor(rng()*3), ac:rng() < 0.5 });
    }
  } else if (t === 'houses' || t === 'farm'){
    // Low houses with yards around them: lots shrink to leave grass, some stay empty. A big farm has a
    // barn and fields of crops.
    fill(T.GRASS);
    if (big && t === 'farm') crops();
    const lots = []; splitLots(x0, z0, w, d, lots, 0, big ? 6 : 3);
    let barn = big && t === 'farm';
    for (const P of shuffle(lots)){
      if (rng() < (t === 'farm' ? 0.6 : 0.2)) continue;
      if (P.w >= 3){ P.w--; if (rng() < 0.5) P.x++; }
      if (P.d >= 3){ P.d--; if (rng() < 0.5) P.z++; }
      let crop = false; for (let z=P.z;z<P.z+P.d;z++) for (let x=P.x;x<P.x+P.w;x++) if (c.crops.some(q => q[0] === x && q[1] === z)) crop = true;
      if (crop) continue;
      if (barn && P.w*P.d >= 4){ barn = false; put(P, rand(3.4,4.4), { style:'warehouse', color:pick([0x7a3328,0x6b2f26,0x8a4a32]), ac:false }); continue; }
      put(P, rand(2.3,3.3), { style:'house', color:pick(HOUSE_PALETTE), roof:pick(ROOF_PALETTE), win:Math.floor(rng()*3) });
    }
    for (let i=many(0,2);i>0;i--) spot(T.GRASS, tree);
    // Picket fences round suburban yards, rail fences round farms (gates in them, bits knocked down).
    if (rng() < (t === 'farm' ? 0.55 : 0.4)) fenceRing(c, L.r, t === 'farm' ? 'rail' : 'picket', { broken:0.35 });
  } else if (t === 'warehouses'){
    // Warehouses; a big lot has factory halls and a smokestack or two.
    fill(T.SIDEWALK);
    const lots = []; splitLots(x0, z0, w, d, lots, 2, 3, big);
    for (const P of lots){
      if (rng() < 0.12) continue;
      put(P, rand(3,4.6) + (P.w*P.d >= 15 ? rand(0.8,1.8) : 0), { style:'warehouse', color:pick(WAREHOUSE_PALETTE), ac:rng() < 0.6 });
    }
    if (big) for (let i=randi(1,2);i>0;i--) spot(T.SIDEWALK, (x, z) => { const h = rand(9,14); c.props.push({ kind:'stack', x, z, h }); if (rng() < 0.4) c.smoke.push({ x:x+0.5, z:z+0.5, s:1, y:h }); });
  } else if (t === 'park' || t === 'field'){
    fill(T.GRASS);
    if (big){
      // Footpaths where the streets ran, and raised ground: a big hill (maybe with a summit), a stepped
      // terrace downtown, or in a field an old railway embankment.
      if (t === 'park') paths();
      if (t === 'field' && rng() < 0.4) berm();
      else if (rng() < 0.85) reserve(D === 'downtown' && t === 'park' ? 'terrace' : 'knoll', randi(3, 6), randi(3, 5));
      if (t === 'field' && rng() < 0.6) crops();
      if (t === 'park' && rng() < 0.45) for (let i=0;i<8;i++){
        const pw = randi(2,4), pd = randi(2,3), px = x0 + 1 + randi(0, Math.max(0, w - 2 - pw)), pz = z0 + 1 + randi(0, Math.max(0, d - 2 - pd));
        let fits = true; for (let z=pz-1;z<=pz+pd;z++) for (let x=px-1;x<=px+pw;x++) if (grid[I(x,z)] !== T.GRASS || res.has(I(x,z))) fits = false;
        if (!fits) continue;
        for (let z=pz;z<pz+pd;z++) for (let x=px;x<px+pw;x++) grid[I(x,z)] = T.WATER;
        c.ponds.push({ x0:px, z0:pz, x1:px+pw, z1:pz+pd }); break;
      }
    } else if (t === 'park' && D === 'downtown' && rng() < 0.6) L.raise = { kind:'terrace' };  // a raised terrace: trees stay round the edge
    for (let i=t === 'park' ? many(3,6) : many(0,2);i>0;i--){
      if (!L.raise || L.raise.w) spot(T.GRASS, tree);
      else { const q = randi(0,15), [x, z] = q < 5 ? [x0+q, z0] : q < 10 ? [x0+q-5, z0+4] : q < 13 ? [x0, z0+q-9] : [x0+4, z0+q-12]; if (grid[I(x,z)] === T.GRASS){ grid[I(x,z)] = T.OBSTACLE; tree(x, z); } }
    }
    if (t === 'field' && rng() < 0.3*k) spot(T.GRASS, (x, z) => c.rubble.push({ x, z }));
    if (t === 'field' && rng() < (big ? 0.55 : 0.4)) fenceRing(c, L.r, 'rail', { broken:0.45, gate:0.8 });
  } else if (t === 'lot'){
    fill(T.SIDEWALK);
    for (let i=D === 'downtown' ? many(3,5) : D === 'outskirts' ? many(1,2) : many(2,4);i>0;i--)
      spot(T.SIDEWALK, (x, z) => c.cars.push({ x, z, rot:(rng()<0.5?0:Math.PI/2) + rand(-0.15,0.15), color:pick([0x6b2b2b,0x2b4a6b,0x9a9a92,0x3a3f45,0x6b5a2b,0x2f5a3c]), burnt:rng() < 0.08*CONDITIONS[c.cond].wrecks }));
  } else if (t === 'yard'){
    // Industrial storage: pallets of lumber, plus crates from placeLoot(); a big yard has rows of
    // shipping containers (some stacked two high) behind a chain-link fence.
    fill(T.SIDEWALK);
    for (let i=many(1,3);i>0;i--) spot(T.SIDEWALK, (x, z) => lumber(x, z));
    if (big) for (let i=many(1,2.2);i>0;i--){
      const ax = rng() < 0.5, x = x0 + 1 + randi(0, w - (ax ? 4 : 3)), z = z0 + 1 + randi(0, d - (ax ? 3 : 4)), x2 = ax ? x+1 : x, z2 = ax ? z : z+1;
      if (grid[I(x,z)] !== T.SIDEWALK || grid[I(x2,z2)] !== T.SIDEWALK) continue;
      grid[I(x,z)] = grid[I(x2,z2)] = T.OBSTACLE;
      c.props.push({ kind:'shipping', x, z, cx:(x + x2)/2 + 0.5, cz:(z + z2)/2 + 0.5, rot:ax ? 0 : Math.PI/2, color:pick([0x8a3a2a,0x2d5f8a,0x3f6b3a,0xc0802a,0x6b6f74]), top:rng() < 0.35 ? pick([0x8a3a2a,0x2d5f8a,0xc0802a]) : 0 });
    }
    if (rng() < (big ? 0.8 : 0.35)) fenceRing(c, L.r, 'chain', { broken:0.4 });
  } else if (t === 'construction'){
    // Building site on dirt: a steel frame going up, a tower crane (two on a big site), concrete pipes and
    // lumber, a chain-link fence round it (crates from placeLoot()).
    fill(T.SIDEWALK); dirt();
    const fw = big ? randi(3,5) : randi(2,3), fd = big ? randi(3,4) : randi(2,3);
    put({ x:x0 + 1 + randi(0, w-2-fw), z:z0 + 1 + randi(0, d-2-fd), w:fw, d:fd }, rand(6,12) + (big ? rand(2,6) : 0), { style:'frame', color:0x8a8780, floors:randi(2,4) + (big ? 1 : 0) });
    for (let i=big ? 2 : 1;i>0;i--) spot(T.SIDEWALK, (x, z) => c.props.push({ kind:'crane', x, z, rot:Math.floor(rng()*4)*Math.PI/2, h:rand(15,20), jib:rand(9,13) }));
    for (let i=many(1,2);i>0;i--) spot(T.SIDEWALK, (x, z) => rng() < 0.5 ? c.props.push({ kind:'pipes', x, z, rot:rng() < 0.5 ? 0 : Math.PI/2 }) : lumber(x, z));
    fenceRing(c, L.r, 'chain', { broken:0.3, gate:0.8 });
  } else if (t === 'cemetery'){
    // Iron fence round the edge with a gate in the middle of each side, rows of graves on every other
    // tile, a crypt (or an old tree) in the middle; a big cemetery has a few crypts among its rows.
    fill(T.GRASS);
    fenceRing(c, L.r, 'iron', { mid:true, broken:0.2 });
    const crypt = (x, z) => put({ x, z, w:1, d:1 }, rand(2.2,2.8), { style:'crypt', color:pick([0x8f8c86,0x7d7a74,0x99948a]), roof:0x45464b });
    if (!big){
      for (const [x, z] of pitches()) grave(x, z);
      if (rng() < 0.6) crypt(x0+2, z0+2); else { grid[I(x0+2,z0+2)] = T.OBSTACLE; tree(x0+2, z0+2); }
    } else {
      const ps = shuffle(pitches()), nc = randi(1, 1 + L.blocks.length/2);
      ps.forEach(([x, z], i) => i < nc ? crypt(x, z) : i < nc + 2 && rng() < 0.6 ? (grid[I(x,z)] = T.OBSTACLE, tree(x, z)) : grave(x, z));
    }
  } else if (t === 'camp'){
    // Abandoned relief camp: rows of tents on dirt (one a first-aid tent), burn barrels, a fence.
    fill(T.GRASS); dirt();
    shuffle(pitches()).forEach(([x, z], i) => {
      if (i > 0 && rng() < 0.25) return;
      grid[I(x,z)] = T.OBSTACLE; c.props.push({ kind:i === 0 ? 'medtent' : 'tent', x, z, rot:rng() < 0.5 ? 0 : Math.PI });
    });
    for (let i=many(1,2);i>0;i--) spot(T.GRASS, (x, z) => { const lit = rng() < 0.65; c.props.push({ kind:'barrel', x, z, lit }); if (lit) c.smoke.push({ x:x+0.5, z:z+0.5, s:0.5 }); });
    if (rng() < 0.6) fenceRing(c, L.r, 'chain', { broken:0.5 });
  } else if (t === 'pond'){
    // A park around a pond (water blocks walking, not sight), with trees; a big one is a lake of two
    // overlapping pools with paths where the streets ran.
    fill(T.GRASS);
    if (big) paths();
    const pool = (pw, pd, px, pz) => {
      for (let z=pz;z<pz+pd;z++) for (let x=px;x<px+pw;x++){ if (grid[I(x,z)] === T.SIDEWALK) c.overlays.pave.splice(c.overlays.pave.findIndex(q => q[0] === x && q[1] === z), 1); grid[I(x,z)] = T.WATER; }
      c.ponds.push({ x0:px, z0:pz, x1:px+pw, z1:pz+pd });
    };
    const pw = big ? randi(3, Math.min(6, w-2)) : randi(2,3), pd = big ? randi(2, Math.min(4, d-2)) : randi(2,3), px = x0 + 1 + randi(0, w-2-pw), pz = z0 + 1 + randi(0, d-2-pd);
    pool(pw, pd, px, pz);
    if (big && rng() < 0.7){
      const qw = randi(2, Math.min(5, w-2)), qd = randi(2, Math.min(5, d-2));
      pool(qw, qd, Math.max(x0+1, Math.min(x1-1-qw, px + randi(-2, pw))), Math.max(z0+1, Math.min(z1-1-qd, pz + randi(-2, pd))));
    }
    for (let i=many(2,4);i>0;i--) spot(T.GRASS, tree);
  } else if (t === 'crater'){
    // A shell hit: a blast hole in the middle (some flooded), scorched ground, rubble, a burnt car.
    fill(T.SIDEWALK);
    const cx = x0 + (w >> 1), cz = z0 + (d >> 1), wet = rng() < 0.3;
    grid[I(cx,cz)] = wet ? T.WATER : T.LOW;
    c.craters.push({ x:cx+0.5, z:cz+0.5, r:rand(2.6,3.4), wet });
    for (let z=cz-1;z<=cz+1;z++) for (let x=cx-1;x<=cx+1;x++) if (x !== cx || z !== cz) c.overlays.scorch.push([x,z]);
    for (let i=many(1,3);i>0;i--) spot(T.SIDEWALK, (x, z) => c.rubble.push({ x, z }));
    for (let i=many(2,4);i>0;i--) c.debris.push([x0 + rand(0,w), z0 + rand(0,d)]);
    if (rng() < 0.5) spot(T.SIDEWALK, (x, z) => c.cars.push(wreck(x, z, rand(0,6.3), { burnt:true })));
    if (rng() < 0.5) c.smoke.push({ x:cx+0.5, z:cz+0.5, s:0.8 });
  } else if (t === 'plaza'){
    fill(T.PLAZA);
    grid[I(x0+2,z0+2)] = T.CRYSTAL;
    for (const [px,pz] of [[0,0],[4,0],[0,4],[4,4]]){ grid[I(x0+px,z0+pz)] = T.OBSTACLE; c.pillars.push({ x:x0+px, z:z0+pz, h:rand(1.4,3.6) }); }
  }
}

// A street closed to cars for good: a paved walk with planters (downtown, industrial), a footpath
// beside a strip of grass (suburbs) or a dirt track (outskirts). Always open end to end on foot.
function buildStrip(c, s){
  const { grid } = c, along = s.d > s.w;
  const at = (i, k) => along ? [s.x0 + k, s.z0 + i] : [s.x0 + i, s.z0 + k];  // i along the street (0..4), k across (0..1)
  const lane = randi(0, 1);
  for (let i=0;i<5;i++) for (let k=0;k<2;k++){
    const [x, z] = at(i, k);
    if (s.kind === 'walk'){ grid[I(x,z)] = T.SIDEWALK; c.overlays.pave.push([x,z]); }
    else if (s.kind === 'path'){ grid[I(x,z)] = k === lane ? T.SIDEWALK : T.GRASS; if (k === lane) c.overlays.pave.push([x,z]); }
    else { grid[I(x,z)] = T.SIDEWALK; c.overlays.dirt.push([x,z]); }
  }
  // Planters on alternate sides, so there's always a way through.
  if (s.kind === 'walk') for (const [i, k] of [[1, lane], [3, 1 - lane]]){ const [x, z] = at(i, k); grid[I(x,z)] = T.OBSTACLE; c.trees.push({ x, z, s:rand(0.75,1), m:Math.floor(rng()*3), planter:true }); }
  else if (s.kind === 'path' && rng() < 0.7){ const [x, z] = at(randi(1, 3), 1 - lane); grid[I(x,z)] = T.OBSTACLE; c.trees.push({ x, z, s:rand(0.8,1.2), m:Math.floor(rng()*3) }); }
  else if (s.kind === 'track' && rng() < 0.4){ const [x, z] = at(randi(1, 3), randi(0, 1)); grid[I(x,z)] = T.OBSTACLE; c.rubble.push({ x, z }); }
}

// ---------- Fences ----------
// A fence round rect r, on its edge tiles that are open ground. Buildings, trees and the like standing
// on the edge interrupt it, so every stretch runs up to something. Each stretch of 3 or more gets a
// gate (in the middle of the side with o.mid; o.gate = its chance, else always; chain-link and farm
// fences sometimes a double one), and each side, at chance o.broken, has a bit knocked down: fallen
// fence lying on the ground (walkable). tidyFences() cleans up the ends once everything is built.
function fenceRing(c, r, style, o = {}){
  const { grid } = c, X1 = r.x0 + r.w - 1, Z1 = r.z0 + r.d - 1;
  const open = i => grid[i] === T.SIDEWALK || grid[i] === T.GRASS;
  const line = (n, f) => { const a = []; for (let i=0;i<n;i++) a.push(f(i)); return a; };
  const sides = [line(r.w, i => [r.x0+i, r.z0]), line(r.d, i => [X1, r.z0+i]), line(r.w, i => [r.x0+i, Z1]), line(r.d, i => [r.x0, r.z0+i])];
  const role = new Map(), rot = new Map();
  sides.forEach((S, si) => {
    const runs = []; let cur = null;
    S.forEach(([x, z], i) => { if (open(I(x,z))){ if (!cur) runs.push(cur = []); cur.push(i); } else cur = null; });
    for (const run of runs){
      // Gates keep off the corners (and the tiles next to them when the side is long enough).
      const away = S.length >= 6 ? 2 : 1, inner = run.filter(i => i >= away && i < S.length - away), mid = S.length >> 1;
      if (run.length < 3 || !inner.length || rng() >= (o.gate ?? 1)) continue;
      const g = o.mid && inner.includes(mid) ? mid : pick(inner), g2 = g + (rng() < 0.5 ? 1 : -1);
      role.set(I(...S[g]), 'gate');
      if ((style === 'chain' || style === 'rail') && run.length >= 6 && inner.includes(g2) && rng() < 0.5) role.set(I(...S[g2]), 'gate');
    }
    if (rng() < (o.broken || 0)){ const n = randi(1, 3), s0 = randi(0, S.length - n); for (let i=s0;i<s0+n;i++){ const id = I(...S[i]); if (role.get(id) !== 'gate') role.set(id, 'broken'); } }
    for (const [x, z] of S) if (!rot.has(I(x,z))) rot.set(I(x,z), si % 2 ? Math.PI/2 : 0);
  });
  for (const S of sides) for (const [x, z] of S){
    const id = I(x,z), ro = rot.get(id); if (!open(id) || ro === undefined) continue;
    const R = role.get(id), g = grid[id]; rot.delete(id);
    if (R === 'gate') c.props.push({ kind:'fgate', x, z, rot:ro, style });
    else if (R === 'broken') c.props.push(brokenFence(x, z, ro, style, g));
    else { grid[id] = T.FENCE; c.props.push({ kind:'fence', x, z, rot:ro, style, under:g }); }
  }
}
// A fallen piece of fence on an open tile: lying flat (lean ~1.45) or half over, toward `side`.
const brokenFence = (x, z, rot, style, under, lean) => ({ kind:'fence', broken:true, x, z, rot, style, under, lean:lean ?? rand(1.25, 1.5), side:rng() < 0.5 ? 1 : -1 });
// Every fence end should meet something: a building, a wall, a tree, a car, water, raised ground, a gate,
// another fence. Where one stops in the open, the rest of it lies broken on the ground: fallen pieces fill
// the gap up to the next solid thing (up to 3 tiles), or else one lies just past the end; with no open
// ground past it (a road, a ramp) the end itself is knocked down. Then each gate hangs off a post beside it.
function tidyFences(c){
  const { grid, props } = c, L = c.level, at = new Map();
  // Gates and fallen pieces something was built on since (a container, a closure, a ramp) are gone.
  for (let i=props.length-1;i>=0;i--){ const p = props[i], id = I(p.x, p.z); if ((p.kind === 'fgate' || p.broken) && (L[id] || (grid[id] !== T.SIDEWALK && grid[id] !== T.GRASS))) props.splice(i, 1); }
  for (const p of props) if (p.kind === 'fence' || p.kind === 'fgate' || p.kind === 'cart' || p.kind === 'flag' || p.kind === 'gate') at.set(I(p.x, p.z), p);
  const marked = i => { const p = at.get(i); return p && (p.kind === 'fgate' || p.broken); };
  // A fence, or what continues one: a gate in it, a piece of it lying broken.
  const fence = i => grid[i] === T.FENCE || marked(i);
  const meets = (i, lv) => !walkable(grid[i]) || L[i] !== lv || marked(i);
  const ground = (i, lv) => (grid[i] === T.SIDEWALK || grid[i] === T.GRASS) && L[i] === lv && !at.has(i);
  const ends = [];
  for (const p of props){
    if (p.kind !== 'fence' || p.broken) continue;
    const i = I(p.x, p.z), hx = fence(i+1) || fence(i-1), hz = fence(i+N) || fence(i-N);
    if (hx && hz) continue;
    const [ax, az] = hx ? [1, 0] : hz ? [0, 1] : p.rot ? [0, 1] : [1, 0];
    for (const s of [1, -1]) if (!fence(I(p.x + ax*s, p.z + az*s))) ends.push([p, ax*s, az*s]);
  }
  for (const [p, dx, dz] of ends){
    if (p.broken) continue;
    const i = I(p.x, p.z), lv = L[i];
    if (meets(I(p.x+dx, p.z+dz), lv)) continue;
    const gap = []; let k = 1;
    for (;k<=4;k++){ const j = I(p.x + dx*k, p.z + dz*k); if (!ground(j, lv)) break; gap.push(j); }
    const lay = (j, lean) => { const q = brokenFence(j % N, Math.floor(j/N), p.rot, p.style, grid[j], lean); props.push(q); at.set(j, q); };
    if (gap.length && gap.length <= 3 && meets(I(p.x + dx*k, p.z + dz*k), lv)) gap.forEach((j, n) => lay(j, n ? undefined : rand(0.5, 1.1)));
    else if (gap.length) lay(gap[0], rand(0.6, 1.5));
    else { grid[i] = p.under; Object.assign(p, brokenFence(p.x, p.z, p.rot, p.style, p.under, rand(0.6, 1.5))); }
  }
  // Gates: hinged on a fence post beside them, swung open (mostly inward) or ajar; with nothing to hang
  // from, lying on the ground.
  for (const p of props){
    if (p.kind !== 'fgate') continue;
    const [ax, az] = p.rot ? [0, 1] : [1, 0], opts = [[ax, az], [-ax, -az]].filter(([dx, dz]) => grid[I(p.x + dx, p.z + dz)] === T.FENCE);
    p.h = opts.length ? pick(opts) : [ax, az]; p.fallen = !opts.length || rng() < 0.08;
    p.swing = rng() < 0.5 ? 1 : -1; p.ajar = rand(0.45, 1);
  }
}

// ---------- Wrecks, damage and road closures ----------
// Which block a tile belongs to (city.blockOf).
const blockAt = (c, x, z) => c.blocks[c.blockOf[I(x,z)]];
const BASIC_T = new Set(['towers','ruins','houses','farm','warehouses','park','field','lot','yard','construction','camp','crater','pond']);
// Keeps the start corner, the exit and landmark entrances clear of anything that blocks a road.
function clearSpot(c, x, z){
  if (x < 11 && z < 11) return false;
  if (c.level && c.level[I(x,z)]) return false;
  if (x > c.n - 10 && Math.abs(z - c.exitZ) < 6) return false;
  return c.landmarks.every(l => Math.abs(l.ox - x) + Math.abs(l.oz - z) > 3);
}
// Tiles reachable on foot from the start: { n, at } (at[i] = 1 if reachable).
function reach(c){
  const at = new Uint8Array(N*N), q = [I(2,2)]; at[q[0]] = 1;
  for (let h=0;h<q.length;h++){
    const cx = q[h] % N, cz = (q[h]-cx)/N;
    for (const [dx,dz] of D4){ const ni = I(cx+dx,cz+dz); if (!at[ni] && walkable(c.grid[ni]) && (!c.level || c.level[ni] <= c.level[q[h]] + 1)){ at[ni] = 1; q.push(ni); } }
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

// ---------- Raised ground ----------
// Grassy hills in parks and fields, loading docks along warehouse fronts, raised terraces in downtown
// parks, railway embankments across big fields (lot.raise). A top is only reachable up its ramps or stairs
// (rampDir = the D4 index you climb toward), so it's a spot to hold with one way up. Big hills and
// terraces can have a second tier on top (tier 2: levels 3 and 4), up its own ramp from the first.
// Each one is kept only if it cuts nothing off.
// raised = { kind, x0, z0, x1, z1 (top, end-exclusive), ramps:[[x, z, dir]], tier } for cityScene.
// Ramp directions are indices into RAMP_DIRS, the order grid.js and cityScene.js read them in.
const RAMP_DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const D4I = (dx, dz) => RAMP_DIRS.findIndex(d => d[0] === dx && d[1] === dz);
function raise(c, kind, x0, z0, x1, z1, ramps, tier = 1){
  const { grid } = c, want = kind === 'dock' ? T.SIDEWALK : null, base = 2*(tier - 1);
  const ok = (x, z) => { const g = grid[I(x,z)]; return c.level[I(x,z)] === base && (want ? g === want : g === T.GRASS || g === T.SIDEWALK); };
  for (let z=z0;z<z1;z++) for (let x=x0;x<x1;x++) if (!ok(x, z)) return false;
  ramps = ramps.filter(([x, z]) => ok(x, z));
  if (!ramps.length) return false;
  const R = c.reach || (c.reach = reach(c)), old = [];
  for (let z=z0;z<z1;z++) for (let x=x0;x<x1;x++){ old.push(I(x,z)); c.level[I(x,z)] = base + 2; }
  for (const [x, z, d] of ramps){ old.push(I(x,z)); c.level[I(x,z)] = base + 1; c.rampDir[I(x,z)] = d; }
  const r = reach(c);
  if (r.n !== R.n){ for (const i of old) c.level[i] = base; return false; }
  c.reach = r; c.raised.push({ kind, x0, z0, x1, z1, ramps, tier });
  return true;
}
// One ramp per side of a rect (a random spot along it, or the middle for stairs), climbing toward it.
const rampsRound = (x0, z0, x1, z1, mid) => {
  const ax = () => mid ? (x0 + x1 - 1) >> 1 : randi(x0, x1 - 1), az = () => mid ? (z0 + z1 - 1) >> 1 : randi(z0, z1 - 1);
  return [[ax(), z0 - 1, D4I(0,1)], [ax(), z1, D4I(0,-1)], [x0 - 1, az(), D4I(1,0)], [x1, az(), D4I(-1,0)]];
};
// Trees on a hill top, away from the tops of its ramps.
function topTrees(c, R, n){
  for (let i=0;i<n*3 && n>0;i++){
    const x = randi(R.x0, R.x1 - 1), z = randi(R.z0, R.z1 - 1);
    if (R.ramps.some(([rx, rz]) => Math.abs(rx - x) + Math.abs(rz - z) <= 1) || c.grid[I(x,z)] !== T.GRASS) continue;
    if (tryBlock(c, [[x, z, T.OBSTACLE]])){ c.trees.push({ x, z, s:rand(0.8,1.2), m:Math.floor(rng()*3) }); n--; }
  }
}
// A big lot's reserved raised ground: an embankment (a long ridge, ramps at both ends), or a hill or
// terrace with ramps (stairs) up two or three sides and maybe a second tier inset on top of it.
function bigRaise(c, R){
  const { kind, x0, z0, w, d } = R, x1 = x0 + w, z1 = z0 + d;
  if (kind === 'berm'){
    raise(c, 'berm', x0, z0, x1, z1, w >= d ? [[x0-1, z0, D4I(1,0)], [x1, z0, D4I(-1,0)]] : [[x0, z0-1, D4I(0,1)], [x0, z1, D4I(0,-1)]]);
    return;
  }
  const stairs = kind === 'terrace';
  if (!raise(c, kind, x0, z0, x1, z1, shuffle(rampsRound(x0, z0, x1, z1, stairs)).slice(0, randi(2, stairs ? 4 : 3)))) return;
  const low = c.raised[c.raised.length - 1];
  if (w >= 4 && d >= 3 && rng() < 0.7){
    const uw = randi(2, w - 2), ud = randi(1, d - 2), ux = x0 + 1 + randi(0, w - 2 - uw), uz = z0 + 1 + randi(0, d - 2 - ud);
    // Its ramps start on the first tier: best where there's a tile of it in front to climb from.
    const all = rampsRound(ux, uz, ux + uw, uz + ud, stairs), room = all.filter(([x, z, dir]) => { const [dx, dz] = RAMP_DIRS[dir], bx = x - dx, bz = z - dz; return bx >= x0 && bx < x1 && bz >= z0 && bz < z1; });
    if (raise(c, kind, ux, uz, ux + uw, uz + ud, shuffle(room.length ? room : all).slice(0, randi(1, 2)), 2) && kind === 'knoll') topTrees(c, c.raised[c.raised.length - 1], randi(0, 1));
  }
  if (kind === 'knoll') topTrees(c, low, randi(0, 2));
}
function addHeights(c){
  c.level = new Uint8Array(N*N); c.rampDir = new Uint8Array(N*N); c.raised = []; c.reach = null;
  for (const L of c.lots){
    if (L.blocks.some(b => b.bx + b.bz <= 1)) continue;
    const { x0, z0, w, d } = L.r, t = L.type, R = L.raise;
    if (R && R.w) bigRaise(c, R);
    else if (R && R.kind === 'terrace'){
      // The middle 3×3 up a flight of steps on two opposite sides.
      const cx = x0 + (w >> 1), cz = z0 + (d >> 1), ax = rng() < 0.5;
      raise(c, 'terrace', cx-1, cz-1, cx+2, cz+2, ax ? [[cx-2, cz, D4I(1,0)], [cx+2, cz, D4I(-1,0)]] : [[cx, cz-2, D4I(0,1)], [cx, cz+2, D4I(0,-1)]]);
    } else if (!R && ((t === 'park' && rng() < 0.4) || (t === 'field' && rng() < 0.3) || (t === 'farm' && rng() < 0.2) || (t === 'camp' && rng() < 0.15))){
      // A hill: a 2×2 to 3×2 top inside the lot, a ramp up one side (sometimes two).
      const hw = randi(2,3), hd = hw === 3 ? 2 : randi(2,3), hx = x0 + 1 + randi(0, w - 2 - hw), hz = z0 + 1 + randi(0, d - 2 - hd);
      raise(c, 'knoll', hx, hz, hx + hw, hz + hd, shuffle(rampsRound(hx, hz, hx + hw, hz + hd)).slice(0, rng() < 0.35 ? 2 : 1));
    }
  }
  // Loading docks: along a warehouse's front (its roll-up door side, +z), a ramp at one end (long ones
  // on factory halls sometimes get one at each end).
  for (const b of c.buildings){
    if (b.style !== 'warehouse' || b.cut || rng() > 0.45) continue;
    const r = blockAt(c, b.x, b.z).lot, zf = b.z + b.d;
    if (!r || zf > r.z0 + r.d - 1) continue;
    const ramps = shuffle([[b.x - 1, zf, D4I(1,0)], [b.x + b.w, zf, D4I(-1,0)]]).filter(([x]) => x >= r.x0 && x < r.x0 + r.w);
    raise(c, 'dock', b.x, zf, b.x + b.w, zf + 1, ramps.slice(0, b.w >= 5 && rng() < 0.5 ? 2 : 1));
  }
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
    const low = (x, z, kd, o, tile = T.LOW) => { const under = grid[I(x,z)]; cells.push([x, z, tile]); add.push(() => c.props.push(Object.assign({ kind:kd, x, z, rot, under }, o))); };
    const solid = (x, z, f) => { cells.push([x, z, T.OBSTACLE]); add.push(f); };
    const car = (x, z, o) => solid(x, z, () => c.cars.push(wreck(x, z, rot + Math.PI/2 + rand(-0.9,0.9), o)));
    if (kind === 'barrier'){ const style = dist === 'residential' || dist === 'outskirts' ? 'sawhorse' : 'jersey'; for (const [tx,tz] of all) low(tx, tz, style); }
    else if (kind === 'fence') for (const [tx,tz] of all) low(tx, tz, 'fence', { style:'chain', sign:tx === lanes[0][0] && tz === lanes[0][1] }, T.FENCE);
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
const SEARCH = { s:'shelf', L:'locker', A:'armory', k:'desk', M:'medcab', X:'milcrate', w:'lumber' };
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
    const g0 = best.g[0], lot = { x0:g0.x0, z0:g0.z0, w:7*n - 2, d:7*n - 2, bx:best.bx, bz:best.bz, n };
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
  const { grid, buildings, cars, containers } = c;
  for (const L of c.lots){
    if (!BASIC.has(L.type)) continue;
    const { x0, z0, w, d } = L.r, D = DISTRICTS[L.district], free = [];
    for (let z=z0;z<z0+d;z++) for (let x=x0;x<x0+w;x++){
      const edge = x === x0 || x === x0+w-1 || z === z0 || z === z0+d-1, g = grid[I(x,z)];
      if ((g === T.SIDEWALK || g === T.GRASS) && edge && !c.level[I(x,z)]) free.push([x,z]);
    }
    let n = 0, kind = 'crate';
    const t = L.type, outer = L.district === 'outskirts';
    // Rolled once per block of the lot.
    for (let m=L.blocks.length;m>0;m--){
      if (t === 'towers' || t === 'houses' || t === 'farm'){ kind = 'dumpster'; n += (rng() < D.dumpster[0] ? 1 : 0) + (rng() < D.dumpster[1] ? 1 : 0); }
      else if (t === 'warehouses') n += rng() < 0.5 ? 1 : 0;
      else if (t === 'lot') n += outer ? (rng() < 0.4 ? 1 : 0) : randi(1,2);
      else if (t === 'yard') n += randi(2,3);
      else if (t === 'ruins') n += rng() < (outer ? 0.4 : 0.7) ? 1 : 0;
      else if (t === 'field' || t === 'pond') n += rng() < 0.12 ? 1 : 0;
      else if (t === 'construction') n += randi(1,2);
      else if (t === 'camp') n += rng() < 0.7 ? 1 : 0;
      else if (t === 'crater') n += rng() < 0.3 ? 1 : 0;
    }
    for (let i=0;i<n && free.length;i++){
      const [x,z] = free.splice(Math.floor(rng()*free.length),1)[0];
      grid[I(x,z)] = T.OBSTACLE;
      containers.push({ kind, x, z, rot:(x === x0 || x === x0+w-1) ? Math.PI/2 : 0 });
    }
  }
  // Car trunks (landmark parking lots already rolled theirs in stamp()).
  for (const cr of cars) if (!cr.tpl && rng() < (cr.burnt ? 0.2 : 0.55)) containers.push({ kind:'trunk', x:cr.x, z:cr.z });
  // Tiles reachable on foot from the start, so doors always face somewhere you can stand.
  const reachAt = reach(c).at;
  for (const b of buildings){
    if (b.ruined || b.lm || b.style === 'frame' || b.burnt || b.cut || rng() >= (b.style === 'crypt' ? 0.5 : DISTRICTS[b.district].door)) continue;
    const spots = [];
    for (let z=b.z;z<b.z+b.d;z++) for (let x=b.x;x<b.x+b.w;x++) for (const [dx,dz] of D4) if (reachAt[I(x+dx,z+dz)]) spots.push({ x, z, dx, dz });
    if (!spots.length) continue;
    const s = pick(spots);
    containers.push({ kind:'door', x:s.x, z:s.z, dx:s.dx, dz:s.dz, label:LABEL[b.style] });
  }
}
