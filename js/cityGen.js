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
import { N, T, CITY_NAMES, PALETTE, HOUSE_PALETTE, ROOF_PALETTE, WAREHOUSE_PALETTE, DISTRICTS, LAYOUT, CONDITIONS, CLOSURES, BLOCK_DENSITY, STREETS, TERRAIN, STEP, cityBlocks, walkable, stepUp } from './config.js';
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
  addTerrain(c);
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
  c.lots = lots; c.streets = { V, H, inner };
}

// ---------- Lots ----------
// What gets built on a lot: one block, or several merged (a big lot, `big`), or a block grown over a
// street. Everything is laid out inside its rect r; big lots get more of it and things single blocks
// can't hold (big towers and factory halls, park paths where the streets ran, big hills, embankments,
// crops, shipping containers, cemeteries full of graves).
function buildLot(c, L){
  const { grid } = c, { x0, z0, w, d } = L.r, x1 = x0 + w, z1 = z0 + d, D = L.district, t = L.type, big = L.blocks.length > 1, k = w*d/25;
  const res = new Set();  // tiles kept free for a terrace or an embankment built later (addTerrain)
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
  // Marks a hw×hd area for the terrain (addTerrain): a hill, or a terrace or embankment (kept clear, with a
  // ring round it for its stairs).
  const reserve = (kind, hw, hd) => {
    hw = Math.min(hw, w - 2); hd = Math.min(hd, d - 2); if (hw < 1 || hd < 1) return;
    const rx = x0 + 1 + randi(0, w - 2 - hw), rz = z0 + 1 + randi(0, d - 2 - hd);
    if (kind !== 'knoll') for (let z=rz-1;z<=rz+hd;z++) for (let x=rx-1;x<=rx+hw;x++) res.add(I(x,z));
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
      // Footpaths where the streets ran, and the lie of the land: a big hill, a terrace downtown (two
      // tiers up stairs), or in a field an old railway embankment.
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
      if (!L.raise || L.raise.w) spot(T.GRASS, tree);  // (a small terrace keeps its trees round the edge)
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
// Every fence end should meet something: a building, a wall, a tree, a car, water, a ledge, a gate,
// another fence. Where one stops in the open, the rest of it lies broken on the ground: fallen pieces fill
// the gap up to the next solid thing (up to 3 tiles), or else one lies just past the end; with no open
// ground past it (a road, a ramp) the end itself is knocked down. Then each gate hangs off a post beside it.
function tidyFences(c){
  const { grid, props } = c, H = c.hc, at = new Map();
  // Gates and fallen pieces something was built on since (a container, a closure, stairs) are gone.
  for (let i=props.length-1;i>=0;i--){ const p = props[i], id = I(p.x, p.z); if ((p.kind === 'fgate' || p.broken) && (c.ramp[id] || (grid[id] !== T.SIDEWALK && grid[id] !== T.GRASS))) props.splice(i, 1); }
  const ledge = (a, b, dx, dz) => !stepUp(H, a, b, dx, dz) || !stepUp(H, b, a, -dx, -dz);
  for (const p of props) if (p.kind === 'fence' || p.kind === 'fgate' || p.kind === 'cart' || p.kind === 'flag' || p.kind === 'gate') at.set(I(p.x, p.z), p);
  const marked = i => { const p = at.get(i); return p && (p.kind === 'fgate' || p.broken); };
  // A fence, or what continues one: a gate in it, a piece of it lying broken.
  const fence = i => grid[i] === T.FENCE || marked(i);
  // Tile j, (dx,dz) on from tile i: does a fence on i meet it? Is it open ground a fence could run on?
  const meets = (j, i, dx, dz) => !walkable(grid[j]) || ledge(i, j, dx, dz) || marked(j);
  const ground = (j, i, dx, dz) => (grid[j] === T.SIDEWALK || grid[j] === T.GRASS) && !ledge(i, j, dx, dz) && !at.has(j) && !c.ramp[j];
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
    const i = I(p.x, p.z), at_ = k => I(p.x + dx*k, p.z + dz*k);
    if (meets(at_(1), i, dx, dz)) continue;
    const gap = []; let k = 1;
    for (;k<=4;k++){ if (!ground(at_(k), at_(k-1), dx, dz)) break; gap.push(at_(k)); }
    const lay = (j, lean) => { const q = brokenFence(j % N, Math.floor(j/N), p.rot, p.style, grid[j], lean); props.push(q); at.set(j, q); };
    if (gap.length && gap.length <= 3 && meets(at_(k), at_(k-1), dx, dz)) gap.forEach((j, n) => lay(j, n ? undefined : rand(0.5, 1.1)));
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
  // Not on stairs, nor at their foot or head.
  if (c.ramp && (c.ramp[I(x,z)] || c.ramp[I(x+1,z)] || c.ramp[I(x-1,z)] || c.ramp[I(x,z+1)] || c.ramp[I(x,z-1)])) return false;
  if (x > c.n - 10 && Math.abs(z - c.exitZ) < 6) return false;
  return c.landmarks.every(l => Math.abs(l.ox - x) + Math.abs(l.oz - z) > 3);
}
// Tiles reachable on foot from the start: { n, at } (at[i] = 1 if reachable).
function reach(c, flat){
  const at = new Uint8Array(N*N), q = [I(2,2)]; at[q[0]] = 1;
  for (let h=0;h<q.length;h++){
    const cx = q[h] % N, cz = (q[h]-cx)/N;
    for (const [dx,dz] of D4){ const ni = I(cx+dx,cz+dz); if (!at[ni] && walkable(c.grid[ni]) && (flat || !c.hc || stepUp(c.hc, q[h], ni, dx, dz))){ at[ni] = 1; q.push(ni); } }
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

// ---------- Terrain ----------
// The town is built in flat layers (TERRAIN.layer units apart, TERRAIN.layers of them). Every crossing of
// the street grid sits on a layer, read off a smooth field (the town tilts toward one side, with broad hills
// and hollows) and eased so neighbouring crossings, diagonals too, are at most one layer apart. Every lot
// (a block, merged blocks, a landmark) is flat on the layer of its middle, kept within one of its corners.
// Only connecting ground slopes, and always along one axis: a street between crossings on different layers
// ramps all the way (a layer over 5 tiles, so 0.4 a tile, under STEP), stairs lead from a street onto a lot
// above or below it (retaining walls everywhere else), and pads raised a layer on a lot (park terraces and
// hills, railway embankments, loading docks) are reached up stairs or grassy banks. The city's border stands
// one layer above the highest one (the quarantine wall on top), with the exit cut through it at street level.
// city.hc = each tile's corners (flat, or sloping one way); stairs/rails/docks for cityScene; features for
// the dev tools; ramp marks stair tiles (no containers, closures or wrecks on them).
function addTerrain(c){
  const nb = c.b, n = c.n, M = nb + 1, TR = TERRAIN, K = TR.layers, LH = TR.layer, { V, H, inner } = c.streets;
  c.features = []; c.stairs = []; c.rails = []; c.docks = []; c.ramp = new Uint8Array(N*N); c.reach = null;
  const area = nb*nb/100;
  // The field, in tile units.
  const ang = rand(0, 2*Math.PI), tilt = rand(0.4, 1)*TR.tilt, bumps = [];
  for (let k=Math.round(rand(TR.hills[0], TR.hills[1])*area);k>0;k--)
    bumps.push({ x:rand(0, n), z:rand(0, n), r:rand(TR.r[0], TR.r[1]), s:rand(0.6, 1.6), a:rand(0, Math.PI), h:rng() < TR.hollow ? -rand(0.3, 0.7) : rand(0.45, 1) });
  const G = 7, gw = Math.ceil(n/G) + 2, noise = []; for (let i=0;i<gw*gw;i++) noise.push(rand(-1, 1));
  const sm = t => t*t*(3 - 2*t), q = (i, j) => noise[j*gw + i];
  const field = (x, z) => {
    let h = tilt*((x/n - 0.5)*Math.cos(ang) + (z/n - 0.5)*Math.sin(ang));
    for (const b of bumps){
      const dx = x - b.x, dz = z - b.z, ca = Math.cos(b.a), sa = Math.sin(b.a), u = (dx*ca + dz*sa)/(b.r*b.s), v = (dz*ca - dx*sa)*b.s/b.r;
      h += b.h*Math.exp(-(u*u + v*v)/2);
    }
    const gx = x/G, gz = z/G, ix = Math.floor(gx), iz = Math.floor(gz), fx = sm(gx - ix), fz = sm(gz - iz);
    return h + TR.noise*((q(ix,iz)*(1-fx) + q(ix+1,iz)*fx)*(1-fz) + (q(ix,iz+1)*(1-fx) + q(ix+1,iz+1)*fx)*fz);
  };
  // Crossings onto layers.
  const raw = new Float32Array(M*M); let lo = 1e9, hi = -1e9;
  for (let j=0;j<=nb;j++) for (let i=0;i<=nb;i++){ const v = field(2 + 7*i, 2 + 7*j); raw[j*M + i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const layerOf = v => Math.max(0, Math.min(K - 1, Math.floor((v - lo)/(hi - lo + 1e-6)*K)));
  const NL = new Int8Array(M*M); for (let i=0;i<M*M;i++) NL[i] = layerOf(raw[i]);
  for (let moved=true;moved;){
    moved = false;
    for (let j=0;j<=nb;j++) for (let i=0;i<=nb;i++) for (let dj=-1;dj<=1;dj++) for (let di=-1;di<=1;di++){
      const a = j*M + i, ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii > nb || jj > nb) continue;
      const b = jj*M + ii; if (NL[a] > NL[b] + 1){ NL[a] = NL[b] + 1; moved = true; }
    }
  }
  const top = Math.max(...NL);
  const hc = c.hc = new Float32Array(N*N*4);
  const flat = (x0, z0, w, d, h) => { for (let z=z0;z<z0+d;z++) for (let x=x0;x<x0+w;x++) hc.fill(h, I(x,z)*4, I(x,z)*4 + 4); };
  // The border, a layer above the highest; then crossings and the streets between them.
  for (let z=0;z<n;z++) for (let x=0;x<n;x++) hc.fill((top + 1)*LH, I(x,z)*4, I(x,z)*4 + 4);
  for (let j=0;j<=nb;j++) for (let i=0;i<=nb;i++) if (!inner[j*M + i]) flat(1 + 7*i, 1 + 7*j, 2, 2, NL[j*M + i]*LH);
  for (let i=0;i<=nb;i++) for (let j=0;j<nb;j++){
    if (V[i*nb + j] !== 1){ const a = NL[j*M + i]*LH, b = NL[(j+1)*M + i]*LH; for (let k=0;k<5;k++) for (let w=0;w<2;w++){ const t = I(1 + 7*i + w, 3 + 7*j + k)*4, h0 = a + (b - a)*k/5, h1 = a + (b - a)*(k + 1)/5; hc[t] = hc[t+1] = h0; hc[t+2] = hc[t+3] = h1; } }
    if (H[i*nb + j] !== 1){ const a = NL[i*M + j]*LH, b = NL[i*M + j + 1]*LH; for (let k=0;k<5;k++) for (let w=0;w<2;w++){ const t = I(3 + 7*j + k, 1 + 7*i + w)*4, h0 = a + (b - a)*k/5, h1 = a + (b - a)*(k + 1)/5; hc[t] = hc[t+2] = h0; hc[t+1] = hc[t+3] = h1; } }
  }
  // The exit, cut through the border at the street's level.
  for (let z=0;z<n;z++) if (c.grid[I(n-1, z)] === T.BARRICADE) hc.fill(hc[I(n-2, z)*4 + 1], I(n-1, z)*4, I(n-1, z)*4 + 4);
  // Lots, flat: the layer under their middle, within one of every crossing round them.
  const lots = c.lots.map(L => { const bs = L.blocks; return { r:L.r, L, bx0:Math.min(...bs.map(b => b.bx)), bz0:Math.min(...bs.map(b => b.bz)), bx1:Math.max(...bs.map(b => b.bx)), bz1:Math.max(...bs.map(b => b.bz)) }; });
  const seen = new Set();
  for (const b of c.blocks) if (b.type === 'landmark' && !seen.has(b.lot)){ seen.add(b.lot); lots.push({ r:b.lot, bx0:b.lot.bx, bz0:b.lot.bz, bx1:b.lot.bx + b.lot.n - 1, bz1:b.lot.bz + b.lot.n - 1 }); }
  for (const o of lots){
    let a = 99, b = -1; for (let j=o.bz0;j<=o.bz1+1;j++) for (let i=o.bx0;i<=o.bx1+1;i++){ a = Math.min(a, NL[j*M + i]); b = Math.max(b, NL[j*M + i]); }
    const r = o.r, want = layerOf(field(r.x0 + r.w/2, r.z0 + r.d/2));
    o.layer = b - a <= 2 ? Math.max(b - 1, Math.min(a + 1, want)) : Math.round((a + b)/2);
    if (o.L) o.L.layer = o.layer;
    flat(r.x0, r.z0, r.w, r.d, o.layer*LH);
  }
  for (const p of c.ponds) p.h = hc[I(p.x0, p.z0)*4];
  // Stairs. The two corners of tile i on its side facing (dx,dz), as indices into hc.
  const marked = new Set(c.props.filter(p => p.kind === 'fgate' || p.broken).map(p => I(p.x, p.z)));
  const open = i => { const g = c.grid[i]; return (g === T.SIDEWALK || g === T.GRASS || g === T.PLAZA || g === T.FLOOR) && !marked.has(i) && !c.ramp[i]; };
  const side = (i, dx, dz) => dx > 0 ? [i*4+1, i*4+3] : dx < 0 ? [i*4, i*4+2] : dz > 0 ? [i*4+2, i*4+3] : [i*4, i*4+1];
  // Edge tile (x,z) of a flat pad at height h becomes stairs down (or up) to the ground outside it, facing
  // out (dx,dz): one way only, its outer edge level at the height there.
  const lay = (x, z, dx, dz, h, kind) => {
    const i = I(x,z), j = I(x+dx, z+dz), [a, b] = side(i, dx, dz), [ja, jb] = side(j, -dx, -dz), out = (hc[ja] + hc[jb])/2;
    if (c.ramp[i]) return false;
    hc.fill(h, i*4, i*4 + 4); hc[a] = hc[b] = out; c.ramp[i] = 1;
    c.stairs.push({ x, z, dx:out < h ? -dx : dx, dz:out < h ? -dz : dz, lo:Math.min(out, h), hi:Math.max(out, h), kind });
    return true;
  };
  // Edge tiles of rect r that could hold stairs, by side (N, E, S, W): open, with walkable ground outside
  // that isn't level with h. [x, z, dx, dz, distance from the middle of the side]
  const edges = (r, h) => {
    const cand = [[], [], [], []];
    [[0,-1],[1,0],[0,1],[-1,0]].forEach(([dx, dz], si) => {
      const n2 = dx ? r.d : r.w;
      for (let k=0;k<n2;k++){
        const x = dx > 0 ? r.x0 + r.w - 1 : dx < 0 ? r.x0 : r.x0 + k, z = dz > 0 ? r.z0 + r.d - 1 : dz < 0 ? r.z0 : r.z0 + k, i = I(x,z), j = I(x+dx, z+dz);
        // Open itself, walkable ground beyond it and somewhere to step off at the top (or bottom).
        if (!open(i) || !walkable(c.grid[j]) || c.ramp[j] || !walkable(c.grid[I(x-dx, z-dz)]) || c.ramp[I(x-dx, z-dz)]) continue;
        const [a, b] = side(j, -dx, -dz);
        if (Math.max(Math.abs(hc[a] - h), Math.abs(hc[b] - h)) > STEP) cand[si].push([x, z, dx, dz, Math.abs(k - (n2 >> 1))]);
      }
    });
    return cand;
  };
  // Every lot reachable: where a lot (or part of it) can't be walked onto, stairs from the ground beside it
  // that can, a side at a time.
  const flatAt = reach(c, true).at;
  for (let round=0;round<6;round++){
    const at = reach(c).at; let more = false;
    for (const o of shuffle(lots.slice())){
      const r = o.r; let cut = false;
      for (let z=r.z0;z<r.z0+r.d && !cut;z++) for (let x=r.x0;x<r.x0+r.w;x++) if (flatAt[I(x,z)] && !at[I(x,z)]){ cut = true; break; }
      if (!cut) continue;
      const cand = edges(r, o.layer*LH).map(l => l.filter(([x, z, dx, dz]) => at[I(x+dx, z+dz)]));
      const sides = shuffle(cand.filter(l => l.length)); if (!sides.length) continue;
      for (const l of sides.slice(0, round < 2 ? 1 : 2)){ const e = pick(l); if (lay(e[0], e[1], e[2], e[3], o.layer*LH, 'stairs')) more = true; }
    }
    if (!more) break;
  }
  // Still cut off (a forecourt boxed in by its building, say): that part of the lot drops (or rises) to the
  // level of the ground beside it, a forecourt flush with the street.
  for (let round=0;round<4;round++){
    const at = reach(c).at; let more = false;
    for (const o of lots){
      const r = o.r, inR = (x, z) => x >= r.x0 && x < r.x0 + r.w && z >= r.z0 && z < r.z0 + r.d, done = new Set();
      for (let z=r.z0;z<r.z0+r.d;z++) for (let x=r.x0;x<r.x0+r.w;x++){
        const i0 = I(x,z); if (!flatAt[i0] || at[i0] || done.has(i0) || !walkable(c.grid[i0])) continue;
        const comp = [i0], q2 = [i0]; done.add(i0); let link = null;
        for (let h=0;h<q2.length;h++){
          const cx = q2[h] % N, cz = (q2[h] - cx)/N;
          for (const [dx, dz] of D4){
            const j = I(cx+dx, cz+dz); if (!walkable(c.grid[j])) continue;
            if (inR(cx+dx, cz+dz) && !at[j] && !done.has(j)){ done.add(j); comp.push(j); q2.push(j); }
            else if (at[j] && !link) link = [j, -dx, -dz];
          }
        }
        if (!link) continue;
        const [ja, jb] = side(link[0], link[1], link[2]), h = (hc[ja] + hc[jb])/2;
        for (const t of comp) if (!c.ramp[t]) hc.fill(h, t*4, t*4 + 4);
        more = true;
      }
    }
    if (!more) break;
  }
  // Pads raised a layer on a lot. exits: [x, z, dx, dz] tiles to lay stairs on, 'auto' (one on each side at
  // random), or { mid } (one in the middle of each side). Kept only if nothing gets cut off.
  const cutPad = (r, h, exits, kind) => {
    const R0 = c.reach || (c.reach = reach(c)), saved = new Map();
    for (let z=r.z0;z<r.z0+r.d;z++) for (let x=r.x0;x<r.x0+r.w;x++){ const i = I(x,z); saved.set(i, hc.slice(i*4, i*4 + 4)); hc.fill(h, i*4, i*4 + 4); }
    const cand = Array.isArray(exits) ? null : edges(r, h);
    const tries = cand ? [cand.map(l => l.length && rng() < 0.75 ? [exits.mid ? l.reduce((m, e) => e[4] < m[4] ? e : m) : pick(l)] : []).flat(), cand.map(l => l.length ? [pick(l)] : []).flat()] : [exits];
    for (const ex of tries){
      const laid = [];
      for (const [x, z, dx, dz] of ex) if (lay(x, z, dx, dz, h, kind)) laid.push(I(x,z));
      const r2 = reach(c);
      if (r2.n === R0.n){ c.reach = r2; return true; }
      for (const i of laid){ c.ramp[i] = 0; hc.fill(h, i*4, i*4 + 4); }
      c.stairs.length -= laid.length;
    }
    for (const [i, v] of saved) hc.set(v, i*4);
    return false;
  };
  for (const L of c.lots){
    if (L.blocks.some(b => b.bx + b.bz <= 1)) continue;
    const R = L.raise, r = L.r, t = L.type, base = L.layer*LH;
    if (R && R.kind === 'terrace'){
      // A terrace: up stairs in the middle of its sides, sometimes a second tier on top.
      const T1 = R.w ? R : { x0:r.x0 + (r.w >> 1) - 1, z0:r.z0 + (r.d >> 1) - 1, w:3, d:3 };
      if (!cutPad(T1, base + LH, { mid:true }, 'stairs')) continue;
      c.features.push({ kind:'terrace', x:T1.x0, z:T1.z0 });
      if (T1.w >= 4 && T1.d >= 3 && rng() < 0.65){
        const T2 = { x0:T1.x0 + 1, z0:T1.z0 + 1, w:T1.w - 2, d:Math.max(1, T1.d - 2) };
        if (cutPad(T2, base + 2*LH, { mid:true }, 'stairs')) c.features.push({ kind:'second tier', x:T2.x0, z:T2.z0 });
      }
    } else if (R && R.kind === 'berm'){
      // A railway embankment a layer up along the lot, a grassy bank at each end.
      const ax = R.w >= R.d, ex = ax ? [[R.x0, R.z0, -1, 0], [R.x0 + R.w - 1, R.z0, 1, 0]] : [[R.x0, R.z0, 0, -1], [R.x0, R.z0 + R.d - 1, 0, 1]];
      if (cutPad(R, base + LH, ex, 'bank')){ c.rails.push({ x0:R.x0, z0:R.z0, w:R.w, d:R.d }); c.features.push({ kind:'embankment', x:R.x0, z:R.z0 }); }
    } else if ((R && R.kind === 'knoll' && R.w) || (!R && ((t === 'park' && rng() < 0.45) || (t === 'field' && rng() < 0.35) || (t === 'farm' && rng() < 0.25) || (t === 'camp' && rng() < 0.15)))){
      // A hill: a flat top a layer up, grassy banks up one or two sides (a big one may have a second tier).
      const hw = R && R.w ? R.w : randi(2,3), hd = R && R.w ? R.d : (hw === 3 ? 2 : randi(2,3));
      const P = R && R.w ? R : { x0:r.x0 + 1 + randi(0, r.w - 2 - hw), z0:r.z0 + 1 + randi(0, r.d - 2 - hd), w:hw, d:hd };
      if (!cutPad(P, base + LH, 'auto', 'bank')) continue;
      c.features.push({ kind:'hill', x:P.x0, z:P.z0 });
      if (P.w >= 4 && P.d >= 3 && rng() < 0.5){
        const P2 = { x0:P.x0 + 1, z0:P.z0 + 1, w:P.w - 2, d:Math.max(1, P.d - 2) };
        if (cutPad(P2, base + 2*LH, 'auto', 'bank')) c.features.push({ kind:'second tier', x:P2.x0, z:P2.z0 });
      }
    }
  }
  // Loading docks: a platform along a warehouse's front (its roll-up door side, +z), a ramp at one end.
  for (const b of c.buildings){
    if (b.style !== 'warehouse' || b.cut || rng() > 0.55) continue;
    const r = blockAt(c, b.x, b.z).lot, zf = b.z + b.d;
    if (!r || zf > r.z0 + r.d - 1) continue;
    for (const ex of shuffle([-1, 1])){
      const rx = ex < 0 ? b.x - 1 : b.x + b.w, pad = { x0:Math.min(b.x, rx), z0:zf, w:b.w + 1, d:1 };
      if (rx < r.x0 || rx >= r.x0 + r.w || !walkable(c.grid[I(rx + ex, zf)])) continue;
      let ok = true; for (let x=pad.x0;x<pad.x0+pad.w;x++) if (c.grid[I(x,zf)] !== T.SIDEWALK || !open(I(x,zf))) ok = false;
      if (!ok) continue;
      const h = hc[I(b.x, zf)*4] + TR.dock;
      if (cutPad(pad, h, [[rx, zf, ex, 0]], 'ramp')){ c.docks.push({ x0:b.x, z:zf, w:b.w, h }); c.features.push({ kind:'dock', x:b.x, z:zf }); break; }
    }
  }
  c.hmax = (top + 1)*LH;
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
  c.reach = null;
  for (const L of c.lots){
    if (!BASIC.has(L.type)) continue;
    const { x0, z0, w, d } = L.r, D = DISTRICTS[L.district], free = [];
    for (let z=z0;z<z0+d;z++) for (let x=x0;x<x0+w;x++){
      const edge = x === x0 || x === x0+w-1 || z === z0 || z === z0+d-1, g = grid[I(x,z)];
      if ((g === T.SIDEWALK || g === T.GRASS) && edge && !c.ramp[I(x,z)]) free.push([x,z]);
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
      // Never in the way of stairs, never cutting anything off.
      if ([[0,0],[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dz]) => c.ramp[I(x+dx, z+dz)]) || !tryBlock(c, [[x, z, T.OBSTACLE]])){ i--; continue; }
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
