// ---------- City scene ----------
// Turns generated city data into Three.js meshes, and tears it all down again.
import * as THREE from 'three';
import { TILE, N, B } from './config.js';
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
const box = (w, h, d, base) => { const g = new THREE.BoxGeometry(w, h, d); if (base) g.translate(0, h/2, 0); return g; };
const dummy = new THREE.Object3D();
const mesh = (geo, mat, x, y, z, parent, shadow = true) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
};
const glassMat = () => std(0x2a3f55, { emissive:0x1a3a55, emissiveIntensity:0.5, roughness:0.2, metalness:0.3 });

export function buildCityScene(c){
  const cityGroup = world.cityGroup = new THREE.Group(); scene.add(cityGroup);
  const W = N*TILE;
  const outer = new THREE.Mesh(own(new THREE.PlaneGeometry(W+300, W+300)), std(0x121418, { roughness:1 }));
  outer.rotation.x = -Math.PI/2; outer.position.set(W/2,-0.05,W/2); outer.receiveShadow = true; cityGroup.add(outer);
  const road = new THREE.Mesh(own(new THREE.PlaneGeometry(W, W)), std(0x2f3136, { roughness:1 }));
  road.rotation.x = -Math.PI/2; road.position.set(W/2,0,W/2); road.receiveShadow = true; cityGroup.add(road);

  // Block slabs; a landmark's lot (one block, or 2×2 blocks plus the roads between) is one slab.
  const groundMats = {}, gm = { towers:0x67655f, ruins:0x58564f, park:0x3b4a2e, field:0x4b5032, houses:0x45543a, farm:0x4b5032,
    warehouses:0x5c5b56, yard:0x55534d, lot:0x26282c, plaza:0x7a7468, landmark:0x67655f };
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
  tiles(O.lot, SH.lotMat); tiles(O.pad, SH.padMat);
  tiles(O.police, std(LANDMARKS.police.floor, { roughness:0.6 }));
  tiles(O.supermarket, std(LANDMARKS.supermarket.floor, { map:CHECKER_TEX, roughness:0.5 }));
  // Parking stall lines, running along the parked cars.
  const sm = c.interiors.find(i => i.lm === 'supermarket'), alongZ = !sm || sm.front[1] === 1;
  const lotSet = new Set(O.lot.map(([x,z]) => z*N + x));
  const lines = O.lot.filter(([x,z]) => lotSet.has(alongZ ? z*N + x-1 : (z-1)*N + x));
  if (alongZ) tiles(lines, SH.lineMat, 0.086, 0.09, TILE*0.8, -TILE/2, 0); else tiles(lines, SH.lineMat, 0.086, TILE*0.8, 0.09, 0, -TILE/2);

  // Lane dashes, wherever both lanes of a road survive (landmark lots swallow some).
  const dash = own(new THREE.InstancedMesh(own(new THREE.PlaneGeometry(1.0, 0.13)), own(new THREE.MeshBasicMaterial({ color:0x9c8c4a })), 2*(B+1)*N));
  let di = 0;
  for (let k=0;k<=B;k++){
    const line = (2+7*k)*TILE, a = 1+7*k;
    for (let t=1;t<N-1;t++){
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
  const l2 = (N-e-2)*TILE; addWall(TILE, l2, W-TILE/2, (e+2)*TILE + l2/2);

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
  for (const cr of c.cars){
    const g = new THREE.Group(); g.position.set((cr.x+0.5)*TILE, 0, (cr.z+0.5)*TILE); g.rotation.y = cr.rot;
    const body = new THREE.Mesh(SH.carBody, carMat(cr.police ? 0xe9e9ee : cr.color)); body.position.y = 0.42; body.castShadow = body.receiveShadow = true;
    const cab = new THREE.Mesh(SH.carCab, SH.glassMat); cab.position.set(-0.1, 0.9, 0); cab.castShadow = true;
    if (cr.wreck) { g.rotation.z = 0.04; cab.rotation.z = 0.12; }
    g.add(body, cab);
    if (cr.police){
      // Black-and-white with a lightbar that still flashes.
      mesh(SH.policeDoorGeo, SH.navyMat, -0.05, 0.47, 0, g, false);
      mesh(SH.lightbarGeo, SH.sirenR, -0.1, 1.18, -0.2, g, false); mesh(SH.lightbarGeo, SH.sirenB, -0.1, 1.18, 0.2, g, false);
    }
    cityGroup.add(g);
  }
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
  const opens = buildProps(c);
  buildContainers(c, opens);
  world.crystal = buildCrystal(c.crystalTile, state.level);
  world.barricade = buildBarricade(c.exitZ);
}

// ---------- Buildings ----------
// Towers (windows, rooftop gear), houses (gabled roofs), warehouses (corrugated siding, roll-up
// door) and the solid landmarks (pharmacy, hardware store, gas station shop: colour band, roof
// sign, glass storefront). Children use the building's own materials so they fade with it.
function buildingMesh(b){
  const w = b.w*TILE - 0.3, d = b.d*TILE - 0.3, h = b.h, top = h/2, L = b.lm && LANDMARKS[b.lm];
  const col = new THREE.Color(L ? L.wall : b.color);
  let mats, uniq;
  if (b.ruined){
    const m = std(col.clone().multiplyScalar(0.8), { roughness:1 });
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
  if (b.style === 'house'){
    // Gable roof along the long side; its triangular ends are plain wall.
    const ridgeX = b.w >= b.d, span = (ridgeX ? d : w) + 0.4, len = (ridgeX ? w : d) + 0.4, rh = Math.min(1.5, span*0.36);
    const shape = new THREE.Shape(); shape.moveTo(-span/2, 0); shape.lineTo(span/2, 0); shape.lineTo(0, rh); shape.closePath();
    const geo = own(new THREE.ExtrudeGeometry(shape, { depth:len, bevelEnabled:false })); geo.translate(0, 0, -len/2);
    const cap = std(col), roof = std(b.roof, { roughness:1 });
    const r = add(geo, [cap, roof], 0, top, 0); if (ridgeX) r.rotation.y = Math.PI/2;
    if (Math.random() < 0.5){
      const a = len*0.25, s = span*0.15;
      add(G('chimney', () => box(0.4, 1, 0.4, true)), roof, ridgeX ? a : s, top, ridgeX ? s : a).scale.y = rh + 0.35;
    }
    uniq.push(cap, roof);
  } else if (b.style === 'tower'){
    if (b.ac) add(own(new THREE.BoxGeometry(Math.min(1.2,w*0.4),0.5,Math.min(0.9,d*0.4))), uniq[2], w*0.15, top + 0.25, -d*0.1);
    if (w*d > 14 && Math.random() < 0.4){
      // Water tank on legs.
      const t = add(G('tank', () => new THREE.CylinderGeometry(0.75,0.75,1.2,10)), uniq[2], -w*0.2, top + 1.5, d*0.15);
      for (const [lx,lz] of [[-0.5,-0.5],[0.5,-0.5],[-0.5,0.5],[0.5,0.5]]) add(G('leg', () => box(0.1, 0.9, 0.1)), uniq[2], -w*0.2 + lx, top + 0.45, d*0.15 + lz);
      t.castShadow = true;
    }
    if (h > 13 && Math.random() < 0.5){ const a = add(SH.poleGeo, uniq[2], 0, top, 0); a.scale.set(1, 3.5, 1); }
  } else if (b.style === 'warehouse'){
    const dm = std(0x3c3f44, { roughness:0.6, metalness:0.3 });
    add(G('rollup', () => box(2.2, 2.2, 0.08)), dm, Math.min(0, w/2 - 1.6), -top + 1.1, d/2 + 0.04);
    if (b.ac) add(own(new THREE.BoxGeometry(Math.min(1.4,w*0.4),0.6,Math.min(1,d*0.4))), uniq[2], -w*0.2, top + 0.3, 0);
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
  slab.userData.mats = mats;
  for (const p of parts.concat(slab)){ p.userData.fadeKey = slab; world.buildingMeshes.push(p); }
  world.interiors.push({ shell, roof, key:slab, k:0 });
  for (let z=it.z0;z<=it.z1;z++) for (let x=it.x0;x<=it.x1;x++) if (!isWall.has(z*N+x)) world.interiorAt[z*N+x] = idx + 1;
}

// ---------- Props ----------
// Landmark furniture and yard clutter from cityGen's props list. Returns tile -> open(), the
// visual for searching the prop (a shelf emptied, a locker door swung open, a drawer pulled out).
function buildProps(c){
  const opens = new Map(), cityGroup = world.cityGroup;
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
const GLINT_Y = { shelf:2.0, locker:2.5, armory:2.4, desk:1.6 };
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

function buildBarricade(exitZ){
  const g = new THREE.Group();
  const red = std(0xb8342a, { roughness:0.8 });
  const white = std(0xe2ddd2, { roughness:0.8 });
  const yellow = std(0xc8901a, { roughness:0.7 });
  const geo = own(new THREE.BoxGeometry(0.55,0.95,0.6));
  const x = (N-1)*TILE + 0.45;
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
  const cx = (N-1+0.5)*TILE, cz = (world.city.exitZ+1)*TILE;
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
  world.buildingMeshes = []; world.interiors = []; world.interiorAt = null; faded.clear();
  for (const z of zombies) disposeZombie(z);
  for (const d of dying) disposeCorpse(d);
  zombies.length = 0; dying.length = 0;
  for (const arr of [bullets, particles, pickups, drops, throwns, hazards, spits, puddles, rings]) { for (const o of arr) scene.remove(o.mesh || o.m || o.g); arr.length = 0; }
  for (const d of decals) scene.remove(d); decals.length = 0;
  world.crystal = null; world.barricade = null; world.exitMarker = null; world.lure = null;
}
