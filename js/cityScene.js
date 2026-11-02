// ---------- City scene ----------
// Turns generated city data into Three.js meshes, and tears it all down again.
import * as THREE from 'three';
import { TILE, N, RAISE } from './config.js';
import { mr, mpick } from './utils.js';
import { scene } from './renderer.js';
import { SH, CORR_TEX, CHECKER_TEX, carMat, boxes } from './assets.js';
import { state, world, zombies, dying, bullets, particles, pickups, decals, drops, throwns, hazards, spits, puddles, rings } from './state.js';
import { LOOT, LANDMARKS } from './items.js';
import { disposeZombie, disposeCorpse } from './zombies.js';
import { faded } from './fx.js';
import { groundAt } from './grid.js';
import { initBreaks } from './breakables.js';

// Per-city geometries/materials/textures, disposed in teardownCity().
let disposables = [], geoCache = new Map();
const own = o => { disposables.push(o); return o; };
const std = (color, o) => own(new THREE.MeshStandardMaterial(Object.assign({ color, roughness:0.9 }, o)));
// Per-city geometry shared by every mesh of the same shape.
const G = (key, make) => geoCache.get(key) || geoCache.set(key, own(make())).get(key);
// Per-city material shared by every prop that asks for the same key (never on fadeable meshes).
const M = (key, color, o) => G('m:' + key, () => new THREE.MeshStandardMaterial(Object.assign({ color, roughness:0.9 }, o)));
const box = (w, h, d, base) => { const g = new THREE.BoxGeometry(w, h, d); if (base) g.translate(0, h/2, 0); return g; };
const dummy = new THREE.Object3D();
const mesh = (geo, mat, x, y, z, parent, shadow = true) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
};
const glassMat = () => std(0x2a3f55, { emissive:0x1a3a55, emissiveIntensity:0.5, roughness:0.2, metalness:0.3 });
// Seeded random for cosmetic details stored as a seed in the city data, so every machine draws them alike.
const srand = seed => { let s = (seed >>> 0) || 1; return (a = 0, b = 1) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return a + (b - a)*s/4294967296; }; };
// Canvas texture (per city), drawn by f(ctx, size).
const canvasTex = (size, f, rx = 1, ry = 1, hgt = size) => {
  const cv = document.createElement('canvas'); cv.width = size; cv.height = hgt; f(cv.getContext('2d'), size, hgt);
  const t = own(new THREE.CanvasTexture(cv)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t;
};
// Per-city animation: smoke plumes (one instanced mesh) and flickering fire materials (animateCity).
const anim = { smoke:null, puffs:[], fires:[] };
const PUFFS = 6, PUFF_T = 4.5;

export function buildCityScene(c){
  const cityGroup = world.cityGroup = new THREE.Group(); scene.add(cityGroup);
  const n = c.n, W = n*TILE;
  const outer = new THREE.Mesh(own(new THREE.PlaneGeometry(W+300, W+300)), std(0x121418, { roughness:1 }));
  outer.rotation.x = -Math.PI/2; outer.position.set(W/2,-0.05,W/2); outer.receiveShadow = true; cityGroup.add(outer);
  const road = new THREE.Mesh(own(new THREE.PlaneGeometry(W, W)), std(0x2f3136, { roughness:1 }));
  road.rotation.x = -Math.PI/2; road.position.set(W/2,0,W/2); road.receiveShadow = true; cityGroup.add(road);

  // Ground slabs: one per lot (a block, several merged ones with the streets between, a block grown over a
  // street, a landmark's lot) and one per street closed to cars.
  const groundMats = {}, gm = { towers:0x67655f, ruins:0x58564f, park:0x3b4a2e, field:0x4b5032, houses:0x45543a, farm:0x4b5032,
    warehouses:0x5c5b56, yard:0x55534d, lot:0x26282c, plaza:0x7a7468, landmark:0x67655f, construction:0x5a5247, cemetery:0x3a4630, camp:0x47483a,
    pond:0x3b4a2e, crater:0x4a4741, walk:0x67655f, path:0x45543a, track:0x4b5032 };
  for (const k in gm) groundMats[k] = std(gm[k], { roughness:1 });
  const slab = (L, type) => {
    const m = new THREE.Mesh(G('slab' + L.w + 'x' + L.d, () => new THREE.BoxGeometry(L.w*TILE - 0.12, 0.08, L.d*TILE - 0.12)), groundMats[type]);
    m.position.set((L.x0 + L.w/2)*TILE, 0.04, (L.z0 + L.d/2)*TILE); m.receiveShadow = true; cityGroup.add(m);
  };
  const lots = new Set();
  for (const b of c.blocks){ const L = b.lot; if (!lots.has(L)){ lots.add(L); slab(L, b.type); } }
  for (const s of c.strips) slab(s, s.kind);
  // Ground overlays: parking asphalt, gas station forecourts, shop floors (under the roofs).
  const tiles = (list, mat, y = 0.083, sx = TILE, sz = TILE, ox = 0, oz = 0) => {
    if (!list.length) return;
    const im = own(new THREE.InstancedMesh(SH.tilePlane, mat, list.length));
    list.forEach(([x,z], i) => { dummy.position.set((x+0.5)*TILE + ox, y, (z+0.5)*TILE + oz); dummy.rotation.set(0,0,0); dummy.scale.set(sx, 1, sz); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.receiveShadow = true; cityGroup.add(im);
  };
  const O = c.overlays;
  tiles(O.lot, SH.lotMat); tiles(O.pad, SH.padMat); tiles(O.dirt, std(0x5a4b38, { roughness:1 })); tiles(O.pave, std(0x7f7a70, { roughness:1 }));
  buildCrops(c);
  buildScars(c);
  for (const type in c.floors){ const L = LANDMARKS[type]; tiles(c.floors[type], std(L.floor, L.checker ? { map:CHECKER_TEX, roughness:0.5 } : { roughness:0.6 })); }
  // Parking stall lines, running along the parked cars (each lot tile carries its lot's front rotation).
  const lotSet = new Set(O.lot.map(([x,z]) => z*N + x));
  const linesZ = O.lot.filter(([x,z,r]) => r === 0 && lotSet.has(z*N + x-1)), linesX = O.lot.filter(([x,z,r]) => r !== 0 && lotSet.has((z-1)*N + x));
  tiles(linesZ, SH.lineMat, 0.086, 0.09, TILE*0.8, -TILE/2, 0); tiles(linesX, SH.lineMat, 0.086, TILE*0.8, 0.09, 0, -TILE/2);

  // Lane dashes, wherever both lanes of a road survive (landmark lots swallow some).
  const dash = own(new THREE.InstancedMesh(own(new THREE.PlaneGeometry(1.0, 0.13)), own(new THREE.MeshBasicMaterial({ color:0x9c8c4a })), 2*(c.b+1)*n));
  let di = 0;
  for (let k=0;k<=c.b;k++){
    const line = (2+7*k)*TILE, a = 1+7*k;
    for (let t=1;t<n-1;t++){
      if ((t-1)%7 < 2) continue;
      if (c.road[a*N+t] && c.road[(a+1)*N+t]){ dummy.rotation.set(-Math.PI/2,0,0); dummy.position.set((t+0.5)*TILE, 0.012, line); dummy.scale.set(1,1,1); dummy.updateMatrix(); dash.setMatrixAt(di++, dummy.matrix); }
      if (c.road[t*N+a] && c.road[t*N+a+1]){ dummy.rotation.set(-Math.PI/2,0,Math.PI/2); dummy.position.set(line, 0.012, (t+0.5)*TILE); dummy.scale.set(1,1,1); dummy.updateMatrix(); dash.setMatrixAt(di++, dummy.matrix); }
    }
  }
  dash.count = di; cityGroup.add(dash);

  // Quarantine walls
  const wallMat = std(0x55575c, { roughness:0.95 });
  const stripeMat = std(0xc8901a, { roughness:0.8 });
  const addWall = (w,d,x,z) => {
    const m = new THREE.Mesh(own(new THREE.BoxGeometry(w,1.8,d)), wallMat); m.position.set(x,0.9,z); m.castShadow = m.receiveShadow = true; cityGroup.add(m);
    const s = new THREE.Mesh(own(new THREE.BoxGeometry(w+0.02,0.18,d+0.02)), stripeMat); s.position.set(x,1.55,z); cityGroup.add(s);
  };
  addWall(W, TILE, W/2, TILE/2);
  addWall(W, TILE, W/2, W-TILE/2);
  addWall(TILE, W, TILE/2, W/2);
  const e = c.exitZ;
  addWall(TILE, e*TILE, W-TILE/2, e*TILE/2);
  const l2 = (n-e-2)*TILE; addWall(TILE, l2, W-TILE/2, (e+2)*TILE + l2/2);

  world.buildingMeshes = [];
  doorAt = new Set(c.containers.filter(k => k.kind === 'door').map(k => `${k.x},${k.z},${k.dx},${k.dz}`));
  for (const b of c.buildings){ const m = buildingMesh(b); world.buildingMeshes.push(m); cityGroup.add(m); }
  world.interiors = []; world.interiorAt = new Int8Array(N*N);
  c.interiors.forEach((it, i) => buildInterior(it, i));
  for (const t of c.trees){
    // On raised ground too; a planter's tree stands in a concrete box.
    const g = new THREE.Group(), x = (t.x+0.5)*TILE, z = (t.z+0.5)*TILE; g.position.set(x, groundAt(x, z), z); cityGroup.add(g);
    if (t.planter){ mesh(G('planter', () => boxes([[1.5,0.5,1.5,0,0.25,0], [1.3,0.08,1.3,0,0.52,0]])), M('planter', 0x9a958b), 0, 0, 0, g); }
    const k = new THREE.Group(); k.scale.setScalar(t.s); k.position.y = t.planter ? 0.4 : 0; g.add(k);
    const tr = new THREE.Mesh(SH.trunkGeo, SH.trunkMat); tr.position.y = 0.65; tr.castShadow = true;
    const lf = new THREE.Mesh(SH.leafGeos[(t.x + t.z) % 3], SH.leafMats[t.m]); lf.position.y = 1.75; lf.rotation.y = (t.x % 2)*Math.PI/2; lf.castShadow = true;
    k.add(tr, lf);
  }
  for (const cr of c.cars) cityGroup.add(carMesh(cr));
  for (const r of c.rubble){
    for (let i=0;i<4;i++){
      const m = new THREE.Mesh(SH.rubbleGeo, SH.rubbleMat);
      const sy = mr(0.6,1.2); m.scale.set(mr(0.6,1.4), sy, mr(0.6,1.4));
      m.position.set((r.x+0.5)*TILE + mr(-0.5,0.5), 0.23*sy, (r.z+0.5)*TILE + mr(-0.5,0.5)); m.castShadow = true; cityGroup.add(m);
    }
  }
  for (const p of c.pillars){
    const m = new THREE.Mesh(own(boxes([[0.9,p.h,0.9,0,0,0], [1.1,0.3,1.1,0,-p.h/2 + 0.15,0], [1.05,0.2,1.05,0,p.h/2 - 0.1,0]])), SH.pillarMat);
    m.position.set((p.x+0.5)*TILE, p.h/2, (p.z+0.5)*TILE); m.castShadow = m.receiveShadow = true; cityGroup.add(m);
  }
  buildSmoke(c);
  const opens = buildProps(c);
  buildContainers(c, opens);
  world.crystal = buildCrystal(c.crystalTile, state.level);
  world.barricade = buildBarricade(c.exitZ, n);
  buildRaised(c);
  initBreaks(c);
}

// ---------- Cars ----------
// Parked, wrecked (tilted, crumpled cab), on their roof or side, burnt out (charred, no glass), or
// driven into a wall (ox/oz nudge them against it). Landmark vehicles carry a style.
function carMesh(cr){
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  g.position.set((cr.x + 0.5 + (cr.ox || 0))*TILE, 0, (cr.z + 0.5 + (cr.oz || 0))*TILE); g.rotation.y = cr.rot;
  const st = cr.style, burnt = cr.burnt, color = burnt ? 0x2b2724 : st === 'police' || st === 'ambulance' ? 0xe9e9ee : st === 'military' ? 0x4b5320 : cr.color;
  const b = mesh(SH.carBody, carMat(color), 0, 0.42, 0, body), cab = mesh(SH.carCab, burnt ? carMat(0x151311) : SH.glassMat, -0.1, 0.9, 0, body);
  // Four square wheels and bumpers under every car (on top when it's flipped, beside it on its side).
  mesh(G('carParts', () => boxes([[0.5,0.48,0.22,-0.6,0.24,-0.47], [0.5,0.48,0.22,0.6,0.24,-0.47], [0.5,0.48,0.22,-0.6,0.24,0.47], [0.5,0.48,0.22,0.6,0.24,0.47],
    [0.16,0.22,1.0,0.99,0.3,0], [0.16,0.22,1.0,-0.99,0.3,0]])), M('wheel', 0x16171a), 0, 0, 0, body);
  if (cr.crash){ cab.scale.y = 0.8; b.scale.x = 0.9; b.position.x = -0.1; }
  if (cr.pose){
    // Rolled over: on the roof (cab crushed) or on its side, wheels showing.
    if (cr.pose === 'flip'){ body.rotation.x = Math.PI; body.position.y = 1.02; cab.scale.y = 0.55; cab.position.y = 0.82; }
    else { body.rotation.x = Math.PI/2; body.position.y = 0.53; }
  }
  if (st === 'police'){
    // Black-and-white with a lightbar that still flashes.
    mesh(SH.policeDoorGeo, SH.navyMat, -0.05, 0.47, 0, body, false);
    mesh(SH.lightbarGeo, SH.sirenR, -0.1, 1.18, -0.2, body, false); mesh(SH.lightbarGeo, SH.sirenB, -0.1, 1.18, 0.2, body, false);
  } else if (st === 'ambulance'){
    // Boxy white rear with a red stripe and red lights.
    mesh(G('ambBox', () => box(1.1, 0.75, 1.0, true)), carMat(0xe9e9ee), 0.4, 0.68, 0, body);
    mesh(SH.policeDoorGeo, SH.redMat, -0.05, 0.47, 0, body, false);
    mesh(SH.lightbarGeo, SH.sirenR, -0.1, 1.18, 0, body, false);
  } else if (st === 'military'){
    // Bigger, olive, with a canvas-covered bed.
    g.scale.set(1.15, 1.15, 1.2);
    mesh(G('canvas', () => box(1.0, 0.6, 1.0, true)), SH.canvasMat, 0.45, 0.68, 0, body);
  }
  return g;
}

// ---------- Scars ----------
// Burnt ground (soft scorch blobs), ponds (rounded water with a muddy rim), shell craters and loose
// rubble lying about (no collision).
function buildScars(c){
  const cityGroup = world.cityGroup, rnd = srand(c.n*7 + c.exitZ);
  const sc = c.overlays.scorch;
  if (sc.length){
    const tex = canvasTex(64, (g, s) => { for (const [k, a] of [[4, 0.25], [10, 0.45], [16, 0.7]]){ g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(k, k, s - 2*k, s - 2*k); } });
    const im = own(new THREE.InstancedMesh(SH.tilePlane, own(new THREE.MeshBasicMaterial({ map:tex, color:0x15110d, transparent:true, depthWrite:false })), sc.length));
    sc.forEach(([x,z], i) => { dummy.position.set((x + 0.5)*TILE, 0.0845, (z + 0.5)*TILE); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(TILE*rnd(1.1, 1.4)); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.renderOrder = 1; cityGroup.add(im);
  }
  const water = std(0x24485a, { roughness:0.08, metalness:0.35, emissive:0x081820, emissiveIntensity:0.6 }), mud = std(0x3b3326, { roughness:1 });
  // A flat rectangle on the ground, facing up.
  const rect = (x0, z0, x1, z1) => own(new THREE.PlaneGeometry(x1 - x0, z1 - z0)).rotateX(-Math.PI/2).translate((x0 + x1)/2, 0, (z0 + z1)/2);
  const flat = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.receiveShadow = true; cityGroup.add(m); return m; };
  for (const p of c.ponds){
    const X0 = p.x0*TILE, Z0 = p.z0*TILE, X1 = p.x1*TILE, Z1 = p.z1*TILE;
    flat(rect(X0 - 0.35, Z0 - 0.35, X1 + 0.35, Z1 + 0.35), mud, 0.084);
    flat(rect(X0 + 0.05, Z0 + 0.05, X1 - 0.05, Z1 - 0.05), water, 0.088);
    // Lily pads and reeds.
    const pad = G('lily', () => { const g = new THREE.PlaneGeometry(0.45, 0.45); g.rotateX(-Math.PI/2); return g; }), padM = M('lily', 0x3f6b34);
    for (let i=0;i<4;i++) flat(pad, padM, 0.092).position.set(rnd(X0 + 0.6, X1 - 0.6), 0.092, rnd(Z0 + 0.6, Z1 - 0.6));
    const reed = G('reed', () => boxes([[0.16,0.7,0.16,0,0.35,0], [0.16,0.5,0.16,0.18,0.25,0.06], [0.16,0.4,0.16,-0.1,0.2,0.16]])), reedM = M('reed', 0x6b7a3a);
    for (let i=0;i<6;i++){ const e = mesh(reed, reedM, rnd(X0, X1), 0, rnd() < 0.5 ? Z0 + rnd(-0.2, 0.3) : Z1 - rnd(-0.2, 0.3), cityGroup, false); e.scale.y = rnd(0.7, 1.3); }
  }
  const scorchM = std(0x1f1c19, { roughness:1 }), hole = std(0x0e0d0c, { roughness:1 });
  for (const cr of c.craters){
    const g = new THREE.Group(); g.position.set(cr.x*TILE, 0, cr.z*TILE); cityGroup.add(g);
    flat(own(new THREE.PlaneGeometry(cr.r*1.8, cr.r*1.8)).rotateX(-Math.PI/2), scorchM, 0.086).position.set(cr.x*TILE, 0.086, cr.z*TILE);
    flat(G('craterHole', () => new THREE.PlaneGeometry(2.1, 2.1).rotateX(-Math.PI/2)), cr.wet ? water : hole, 0.09).position.set(cr.x*TILE, 0.09, cr.z*TILE);
    // Thrown-up rim of broken ground: blocks along a square round the hole.
    const sq = (k, n, h) => { const p = k/n*4, sd = Math.floor(p), f = (p - sd)*2 - 1; return [[f*h, -h], [h, f*h], [-f*h, h], [-h, -f*h]][sd]; };
    for (let i=0;i<16;i++){
      const [x, z] = sq(i, 16, cr.r*rnd(0.72, 0.85)), m = mesh(SH.rubbleGeo, SH.rubbleMat, x, 0.05, z, g);
      m.scale.set(rnd(0.6, 1.2), rnd(0.3, 0.55), rnd(0.6, 1.2));
    }
    for (let i=0;i<8;i++){ const [x, z] = sq(i, 8, 1.3), s = rnd(0.5, 0.9), m = mesh(SH.rubbleGeo, SH.rubbleMat, x, 0.23*s, z, g); m.scale.setScalar(s); }
  }
  if (c.debris.length){
    const im = own(new THREE.InstancedMesh(SH.rubbleGeo, SH.rubbleMat, c.debris.length*3));
    let k = 0;
    for (const [x, z] of c.debris) for (let i=0;i<3;i++){
      const s = rnd(0.25, 0.6); dummy.position.set((x + rnd(-0.4, 0.4))*TILE, 0.23*s, (z + rnd(-0.4, 0.4))*TILE); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(s);
      dummy.updateMatrix(); im.setMatrixAt(k++, dummy.matrix);
    }
    im.castShadow = im.receiveShadow = true; cityGroup.add(im);
  }
}

// ---------- Crops ----------
// Farmed tiles: dark tilled earth with two rows of plants along the field (cabbages, corn, wheat), all in
// one instanced mesh; colours from a seed so every machine draws them alike.
function buildCrops(c){
  if (!c.crops.length) return;
  const cityGroup = world.cityGroup, rnd = srand(c.crops.length*13 + c.n), col = new THREE.Color();
  const soil = own(new THREE.InstancedMesh(SH.tilePlane, std(0x3f3326, { roughness:1 }), c.crops.length));
  const im = own(new THREE.InstancedMesh(G('crop', () => box(0.42, 0.42, 0.42, true)), std(0xffffff, { roughness:1 }), c.crops.length*6));
  const kinds = [[0x4f7a32, 0.7], [0x6b8a2e, 1.6], [0xb59a3c, 1.1]], fieldKind = new Map();
  let k = 0;
  c.crops.forEach(([x, z, ax], i) => {
    dummy.position.set((x + 0.5)*TILE, 0.083, (z + 0.5)*TILE); dummy.rotation.set(0, 0, 0); dummy.scale.set(TILE, 1, TILE); dummy.updateMatrix(); soil.setMatrixAt(i, dummy.matrix);
    // One crop per field (neighbouring tiles share it).
    const key = Math.floor(x/7)*100 + Math.floor(z/7); if (!fieldKind.has(key)) fieldKind.set(key, kinds[Math.floor(rnd(0, 3))]);
    const [hex, h] = fieldKind.get(key);
    for (const row of [-0.45, 0.45]) for (const a of [-0.65, 0, 0.65]){
      const s = rnd(0.75, 1.1);
      dummy.position.set((x + 0.5)*TILE + (ax ? a : row), 0.08, (z + 0.5)*TILE + (ax ? row : a)); dummy.scale.set(s, h*rnd(0.8, 1.1), s); dummy.updateMatrix();
      im.setMatrixAt(k, dummy.matrix); im.setColorAt(k++, col.setHex(hex).multiplyScalar(rnd(0.8, 1.1)));
    }
  });
  soil.receiveShadow = true; im.castShadow = im.receiveShadow = true; cityGroup.add(soil, im);
}

// ---------- Raised ground ----------
// Hills (grass top, earthy banks), loading docks (concrete with a yellow edge and rubber bumpers),
// terraces (paving) and railway embankments (gravel, with the old track on top), each with its ramps
// or stairs. A second tier (tier 2) sits on the first, from RAISE up.
const LOOK = { knoll:{ top:0x4a5a33, side:0x5a4b38 }, dock:{ top:0x8d8a84, side:0x7a7770 }, terrace:{ top:0x9d968a, side:0x857e72 }, berm:{ top:0x6f685d, side:0x5a4b38 } };
function buildRaised(c){
  const cityGroup = world.cityGroup;
  for (const r of c.raised){
    const L = LOOK[r.kind], top = M('top-' + r.kind, L.top, { roughness:1 }), side = M('side-' + r.kind, L.side, { roughness:1, flatShading:true });
    const w = (r.x1 - r.x0)*TILE, d = (r.z1 - r.z0)*TILE, y0 = (r.tier - 1)*RAISE;
    const m = mesh(G('raise' + w + 'x' + d, () => box(w, RAISE, d, true)), [side, side, top, side, side, side], (r.x0*TILE + w/2), y0, (r.z0*TILE + d/2), cityGroup);
    if (r.kind === 'berm'){
      // Sleepers across the top every 0.8, two rails along it.
      const ax = w >= d, len = ax ? w : d, parts = [];
      for (let a=-len/2 + 0.4;a<len/2;a+=0.8) parts.push(ax ? [0.26, 0.15, 1.5, a, RAISE + 0.075, 0] : [1.5, 0.15, 0.26, 0, RAISE + 0.075, a]);
      mesh(own(boxes(parts)), M('sleeper', 0x4a3a2a), 0, 0, 0, m);
      mesh(own(boxes([-0.5, 0.5].map(o => ax ? [len - 0.2, 0.16, 0.16, 0, RAISE + 0.23, o] : [0.16, 0.16, len - 0.2, o, RAISE + 0.23, 0]))), M('rail', 0x5a4a40, { metalness:0.5, roughness:0.6 }), 0, 0, 0, m);
    }
    if (r.kind === 'knoll' && r.tier === 1){
      // Stones round its foot.
      const rnd = srand(r.x0*97 + r.z0);
      for (let i=0;i<5;i++){ const a = rnd(0, 6.3), s = mesh(SH.rubbleGeo, SH.rubbleMat, m.position.x + Math.cos(a)*(w/2 - 0.1), 0.15, m.position.z + Math.sin(a)*(d/2 - 0.1), cityGroup); s.scale.setScalar(rnd(0.6, 1.1)); }
    } else if (r.kind === 'dock'){
      mesh(G('dockEdge' + w, () => box(w, 0.08, 0.3, true)), M('dockEdge', 0xd9a21b), m.position.x, RAISE, m.position.z + d/2 - 0.15, cityGroup, false);
      for (let k=0;k<r.x1 - r.x0;k++) mesh(G('bumper', () => box(0.4, 0.45, 0.12, true)), M('bumper', 0x1a1a1a), (r.x0 + k + 0.5)*TILE, 0.4, m.position.z + d/2 + 0.06, cityGroup);
    }
    for (const [x, z, dir] of r.ramps){
      const [dx, dz] = [[1,0],[-1,0],[0,1],[0,-1]][dir], cx = (x + 0.5)*TILE, cz = (z + 0.5)*TILE;
      // Four steps climbing toward the top (grass-topped on hills).
      for (let k=0;k<4;k++){
        const st = mesh(G('step' + k, () => box(TILE, RAISE*(k + 1)/4, TILE*(4 - k)/4, true)), r.kind === 'knoll' || r.kind === 'berm' ? [side, side, top, side, side, side] : side, cx + dx*TILE*k/8, y0, cz + dz*TILE*k/8, cityGroup);
        st.rotation.y = dx ? Math.PI/2 : 0;
      }
    }
  }
}

// ---------- Smoke ----------
// Plumes over burning wrecks, burnt houses, broken towers and lit barrels: PUFFS puffs each, all in one
// instanced mesh that animateCity() moves every frame (rise, drift, swell, shrink away).
function buildSmoke(c){
  anim.puffs = []; anim.smoke = null;
  if (!c.smoke.length) return;
  const rnd = srand(c.smoke.length*31 + c.n);
  const mat = own(new THREE.MeshStandardMaterial({ color:0x4a4744, roughness:1, transparent:true, opacity:0.3, depthWrite:false }));
  const im = anim.smoke = own(new THREE.InstancedMesh(G('puff', () => new THREE.BoxGeometry(1.5, 1.5, 1.5)), mat, c.smoke.length*PUFFS));
  for (const s of c.smoke) for (let i=0;i<PUFFS;i++) anim.puffs.push({ x:s.x*TILE, z:s.z*TILE, y:(s.y || 0) + 0.6, s:s.s, ph:i/PUFFS*PUFF_T + rnd(0, 0.4), wx:rnd(0.5, 1), wz:rnd(-0.4, 0.4) });
  im.frustumCulled = false; im.renderOrder = 2; world.cityGroup.add(im);
  animateCity(0, 0);
}
export function animateCity(dt, t){
  for (const m of anim.fires) m.emissiveIntensity = 1.4 + Math.sin(t*13 + m.userData.ph)*0.4 + Math.sin(t*31)*0.25;
  const im = anim.smoke; if (!im) return;
  anim.puffs.forEach((p, i) => {
    const k = ((t + p.ph) % PUFF_T)/PUFF_T, sw = (0.35 + k*1.5)*p.s*(k > 0.75 ? (1 - k)/0.25 : 1);
    dummy.position.set(p.x + k*k*3*p.wx*p.s, p.y + k*6.5*p.s, p.z + k*k*3*p.wz*p.s); dummy.rotation.set(0, i*Math.PI/2 + k*1.5, 0); dummy.scale.setScalar(Math.max(0.01, sw));
    dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
  });
  im.instanceMatrix.needsUpdate = true;
}

// ---------- Buildings ----------
let doorAt = new Set();  // "x,z,dx,dz" of every searchable door (no window drawn over it)
const LIT = [0.12, 0.25, 0.04];
// Towers (windows, rooftop gear), houses (gabled roofs), warehouses (corrugated siding, roll-up
// door) and the solid landmarks (pharmacy, hardware store, gas station shop: colour band, roof
// sign, glass storefront). Children use the building's own materials so they fade with it.
function buildingMesh(b){
  if (b.style === 'frame') return frameMesh(b);
  const w = b.w*TILE - 0.3, d = b.d*TILE - 0.3, h = b.cut || b.h, top = h/2, L = b.lm && LANDMARKS[b.lm];
  // Fire-blackened: burnt houses, sooty towers; broken ones a little darker too.
  const col = new THREE.Color(L ? L.wall : b.color).multiplyScalar(b.burnt ? 0.32 : b.soot ? 0.55 : b.cut ? 0.85 : 1);
  const plain = b.ruined || b.style === 'crypt';
  let mats, uniq;
  if (plain){
    const m = std(b.ruined ? col.clone().multiplyScalar(0.8) : col, { roughness:1 });
    mats = [m,m,m,m,m,m]; uniq = [m];
  } else if (b.style === 'warehouse'){
    // Corrugated siding (vertical ribs).
    const tex = n => { const t = own(CORR_TEX.clone()); t.needsUpdate = true; t.repeat.set(n, 1); return t; };
    const mx = std(col, { map:tex(b.d) }), mz = std(col, { map:tex(b.w) }), roof = std(col.clone().multiplyScalar(0.8), { roughness:1 });
    mats = [mx,mx,roof,roof,mz,mz]; uniq = [mx,mz,roof];
  } else {
    const wall = std(col, { roughness:0.95 }), roof = std(col.clone().multiplyScalar(0.55), { roughness:1 });
    mats = [wall,wall,roof,roof,wall,wall]; uniq = [wall,wall,roof];
  }
  const m = new THREE.Mesh(own(new THREE.BoxGeometry(w, h, d)), mats);
  m.position.set((b.x + b.w/2)*TILE, h/2, (b.z + b.d/2)*TILE);
  m.castShadow = m.receiveShadow = true;
  const add = (geo, mat, x, y, z) => mesh(geo, mat, x, y, z, m);
  const rnd = srand(b.seed || (b.x*131 + b.z*17));
  if (!plain && b.style !== 'warehouse'){
    // Window boxes on the two faces the camera sees, one per tile per floor (some lit), none over a
    // door or a landmark's storefront; a darker base course and, on flat roofs, a parapet.
    const dk = [], lt = [], lit = LIT[b.win || 0];
    for (let y = L ? 2.35 : 0.95; y < h - (L ? 1 : 0.55); y += 1.25)
      for (const onX of [true, false]){
        const n = onX ? b.d : b.w, span = onX ? d : w;
        for (let k=0;k<n;k++){
          const tx = onX ? b.x + b.w - 1 : b.x + k, tz = onX ? b.z + k : b.z + b.d - 1;
          if (y < 2 && doorAt.has(`${tx},${tz},${onX ? 1 : 0},${onX ? 0 : 1}`)) continue;
          const a = -span/2 + (k + 0.5)*span/n, ww = span/n - 0.6;
          (rnd() < lit ? lt : dk).push(onX ? [0.12, 0.66, ww, w/2 + 0.03, y - top, a] : [ww, 0.66, 0.12, a, y - top, d/2 + 0.03]);
        }
      }
    if (dk.length){ const wm = std(0x1f232a, { roughness:0.4, metalness:0.2 }); add(own(boxes(dk)), wm, 0, 0, 0); uniq.push(wm); }
    if (lt.length){ const lm = std(0xffd27a, { emissive:0xffb347, emissiveIntensity:0.45, roughness:0.6 }); add(own(boxes(lt)), lm, 0, 0, 0); uniq.push(lm); }
    const base = std(col.clone().multiplyScalar(0.7), { roughness:1 }); uniq.push(base);
    add(own(box(w + 0.14, 0.45, d + 0.14)), base, 0, -top + 0.225, 0);
    if (b.style !== 'house' && !b.cut) add(own(boxes([[w + 0.1, 0.4, 0.28, 0, 0, d/2 - 0.09], [w + 0.1, 0.4, 0.28, 0, 0, -d/2 + 0.09], [0.28, 0.4, d + 0.1, w/2 - 0.09, 0, 0], [0.28, 0.4, d + 0.1, -w/2 + 0.09, 0, 0]])), base, 0, top + 0.2, 0);
  }
  if (b.cut){
    // Collapsed upper floors: jagged chunks of the old walls, a torn floor slab, bent rebar.
    const conc = std(col.clone().multiplyScalar(0.75), { roughness:1 }), rebar = std(0x5a3a28, { roughness:0.8, metalness:0.4 });
    for (const [fx, fz, fw, fd, ch] of b.chunks){
      const c = add(own(box(w*fw, ch, d*fd, true)), [mats[0], mats[1], conc, conc, mats[4], mats[5]], -w/2 + (fx + fw/2)*w, top, -d/2 + (fz + fd/2)*d);
    }
    add(own(box(w + 0.25, 0.16, d + 0.25)), conc, rnd(-0.1, 0.1), top + 0.02, rnd(-0.1, 0.1));
    for (let i=0;i<5;i++) add(G('rebar', () => box(0.12, 1, 0.12, true)), rebar, rnd(-w/2 + 0.3, w/2 - 0.3), top, rnd(-d/2 + 0.3, d/2 - 0.3)).scale.y = rnd(0.5, 1.3);
    uniq.push(conc, rebar);
  }
  if (b.cut || b.soot){
    // Blown-out holes on the faces the camera sees, soot streaked above them.
    const dark = std(0x0d0c0b, { roughness:1 }), soot = std(0x1c1a18, { roughness:1 });
    for (let i=0;i<(b.holes || 2);i++){
      const onX = rnd() < 0.5, hw = rnd(0.8, 1.6), hh = rnd(0.8, 1.5), y = rnd(-top + 1, Math.max(-top + 1, top - 2.4));
      const along = onX ? rnd(-d/2 + hw/2, d/2 - hw/2) : rnd(-w/2 + hw/2, w/2 - hw/2), at = (o, e) => onX ? [w/2 + o, along] : [along, d/2 + o];
      const [hx, hz] = at(0.1), [sx, sz] = at(0.11), sh = Math.min(1.6, top - y - hh/2);
      add(own(onX ? box(0.12, hh, hw) : box(hw, hh, 0.12)), dark, hx, y, hz);
      if (sh > 0.2) add(own(onX ? box(0.1, sh, hw*0.8) : box(hw*0.8, sh, 0.1)), soot, sx, y + hh/2 + sh/2, sz);
    }
    uniq.push(dark, soot);
  }
  if (b.style === 'house' || b.style === 'crypt'){
    // Gable roof along the long side; its triangular ends are plain wall. Burnt houses: charred, or
    // caved in to a few blackened rafters.
    const ridgeX = b.w >= b.d, span = (ridgeX ? d : w) + 0.4, len = (ridgeX ? w : d) + 0.4;
    const roof = std(b.burnt ? 0x1a1816 : b.roof, { roughness:1 });
    if (b.caved){
      for (let i=0;i<5;i++){
        const a = (i/4 - 0.5)*len*0.85, r = add(G('rafter', () => box(0.16, 0.16, 1, true)), roof, ridgeX ? a : 0, top, ridgeX ? 0 : a);
        r.scale.z = span*rnd(0.4, 0.95); r.rotation.y = ridgeX ? 0 : Math.PI/2;
      }
      uniq.push(roof);
    } else {
      // Stepped roof: three boxes narrowing toward the ridge, the lowest overhanging the walls.
      const tiers = [[1, 0.4], [0.64, 0.38], [0.3, 0.36]], parts = []; let y0 = 0;
      for (const [f, th] of tiers){ parts.push(ridgeX ? [len, th, span*f, 0, y0 + th/2, 0] : [span*f, th, len, 0, y0 + th/2, 0]); y0 += th; }
      const cap = std(col);
      add(own(boxes(parts)), roof, 0, top, 0);
      if (b.style === 'crypt'){
        // Dark doorway on the camera side and a cross on the ridge.
        const dk = std(0x111111, { roughness:1 });
        add(G('cryptDoor', () => box(0.7, 1.4, 0.06, true)), dk, 0, -top, d/2 + 0.02);
        add(G('crossV', () => box(0.16, 0.8, 0.16, true)), cap, 0, top + y0 - 0.05, 0); add(G('crossH', () => box(0.5, 0.16, 0.16)), cap, 0, top + y0 + 0.45, 0);
        uniq.push(dk);
      } else if (rnd() < 0.5 && !b.burnt){
        const a = len*0.25, s = span*0.15;
        add(G('chimney', () => box(0.45, 1, 0.45, true)), roof, ridgeX ? a : s, top, ridgeX ? s : a).scale.y = y0 + 0.35;
      }
      uniq.push(cap, roof);
    }
  } else if (b.style === 'tower' && !b.cut){
    if (b.ac) add(own(new THREE.BoxGeometry(Math.min(1.2,w*0.4),0.5,Math.min(0.9,d*0.4))), uniq[2], w*0.15, top + 0.25, -d*0.1);
    if (w*d > 14 && rnd() < 0.4){
      // Water tank on legs.
      const t = add(G('tank', () => boxes([[1.4,1.1,1.4,0,0,0], [1.0,0.3,1.0,0,0.7,0]])), uniq[2], -w*0.2, top + 1.45, d*0.15);
      for (const [lx,lz] of [[-0.55,-0.55],[0.55,-0.55],[-0.55,0.55],[0.55,0.55]]) add(G('leg', () => box(0.2, 0.9, 0.2)), uniq[2], -w*0.2 + lx, top + 0.45, d*0.15 + lz);
      t.castShadow = true;
    }
    if (h > 13 && rnd() < 0.5){ const a = add(SH.poleGeo, uniq[2], 0, top, 0); a.scale.set(1, 3.5, 1); }
    if (w > 4 && d > 4) add(G('stairHut', () => box(1.3, 1.0, 1.3, true)), uniq[2], -w/2 + 1.0, top, -d/2 + 1.0);
  } else if (b.style === 'warehouse'){
    const dm = std(0x3c3f44, { roughness:0.6, metalness:0.3 });
    if (!b.cut) add(G('rollup', () => boxes([[2.2, 2.2, 0.12, 0, 0, 0], [2.4, 0.16, 0.18, 0, 1.1, 0]])), dm, Math.min(0, w/2 - 1.6), -top + 1.1, d/2 + 0.05);
    if (b.ac && !b.cut) add(own(new THREE.BoxGeometry(Math.min(1.4,w*0.4),0.6,Math.min(1,d*0.4))), uniq[2], -w*0.2, top + 0.3, 0);
    uniq.push(dm);
  }
  if (L){
    const band = std(L.band, { roughness:0.6 });
    add(own(new THREE.BoxGeometry(w + 0.06, 0.5, d + 0.06)), band, 0, top - 0.45, 0);
    // Glass storefront on the door's side, one pane per tile so the door itself stays clear.
    const glass = glassMat(), [fx, fz] = b.face;
    for (let k=0;k<(fx ? b.d : b.w);k++){
      const tx = fx ? (fx > 0 ? b.x + b.w - 1 : b.x) : b.x + k, tz = fx ? b.z + k : (fz > 0 ? b.z + b.d - 1 : b.z);
      if (tx === b.door[0] && tz === b.door[1]) continue;
      const px = (tx + 0.5)*TILE - m.position.x + fx*TILE*0.43, pz = (tz + 0.5)*TILE - m.position.z + fz*TILE*0.43;
      add(G('pane' + (fx ? 'x' : 'z'), () => fx ? box(0.12, 1.3, TILE - 0.5) : box(TILE - 0.5, 1.3, 0.12)), glass, px, -top + 1.35, pz);
      if (L.grille) for (let i=-2;i<=2;i++) add(G('grille', () => box(0.12, 1.4, 0.12)), band, px + fx*0.05 + (fx ? 0 : i*0.3), -top + 1.35, pz + fz*0.05 + (fx ? i*0.3 : 0));
    }
    uniq.push(band, glass);
    // Roof sign angled toward the camera.
    const sm = signMats(b.lm), side = own(sm[0].clone()), front = own(sm[4].clone());
    const sign = add(own(new THREE.BoxGeometry(Math.max(2.6, Math.min(w, d)*0.95), 0.8, 0.2)), [side,side,side,side,front,side], 0, top + 0.55, 0);
    sign.rotation.y = Math.PI/4;
    uniq.push(side, front);
    if (b.lm === 'pharmacy'){
      // Glowing green cross on a post at the front corner.
      const gc = std(0x2fd06a, { emissive:0x1fbf55, emissiveIntensity:1.1, roughness:0.4 });
      const cx = w/2 - 0.4, cz = d/2 - 0.4;
      add(SH.poleGeo, uniq[2], cx, top, cz).scale.set(1, 1.1, 1);
      const cr = new THREE.Group(); cr.position.set(cx, top + 1.6, cz); cr.rotation.y = Math.PI/4; m.add(cr);
      mesh(G('crossA', () => box(1.0, 0.32, 0.14)), gc, 0, 0, 0, cr); mesh(G('crossB', () => box(0.32, 1.0, 0.14)), gc, 0, 0, 0, cr);
      uniq.push(gc);
    }
  }
  m.userData.mats = uniq;
  return m;
}

// Building site frame: an invisible hull (it blocks, and fades like any building) around steel
// columns on every tile corner, concrete floor slabs (the top one unfinished) and a lift core.
function frameMesh(b){
  const w = b.w*TILE - 0.3, d = b.d*TILE - 0.3, h = b.h, fl = b.floors, fh = h/fl;
  const hull = std(0, { visible:false }), steel = std(0x7a4a2e, { roughness:0.7, metalness:0.3 }), conc = std(0x9a968e, { roughness:1 });
  const m = new THREE.Mesh(own(new THREE.BoxGeometry(w, h, d)), hull);
  m.position.set((b.x + b.w/2)*TILE, h/2, (b.z + b.d/2)*TILE);
  const add = (geo, mat, x, y, z) => mesh(geo, mat, x, y, z, m), rnd = srand(b.x*31 + b.z*7);
  for (let i=0;i<=b.w;i++) for (let j=0;j<=b.d;j++){
    const top = i === b.w && j === 0 ? h*0.7 : h;
    add(G('col' + top, () => box(0.22, top, 0.22, true)), steel, -w/2 + i*w/b.w, -h/2, -d/2 + j*d/b.d);
  }
  for (let k=1;k<=fl;k++){
    const part = k === fl ? rnd(0.4, 0.7) : 1;
    add(own(box(w*part + 0.1, 0.18, d + 0.1, true)), conc, -w/2 + w*part/2, -h/2 + k*fh - 0.18, 0);
    for (const sd of [-1, 1]) add(own(box(w + 0.1, 0.16, 0.16, true)), steel, 0, -h/2 + k*fh - 0.34, sd*d/2);
  }
  add(own(box(1.3, h*0.92, 1.3, true)), conc, -w/2 + 0.75, -h/2, -d/2 + 0.75);
  m.userData.mats = [hull, steel, conc];
  return m;
}

// ---------- Walk-in landmarks ----------
// Walls sit on the tile grid (full tiles, so they look exactly as solid as they collide), with a
// colour band, glass along the front, a header over the open entrance and a roof with a sign.
// While the player stands inside, updateInteriors() (fx.js) hides the roof and lowers the walls.
function buildInterior(it, idx){
  const L = LANDMARKS[it.lm], H = it.h, cityGroup = world.cityGroup;
  const shell = new THREE.Group(), roof = new THREE.Group(); cityGroup.add(shell, roof);
  const wall = std(L.wall), band = std(L.band, { roughness:0.6 }), glass = glassMat(), dark = std(0x2a2d33, { roughness:0.6, metalness:0.3 });
  const roofM = std(new THREE.Color(L.wall).multiplyScalar(0.5), { roughness:1 });
  const sm = signMats(it.lm), side = own(sm[0].clone()), front = own(sm[4].clone()), signM = [side,side,side,side,front,side];
  const mats = [wall, band, glass, dark, roofM, side, front], parts = [];
  const isWall = new Set(it.walls.map(([x,z]) => z*N + x)), used = new Set(), runs = [];
  // Greedy wall runs: along x first, what's left along z.
  for (let z=it.z0;z<=it.z1;z++) for (let x=it.x0;x<=it.x1;x++){
    if (!isWall.has(z*N+x) || used.has(z*N+x)) continue;
    let e = x; while (isWall.has(z*N + e+1) && !used.has(z*N + e+1)) e++;
    if (e > x){ for (let k=x;k<=e;k++) used.add(z*N+k); runs.push([x, z, e, z]); }
  }
  for (let z=it.z0;z<=it.z1;z++) for (let x=it.x0;x<=it.x1;x++){
    if (!isWall.has(z*N+x) || used.has(z*N+x)) continue;
    let e = z; while (isWall.has((e+1)*N + x) && !used.has((e+1)*N + x)) e++;
    for (let k=z;k<=e;k++) used.add(k*N+x); runs.push([x, z, x, e]);
  }
  // Runs along the front wall get a strip of shop windows.
  const [fx, fz] = it.front, onFront = (x0, z0, x1, z1) => fz ? z0 === z1 && z0 === it.z1 : x0 === x1 && x0 === it.x1;
  for (const [x0, z0, x1, z1] of runs){
    const lx = (x1-x0+1)*TILE, lz = (z1-z0+1)*TILE, cx = (x0 + x1 + 1)/2*TILE, cz = (z0 + z1 + 1)/2*TILE;
    parts.push(mesh(own(box(lx, H, lz, true)), wall, cx, 0, cz, shell));
    mesh(own(box(lx + 0.04, 0.55, lz + 0.04, true)), band, cx, H - 0.7, cz, shell, false);
    if (onFront(x0, z0, x1, z1) && (fz ? lx : lz) > TILE)
      mesh(own(fz ? box(lx - 0.8, 1.5, 0.06, true) : box(0.06, 1.5, lz - 0.8, true)), glass, cx + fx*(TILE/2 + 0.03), 0.9, cz + fz*(TILE/2 + 0.03), shell, false);
  }
  // Entrance: dark frame posts, a header above, and the name over the door.
  const ex0 = Math.min(...it.ent.map(t => t[0])), ex1 = Math.max(...it.ent.map(t => t[0])), ez0 = Math.min(...it.ent.map(t => t[1])), ez1 = Math.max(...it.ent.map(t => t[1]));
  const ecx = (ex0 + ex1 + 1)/2*TILE, ecz = (ez0 + ez1 + 1)/2*TILE, elen = fz ? (ex1-ex0+1)*TILE : (ez1-ez0+1)*TILE;
  parts.push(mesh(own(fz ? box(elen, H - 2.7, TILE, true) : box(TILE, H - 2.7, elen, true)), wall, ecx, 2.7, ecz, shell));
  mesh(own(fz ? box(elen + 0.04, 0.55, TILE + 0.04, true) : box(TILE + 0.04, 0.55, elen + 0.04, true)), band, ecx, H - 0.7, ecz, shell, false);
  for (const s of [-1, 1]) mesh(G('post', () => box(0.18, 2.7, 0.18, true)), dark, ecx + (fz ? s*elen/2 : fx*0.9), 0, ecz + (fz ? fz*0.9 : s*elen/2), shell);
  const es = mesh(G('entSign', () => box(3.4, 0.6, 0.12)), signM, ecx + fx*(TILE/2 + 0.08), 3.25, ecz + fz*(TILE/2 + 0.08), shell, false);
  es.rotation.y = Math.atan2(fx, fz);
  // Roof (with rooftop units and the big sign).
  const rw = (it.x1 - it.x0 + 1)*TILE, rd = (it.z1 - it.z0 + 1)*TILE, rcx = it.x0*TILE + rw/2, rcz = it.z0*TILE + rd/2;
  const slab = mesh(own(box(rw, 0.3, rd, true)), roofM, rcx, H, rcz, roof);
  for (let i=0;i<3;i++) mesh(G('roofAC', () => box(1.4, 0.6, 1.0, true)), roofM, rcx + mr(-rw*0.35, rw*0.35), H + 0.3, rcz + mr(-rd*0.35, rd*0.35), roof);
  const sign = mesh(G('roofSign', () => box(7, 1.4, 0.25)), signM, rcx, H + 1.3, rcz, roof);
  sign.rotation.y = Math.PI/4;
  if (it.lm === 'police'){ const a = mesh(SH.poleGeo, dark, rcx - rw*0.35, H + 0.3, rcz - rd*0.35, roof); a.scale.set(1, 4, 1); }
  if (it.lm === 'hospital'){
    // Helipad cross on the roof, offset so the sign doesn't cover it.
    const red = std(LANDMARKS.hospital.band, { roughness:0.7 }); mats.push(red);
    const hx = rcx - rw*0.22, hz = rcz - rd*0.22;
    mesh(G('heliA', () => box(4.2, 0.06, 1.3, true)), red, hx, H + 0.3, hz, roof, false); mesh(G('heliB', () => box(1.3, 0.06, 4.2, true)), red, hx, H + 0.3, hz, roof, false);
  }
  slab.userData.mats = mats;
  for (const p of parts.concat(slab)){ p.userData.fadeKey = slab; world.buildingMeshes.push(p); }
  world.interiors.push({ shell, roof, key:slab, k:0 });
  for (let z=it.z0;z<=it.z1;z++) for (let x=it.x0;x<=it.x1;x++) if (!isWall.has(z*N+x)) world.interiorAt[z*N+x] = idx + 1;
}

// ---------- Props ----------
// Landmark furniture and yard clutter from cityGen's props list. Returns tile -> open(), the
// visual for searching the prop (a shelf emptied, a locker door swung open, a drawer pulled out).
const D4S = [[1,0],[-1,0],[0,1],[0,-1]];
const tentGeo = () => G('tent', () => boxes([[1.9,0.8,1.9,0,0.4,0], [1.4,0.42,1.9,0,1.01,0], [0.8,0.34,1.9,0,1.39,0]]));  // box tent, stepped roof
// Chain-link mesh: a square grid, see-through (alpha-tested) on a thin box panel.
const chainMat = () => G('chainMesh', () => new THREE.MeshStandardMaterial({ map:canvasTex(64, (g, s) => {
  g.fillStyle = '#9aa0a6'; for (let k=0;k<s;k+=16){ g.fillRect(k, 0, 3, s); g.fillRect(0, k, s, 3); }
}, 2, 4), alphaTest:0.45, side:THREE.DoubleSide, roughness:0.6, metalness:0.4 }));
// Half a fence run, from the post (x = 0) to the tile edge (x = TILE/2), as one box geometry per kind.
// Picket: square pickets on two rails; rail: three rails; iron: square bars between two rails; chain: a frame.
const fenceRun = (st, H) => G('frun-' + st, () => {
  const L = TILE/2, list = [];
  if (st === 'picket'){ for (const x of [0.25, 0.6, 0.92]) list.push([0.16, H, 0.1, x, H/2, 0]); for (const y of [0.3, 0.72]) list.push([L, 0.12, 0.1, L/2, y, -0.1]); }
  else if (st === 'rail') for (const y of [0.3, 0.65, 1.0]) list.push([L, 0.15, 0.12, L/2, y, 0]);
  else if (st === 'iron'){ for (const x of [0.25, 0.5, 0.75]) list.push([0.1, H, 0.1, x, H/2, 0]); for (const y of [0.18, H - 0.06]) list.push([L, 0.12, 0.12, L/2, y, 0]); }
  else for (const y of [0.08, H - 0.05]) list.push([L, 0.1, 0.1, L/2, y, 0]);
  return boxes(list);
});
// Fence height and post material by style; the post itself.
const fenceLook = st => ({ H:{ iron:1.3, chain:1.9, picket:1.0, rail:1.1 }[st], postM:st === 'picket' || st === 'rail' ? M(st + 'Post', st === 'picket' ? 0xe8e4da : 0x6e5235) : M('post', 0x2a2c30, { metalness:0.4 }) });
const fencePost = (st, H) => st === 'picket' || st === 'rail' ? box(0.22, H + 0.12, 0.22, true) : boxes([[0.18, H + 0.08, 0.18, 0, (H + 0.08)/2, 0], [0.26, 0.1, 0.26, 0, H + 0.1, 0]]);
// Lattice for crane mast and jib (yellow frame with X bracing), repeated rx × ry times.
const latticeMat = (rx, ry) => std(0xffffff, { map:canvasTex(64, (g, s) => {
  g.strokeStyle = '#d9a21b'; g.lineWidth = 6; g.strokeRect(3, 3, s - 6, s - 6); g.lineWidth = 4;
  g.fillStyle = '#d9a21b'; g.fillRect(0, s/2 - 3, s, 6);
}, rx, ry), alphaTest:0.4, side:THREE.DoubleSide, roughness:0.7 });
// Painted signs: quarantine notice, ROAD CLOSED board, orange-and-white barricade stripes.
const signTex = kind => G('sign-' + kind, () => {
  const stripes = kind === 'stripes';
  const map = canvasTex(stripes ? 64 : 256, (g, s, hh) => {
    if (stripes){ g.fillStyle = '#f2efe6'; g.fillRect(0, 0, s, s); g.fillStyle = '#e0601a'; for (let k=0;k<s;k+=32) g.fillRect(k, 0, 16, s); return; }
    const q = kind === 'quarantine';
    g.fillStyle = q ? '#e8c22a' : '#f2efe6'; g.fillRect(0, 0, s, hh); g.fillStyle = q ? '#111' : '#c0281e'; g.fillRect(0, 0, s, 8); g.fillRect(0, hh - 8, s, 8);
    g.font = `bold ${q ? 40 : 52}px Barlow, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (q){ g.fillText('☣ QUARANTINE', s/2, hh*0.38, s - 16); g.font = 'bold 30px Barlow, Arial, sans-serif'; g.fillText('KEEP OUT', s/2, hh*0.72, s - 16); }
    else g.fillText('ROAD CLOSED', s/2, hh/2 + 2, s - 16);
  }, stripes ? 3 : 1, 1, stripes ? 64 : kind === 'quarantine' ? 124 : 88);
  return new THREE.MeshStandardMaterial({ map, roughness:0.7, side:THREE.DoubleSide });
});
// A painted sign on a box: the paint on front and back, plain board on the edges.
const signFaces = kind => { const t = signTex(kind), e = M('signEdge', 0xd9d4c6, { roughness:0.8 }); return [e, e, e, e, t, t]; };
function buildProps(c){
  const opens = new Map(), cityGroup = world.cityGroup, fenceAt = new Set(c.props.filter(p => p.kind === 'fence' && !p.broken).map(p => p.z*N + p.x));
  // A fence runs on into a gate in it or a piece of it lying broken.
  const linkAt = new Set(c.props.filter(p => p.kind === 'fgate' || (p.kind === 'fence' && p.broken)).map(p => p.z*N + p.x));
  for (const p of c.props){
    const g = p.g = new THREE.Group(); g.position.set((p.x+0.5)*TILE, groundAt((p.x+0.5)*TILE, (p.z+0.5)*TILE), (p.z+0.5)*TILE); g.rotation.y = p.rot || 0; cityGroup.add(g);
    let open = null;
    if (p.kind === 'shelf'){
      mesh(SH.shelfGeo, SH.metalMat, 0, 0, 0, g);
      // Goods on three levels both sides, as one instanced mesh with random colours.
      const im = own(new THREE.InstancedMesh(SH.goodsGeo, SH.whiteMat, 24)), col = new THREE.Color();
      let n = 0;
      for (const sd of [-1,1]) for (const y of [0.3, 0.75, 1.2]) for (let i=0;i<4;i++){
        if (Math.random() < 0.15) continue;
        dummy.position.set(-0.62 + i*0.41, y, sd*0.36); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, mr(0.8,1.25), 1); dummy.updateMatrix();
        im.setMatrixAt(n, dummy.matrix); im.setColorAt(n++, col.copy(mpick(SH.goodsMats).color));
      }
      im.count = n; im.castShadow = true; g.add(im);
      if (p.search) open = () => { im.count = Math.min(n, 4); };
    } else if (p.kind === 'counter'){
      mesh(SH.counterGeo, SH.darkMetalMat, 0, 0, 0, g);
      mesh(SH.registerGeo, SH.whiteMat, 0.45, 0.95, 0, g);
      mesh(SH.monitorGeo, SH.screenMat, 0.45, 1.25, -0.05, g, false);
    } else if (p.kind === 'locker'){
      mesh(SH.lockerGeo, SH.lockerMat, 0, 0, 0, g);
      const doors = [];
      for (let i=0;i<3;i++){ const h = new THREE.Group(); h.position.set(-0.72 + i*0.49, 0.1, 0.31); g.add(h); mesh(SH.lockerDoorGeo, SH.lockerMat, 0, 0, 0, h, false); doors.push(h); }
      if (p.search) open = () => { doors[0].rotation.y = -1.9; doors[2].rotation.y = -1.4; };
    } else if (p.kind === 'armory'){
      mesh(SH.armoryGeo, SH.armoryMat, 0, 0, 0, g);
      const guns = new THREE.Group(); g.add(guns);
      for (let i=0;i<4;i++){ mesh(SH.rifleGeo, SH.darkMetalMat, -0.55 + i*0.37, 0.4, 0.36, guns); }
      open = () => { guns.visible = false; };
    } else if (p.kind === 'desk'){
      mesh(SH.deskGeo, SH.woodMat, 0, 0, 0, g);
      mesh(SH.monitorGeo, SH.screenMat, 0.3, 0.78, -0.2, g);
      const dr = mesh(SH.drawerGeo, SH.woodMat, -0.4, 0.4, 0.22, g);
      if (p.search) open = () => { dr.position.z = 0.7; };
    } else if (p.kind === 'bars'){
      for (let i=0;i<7;i++) mesh(SH.barGeo, SH.darkMetalMat, -0.9 + i*0.3, 0, 0, g);
      mesh(SH.railGeo, SH.darkMetalMat, 0, 2.3, 0, g); mesh(SH.railGeo, SH.darkMetalMat, 0, 0.1, 0, g);
    } else if (p.kind === 'pump'){
      mesh(SH.pumpGeo, SH.whiteMat, 0, 0, 0, g);
      mesh(SH.pumpTopGeo, SH.redMat, 0, 1.4, 0, g);
      mesh(SH.monitorGeo, SH.screenMat, 0, 0.9, 0.24, g, false);
    } else if (p.kind === 'pylon'){
      mesh(SH.poleGeo, SH.darkMetalMat, 0, 0, 0, g).scale.set(2.2, 4.4, 2.2);
      const s = mesh(G('pylonSign', () => box(1.9, 1.1, 0.22)), signMats(p.lm), 0, 4.6, 0, g);
      s.rotation.y = Math.PI/4 - g.rotation.y;
    } else if (p.kind === 'lumber'){
      const ls = []; for (let i=0;i<3;i++) ls.push(mesh(SH.lumberGeo, SH.lumberMat, mr(-0.08,0.08), i*0.24, mr(-0.08,0.08), g));
      if (p.search) open = () => { ls[2].visible = false; ls[1].position.x += 0.45; };
    } else if (p.kind === 'cart'){
      g.position.x += mr(-0.4,0.4); g.position.z += mr(-0.4,0.4);
      mesh(SH.cartGeo, SH.metalMat, 0, 0.3, 0, g);
      mesh(G('cartHandle', () => box(0.5, 0.06, 0.06)), SH.redMat, 0, 0.78, -0.42, g, false);
    } else if (p.kind === 'flag'){
      mesh(SH.poleGeo, SH.metalMat, 0, 0, 0, g).scale.set(1, 4.6, 1);
      const f = mesh(SH.flagGeo, SH.flagMat, 0.48, 4.25, 0, g); f.rotation.y = Math.PI/4 - g.rotation.y;
    } else if (p.kind === 'bed'){
      mesh(G('bed', () => box(1.7, 0.55, 0.9, true)), SH.whiteMat, 0, 0, 0, g);
      mesh(G('pillow', () => box(0.35, 0.12, 0.6, true)), SH.metalMat, 0.6, 0.55, 0, g, false);
      mesh(G('blanket', () => box(1.0, 0.06, 0.94, true)), SH.blanketMat, -0.25, 0.55, 0, g, false);
    } else if (p.kind === 'gurney'){
      mesh(G('gurney', () => box(1.6, 0.12, 0.7, true)), SH.whiteMat, 0, 0.75, 0, g);
      for (const [lx, lz] of [[-0.65,-0.25],[0.65,-0.25],[-0.65,0.25],[0.65,0.25]]) mesh(SH.poleGeo, SH.metalMat, lx, 0, lz, g, false).scale.set(0.8, 0.75, 0.8);
    } else if (p.kind === 'medcab'){
      mesh(SH.lockerGeo, SH.whiteMat, 0, 0, 0, g);
      const h = new THREE.Group(); h.position.set(-0.72, 0.1, 0.31); g.add(h);
      mesh(G('cabDoor', () => { const b = box(1.44, 1.8, 0.04, true); b.translate(0.72, 0, 0); return b; }), SH.whiteMat, 0, 0, 0, h, false);
      mesh(G('cabCrossA', () => box(0.5, 0.14, 0.03)), SH.redMat, 0.72, 1.3, 0.03, h, false); mesh(G('cabCrossB', () => box(0.14, 0.5, 0.03)), SH.redMat, 0.72, 1.3, 0.03, h, false);
      if (p.search) open = () => { h.rotation.y = -1.7; };
    } else if (p.kind === 'sandbag'){
      // Two staggered courses of bags.
      mesh(G('bagsLow', () => box(TILE, 0.5, 1.0, true)), SH.sandbagMat, 0, 0, 0, g);
      mesh(G('bagsHigh', () => box(TILE - 0.3, 0.45, 0.8, true)), SH.sandbagMat, 0, 0.5, 0, g);
    } else if (p.kind === 'tent' || p.kind === 'medtent'){
      const med = p.kind === 'medtent', t = mesh(tentGeo(), med ? M('medTent', 0xd8d4c8, { side:THREE.DoubleSide }) : SH.tentMat, 0, 0, 0, g);
      t.rotation.y = Math.PI/2;
      // First-aid tent: a red cross on both ends.
      if (med) for (const sd of [-1, 1]){ mesh(G('tcA', () => box(0.5, 0.16, 0.04)), SH.redMat, 0, 0.5, sd*0.96, t, false); mesh(G('tcB', () => box(0.16, 0.5, 0.04)), SH.redMat, 0, 0.5, sd*0.96, t, false); }
    } else if (p.kind === 'tower'){
      // Watchtower: four legs, a platform with a sandbag rim, a little roof.
      for (const [lx, lz] of [[-0.7,-0.7],[0.7,-0.7],[-0.7,0.7],[0.7,0.7]]) mesh(SH.poleGeo, SH.woodMat, lx, 0, lz, g).scale.set(1.5, 3.4, 1.5);
      mesh(G('towerDeck', () => box(1.9, 0.15, 1.9, true)), SH.woodMat, 0, 3.4, 0, g);
      mesh(G('towerRim', () => box(1.9, 0.55, 1.9, true)), SH.sandbagMat, 0, 3.55, 0, g);
      for (const [lx, lz] of [[-0.85,-0.85],[0.85,-0.85],[-0.85,0.85],[0.85,0.85]]) mesh(SH.poleGeo, SH.woodMat, lx, 3.55, lz, g, false).scale.set(1, 1.3, 1);
      mesh(G('towerRoof', () => box(2.2, 0.12, 2.2, true)), SH.tentMat, 0, 4.85, 0, g);
    } else if (p.kind === 'milcrate'){
      mesh(G('milBox', () => box(1.4, 0.75, 0.9, true)), SH.milMat, 0, 0, 0, g);
      const lid = mesh(G('milLid', () => box(1.46, 0.12, 0.96, true)), SH.milMat, 0, 0.75, 0, g);
      mesh(G('milStripe', () => box(1.42, 0.1, 0.92, true)), SH.lumberMat, 0, 0.45, 0, g, false);
      if (p.search) open = () => { lid.position.set(0, 0.2, 0.75); lid.rotation.x = 1.2; };
    } else if (p.kind === 'gate'){
      // Two posts and the sign over the gap in the sandbags.
      for (const sd of [-1, 1]) mesh(SH.poleGeo, SH.woodMat, sd*2.1, 0, 0, g).scale.set(2, 3.4, 2);
      mesh(G('gateSign', () => box(4.4, 0.7, 0.12)), signMats(p.lm), 0, 3.1, 0, g);
    } else if (p.kind === 'fence' && p.broken){
      // A piece knocked down: a snapped post stub, the run lying in the grass (or half over) to one side.
      g.rotation.y = p.rot ? Math.PI/2 : 0;
      const st = p.style, { H, postM } = fenceLook(st);
      mesh(G('fstub' + st, () => box(0.22, 0.4, 0.22, true)), postM, 0, 0, 0, g);
      const f = new THREE.Group(); f.rotation.x = p.side*p.lean; f.position.y = 0.05; g.add(f);
      for (const ry of [0, Math.PI]){
        mesh(fenceRun(st, H), postM, 0, 0, 0, f).rotation.y = ry;
        if (st === 'chain') mesh(G('chainPanel', () => box(TILE/2, H - 0.1, 0.03)), chainMat(), TILE/4*(ry ? -1 : 1), H/2, 0, f, false);
      }
    } else if (p.kind === 'fgate'){
      // A gate in a fence: hung off the post on the hinge side (p.h points to it), swung open or ajar
      // (or lying where it fell), with a post at each end of the gap that has fence beside it.
      g.rotation.y = 0;
      const st = p.style, { H, postM } = fenceLook(st), [hx, hz] = p.h, L = TILE/2;
      for (const sd of [1, -1]) if (fenceAt.has((p.z + hz*sd)*N + p.x + hx*sd)) mesh(G('fpost' + st, () => fencePost(st, H)), postM, hx*sd*(L - 0.11), 0, hz*sd*(L - 0.11), g);
      const pivot = new THREE.Group(); pivot.position.set(hx*(L - 0.11), 0, hz*(L - 0.11)); g.add(pivot);
      pivot.rotation.y = Math.atan2(hz, -hx) + (p.fallen ? 0 : p.swing*p.ajar*Math.PI/2);
      const leaf = new THREE.Group(); leaf.scale.x = 0.88; pivot.add(leaf);
      if (p.fallen){ leaf.rotation.x = p.swing*1.45; leaf.position.y = 0.05; }
      for (const o of [0, L]){
        mesh(fenceRun(st, H), postM, o, 0, 0, leaf);
        if (st === 'chain') mesh(G('chainPanel', () => box(TILE/2, H - 0.1, 0.03)), chainMat(), o + TILE/4, H/2, 0, leaf, false);
      }
      mesh(G('gstile' + st, () => box(0.16, H, 0.16, true)), postM, TILE - 0.08, 0, 0, leaf);
    } else if (p.kind === 'fence'){
      // Posts on the tile centre, a panel toward every neighbouring fence tile (a lone one spans its
      // tile along rot). Chain-link (with a quarantine sign where it closes a road) or cemetery iron.
      g.rotation.y = 0;
      const st = p.style, { H, postM } = fenceLook(st);
      mesh(G('fpost' + st, () => fencePost(st, H)), postM, 0, 0, 0, g);
      // A straight run ends flush with its tile's edge (against a wall, a gate); corners don't stick out.
      const dirs = D4S.filter(([dx, dz]) => fenceAt.has((p.z + dz)*N + p.x + dx) || linkAt.has((p.z + dz)*N + p.x + dx)), axisX = dirs.some(d => d[0]), axisZ = dirs.some(d => d[1]);
      const runs = !dirs.length ? (p.rot ? [[0,1],[0,-1]] : [[1,0],[-1,0]]) : axisX && axisZ ? dirs : axisX ? [[1,0],[-1,0]] : [[0,1],[0,-1]];
      for (const [dx, dz] of runs){
        const ry = Math.atan2(-dz, dx);
        mesh(fenceRun(st, H), postM, 0, 0, 0, g).rotation.y = ry;
        if (st === 'chain'){ const pn = mesh(G('chainPanel', () => box(TILE/2, H - 0.1, 0.03)), chainMat(), TILE/4*dx, H/2, TILE/4*dz, g, false); pn.rotation.y = ry; }
      }
      if (p.sign){ const sg = mesh(G('qsign', () => box(1.3, 0.62, 0.08)), signFaces('quarantine'), 0, 1.1, 0, g, false); sg.rotation.y = p.rot ? 0 : Math.PI/2; }
    } else if (p.kind === 'jersey'){
      // Concrete barriers, two to a tile, with an orange reflector strip.
      for (const sd of [-0.5, 0.5]){
        const k = new THREE.Group(); k.position.set(sd*TILE*0.5, 0, mr(-0.1, 0.1)); g.add(k);
        mesh(G('jerseyLow', () => box(0.95, 0.3, 0.62, true)), M('concrete', 0xb3afa5), 0, 0, 0, k);
        mesh(G('jerseyHigh', () => box(0.95, 0.55, 0.32, true)), M('concrete', 0xb3afa5), 0, 0.3, 0, k);
        mesh(G('jerseyStripe', () => box(0.96, 0.1, 0.34, true)), M('reflect', 0xd9822b, { emissive:0x7a3a08, emissiveIntensity:0.5 }), 0, 0.65, 0, k, false);
      }
    } else if (p.kind === 'sawhorse'){
      // Striped wooden barricade, some with a ROAD CLOSED board on top.
      for (const y of [0.42, 0.85]) mesh(G('sawBoard', () => box(1.75, 0.24, 0.12, true)), signTex('stripes'), 0, y, 0.12, g);
      mesh(G('sawLegs', () => boxes([-0.72, 0.72].map(x => [0.16, 1.1, 0.16, x, 0.55, 0]))), M('wood', 0x8a6a44), 0, 0, 0, g);
      if ((p.x + p.z) % 2) mesh(G('closedSign', () => box(1.1, 0.38, 0.08)), signFaces('closed'), 0, 1.35, 0.14, g, false);
    } else if (p.kind === 'heap'){
      // Rubble from a collapsed building: broken blocks, slabs of floor and rebar.
      const rnd = srand(p.seed);
      // A stepped pile: big blocks at the bottom, smaller ones and slabs higher up, a few rebar stubs.
      for (let i=0;i<7;i++){ const s = rnd(1, 1.9) - i*0.08, m = mesh(SH.rubbleGeo, SH.rubbleMat, rnd(-0.6, 0.6)*(1 - i/10), 0.23*s + (i > 3 ? 0.4 : 0), rnd(-0.6, 0.6)*(1 - i/10), g); m.scale.setScalar(s); m.rotation.y = i % 2 ? Math.PI/2 : 0; }
      for (let i=0;i<2;i++) mesh(G('heapSlab', () => box(1.4, 0.18, 0.9)), M('concrete', 0xb3afa5), rnd(-0.4, 0.4), 0.85 + i*0.18, rnd(-0.4, 0.4), g).rotation.y = i*Math.PI/2;
      for (let i=0;i<2;i++) mesh(G('rebarP', () => box(0.12, 0.9, 0.12, true)), M('rebar', 0x5a3a28, { metalness:0.4 }), rnd(-0.5, 0.5), 0.5, rnd(-0.5, 0.5), g, false);
    } else if (p.kind === 'bus'){
      // A bus slewed across both lanes, sometimes on its side or burnt out.
      g.position.set(p.cx*TILE, 0, p.cz*TILE);
      const body = new THREE.Group(); body.position.y = p.side ? 0.9 : 1.13; body.rotation.x = p.side ? Math.PI/2 : 0; g.add(body);
      const col = p.burnt ? 0x2b2724 : p.color, glass = p.burnt ? carMat(0x151311) : SH.glassMat;
      mesh(G('busBody', () => box(4.6, 1.55, 1.75)), carMat(col), 0, 0, 0, body);
      mesh(G('busWin', () => box(4.0, 0.5, 1.77)), glass, -0.1, 0.35, 0, body, false);
      mesh(G('busShield', () => box(0.05, 0.75, 1.5)), glass, 2.31, 0.25, 0, body, false);
      if (!p.burnt) mesh(G('busStripe', () => box(4.62, 0.12, 1.77)), carMat(p.stripe), 0, -0.25, 0, body, false);
      const wg = G('busWheel', () => box(0.82, 0.82, 0.25));
      for (const wx of [-1.5, -0.8, 1.5]) for (const wz of [-0.8, 0.8]) mesh(wg, M('wheel', 0x16171a), wx, -0.78, wz, body);
    } else if (p.kind === 'crane'){
      // Tower crane: lattice mast and jib, cab, counterweight and a load hanging off the hook.
      // It fades like a building when it's in the way (its own materials).
      const H = p.h, J = p.jib, yel = 0xd9a21b;
      const mastM = latticeMat(1, H/0.9), jibM = latticeMat(J/0.6, 1), solid = std(yel, { roughness:0.7 }), conc = std(0x8d8a84, { roughness:1 }), cable = std(0x222222, { roughness:0.6 });
      mesh(G('craneBase', () => box(1.7, 0.35, 1.7, true)), conc, 0, 0, 0, g);
      const mast = mesh(own(box(0.9, H, 0.9, true)), mastM, 0, 0, 0, g);
      const jib = mesh(own(box(J, 0.6, 0.6, true)), jibM, J*0.22, H, 0, g);
      mesh(G('craneCab', () => box(1.1, 0.95, 1.0, true)), solid, 0.55, H - 0.95, 0.7, g);
      mesh(G('craneApex', () => box(0.35, 2.4, 0.35, true)), solid, 0, H + 0.6, 0, g);
      mesh(own(box(1.5, 1.0, 0.9, true)), conc, -J*0.24, H - 0.4, 0, g);
      const hx = J*0.55, L = H*0.55;
      mesh(G('trolley', () => box(0.6, 0.25, 0.7, true)), solid, hx, H - 0.25, 0, g, false);
      mesh(own(box(0.1, L, 0.1, true)), cable, hx, H - L, 0, g, false);
      mesh(G('hook', () => box(0.35, 0.4, 0.3, true)), solid, hx, H - L - 0.4, 0, g);
      const load = mesh(G('craneLoad', () => box(2.2, 0.28, 0.45, true)), M('steel', 0x7a4a2e, { metalness:0.3 }), hx, H - L - 0.75, 0, g); load.rotation.y = mr(-0.5, 0.5);
      mast.userData.mats = [mastM, jibM, solid, conc, cable]; mast.userData.center = g.position;
      jib.userData.fadeKey = mast; world.buildingMeshes.push(mast, jib);
    } else if (p.kind === 'pipes'){
      // Concrete drainage pipes, two lying side by side and one on top.
      // Square concrete culverts, two side by side and one on top, dark openings at the ends.
      const pg = G('pipe', () => box(1.7, 0.8, 0.8)), ig = G('pipeEnd', () => box(1.72, 0.56, 0.56));
      for (const [py, pz] of [[0.4, -0.42], [0.4, 0.42], [1.2, 0]]){ mesh(pg, M('concrete', 0xb3afa5), 0, py, pz, g); mesh(ig, M('pipeIn', 0x2a2826), 0, py, pz, g, false); }
    } else if (p.kind === 'grave'){
      // A row of headstones (slabs, crosses, an obelisk), some leaning, over mounds; some dug open.
      const rnd = srand(p.seed), stone = M('stone', 0x8d8a84), dirt = M('graveDirt', 0x3e3226), hole = M('graveHole', 0x0d0b09);
      for (let i=0;i<p.n;i++){
        const x = (i - (p.n - 1)/2)*0.62, k = new THREE.Group(); k.position.set(x, 0, -0.45); g.add(k);
        const r = rnd();
        if (r < 0.55) mesh(G('stoneSlab', () => boxes([[0.44,0.6,0.16,0,0.3,0], [0.3,0.12,0.16,0,0.66,0], [0.54,0.1,0.26,0,0.05,0]])), stone, 0, 0, 0, k);
        else if (r < 0.85) mesh(G('stoneCross', () => boxes([[0.16,0.9,0.16,0,0.45,0], [0.5,0.16,0.16,0,0.62,0]])), stone, 0, 0, 0, k);
        else mesh(G('obelisk', () => boxes([[0.4,0.2,0.4,0,0.1,0], [0.28,0.8,0.28,0,0.6,0], [0.18,0.3,0.18,0,1.15,0]])), stone, 0, 0, 0, k);
        if (rnd() < 0.3){
          // Dug open from below: a black hole and the earth heaped beside it.
          const h = mesh(G('graveOpen', () => { const q = new THREE.PlaneGeometry(0.45, 0.85); q.rotateX(-Math.PI/2); return q; }), hole, x, 0.09, 0.15, g, false); h.receiveShadow = false;
          const pile = mesh(SH.rubbleGeo, dirt, x + 0.25, 0.1, 0.25, g); pile.scale.set(0.6, 0.35, 0.8);
        } else mesh(G('mound', () => box(0.46, 0.1, 0.85, true)), dirt, x, 0.06, 0.15, g);
      }
    } else if (p.kind === 'barrel'){
      // Rusty oil drum; a lit one burns (its flame flickers in animateCity()).
      mesh(G('barrel', () => boxes([[0.58,0.85,0.58,0,0,0], [0.64,0.08,0.64,0,0.22,0], [0.64,0.08,0.64,0,-0.22,0]])), M('rust', 0x6b3a22, { metalness:0.4 }), 0, 0.425, 0, g);
      if (p.lit){
        const f = std(0xff8a2a, { emissive:0xff5a00, emissiveIntensity:1.5, roughness:1 }); f.userData.ph = mr(0, 6); anim.fires.push(f);
        mesh(G('flame', () => boxes([[0.42,0.3,0.42,0,-0.2,0], [0.28,0.25,0.28,0,0.07,0], [0.14,0.2,0.14,0,0.28,0]])), f, 0, 1.15, 0, g, false);
      }
    } else if (p.kind === 'shipping'){
      // A shipping container across two tiles (ribbed sides, doors at one end), some with another on top.
      // Stacked ones fade like a building when they hide the player.
      g.position.set(p.cx*TILE, 0, p.cz*TILE);
      const ribs = []; for (let a=-1.6;a<=1.6;a+=0.4) ribs.push([0.16, 1.9, 1.86, a, 0.95, 0]);
      const geo = G('shipBox', () => boxes([[3.7, 2.0, 1.75, 0, 1.0, 0], ...ribs, [0.1, 1.8, 1.6, 1.86, 0.95, 0], [0.12, 1.8, 0.16, 1.9, 0.95, 0]]));
      const mats = [std(p.color, { roughness:0.8, metalness:0.2 })], low = mesh(geo, mats[0], 0, 0, 0, g);
      if (p.top){ mats.push(std(p.top, { roughness:0.8, metalness:0.2 })); const hi = mesh(geo, mats[1], 0, 2.02, 0, g); hi.rotation.y = Math.PI; hi.userData.fadeKey = low; world.buildingMeshes.push(low, hi); }
      low.userData.mats = mats; low.userData.center = g.position;
    } else if (p.kind === 'stack'){
      // A factory smokestack: a tall square chimney with bands, a sooty top; fades like a building.
      const brick = std(0x6b4434, { roughness:1 }), band = std(0x3a2a24, { roughness:1 }), H = p.h;
      const st = mesh(own(box(1.3, H, 1.3, true)), brick, 0, 0, 0, g);
      mesh(own(boxes([[1.6, 0.6, 1.6, 0, 0.3, 0], [1.42, 0.25, 1.42, 0, H*0.45, 0], [1.42, 0.25, 1.42, 0, H*0.8, 0], [1.5, 0.4, 1.5, 0, H - 0.2, 0]])), band, 0, 0, 0, st);
      st.userData.mats = [brick, band]; st.userData.center = g.position; world.buildingMeshes.push(st);
    } else if (p.kind === 'canopy'){
      // Gas station canopy over the pumps; fades like a building when it hides the player.
      const cw = (p.x1 - p.x0 + 1)*TILE, cd = (p.z1 - p.z0 + 1)*TILE;
      g.position.set((p.x0*TILE + cw/2), 0, (p.z0*TILE + cd/2));
      const wm = std(0xe6e3dc, { roughness:0.7 }), rm = std(LANDMARKS.gas.band, { roughness:0.6 });
      const slab = mesh(own(box(cw - 0.4, 0.3, cd - 0.4, true)), wm, 0, 3.5, 0, g);
      mesh(own(box(cw - 0.34, 0.3, cd - 0.34, true)), rm, 0, -0.28, 0, slab, false);
      for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) mesh(SH.poleGeo, SH.whiteMat, sx*(cw/2 - 0.9), 0, sz*(cd/2 - 0.9), g).scale.set(2.4, 3.5, 2.4);
      slab.userData.mats = [wm, rm]; slab.userData.center = g.position; world.buildingMeshes.push(slab);
    }
    if (open) opens.set(p.z*N + p.x, open);
  }
  return opens;
}

// Landmark sign materials: icon and name painted on the front face (+z), plain colour elsewhere.
let signCache = {};
function signMats(type){
  if (signCache[type]) return signCache[type];
  const L = LANDMARKS[type], cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const g = cv.getContext('2d');
  g.fillStyle = L.css; g.fillRect(0,0,512,112);
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0,0,512,6); g.fillRect(0,106,512,6);
  g.fillStyle = '#ffffff'; g.font = 'bold 58px Barlow, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${L.icon} ${L.name.toUpperCase()}`, 256, 60, 488);
  const tex = own(new THREE.CanvasTexture(cv));
  const side = std(L.color, { roughness:0.6 });
  const front = std(0xffffff, { map:tex, emissive:0xffffff, emissiveMap:tex, emissiveIntensity:0.35, roughness:0.6 });
  return signCache[type] = [side, side, side, side, front, side];
}
const awningCache = {};
const awningMat = type => awningCache[type] || (awningCache[type] = std(LANDMARKS[type].band, { roughness:0.8 }));

// Searchable containers. Adds runtime fields to each: px/pz/range (interaction point), time, noise,
// name, searched, glint (floating marker), open() (visual once searched).
const GLINT_Y = { shelf:2.0, locker:2.5, armory:2.4, desk:1.6, medcab:2.5, milcrate:1.5, lumber:1.4 };
function buildContainers(c, opens){
  const cityGroup = world.cityGroup;
  for (const ct of c.containers){
    const lmDoor = ct.kind === 'door' && ct.lm, L = lmDoor ? LANDMARKS[ct.lm] : LOOT[ct.kind];
    Object.assign(ct, { time:L.time, noise:L.noise, name:ct.label || L.name, searched:false, open:() => {} });
    const cx = (ct.x+0.5)*TILE, cz = (ct.z+0.5)*TILE;
    let gx = cx, gz = cz, gy = 1.9;
    if (ct.kind === 'door'){
      const fx = cx + ct.dx*(TILE/2 - 0.12), fz = cz + ct.dz*(TILE/2 - 0.12);
      ct.px = fx + ct.dx*0.8; ct.pz = fz + ct.dz*0.8; ct.range = 1.5;
      const g = new THREE.Group(); g.position.set(fx,0,fz); g.rotation.y = Math.atan2(ct.dx, ct.dz);
      const frame = new THREE.Mesh(SH.doorFrame, SH.frameMat); frame.position.y = 0.97;
      const hinge = new THREE.Group(); hinge.position.set(-0.45,0,0.06);
      const door = new THREE.Mesh(SH.doorGeo, SH.doorMat); door.position.set(0.45,0.88,0); door.castShadow = true; hinge.add(door);
      g.add(frame, hinge);
      if (lmDoor){
        const sign = new THREE.Mesh(G('doorSign', () => new THREE.BoxGeometry(1.9,0.45,0.1)), signMats(ct.lm)); sign.position.set(0,2.25,0.06); g.add(sign);
        mesh(G('awning', () => box(2.3, 0.16, 1.1)), awningMat(ct.lm), 0, 2.6, 0.5, g);
      }
      cityGroup.add(g);
      ct.open = () => { hinge.rotation.y = -1.35; };
      gx = fx + ct.dx*0.35; gz = fz + ct.dz*0.35; gy = lmDoor ? 3.2 : 2.3;
    } else {
      ct.px = cx; ct.pz = cz; ct.range = 2.1;
      if (opens.has(ct.z*N + ct.x)){ ct.open = opens.get(ct.z*N + ct.x); gy = GLINT_Y[ct.kind] || gy; }
      else if (ct.kind === 'dumpster'){
        const g = new THREE.Group(); g.position.set(cx,0,cz); g.rotation.y = ct.rot;
        const body = new THREE.Mesh(SH.dumpBody, SH.dumpMat); body.castShadow = body.receiveShadow = true;
        const lid = new THREE.Mesh(SH.dumpLid, SH.dumpLidMat); lid.position.set(0,1.09,-0.53); lid.castShadow = true;
        g.add(body, lid); cityGroup.add(g);
        ct.open = () => { lid.rotation.x = -1.2; };
      } else if (ct.kind === 'crate'){
        const g = new THREE.Group(); g.position.set(cx + mr(-0.2,0.2),0,cz + mr(-0.2,0.2));
        const body = new THREE.Mesh(SH.crateBody, SH.crateMat); body.castShadow = body.receiveShadow = true;
        const lid = new THREE.Mesh(SH.crateLid, SH.crateLidMat); lid.position.y = 1.0; lid.castShadow = true;
        g.add(body, lid); cityGroup.add(g);
        ct.open = () => { lid.position.set(0.3,0.06,0.85); };
      }
    }
    const gl = new THREE.Mesh(SH.glintGeo, SH.glintMat); gl.position.set(gx, gy, gz); cityGroup.add(gl);
    ct.glint = gl; ct.gy = gy;
  }
}

function buildCrystal(tile, level){
  const g = new THREE.Group();
  g.position.set((tile.x+0.5)*TILE, 0, (tile.z+0.5)*TILE);
  // A square column of crystal turned 45° (it spins), on a stepped square pedestal ringed by square shards.
  const ped = new THREE.Mesh(own(boxes([[2.3,0.25,2.3,0,0.125,0], [1.7,0.3,1.7,0,0.4,0]])), std(0x2d2a33, { roughness:1 }));
  ped.castShadow = ped.receiveShadow = true; g.add(ped);
  const mat = std(0x9d6bff, { emissive:0x5a22e0, emissiveIntensity:0.9, roughness:0.2, metalness:0.1 });
  const mesh = new THREE.Mesh(own(boxes([[0.95,2.4,0.95,0,0,0], [0.6,0.4,0.6,0,1.4,0]])), mat);
  mesh.rotation.y = Math.PI/4; mesh.position.y = 2.1; mesh.castShadow = true; g.add(mesh);
  const shards = [];
  const sg = own(new THREE.BoxGeometry(0.3, 0.8, 0.3));
  for (const [sx, sz, h] of [[0.65,0.65,1],[-0.65,0.65,0.75],[0.65,-0.65,0.8],[-0.65,-0.65,1.1]]){
    const s = new THREE.Mesh(sg, mat); s.position.set(sx, 0.55 + 0.4*h, sz); s.scale.y = h; g.add(s); shards.push(s);
  }
  const light = new THREE.PointLight(0xa070ff, 2.4, 16, 2); light.position.y = 2.2; g.add(light);
  const beamMat = own(new THREE.MeshBasicMaterial({ color:0xa070ff, transparent:true, opacity:0.2, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide }));
  const beam = new THREE.Mesh(own(new THREE.CylinderGeometry(0.35,0.35,80,12,1,true)), beamMat); beam.position.y = 40; g.add(beam);
  const glow = new THREE.Mesh(own(new THREE.PlaneGeometry(4.6,4.6)), own(new THREE.MeshBasicMaterial({ color:0x8a5cff, transparent:true, opacity:0.25, blending:THREE.AdditiveBlending, depthWrite:false })));
  glow.rotation.x = -Math.PI/2; glow.position.y = 0.1; g.add(glow);
  world.cityGroup.add(g);
  const hp = 30 + 15*(level-1);
  return { group:g, mesh, mat, shards, light, beam, glow, pos:new THREE.Vector3(g.position.x, 2, g.position.z), hp, maxHp:hp, alive:true, flash:0 };
}

function buildBarricade(exitZ, n){
  const g = new THREE.Group();
  const red = std(0xb8342a, { roughness:0.8 });
  const white = std(0xe2ddd2, { roughness:0.8 });
  const yellow = std(0xc8901a, { roughness:0.7 });
  const geo = own(new THREE.BoxGeometry(0.55,0.95,0.6));
  const x = (n-1)*TILE + 0.45;
  for (let i=0;i<6;i++){
    const m = new THREE.Mesh(geo, i%2 ? red : white);
    m.position.set(x, 0.48, exitZ*TILE + 0.35 + i*0.66); m.castShadow = true; g.add(m);
  }
  const sign = new THREE.Mesh(own(new THREE.BoxGeometry(0.12,0.7,3.4)), yellow);
  sign.position.set(x+0.5, 1.45, (exitZ+1)*TILE); sign.castShadow = true; g.add(sign);
  const postGeo = own(new THREE.BoxGeometry(0.1,1.4,0.1));
  for (const dz of [-1.4,1.4]){ const p = new THREE.Mesh(postGeo, white); p.position.set(x+0.5, 0.7, (exitZ+1)*TILE + dz); g.add(p); }
  world.cityGroup.add(g);
  return g;
}

export function buildExitMarker(){
  const g = new THREE.Group();
  const cx = (world.city.n-0.5)*TILE, cz = (world.city.exitZ+1)*TILE;
  const gm = own(new THREE.MeshBasicMaterial({ color:0x4ade80, transparent:true, opacity:0.35, blending:THREE.AdditiveBlending, depthWrite:false }));
  const pad = new THREE.Mesh(own(new THREE.PlaneGeometry(TILE*1.4, TILE*2)), gm);
  pad.rotation.x = -Math.PI/2; pad.position.set(cx, 0.05, cz); g.add(pad);
  const bm = own(new THREE.MeshBasicMaterial({ color:0x4ade80, transparent:true, opacity:0.2, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide }));
  const beam = new THREE.Mesh(own(new THREE.CylinderGeometry(0.5,0.5,80,12,1,true)), bm); beam.position.set(cx, 40, cz); g.add(beam);
  const cm = own(new THREE.MeshBasicMaterial({ color:0x7dffa8 }));
  const cg = own(boxes([[0.2,0.2,0.9,-0.2,0,0], [0.2,0.2,0.55,0,0,0], [0.2,0.2,0.2,0.2,0,0]]));  // a stepped arrow pointing east, at the exit
  const chev = [];
  for (let i=0;i<3;i++){ const c = new THREE.Mesh(cg, cm); c.position.set(cx - 3.2 - i*1.4, 0.35, cz); g.add(c); chev.push(c); }
  world.cityGroup.add(g);
  return { g, pad, beam, chev, gm };
}

export function teardownCity(){
  if (world.cityGroup){ scene.remove(world.cityGroup); world.cityGroup = null; }
  for (const d of disposables) if (d && d.dispose) d.dispose();
  disposables = []; geoCache = new Map(); signCache = {}; for (const k in awningCache) delete awningCache[k];
  anim.smoke = null; anim.puffs = []; anim.fires = [];
  world.buildingMeshes = []; world.interiors = []; world.interiorAt = null; faded.clear();
  for (const z of zombies) disposeZombie(z);
  for (const d of dying) disposeCorpse(d);
  zombies.length = 0; dying.length = 0;
  for (const arr of [bullets, particles, pickups, drops, throwns, hazards, spits, puddles, rings]) { for (const o of arr) scene.remove(o.mesh || o.m || o.g); arr.length = 0; }
  for (const d of decals) scene.remove(d); decals.length = 0;
  world.crystal = null; world.barricade = null; world.exitMarker = null; world.lure = null;
}
