// ---------- City generation ----------
// Pure data: builds the tile grid and prop lists from a seed. No Three.js here.
// The map is B×B blocks of 5×5 tiles between 2-tile roads. Each block belongs to a district
// (DISTRICTS in config.js, laid out by LAYOUT) that decides what gets built on it and how many
// zombies (block.density, residents per block) and how much loot it holds. Landmarks are stamped from the ASCII TEMPLATES below;
// the police station and supermarket take a 2×2 group of blocks (the roads between them become
// part of the lot) and can be walked into.
import { N, B, T, CITY_NAMES, PALETTE, HOUSE_PALETTE, ROOF_PALETTE, WAREHOUSE_PALETTE, DISTRICTS, LAYOUT, walkable } from './config.js';
import { rng, seedRng, rand, randi, pick } from './utils.js';

const I = (x,z) => z*N + x;
const D4 = [[0,1],[1,0],[0,-1],[-1,0]];  // +z first, so props facing a tie turn toward the camera
const wpick = table => {
  let s = 0; for (const e of table) s += e[1];
  let r = rng()*s; for (const e of table){ r -= e[1]; if (r <= 0) return e[0]; }
  return table[0][0];
};

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
// Random each city: 1-3 downtown cores anywhere but near the start, each ringed by suburbs, plus
// 1-2 industrial pockets; whatever's left is outskirts. Later cities get more and bigger cores,
// and every district holds more zombies per block.
function assignDistricts(blocks, level){
  const L = LAYOUT, k = level - 1, spot = (gap, others, apart) => {
    for (let i=0;i<60;i++){
      const x = rand(0.5, B-0.5), z = rand(0.5, B-0.5);
      if (Math.hypot(x, z) >= gap && others.every(o => Math.hypot(o.x - x, o.z - z) >= apart)) return { x, z };
    }
    return null;
  };
  const cores = [], pockets = [];
  for (let n=Math.min(L.cores[2], Math.floor(L.cores[0] + L.cores[1]*k + rng()));n>0;n--){
    const p = spot(L.startGap, cores, L.coreGap);
    if (p) cores.push(Object.assign(p, { r:rand(L.core[0], L.core[1]) + L.coreGrow*k, ring:rand(L.ring[0], L.ring[1]) + L.ringGrow*k }));
  }
  for (let n=randi(L.pockets[0], L.pockets[1]);n>0;n--){
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
  const grid = new Uint8Array(N*N).fill(T.ROAD);
  for (let i=0;i<N;i++){ grid[I(i,0)] = grid[I(i,N-1)] = grid[I(0,i)] = grid[I(N-1,i)] = T.WALL; }
  const blocks = [];
  for (let bz=0;bz<B;bz++) for (let bx=0;bx<B;bx++) blocks.push({ bx, bz, x0:3+7*bx, z0:3+7*bz, type:null });
  assignDistricts(blocks, level);
  const exitZ = 1 + 7*randi(1, B-1);
  grid[I(N-1,exitZ)] = T.BARRICADE; grid[I(N-1,exitZ+1)] = T.BARRICADE;
  // overlays: tiles drawn with their own ground (parking asphalt, forecourt concrete, shop floors).
  const c = { grid, blocks, buildings:[], trees:[], cars:[], rubble:[], pillars:[], props:[], containers:[], landmarks:[], interiors:[],
    overlays:{ lot:[], pad:[], police:[], supermarket:[] } };

  const cb = pick(blocks.filter(b => b.bx + b.bz >= B));
  cb.type = 'plaza';
  placeLandmarks(c);
  for (const b of blocks) if (!b.type){ b.type = wpick(DISTRICTS[b.district].blocks); buildBlock(c, b); }
  for (const b of blocks) if (b.type === 'plaza') buildBlock(c, b);
  const road = new Uint8Array(N*N);
  for (let i=0;i<N*N;i++) road[i] = grid[i] === T.ROAD ? 1 : 0;
  addWrecks(c, exitZ);
  placeLoot(c);
  return Object.assign(c, { road, crystalTile:{ x:cb.x0+2, z:cb.z0+2 }, exitZ, start:{ x:2, z:2 }, name:pick(CITY_NAMES) });
}

// ---------- Ordinary blocks ----------
function buildBlock(c, b){
  const { grid } = c, { x0, z0 } = b, D = b.district;
  const fill = t => { for (let z=z0;z<z0+5;z++) for (let x=x0;x<x0+5;x++) grid[I(x,z)] = t; };
  const spot = (t, f) => { const x = x0 + randi(0,4), z = z0 + randi(0,4); if (grid[I(x,z)] === t){ grid[I(x,z)] = T.OBSTACLE; f(x, z); } };
  const tree = (x, z) => c.trees.push({ x, z, s:rand(0.8,1.3), m:Math.floor(rng()*3) });
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
      spot(T.SIDEWALK, (x, z) => c.cars.push({ x, z, rot:(rng()<0.5?0:Math.PI/2) + rand(-0.15,0.15), color:pick([0x6b2b2b,0x2b4a6b,0x9a9a92,0x3a3f45,0x6b5a2b,0x2f5a3c]) }));
  } else if (t === 'yard'){
    // Industrial storage: pallets of lumber, plus crates from placeLoot().
    fill(T.SIDEWALK);
    for (let i=randi(1,3);i>0;i--) spot(T.SIDEWALK, (x, z) => c.props.push({ kind:'lumber', x, z, rot:rng() < 0.5 ? 0 : Math.PI/2 }));
  } else if (t === 'plaza'){
    fill(T.PLAZA);
    grid[I(x0+2,z0+2)] = T.CRYSTAL;
    for (const [px,pz] of [[0,0],[4,0],[0,4],[4,4]]){ grid[I(x0+px,z0+pz)] = T.OBSTACLE; c.pillars.push({ x:x0+px, z:z0+pz, h:rand(1.4,3.6) }); }
  }
}

// Wrecked cars on roads, never blocking both lanes.
function addWrecks(c, exitZ){
  const { grid } = c, col = () => pick([0x4a3a33,0x3a3f45,0x5b4636,0x444038]);
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
      grid[I(x,z)] = T.OBSTACLE; c.cars.push({ x, z, rot:(rng()<0.5?0:Math.PI) + rand(-0.5,0.5), color:col(), wreck:true });
    } else {
      const partner = ((x-1)%7 === 0) ? x+1 : x-1;
      let ok = true; for (let dz=-1;dz<=1;dz++) if (grid[I(partner,z+dz)] !== T.ROAD) ok = false;
      if (!ok) continue;
      grid[I(x,z)] = T.OBSTACLE; c.cars.push({ x, z, rot:Math.PI/2 + (rng()<0.5?0:Math.PI) + rand(-0.5,0.5), color:col(), wreck:true });
    }
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
// 'c' car, 'p' police car, 't' tree, 'w' lumber, 'x' crate.
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
  ]
};
const TILE_OF = { '.':T.SIDEWALK, ',':T.SIDEWALK, 'g':T.SIDEWALK, 'r':T.SIDEWALK, 'f':T.SIDEWALK, '_':T.FLOOR, 'E':T.FLOOR, 'z':T.FLOOR,
  '#':T.BUILDING, 'B':T.BUILDING, 'D':T.BUILDING, '|':T.BARS };
// Searchable props -> container kind (loot table in items.js LOOT).
const SEARCH = { s:'shelf', L:'locker', A:'armory', k:'desk' };
const PROP = { S:'shelf', s:'shelf', C:'counter', L:'locker', A:'armory', k:'desk', K:'desk', '|':'bars', P:'pump', Y:'pylon', w:'lumber', r:'cart', f:'flag' };
const LM_SPEC = {
  police:      { size:2, h:4.6, score:{ downtown:2, residential:1, industrial:0.5, outskirts:0 } },
  supermarket: { size:2, h:5,   score:{ downtown:1, residential:2, industrial:0.5, outskirts:0.3 } },
  pharmacy:    { size:1, h:3.6, score:{ downtown:2, residential:2, industrial:0.3, outskirts:0.5 } },
  hardware:    { size:1, h:4.2, score:{ downtown:0.5, residential:1.5, industrial:3, outskirts:1 } },
  gas:         { size:1, h:3,   score:{ downtown:0.3, residential:1.5, industrial:1.5, outskirts:2 } }
};

// One police station, one supermarket, 1-2 pharmacies, a hardware store and 1-2 gas stations,
// each on the best-scoring free spot for its kind (with some randomness), kept apart.
function placeLandmarks(c){
  const { blocks } = c, placed = [];
  const want = ['police', 'supermarket', 'hardware', 'pharmacy', 'gas'];
  if (rng() < 0.6) want.push('pharmacy');
  if (rng() < 0.6) want.push('gas');
  for (const type of want){
    const S = LM_SPEC[type], n = S.size;
    let best = null, top = -1e9;
    for (let bz=0;bz<=B-n;bz++) for (let bx=0;bx<=B-n;bx++){
      if (bx + bz < 2) continue;
      const g = [];
      for (let j=0;j<n;j++) for (let i=0;i<n;i++) g.push(blocks[(bz+j)*B + bx+i]);
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
  const walls = [], ent = [], floor = [], yard = [], cells2 = [], box = [], pads = [];
  for (const [x, z, ch] of cells){
    if (ch === '#') walls.push([x,z]);
    else if (ch === 'E') ent.push([x,z]);
    else if (ch === '_') floor.push([x,z]);
    else if (ch === 'z') cells2.push([x,z]);
    else if (ch === 'B' || ch === 'D') box.push([x,z]);
    else if (ch === '.' || ch === 'f') yard.push([x,z]);
    if (ch === ',' || ch === 'r' || ch === 'c') c.overlays.lot.push([x,z]);
    if (ch === 'g' || ch === 'P') { c.overlays.pad.push([x,z]); pads.push([x,z]); }
    if (ch === 't') c.trees.push({ x, z, s:rand(0.9,1.3), m:Math.floor(rng()*3) });
    if (ch === 'c' || ch === 'p'){
      const police = ch === 'p';
      c.cars.push({ x, z, rot:frontRot + Math.PI/2 + rand(-0.12,0.12) + (police ? rand(-0.5,0.5) : 0), police, tpl:true, color:pick([0x6b2b2b,0x2b4a6b,0x9a9a92,0x3a3f45,0x6b5a2b]) });
      if (rng() < (police ? 0.65 : 0.55)) c.containers.push({ kind:police ? 'cruiser' : 'trunk', x, z });
    }
    if (ch === 'x') c.containers.push({ kind:'crate', x, z, rot:0 });
    if (PROP[ch]){
      const kind = PROP[ch];
      const rot = kind === 'shelf' || kind === 'counter' ? along(x, z, 'SsC') : kind === 'bars' ? along(x, z, '|#') : kind === 'cart' ? rand(0,6.3)
        : kind === 'lumber' ? frontRot : faceRot(x, z);
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
  } else {
    // Walk-in building: walls on the tile grid, floor inside, open entrance on the front wall.
    const r = bounds(walls), inside = [];
    for (let z=r.z0;z<=r.z1;z++) for (let x=r.x0;x<=r.x1;x++) if (grid[I(x,z)] !== T.BUILDING) inside.push([x,z]);
    c.overlays[type] = inside;
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
const BASIC = new Set(['towers','ruins','houses','farm','warehouses','park','field','lot','yard']);
const LABEL = { tower:'shop', house:'house', warehouse:'warehouse' };
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
    else if (t === 'field') n = rng() < 0.12 ? 1 : 0;
    for (let i=0;i<n && free.length;i++){
      const [x,z] = free.splice(Math.floor(rng()*free.length),1)[0];
      grid[I(x,z)] = T.OBSTACLE;
      containers.push({ kind, x, z, rot:(x === b.x0 || x === b.x0+4) ? Math.PI/2 : 0 });
    }
  }
  // Car trunks (landmark parking lots already rolled theirs in stamp()).
  for (const cr of cars) if (!cr.tpl && rng() < 0.55) containers.push({ kind:'trunk', x:cr.x, z:cr.z });
  // Tiles reachable on foot from the start, so doors always face somewhere you can stand.
  const reach = new Uint8Array(N*N), q = [I(2,2)]; reach[q[0]] = 1;
  for (let h=0;h<q.length;h++){
    const cx = q[h] % N, cz = (q[h]-cx)/N;
    for (const [dx,dz] of D4){ const ni = I(cx+dx,cz+dz); if (!reach[ni] && walkable(grid[ni])){ reach[ni] = 1; q.push(ni); } }
  }
  for (const b of buildings){
    if (b.ruined || b.lm || rng() >= DISTRICTS[b.district].door) continue;
    const spots = [];
    for (let z=b.z;z<b.z+b.d;z++) for (let x=b.x;x<b.x+b.w;x++) for (const [dx,dz] of D4) if (reach[I(x+dx,z+dz)]) spots.push({ x, z, dx, dz });
    if (!spots.length) continue;
    const s = pick(spots);
    containers.push({ kind:'door', x:s.x, z:s.z, dx:s.dx, dz:s.dz, label:LABEL[b.style] });
  }
}
