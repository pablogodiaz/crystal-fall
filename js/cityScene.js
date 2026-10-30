// ---------- City scene ----------
// Turns generated city data into Three.js meshes, and tears it all down again.
import * as THREE from 'three';
import { TILE, N } from './config.js';
import { mr } from './utils.js';
import { scene } from './renderer.js';
import { SH, WIN_TEX, carMat } from './assets.js';
import { state, world, zombies, dying, bullets, particles, pickups, decals } from './state.js';
import { disposeZombie } from './zombies.js';
import { faded } from './fx.js';

// Per-city geometries/materials/textures, disposed in teardownCity().
let disposables = [];
const own = o => { disposables.push(o); return o; };

export function buildCityScene(c){
  const cityGroup = world.cityGroup = new THREE.Group(); scene.add(cityGroup);
  const W = N*TILE;
  const outer = new THREE.Mesh(own(new THREE.PlaneGeometry(W+300, W+300)), own(new THREE.MeshStandardMaterial({ color:0x121418, roughness:1 })));
  outer.rotation.x = -Math.PI/2; outer.position.set(W/2,-0.05,W/2); outer.receiveShadow = true; cityGroup.add(outer);
  const road = new THREE.Mesh(own(new THREE.PlaneGeometry(W, W)), own(new THREE.MeshStandardMaterial({ color:0x2f3136, roughness:1 })));
  road.rotation.x = -Math.PI/2; road.position.set(W/2,0,W/2); road.receiveShadow = true; cityGroup.add(road);

  const blockGeo = own(new THREE.BoxGeometry(5*TILE-0.12, 0.08, 5*TILE-0.12));
  const groundMats = {
    buildings: own(new THREE.MeshStandardMaterial({ color:0x67655f, roughness:1 })),
    ruins: own(new THREE.MeshStandardMaterial({ color:0x58564f, roughness:1 })),
    park: own(new THREE.MeshStandardMaterial({ color:0x3b4a2e, roughness:1 })),
    lot: own(new THREE.MeshStandardMaterial({ color:0x26282c, roughness:1 })),
    plaza: own(new THREE.MeshStandardMaterial({ color:0x7a7468, roughness:1 }))
  };
  for (const b of c.blocks){
    const m = new THREE.Mesh(blockGeo, groundMats[b.type]);
    m.position.set((b.x0+2.5)*TILE, 0.04, (b.z0+2.5)*TILE); m.receiveShadow = true; cityGroup.add(m);
  }

  // Lane dashes
  const dashGeo = own(new THREE.PlaneGeometry(1.0, 0.13));
  const dashMat = own(new THREE.MeshBasicMaterial({ color:0x9c8c4a }));
  const dash = new THREE.InstancedMesh(dashGeo, dashMat, 2*7*30);
  const dummy = new THREE.Object3D(); let di = 0;
  for (let k=0;k<7;k++){
    const line = (2+7*k)*TILE;
    for (let t=1;t<N-1;t++){
      if ((t-1)%7 < 2) continue;
      dummy.rotation.set(-Math.PI/2,0,0); dummy.position.set((t+0.5)*TILE, 0.012, line); dummy.updateMatrix(); dash.setMatrixAt(di++, dummy.matrix);
      dummy.rotation.set(-Math.PI/2,0,Math.PI/2); dummy.position.set(line, 0.012, (t+0.5)*TILE); dummy.updateMatrix(); dash.setMatrixAt(di++, dummy.matrix);
    }
  }
  dash.count = di; cityGroup.add(dash);

  // Quarantine walls
  const wallMat = own(new THREE.MeshStandardMaterial({ color:0x55575c, roughness:0.95 }));
  const stripeMat = own(new THREE.MeshStandardMaterial({ color:0xc8901a, roughness:0.8 }));
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

  // Buildings
  const buildingMeshes = world.buildingMeshes = [];
  for (const b of c.buildings){
    const w = b.w*TILE - 0.3, d = b.d*TILE - 0.3;
    const geo = own(new THREE.BoxGeometry(w, b.h, d));
    const col = new THREE.Color(b.color);
    let mats, uniq;
    if (b.ruined){
      const m = own(new THREE.MeshStandardMaterial({ color:col.clone().multiplyScalar(0.8), roughness:1 }));
      mats = [m,m,m,m,m,m]; uniq = [m];
    } else {
      const vr = Math.max(1, Math.round(b.h/2));
      const tx = own(WIN_TEX[b.win].clone()); tx.needsUpdate = true; tx.repeat.set(b.d, vr);
      const tz = own(WIN_TEX[b.win].clone()); tz.needsUpdate = true; tz.repeat.set(b.w, vr);
      const mx = own(new THREE.MeshStandardMaterial({ color:col, map:tx, roughness:0.9 }));
      const mz = own(new THREE.MeshStandardMaterial({ color:col, map:tz, roughness:0.9 }));
      const roof = own(new THREE.MeshStandardMaterial({ color:col.clone().multiplyScalar(0.55), roughness:1 }));
      mats = [mx,mx,roof,roof,mz,mz]; uniq = [mx,mz,roof];
    }
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set((b.x + b.w/2)*TILE, b.h/2, (b.z + b.d/2)*TILE);
    mesh.castShadow = mesh.receiveShadow = true;
    if (b.ac && !b.ruined){
      const ac = new THREE.Mesh(own(new THREE.BoxGeometry(Math.min(1.2,w*0.4),0.5,Math.min(0.9,d*0.4))), uniq[2]);
      ac.position.set(w*0.15, b.h/2 + 0.25, -d*0.1); ac.castShadow = true; mesh.add(ac);
    }
    mesh.userData.mats = uniq;
    buildingMeshes.push(mesh); cityGroup.add(mesh);
  }
  for (const t of c.trees){
    const g = new THREE.Group(); g.position.set((t.x+0.5)*TILE, 0, (t.z+0.5)*TILE); g.scale.setScalar(t.s);
    const tr = new THREE.Mesh(SH.trunkGeo, SH.trunkMat); tr.position.y = 0.65; tr.castShadow = true;
    const lf = new THREE.Mesh(SH.leafGeo, SH.leafMats[t.m]); lf.position.y = 1.75; lf.rotation.y = t.x*1.7; lf.castShadow = true;
    g.add(tr, lf); cityGroup.add(g);
  }
  for (const cr of c.cars){
    const g = new THREE.Group(); g.position.set((cr.x+0.5)*TILE, 0, (cr.z+0.5)*TILE); g.rotation.y = cr.rot;
    const body = new THREE.Mesh(SH.carBody, carMat(cr.color)); body.position.y = 0.42; body.castShadow = body.receiveShadow = true;
    const cab = new THREE.Mesh(SH.carCab, SH.glassMat); cab.position.set(-0.1, 0.9, 0); cab.castShadow = true;
    if (cr.wreck) { g.rotation.z = 0.04; cab.rotation.z = 0.12; }
    g.add(body, cab); cityGroup.add(g);
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
  world.crystal = buildCrystal(c.crystalTile, state.level);
  world.barricade = buildBarricade(c.exitZ);
}

function buildCrystal(tile, level){
  const g = new THREE.Group();
  g.position.set((tile.x+0.5)*TILE, 0, (tile.z+0.5)*TILE);
  const ped = new THREE.Mesh(own(new THREE.CylinderGeometry(0.9,1.15,0.5,8)), own(new THREE.MeshStandardMaterial({ color:0x2d2a33, roughness:1 })));
  ped.position.y = 0.25; ped.castShadow = ped.receiveShadow = true; g.add(ped);
  const mat = own(new THREE.MeshStandardMaterial({ color:0x9d6bff, emissive:0x5a22e0, emissiveIntensity:0.9, roughness:0.2, metalness:0.1, flatShading:true }));
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
  const red = own(new THREE.MeshStandardMaterial({ color:0xb8342a, roughness:0.8 }));
  const white = own(new THREE.MeshStandardMaterial({ color:0xe2ddd2, roughness:0.8 }));
  const yellow = own(new THREE.MeshStandardMaterial({ color:0xc8901a, roughness:0.7 }));
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
  disposables = []; world.buildingMeshes = []; faded.clear();
  for (const z of zombies) disposeZombie(z);
  for (const d of dying) disposeZombie(d.z);
  zombies.length = 0; dying.length = 0;
  for (const arr of [bullets, particles, pickups]) { for (const o of arr) scene.remove(o.mesh || o.m || o.g); arr.length = 0; }
  for (const d of decals) scene.remove(d); decals.length = 0;
  world.crystal = null; world.barricade = null; world.exitMarker = null;
}
