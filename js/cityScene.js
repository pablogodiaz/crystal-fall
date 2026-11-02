// ---------- City scene ----------
// Turns generated city data into Three.js meshes, and tears it all down again.
import * as THREE from 'three';
import { TILE, N } from './config.js';
import { mr, mpick } from './utils.js';
import { scene } from './renderer.js';
import { SH, WIN_TEX, CORR_TEX, CHECKER_TEX, carMat } from './assets.js';
import { state, world, zombies, dying, bullets, particles, pickups, decals, drops, throwns, hazards, spits, puddles, rings } from './state.js';
import { LOOT, LANDMARKS } from './items.js';
import { disposeZombie, disposeCorpse } from './zombies.js';
import { faded } from './fx.js';

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

  // Block slabs; a landmark's lot (one block, or 2×2 blocks plus the roads between) is one slab.
  const groundMats = {}, gm = { towers:0x67655f, ruins:0x58564f, park:0x3b4a2e, field:0x4b5032, houses:0x45543a, farm:0x4b5032,
    warehouses:0x5c5b56, yard:0x55534d, lot:0x26282c, plaza:0x7a7468, landmark:0x67655f, construction:0x5a5247, cemetery:0x3a4630, camp:0x47483a,
    pond:0x3b4a2e, crater:0x4a4741 };
  for (const k in gm) groundMats[k] = std(gm[k], { roughness:1 });
  const lots = new Set();
  for (const b of c.blocks){
    const L = b.lot || { x0:b.x0, z0:b.z0, s:5 };
    if (lots.has(L)) continue; lots.add(L);
    const s = L.s*TILE - 0.12;
    const m = new THREE.Mesh(G('slab' + L.s, () => new THREE.BoxGeometry(s, 0.08, s)), groundMats[b.type]);
    m.position.set((L.x0 + L.s/2)*TILE, 0.04, (L.z0 + L.s/2)*TILE); m.receiveShadow = true; cityGroup.add(m);
  }
  // Ground overlays: parking asphalt, gas station forecourts, shop floors (under the roofs).
  const tiles = (list, mat, y = 0.083, sx = TILE, sz = TILE, ox = 0, oz = 0) => {
    if (!list.length) return;
    const im = own(new THREE.InstancedMesh(SH.tilePlane, mat, list.length));
    list.forEach(([x,z], i) => { dummy.position.set((x+0.5)*TILE + ox, y, (z+0.5)*TILE + oz); dummy.rotation.set(0,0,0); dummy.scale.set(sx, 1, sz); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.receiveShadow = true; cityGroup.add(im);
  };
  const O = c.overlays;
  tiles(O.lot, SH.lotMat); tiles(O.pad, SH.padMat); tiles(O.dirt, std(0x5a4b38, { roughness:1 }));
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
  for (const b of c.buildings){ const m = buildingMesh(b); world.buildingMeshes.push(m); cityGroup.add(m); }
  world.interiors = []; world.interiorAt = new Int8Array(N*N);
  c.interiors.forEach((it, i) => buildInterior(it, i));
  for (const t of c.trees){
    const g = new THREE.Group(); g.position.set((t.x+0.5)*TILE, 0, (t.z+0.5)*TILE); g.scale.setScalar(t.s);
    const tr = new THREE.Mesh(SH.trunkGeo, SH.trunkMat); tr.position.y = 0.65; tr.castShadow = true;
    const lf = new THREE.Mesh(SH.leafGeo, SH.leafMats[t.m]); lf.position.y = 1.75; lf.rotation.y = t.x*1.7; lf.castShadow = true;
    g.add(tr, lf); cityGroup.add(g);
  }
  for (const cr of c.cars) cityGroup.add(carMesh(cr));
  for (const r of c.rubble){
    for (let i=0;i<4;i++){
      const m = new THREE.Mesh(SH.rubbleGeo, SH.rubbleMat);
      m.position.set((r.x+0.5)*TILE + mr(-0.5,0.5), 0.2, (r.z+0.5)*TILE + mr(-0.5,0.5));
      m.scale.setScalar(mr(0.6,1.4)); m.rotation.set(mr(0,3), mr(0,3), 0); m.castShadow = true; cityGroup.add(m);
    }
  }
  for (const p of c.pillars){
    const m = new THREE.Mesh(own(new THREE.CylinderGeometry(0.42,0.5,p.h,8)), SH.pillarMat);
    m.position.set((p.x+0.5)*TILE, p.h/2, (p.z+0.5)*TILE); m.castShadow = m.receiveShadow = true; cityGroup.add(m);
  }
  buildSmoke(c);
  const opens = buildProps(c);
  buildContainers(c, opens);
  world.crystal = buildCrystal(c.crystalTile, state.level);
  world.barricade = buildBarricade(c.exitZ, n);
}

// ---------- Cars ----------
// Parked, wrecked (tilted, crumpled cab), on their roof or side, burnt out (charred, no glass), or
// driven into a wall (ox/oz nudge them against it). Landmark vehicles carry a style.
function carMesh(cr){
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  g.position.set((cr.x + 0.5 + (cr.ox || 0))*TILE, 0, (cr.z + 0.5 + (cr.oz || 0))*TILE); g.rotation.y = cr.rot;
  const st = cr.style, burnt = cr.burnt, color = burnt ? 0x2b2724 : st === 'police' || st === 'ambulance' ? 0xe9e9ee : st === 'military' ? 0x4b5320 : cr.color;
  const b = mesh(SH.carBody, carMat(color), 0, 0.42, 0, body), cab = mesh(SH.carCab, burnt ? carMat(0x151311) : SH.glassMat, -0.1, 0.9, 0, body);
  if (cr.wreck && !cr.pose){ g.rotation.z = 0.04; cab.rotation.z = 0.12; }
  if (cr.crash){ cab.scale.y = 0.8; b.scale.x = 0.9; b.position.x = -0.1; }
  if (cr.pose){
    // Rolled over: on the roof (cab crushed) or on its side, wheels showing.
    const wm = M('wheel', 0x16171a), wg = G('wheel', () => { const w = new THREE.CylinderGeometry(0.27, 0.27, 0.18, 10); w.rotateX(Math.PI/2); return w; });
    for (const [wx, wz] of [[-0.6,-0.5],[0.6,-0.5],[-0.6,0.5],[0.6,0.5]]) mesh(wg, wm, wx, 0.15, wz, body);
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
    const tex = canvasTex(64, (g, s) => { const gr = g.createRadialGradient(s/2, s/2, 2, s/2, s/2, s/2); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
    const im = own(new THREE.InstancedMesh(SH.tilePlane, own(new THREE.MeshBasicMaterial({ map:tex, color:0x15110d, transparent:true, depthWrite:false })), sc.length));
    sc.forEach(([x,z], i) => { dummy.position.set((x + 0.5)*TILE, 0.0845, (z + 0.5)*TILE); dummy.rotation.set(0, rnd(0, 6.3), 0); dummy.scale.setScalar(TILE*rnd(1.2, 1.7)); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.renderOrder = 1; cityGroup.add(im);
  }
  const water = std(0x24485a, { roughness:0.08, metalness:0.35, emissive:0x081820, emissiveIntensity:0.6 }), mud = std(0x3b3326, { roughness:1 });
  const rounded = (x0, z0, x1, z1, r) => {
    const sh = new THREE.Shape();
    sh.moveTo(x0 + r, z0); sh.lineTo(x1 - r, z0); sh.quadraticCurveTo(x1, z0, x1, z0 + r); sh.lineTo(x1, z1 - r); sh.quadraticCurveTo(x1, z1, x1 - r, z1);
    sh.lineTo(x0 + r, z1); sh.quadraticCurveTo(x0, z1, x0, z1 - r); sh.lineTo(x0, z0 + r); sh.quadraticCurveTo(x0, z0, x0 + r, z0);
    const geo = own(new THREE.ShapeGeometry(sh, 6)); geo.rotateX(Math.PI/2); return geo;
  };
  const flat = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.receiveShadow = true; cityGroup.add(m); return m; };
  for (const p of c.ponds){
    const X0 = p.x0*TILE, Z0 = p.z0*TILE, X1 = p.x1*TILE, Z1 = p.z1*TILE;
    flat(rounded(X0 - 0.35, Z0 - 0.35, X1 + 0.35, Z1 + 0.35, 1.6), mud, 0.084);
    flat(rounded(X0 + 0.05, Z0 + 0.05, X1 - 0.05, Z1 - 0.05, 1.3), water, 0.088);
    // Lily pads and reeds.
    const pad = G('lily', () => { const g = new THREE.CircleGeometry(0.28, 8); g.rotateX(-Math.PI/2); return g; }), padM = M('lily', 0x3f6b34);
    for (let i=0;i<4;i++) flat(pad, padM, 0.092).position.set(rnd(X0 + 0.6, X1 - 0.6), 0.092, rnd(Z0 + 0.6, Z1 - 0.6));
    const reed = G('reed', () => box(0.06, 0.8, 0.06, true)), reedM = M('reed', 0x6b7a3a);
    for (let i=0;i<10;i++){ const e = mesh(reed, reedM, rnd(X0, X1), 0, rnd() < 0.5 ? Z0 + rnd(-0.2, 0.3) : Z1 - rnd(-0.2, 0.3), cityGroup, false); e.rotation.z = rnd(-0.25, 0.25); e.scale.y = rnd(0.6, 1.3); }
  }
  const scorchM = std(0x1f1c19, { roughness:1 }), hole = std(0x0e0d0c, { roughness:1 });
  for (const cr of c.craters){
    const g = new THREE.Group(); g.position.set(cr.x*TILE, 0, cr.z*TILE); cityGroup.add(g);
    flat(own(new THREE.CircleGeometry(cr.r, 20)).rotateX(-Math.PI/2), scorchM, 0.086).position.set(cr.x*TILE, 0.086, cr.z*TILE);
    flat(G('craterHole', () => new THREE.CircleGeometry(1.15, 16).rotateX(-Math.PI/2)), cr.wet ? water : hole, 0.09).position.set(cr.x*TILE, 0.09, cr.z*TILE);
    // Thrown-up rim of broken ground.
    for (let i=0;i<16;i++){
      const a = i/16*Math.PI*2 + rnd(-0.15, 0.15), r = cr.r*rnd(0.78, 0.98), m = mesh(SH.rubbleGeo, SH.rubbleMat, Math.cos(a)*r, 0.05, Math.sin(a)*r, g);
      m.scale.set(rnd(0.6, 1.2), rnd(0.25, 0.5), rnd(0.6, 1.2)); m.rotation.y = rnd(0, 3);
    }
    for (let i=0;i<8;i++){ const a = rnd(0, 6.3), m = mesh(SH.rubbleGeo, SH.rubbleMat, Math.cos(a)*1.3, 0.12, Math.sin(a)*1.3, g); m.scale.setScalar(rnd(0.5, 0.9)); m.rotation.set(rnd(0, 3), rnd(0, 3), 0); }
  }
  if (c.debris.length){
    const im = own(new THREE.InstancedMesh(SH.rubbleGeo, SH.rubbleMat, c.debris.length*3));
    let k = 0;
    for (const [x, z] of c.debris) for (let i=0;i<3;i++){
      dummy.position.set((x + rnd(-0.4, 0.4))*TILE, 0.06, (z + rnd(-0.4, 0.4))*TILE); dummy.rotation.set(rnd(0, 3), rnd(0, 3), 0); dummy.scale.setScalar(rnd(0.25, 0.6));
      dummy.updateMatrix(); im.setMatrixAt(k++, dummy.matrix);
    }
    im.castShadow = im.receiveShadow = true; cityGroup.add(im);
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
  const im = anim.smoke = own(new THREE.InstancedMesh(G('puff', () => new THREE.IcosahedronGeometry(1, 1)), mat, c.smoke.length*PUFFS));
  for (const s of c.smoke) for (let i=0;i<PUFFS;i++) anim.puffs.push({ x:s.x*TILE, z:s.z*TILE, y:(s.y || 0) + 0.6, s:s.s, ph:i/PUFFS*PUFF_T + rnd(0, 0.4), wx:rnd(0.5, 1), wz:rnd(-0.4, 0.4) });
  im.frustumCulled = false; im.renderOrder = 2; world.cityGroup.add(im);
  animateCity(0, 0);
}
export function animateCity(dt, t){
  for (const m of anim.fires) m.emissiveIntensity = 1.4 + Math.sin(t*13 + m.userData.ph)*0.4 + Math.sin(t*31)*0.25;
  const im = anim.smoke; if (!im) return;
  anim.puffs.forEach((p, i) => {
    const k = ((t + p.ph) % PUFF_T)/PUFF_T, sw = (0.35 + k*1.5)*p.s*(k > 0.75 ? (1 - k)/0.25 : 1);
    dummy.position.set(p.x + k*k*3*p.wx*p.s, p.y + k*6.5*p.s, p.z + k*k*3*p.wz*p.s); dummy.rotation.set(k*2, i, 0); dummy.scale.setScalar(Math.max(0.01, sw));
    dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
  });
  im.instanceMatrix.needsUpdate = true;
}

// ---------- Buildings ----------
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
  } else {
    const corr = b.style === 'warehouse', vr = corr ? 1 : Math.max(1, Math.round(h/2));
    const tex = n => { const t = own((corr ? CORR_TEX : WIN_TEX[b.win]).clone()); t.needsUpdate = true; t.repeat.set(n, vr); return t; };
    const mx = std(col, { map:tex(b.d) }), mz = std(col, { map:tex(b.w) });
    const roof = std(col.clone().multiplyScalar(b.style === 'warehouse' ? 0.8 : 0.55), { roughness:1 });
    mats = [mx,mx,roof,roof,mz,mz]; uniq = [mx,mz,roof];
  }
  const m = new THREE.Mesh(own(new THREE.BoxGeometry(w, h, d)), mats);
  m.position.set((b.x + b.w/2)*TILE, h/2, (b.z + b.d/2)*TILE);
  m.castShadow = m.receiveShadow = true;
  const add = (geo, mat, x, y, z) => mesh(geo, mat, x, y, z, m);
  const rnd = srand(b.seed || (b.x*131 + b.z*17));
  if (b.cut){
    // Collapsed upper floors: jagged chunks of the old walls, a torn floor slab, bent rebar.
    const conc = std(col.clone().multiplyScalar(0.75), { roughness:1 }), rebar = std(0x5a3a28, { roughness:0.8, metalness:0.4 });
    for (const [fx, fz, fw, fd, ch] of b.chunks){
      const c = add(own(box(w*fw, ch, d*fd, true)), [mats[0], mats[1], conc, conc, mats[4], mats[5]], -w/2 + (fx + fw/2)*w, top, -d/2 + (fz + fd/2)*d);
      c.rotation.y = rnd(-0.06, 0.06);
    }
    const slab = add(own(box(w + 0.25, 0.14, d + 0.25)), conc, rnd(-0.1, 0.1), top + 0.02, rnd(-0.1, 0.1)); slab.rotation.z = rnd(-0.06, 0.06); slab.rotation.x = rnd(-0.06, 0.06);
    for (let i=0;i<6;i++){ const r = add(G('rebar', () => box(0.06, 1.3, 0.06, true)), rebar, rnd(-w/2, w/2), top, rnd(-d/2, d/2)); r.rotation.set(rnd(-0.6, 0.6), 0, rnd(-0.6, 0.6)); }
    uniq.push(conc, rebar);
  }
  if (b.cut || b.soot){
    // Blown-out holes on the faces the camera sees, soot streaked above them.
    const dark = std(0x0d0c0b, { roughness:1 }), soot = std(0x1c1a18, { roughness:1 });
    for (let i=0;i<(b.holes || 2);i++){
      const onX = rnd() < 0.5, hw = rnd(0.8, 1.6), hh = rnd(0.8, 1.5), y = rnd(-top + 1, Math.max(-top + 1, top - 2.4));
      const along = onX ? rnd(-d/2 + hw/2, d/2 - hw/2) : rnd(-w/2 + hw/2, w/2 - hw/2), at = (o, e) => onX ? [w/2 + o, along] : [along, d/2 + o];
      const [hx, hz] = at(0.02), [sx, sz] = at(0.03), sh = Math.min(1.6, top - y - hh/2);
      add(own(onX ? box(0.06, hh, hw) : box(hw, hh, 0.06)), dark, hx, y, hz);
      if (sh > 0.2) add(own(onX ? box(0.05, sh, hw*0.8) : box(hw*0.8, sh, 0.05)), soot, sx, y + hh/2 + sh/2, sz);
    }
    uniq.push(dark, soot);
  }
  if (b.style === 'house' || b.style === 'crypt'){
    // Gable roof along the long side; its triangular ends are plain wall. Burnt houses: charred, or
    // caved in to a few blackened rafters.
    const ridgeX = b.w >= b.d, span = (ridgeX ? d : w) + 0.4, len = (ridgeX ? w : d) + 0.4, rh = Math.min(1.5, span*0.36);
    const roof = std(b.burnt ? 0x1a1816 : b.roof, { roughness:1 });
    if (b.caved){
      for (let i=0;i<5;i++){
        const a = (i/4 - 0.5)*len*0.85, r = add(G('rafter', () => box(0.12, 0.12, 1, true)), roof, ridgeX ? a : 0, top, ridgeX ? 0 : a);
        r.scale.z = span*rnd(0.4, 0.95); r.rotation.y = ridgeX ? 0 : Math.PI/2; r.rotation.x = rnd(-0.4, 0.4);
      }
      uniq.push(roof);
    } else {
      const shape = new THREE.Shape(); shape.moveTo(-span/2, 0); shape.lineTo(span/2, 0); shape.lineTo(0, rh); shape.closePath();
      const geo = own(new THREE.ExtrudeGeometry(shape, { depth:len, bevelEnabled:false })); geo.translate(0, 0, -len/2);
      const cap = std(col);
      const r = add(geo, [cap, roof], 0, top, 0); if (ridgeX) r.rotation.y = Math.PI/2;
      if (b.style === 'crypt'){
        // Dark doorway on the camera side and a cross on the ridge.
        const dk = std(0x111111, { roughness:1 });
        add(G('cryptDoor', () => box(0.7, 1.4, 0.06, true)), dk, 0, -top, d/2 + 0.02);
        add(G('crossV', () => box(0.12, 0.8, 0.12, true)), cap, 0, top + rh - 0.1, 0); add(G('crossH', () => box(0.5, 0.12, 0.12)), cap, 0, top + rh + 0.45, 0);
        uniq.push(dk);
      } else if (rnd() < 0.5 && !b.burnt){
        const a = len*0.25, s = span*0.15;
        add(G('chimney', () => box(0.4, 1, 0.4, true)), roof, ridgeX ? a : s, top, ridgeX ? s : a).scale.y = rh + 0.35;
      }
      uniq.push(cap, roof);
    }
  } else if (b.style === 'tower' && !b.cut){
    if (b.ac) add(own(new THREE.BoxGeometry(Math.min(1.2,w*0.4),0.5,Math.min(0.9,d*0.4))), uniq[2], w*0.15, top + 0.25, -d*0.1);
    if (w*d > 14 && rnd() < 0.4){
      // Water tank on legs.
      const t = add(G('tank', () => new THREE.CylinderGeometry(0.75,0.75,1.2,10)), uniq[2], -w*0.2, top + 1.5, d*0.15);
      for (const [lx,lz] of [[-0.5,-0.5],[0.5,-0.5],[-0.5,0.5],[0.5,0.5]]) add(G('leg', () => box(0.1, 0.9, 0.1)), uniq[2], -w*0.2 + lx, top + 0.45, d*0.15 + lz);
      t.castShadow = true;
    }
    if (h > 13 && rnd() < 0.5){ const a = add(SH.poleGeo, uniq[2], 0, top, 0); a.scale.set(1, 3.5, 1); }
  } else if (b.style === 'warehouse'){
    const dm = std(0x3c3f44, { roughness:0.6, metalness:0.3 });
    if (!b.cut) add(G('rollup', () => box(2.2, 2.2, 0.08)), dm, Math.min(0, w/2 - 1.6), -top + 1.1, d/2 + 0.04);
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
      add(G('pane' + (fx ? 'x' : 'z'), () => fx ? box(0.06, 1.3, TILE - 0.5) : box(TILE - 0.5, 1.3, 0.06)), glass, px, -top + 1.35, pz);
      if (L.grille) for (let i=-2;i<=2;i++) add(G('grille', () => box(0.07, 1.4, 0.07)), band, px + fx*0.05 + (fx ? 0 : i*0.3), -top + 1.35, pz + fz*0.05 + (fx ? i*0.3 : 0));
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
const tentGeo = () => G('tent', () => {
  const sh = new THREE.Shape(); sh.moveTo(-0.95, 0); sh.lineTo(0.95, 0); sh.lineTo(0, 1.6); sh.closePath();
  const e = new THREE.ExtrudeGeometry(sh, { depth:1.9, bevelEnabled:false }); e.translate(0, 0, -0.95); return e;
});
// Fence panels: chain-link diamonds or iron bars with spear tips, see-through (alpha-tested).
const fenceMat = kind => G('fence-' + kind, () => {
  const iron = kind === 'iron';
  const map = canvasTex(64, (g, s) => {
    g.strokeStyle = iron ? '#1c1d20' : '#9aa0a6'; g.fillStyle = g.strokeStyle;
    if (iron){ for (let x=4;x<s;x+=16){ g.fillRect(x, 6, 3, s - 6); g.beginPath(); g.moveTo(x - 2, 8); g.lineTo(x + 1.5, 0); g.lineTo(x + 5, 8); g.fill(); } g.fillRect(0, 14, s, 3); g.fillRect(0, s - 8, s, 3); }
    else { g.lineWidth = 2; for (let k=-s;k<s*2;k+=12){ g.beginPath(); g.moveTo(k, 0); g.lineTo(k + s, s); g.stroke(); g.beginPath(); g.moveTo(k + s, 0); g.lineTo(k, s); g.stroke(); } }
  }, iron ? 1 : 1.5, iron ? 1 : 2.5);
  return new THREE.MeshStandardMaterial({ map, alphaTest:0.45, side:THREE.DoubleSide, roughness:0.6, metalness:0.4 });
});
// Lattice for crane mast and jib (yellow frame with X bracing), repeated rx × ry times.
const latticeMat = (rx, ry) => std(0xffffff, { map:canvasTex(64, (g, s) => {
  g.strokeStyle = '#d9a21b'; g.lineWidth = 6; g.strokeRect(3, 3, s - 6, s - 6); g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
}, rx, ry), alphaTest:0.4, side:THREE.DoubleSide, roughness:0.7 });
// Painted signs: quarantine notice, ROAD CLOSED board, orange-and-white barricade stripes.
const signTex = kind => G('sign-' + kind, () => {
  const stripes = kind === 'stripes';
  const map = canvasTex(stripes ? 64 : 256, (g, s, hh) => {
    if (stripes){ g.fillStyle = '#f2efe6'; g.fillRect(0, 0, s, s); g.fillStyle = '#e0601a'; for (let k=-s;k<s*2;k+=24){ g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 12, 0); g.lineTo(k + 12 - s, s); g.lineTo(k - s, s); g.fill(); } return; }
    const q = kind === 'quarantine';
    g.fillStyle = q ? '#e8c22a' : '#f2efe6'; g.fillRect(0, 0, s, hh); g.fillStyle = q ? '#111' : '#c0281e'; g.fillRect(0, 0, s, 8); g.fillRect(0, hh - 8, s, 8);
    g.font = `bold ${q ? 40 : 52}px Barlow, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (q){ g.fillText('☣ QUARANTINE', s/2, hh*0.38, s - 16); g.font = 'bold 30px Barlow, Arial, sans-serif'; g.fillText('KEEP OUT', s/2, hh*0.72, s - 16); }
    else g.fillText('ROAD CLOSED', s/2, hh/2 + 2, s - 16);
  }, stripes ? 3 : 1, 1, stripes ? 64 : kind === 'quarantine' ? 124 : 88);
  return new THREE.MeshStandardMaterial({ map, roughness:0.7, side:THREE.DoubleSide });
});
function buildProps(c){
  const opens = new Map(), cityGroup = world.cityGroup, fenceAt = new Set(c.props.filter(p => p.kind === 'fence').map(p => p.z*N + p.x));
  for (const p of c.props){
    const g = new THREE.Group(); g.position.set((p.x+0.5)*TILE, 0, (p.z+0.5)*TILE); g.rotation.y = p.rot || 0; cityGroup.add(g);
    let open = null;
    if (p.kind === 'shelf'){
      mesh(SH.shelfGeo, SH.metalMat, 0, 0, 0, g);
      // Goods on three levels both sides, as one instanced mesh with random colours.
      const im = own(new THREE.InstancedMesh(SH.goodsGeo, SH.whiteMat, 24)), col = new THREE.Color();
      let n = 0;
      for (const sd of [-1,1]) for (const y of [0.3, 0.75, 1.2]) for (let i=0;i<4;i++){
        if (Math.random() < 0.15) continue;
        dummy.position.set(-0.62 + i*0.41, y, sd*0.36); dummy.rotation.set(0, mr(-0.1,0.1), 0); dummy.scale.set(1, mr(0.8,1.25), 1); dummy.updateMatrix();
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
      for (let i=0;i<4;i++){ const r = mesh(SH.rifleGeo, SH.darkMetalMat, -0.55 + i*0.37, 0.4, 0.38, guns); r.rotation.x = -0.18; }
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
      for (let i=0;i<3;i++){ const l = mesh(SH.lumberGeo, SH.lumberMat, mr(-0.08,0.08), i*0.24, mr(-0.08,0.08), g); l.rotation.y = mr(-0.08,0.08); }
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
      for (const [lx, lz] of [[-0.65,-0.25],[0.65,-0.25],[-0.65,0.25],[0.65,0.25]]) mesh(SH.poleGeo, SH.metalMat, lx, 0, lz, g, false).scale.set(0.6, 0.75, 0.6);
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
      if (med) for (const sd of [-1, 1]){ mesh(G('tcA', () => box(0.5, 0.14, 0.03)), SH.redMat, 0, 0.62, sd*0.97, t, false); mesh(G('tcB', () => box(0.14, 0.5, 0.03)), SH.redMat, 0, 0.62, sd*0.97, t, false); }
    } else if (p.kind === 'tower'){
      // Watchtower: four legs, a platform with a sandbag rim, a little roof.
      for (const [lx, lz] of [[-0.7,-0.7],[0.7,-0.7],[-0.7,0.7],[0.7,0.7]]) mesh(SH.poleGeo, SH.woodMat, lx, 0, lz, g).scale.set(1.6, 3.4, 1.6);
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
    } else if (p.kind === 'fence'){
      // Posts on the tile centre, a panel toward every neighbouring fence tile (a lone one spans its
      // tile along rot). Chain-link (with a quarantine sign where it closes a road) or cemetery iron.
      g.rotation.y = 0;
      const iron = p.style === 'iron', H = iron ? 1.3 : 1.9, mat = iron ? fenceMat('iron') : fenceMat('chain'), postM = M('post', 0x2a2c30, { metalness:0.4 });
      mesh(G('fpost' + H, () => box(0.09, H + 0.08, 0.09, true)), postM, 0, 0, 0, g);
      // A straight run ends flush with its tile's edge (gates, gaps); corners don't stick out.
      const dirs = D4S.filter(([dx, dz]) => fenceAt.has((p.z + dz)*N + p.x + dx)), axisX = dirs.some(d => d[0]), axisZ = dirs.some(d => d[1]);
      const runs = !dirs.length ? (p.rot ? [[0,1],[0,-1]] : [[1,0],[-1,0]]) : axisX && axisZ ? dirs : axisX ? [[1,0],[-1,0]] : [[0,1],[0,-1]];
      for (const [dx, dz] of runs){
        const pn = mesh(G('fpanel' + H, () => { const q = new THREE.PlaneGeometry(TILE/2, H); q.translate(TILE/4, H/2, 0); return q; }), mat, 0, 0, 0, g, false);
        pn.rotation.y = Math.atan2(-dz, dx);
        const rl = mesh(G('frail', () => box(TILE/2, 0.05, 0.05)), postM, dx*TILE/4, H, dz*TILE/4, g, false); rl.rotation.y = pn.rotation.y;
      }
      if (p.sign){ const sg = mesh(G('qsign', () => new THREE.PlaneGeometry(1.3, 0.62)), signTex('quarantine'), 0, 1.1, 0, g, false); sg.rotation.y = p.rot ? 0 : Math.PI/2; }
    } else if (p.kind === 'jersey'){
      // Concrete barriers, two to a tile, with an orange reflector strip.
      for (const sd of [-0.5, 0.5]){
        const k = new THREE.Group(); k.position.x = sd*TILE*0.5; k.rotation.y = mr(-0.12, 0.12); g.add(k);
        mesh(G('jerseyLow', () => box(0.95, 0.3, 0.62, true)), M('concrete', 0xb3afa5), 0, 0, 0, k);
        mesh(G('jerseyHigh', () => box(0.95, 0.55, 0.32, true)), M('concrete', 0xb3afa5), 0, 0.3, 0, k);
        mesh(G('jerseyStripe', () => box(0.96, 0.1, 0.34, true)), M('reflect', 0xd9822b, { emissive:0x7a3a08, emissiveIntensity:0.5 }), 0, 0.65, 0, k, false);
      }
    } else if (p.kind === 'sawhorse'){
      // Striped wooden barricade, some with a ROAD CLOSED board on top.
      for (const y of [0.42, 0.85]) mesh(G('sawBoard', () => box(1.75, 0.22, 0.05, true)), signTex('stripes'), 0, y, 0.12, g);
      for (const lx of [-0.72, 0.72]) for (const lz of [-0.18, 0.18]){ const l = mesh(G('sawLeg', () => box(0.07, 1.1, 0.07, true)), M('wood', 0x8a6a44), lx, 0, lz, g); l.rotation.x = -lz*1.1; }
      if ((p.x + p.z) % 2) mesh(G('closedSign', () => new THREE.PlaneGeometry(1.1, 0.38)), signTex('closed'), 0, 1.35, 0.14, g, false);
    } else if (p.kind === 'heap'){
      // Rubble from a collapsed building: broken blocks, slabs of floor and rebar.
      const rnd = srand(p.seed);
      for (let i=0;i<7;i++){ const m = mesh(SH.rubbleGeo, SH.rubbleMat, rnd(-0.6, 0.6), rnd(0.15, 0.55), rnd(-0.6, 0.6), g); m.scale.setScalar(rnd(1, 1.9)); m.rotation.set(rnd(0, 3), rnd(0, 3), 0); }
      for (let i=0;i<2;i++){ const sl = mesh(G('heapSlab', () => box(1.4, 0.16, 0.9)), M('concrete', 0xb3afa5), rnd(-0.4, 0.4), rnd(0.5, 0.9), rnd(-0.4, 0.4), g); sl.rotation.set(rnd(-0.6, 0.6), rnd(0, 3), rnd(-0.6, 0.6)); }
      for (let i=0;i<3;i++){ const r = mesh(G('rebarP', () => box(0.06, 1.4, 0.06, true)), M('rebar', 0x5a3a28, { metalness:0.4 }), rnd(-0.6, 0.6), 0.4, rnd(-0.6, 0.6), g, false); r.rotation.set(rnd(-0.8, 0.8), 0, rnd(-0.8, 0.8)); }
    } else if (p.kind === 'bus'){
      // A bus slewed across both lanes, sometimes on its side or burnt out.
      g.position.set(p.cx*TILE, 0, p.cz*TILE);
      const body = new THREE.Group(); body.position.y = p.side ? 0.9 : 1.13; body.rotation.x = p.side ? Math.PI/2 : 0; g.add(body);
      const col = p.burnt ? 0x2b2724 : p.color, glass = p.burnt ? carMat(0x151311) : SH.glassMat;
      mesh(G('busBody', () => box(4.6, 1.55, 1.75)), carMat(col), 0, 0, 0, body);
      mesh(G('busWin', () => box(4.0, 0.5, 1.77)), glass, -0.1, 0.35, 0, body, false);
      mesh(G('busShield', () => box(0.05, 0.75, 1.5)), glass, 2.31, 0.25, 0, body, false);
      if (!p.burnt) mesh(G('busStripe', () => box(4.62, 0.12, 1.77)), carMat(p.stripe), 0, -0.25, 0, body, false);
      const wg = G('busWheel', () => { const w = new THREE.CylinderGeometry(0.42, 0.42, 0.25, 12); w.rotateX(Math.PI/2); return w; });
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
      const tie = mesh(own(box(J*0.75, 0.05, 0.05)), cable, J*0.36, H + 2.1, 0, g, false); tie.rotation.z = -Math.atan2(2.1, J*0.72);
      const hx = J*0.55, L = H*0.55;
      mesh(G('trolley', () => box(0.6, 0.25, 0.7, true)), solid, hx, H - 0.25, 0, g, false);
      mesh(own(box(0.04, L, 0.04, true)), cable, hx, H - L, 0, g, false);
      mesh(G('hook', () => box(0.35, 0.4, 0.3, true)), solid, hx, H - L - 0.4, 0, g);
      const load = mesh(G('craneLoad', () => box(2.2, 0.28, 0.45, true)), M('steel', 0x7a4a2e, { metalness:0.3 }), hx, H - L - 0.75, 0, g); load.rotation.y = mr(-0.5, 0.5);
      mast.userData.mats = [mastM, jibM, solid, conc, cable]; mast.userData.center = g.position;
      jib.userData.fadeKey = mast; world.buildingMeshes.push(mast, jib);
    } else if (p.kind === 'pipes'){
      // Concrete drainage pipes, two lying side by side and one on top.
      const pg = G('pipe', () => { const q = new THREE.CylinderGeometry(0.42, 0.42, 1.7, 14); q.rotateZ(Math.PI/2); return q; });
      const ig = G('pipeEnd', () => { const q = new THREE.CircleGeometry(0.31, 12); q.rotateY(Math.PI/2); return q; });
      for (const [py, pz] of [[0.42, -0.43], [0.42, 0.43], [1.15, 0]]){
        mesh(pg, M('concrete', 0xb3afa5), 0, py, pz, g);
        for (const sd of [-1, 1]){ const e = mesh(ig, M('pipeIn', 0x2a2826), sd*0.86, py, pz, g, false); e.rotation.y = sd > 0 ? 0 : Math.PI; }
      }
    } else if (p.kind === 'grave'){
      // A row of headstones (slabs, crosses, an obelisk), some leaning, over mounds; some dug open.
      const rnd = srand(p.seed), stone = M('stone', 0x8d8a84), dirt = M('graveDirt', 0x3e3226), hole = M('graveHole', 0x0d0b09);
      for (let i=0;i<p.n;i++){
        const x = (i - (p.n - 1)/2)*0.62, k = new THREE.Group(); k.position.set(x, 0, -0.45); k.rotation.set(rnd(-0.15, 0.08), rnd(-0.15, 0.15), rnd(-0.15, 0.15)); g.add(k);
        const r = rnd();
        if (r < 0.55){ mesh(G('stoneSlab', () => box(0.44, 0.55, 0.12, true)), stone, 0, 0, 0, k); mesh(G('stoneTop', () => { const q = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12); q.rotateX(Math.PI/2); return q; }), stone, 0, 0.55, 0, k); }
        else if (r < 0.85){ mesh(G('crossPost', () => box(0.12, 0.85, 0.12, true)), stone, 0, 0, 0, k); mesh(G('crossArm', () => box(0.46, 0.12, 0.12)), stone, 0, 0.6, 0, k); }
        else mesh(G('obelisk', () => new THREE.CylinderGeometry(0.06, 0.2, 1.2, 4)), stone, 0, 0.6, 0, k);
        if (rnd() < 0.3){
          // Dug open from below: a black hole and the earth heaped beside it.
          const h = mesh(G('graveOpen', () => { const q = new THREE.PlaneGeometry(0.45, 0.85); q.rotateX(-Math.PI/2); return q; }), hole, x, 0.09, 0.15, g, false); h.receiveShadow = false;
          const pile = mesh(SH.rubbleGeo, dirt, x + 0.25, 0.1, 0.25, g); pile.scale.set(0.6, 0.35, 0.8);
        } else mesh(G('mound', () => box(0.46, 0.1, 0.85, true)), dirt, x, 0.06, 0.15, g);
      }
    } else if (p.kind === 'barrel'){
      // Rusty oil drum; a lit one burns (its flame flickers in animateCity()).
      mesh(G('barrel', () => new THREE.CylinderGeometry(0.32, 0.3, 0.85, 12)), M('rust', 0x6b3a22, { metalness:0.4 }), 0, 0.425, 0, g);
      if (p.lit){
        const f = std(0xff8a2a, { emissive:0xff5a00, emissiveIntensity:1.5, roughness:1 }); f.userData.ph = mr(0, 6); anim.fires.push(f);
        mesh(G('flame', () => new THREE.ConeGeometry(0.26, 0.7, 7)), f, 0, 1.15, 0, g, false).rotation.y = mr(0, 3);
      }
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
const GLINT_Y = { shelf:2.0, locker:2.5, armory:2.4, desk:1.6, medcab:2.5, milcrate:1.5 };
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
        const aw = mesh(G('awning', () => box(2.3, 0.08, 1.1)), awningMat(ct.lm), 0, 2.62, 0.5, g); aw.rotation.x = 0.28;
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
        const g = new THREE.Group(); g.position.set(cx,0,cz); g.rotation.y = mr(-0.3,0.3);
        const body = new THREE.Mesh(SH.crateBody, SH.crateMat); body.castShadow = body.receiveShadow = true;
        const lid = new THREE.Mesh(SH.crateLid, SH.crateLidMat); lid.position.y = 1.0; lid.castShadow = true;
        g.add(body, lid); cityGroup.add(g);
        ct.open = () => { lid.position.set(0.55,0.06,0.75); lid.rotation.set(0,0.6,0.1); };
      }
    }
    const gl = new THREE.Mesh(SH.glintGeo, SH.glintMat); gl.position.set(gx, gy, gz); cityGroup.add(gl);
    ct.glint = gl; ct.gy = gy;
  }
}

function buildCrystal(tile, level){
  const g = new THREE.Group();
  g.position.set((tile.x+0.5)*TILE, 0, (tile.z+0.5)*TILE);
  const ped = new THREE.Mesh(own(new THREE.CylinderGeometry(0.9,1.15,0.5,8)), std(0x2d2a33, { roughness:1 }));
  ped.position.y = 0.25; ped.castShadow = ped.receiveShadow = true; g.add(ped);
  const mat = std(0x9d6bff, { emissive:0x5a22e0, emissiveIntensity:0.9, roughness:0.2, metalness:0.1, flatShading:true });
  const mesh = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.8,0)), mat);
  mesh.scale.set(1,1.8,1); mesh.position.y = 2.1; mesh.castShadow = true; g.add(mesh);
  const shards = [];
  const sg = own(new THREE.OctahedronGeometry(0.25,0));
  for (let i=0;i<5;i++){
    const s = new THREE.Mesh(sg, mat); const a = i/5*Math.PI*2;
    s.position.set(Math.cos(a)*0.9, 0.6, Math.sin(a)*0.9); s.scale.y = 1.8; s.rotation.z = mr(-0.4,0.4); g.add(s); shards.push(s);
  }
  const light = new THREE.PointLight(0xa070ff, 2.4, 16, 2); light.position.y = 2.2; g.add(light);
  const beamMat = own(new THREE.MeshBasicMaterial({ color:0xa070ff, transparent:true, opacity:0.2, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide }));
  const beam = new THREE.Mesh(own(new THREE.CylinderGeometry(0.35,0.35,80,12,1,true)), beamMat); beam.position.y = 40; g.add(beam);
  const glow = new THREE.Mesh(own(new THREE.CircleGeometry(2.6,24)), own(new THREE.MeshBasicMaterial({ color:0x8a5cff, transparent:true, opacity:0.25, blending:THREE.AdditiveBlending, depthWrite:false })));
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
  const cg = own(new THREE.ConeGeometry(0.45,0.8,3));
  const chev = [];
  for (let i=0;i<3;i++){ const c = new THREE.Mesh(cg, cm); c.rotation.z = -Math.PI/2; c.position.set(cx - 3.2 - i*1.4, 0.35, cz); g.add(c); chev.push(c); }
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
