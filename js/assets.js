// ---------- Shared assets ----------
// Geometries/materials reused across cities. Never disposed.
import * as THREE from 'three';

function makeWindowTexture(litChance){
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0,0,64,64);
  for (let y=0;y<2;y++) for (let x=0;x<2;x++){
    const lit = Math.random() < litChance;
    g.fillStyle = lit ? '#ffd27a' : '#323742';
    g.fillRect(7+x*32, 8+y*32, 18, 17);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export const WIN_TEX = [makeWindowTexture(0.12), makeWindowTexture(0.25), makeWindowTexture(0.04)];
// Corrugated metal siding for warehouses (one rib per 0.25 of a tile).
export const CORR_TEX = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const g = c.getContext('2d');
  for (let x=0;x<8;x++){ g.fillStyle = x % 2 ? '#d4d4d4' : '#ffffff'; g.fillRect(x*8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
// Checkered shop floor (2×2 squares per tile).
export const CHECKER_TEX = (() => {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0,0,32,32); g.fillStyle = '#b9b9b9'; g.fillRect(0,0,16,16); g.fillRect(16,16,16,16);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2,2);
  return t;
})();
// Awareness marks over a zombie's head: '?' heard something, '!' spotted you.
function markTexture(ch, color){
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(12,12,14,0.75)'; g.fillRect(8,8,48,48);
  g.strokeStyle = color; g.lineWidth = 4; g.strokeRect(8,8,48,48);
  g.fillStyle = color; g.font = 'bold 40px Barlow, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 32, 35);
  return new THREE.CanvasTexture(c);
}

// Several boxes as one geometry (one mesh, one draw call): list of [w, h, d, x, y, z] (centres), optional
// 7th entry = rotation about y (multiples of PI/2 keep it square to the grid).
export function boxes(list){
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const [w, h, d, x, y, z, ry] of list){
    const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(i + off);
    off += g.attributes.position.count; g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); m.setIndex(idx);
  return m;
}
// A flat square frame (outer/inner half-widths) lying in XY, like RingGeometry: player and pickup markers.
export function squareFrame(o, i){
  const sh = new THREE.Shape([new THREE.Vector2(-o,-o), new THREE.Vector2(o,-o), new THREE.Vector2(o,o), new THREE.Vector2(-o,o)]);
  sh.holes.push(new THREE.Path([new THREE.Vector2(-i,-i), new THREE.Vector2(-i,i), new THREE.Vector2(i,i), new THREE.Vector2(i,-i)]));
  return new THREE.ShapeGeometry(sh);
}
export const SH = {};
(function initShared(){
  SH.bulletGeo = new THREE.BoxGeometry(0.09,0.09,0.55);
  SH.bulletMat = new THREE.MeshBasicMaterial({ color:0xffe08a });
  SH.partGeo = new THREE.BoxGeometry(0.14,0.14,0.14);
  SH.partMats = {
    blood: new THREE.MeshBasicMaterial({ color:0x7a0d0d }),
    spark: new THREE.MeshBasicMaterial({ color:0xffd27a }),
    crystal: new THREE.MeshBasicMaterial({ color:0xc4a1ff }),
    dust: new THREE.MeshBasicMaterial({ color:0x8a8780 }),
    heal: new THREE.MeshBasicMaterial({ color:0x7dffa8 }),
    fire: new THREE.MeshBasicMaterial({ color:0xff8a2a }),
    acid: new THREE.MeshBasicMaterial({ color:0xa6ff3a }),
    dirt: new THREE.MeshBasicMaterial({ color:0x5a4630 }),
    ice: new THREE.MeshBasicMaterial({ color:0xcff4ff }),
    void: new THREE.MeshBasicMaterial({ color:0xa070ff }),
    brew: new THREE.MeshBasicMaterial({ color:0xff6ad5 }),
    wood: new THREE.MeshBasicMaterial({ color:0x9a7448 })
  };
  SH.decalGeo = new THREE.PlaneGeometry(0.95, 0.95);
  SH.decalMat = new THREE.MeshBasicMaterial({ color:0x3d0707, transparent:true, opacity:0.75, depthWrite:false });
  SH.holeMat = new THREE.MeshBasicMaterial({ color:0x241b12, transparent:true, opacity:0.85, depthWrite:false });   // dug-up dirt where a zombie rose
  SH.scorchMat = new THREE.MeshBasicMaterial({ color:0x121110, transparent:true, opacity:0.6, depthWrite:false });  // blast mark
  // Blast-radius rings (explosive zombie warning, shockwaves): unit radius, scaled to the blast.
  SH.blastRingGeo = new THREE.RingGeometry(0.93,1,48);
  SH.blastFillGeo = new THREE.CircleGeometry(1,48);
  SH.zBody = new THREE.BoxGeometry(0.7,0.85,0.4);
  SH.zHead = new THREE.BoxGeometry(0.44,0.44,0.44);
  SH.zArm = new THREE.BoxGeometry(0.16,0.16,0.72);
  SH.zLeg = new THREE.BoxGeometry(0.22,0.62,0.25); SH.zLeg.translate(0,-0.31,0);
  SH.pantsMat = new THREE.MeshStandardMaterial({ color:0x2d2f36, roughness:1 });
  SH.trunkGeo = new THREE.CylinderGeometry(0.14,0.2,1.3,6);
  SH.trunkMat = new THREE.MeshStandardMaterial({ color:0x4a3a2c, roughness:1 });
  SH.leafGeo = new THREE.IcosahedronGeometry(0.95,0);
  SH.leafMats = [0x4d5a32,0x3c4728,0x5a5a30].map(c => new THREE.MeshStandardMaterial({ color:c, roughness:1, flatShading:true }));
  SH.carBody = new THREE.BoxGeometry(1.9,0.55,1.05);
  SH.carCab = new THREE.BoxGeometry(1.0,0.45,0.95);
  SH.carMats = {};
  SH.glassMat = new THREE.MeshStandardMaterial({ color:0x1d2228, roughness:0.3, metalness:0.4 });
  SH.rubbleGeo = new THREE.DodecahedronGeometry(0.45,0);
  SH.rubbleMat = new THREE.MeshStandardMaterial({ color:0x6d6a64, roughness:1, flatShading:true });
  SH.pillarMat = new THREE.MeshStandardMaterial({ color:0x9b9384, roughness:1 });
  SH.crossA = new THREE.BoxGeometry(0.5,0.16,0.16);
  SH.crossB = new THREE.BoxGeometry(0.16,0.5,0.16);
  SH.crossMat = new THREE.MeshStandardMaterial({ color:0xe23b3b, emissive:0x8a1010, roughness:0.5 });
  SH.ringGeo = squareFrame(0.55, 0.41);
  SH.healGlow = new THREE.MeshBasicMaterial({ color:0x7dffa8, transparent:true, opacity:0.35, depthWrite:false, side:THREE.DoubleSide });
  // Containers
  SH.dumpBody = new THREE.BoxGeometry(1.7,1.0,1.0); SH.dumpBody.translate(0,0.55,0);
  SH.dumpLid = new THREE.BoxGeometry(1.76,0.08,1.06); SH.dumpLid.translate(0,0,0.53);
  SH.dumpMat = new THREE.MeshStandardMaterial({ color:0x2f5a3c, roughness:0.8, metalness:0.3 });
  SH.dumpLidMat = new THREE.MeshStandardMaterial({ color:0x1f3a28, roughness:0.8, metalness:0.3 });
  SH.crateBody = new THREE.BoxGeometry(1.1,0.95,1.1); SH.crateBody.translate(0,0.48,0);
  SH.crateLid = new THREE.BoxGeometry(1.16,0.1,1.16);
  SH.crateMat = new THREE.MeshStandardMaterial({ color:0x8a6a3e, roughness:1 });
  SH.crateLidMat = new THREE.MeshStandardMaterial({ color:0x6b5130, roughness:1 });
  SH.doorFrame = new THREE.BoxGeometry(1.1,1.95,0.06);
  SH.doorGeo = new THREE.BoxGeometry(0.9,1.75,0.08);
  SH.frameMat = new THREE.MeshStandardMaterial({ color:0x1d1f23, roughness:1 });
  SH.doorMat = new THREE.MeshStandardMaterial({ color:0x5a3d2a, roughness:0.9 });
  SH.glintGeo = new THREE.BoxGeometry(0.22,0.22,0.22);
  SH.glintMat = new THREE.MeshBasicMaterial({ color:0xffe08a, transparent:true, opacity:0.85 });
  // Ground loot
  SH.dropGeo = new THREE.BoxGeometry(0.5,0.32,0.4);
  SH.dropMats = {
    item: new THREE.MeshStandardMaterial({ color:0xd9c9a3, roughness:0.8 }),
    ammo: new THREE.MeshStandardMaterial({ color:0x5f6b3a, roughness:0.7, metalness:0.3 }),
    weapon: new THREE.MeshStandardMaterial({ color:0x25282d, roughness:0.5, metalness:0.5 })
  };
  SH.dropGlow = new THREE.MeshBasicMaterial({ color:0xffe08a, transparent:true, opacity:0.3, depthWrite:false, side:THREE.DoubleSide });
  // Throwables and hazards
  SH.bottleGeo = new THREE.BoxGeometry(0.2,0.42,0.2);
  SH.bottleMat = new THREE.MeshStandardMaterial({ color:0x4f7a3a, roughness:0.3, emissive:0x7a2a00 });
  SH.pipeGeo = new THREE.BoxGeometry(0.22,0.48,0.22);
  SH.pipeMat = new THREE.MeshStandardMaterial({ color:0x6d7077, roughness:0.5, metalness:0.6 });
  SH.beepGeo = new THREE.BoxGeometry(0.12,0.08,0.12);
  SH.beepMat = new THREE.MeshBasicMaterial({ color:0xff3030 });
  SH.fireGeo = new THREE.CircleGeometry(1,24);
  SH.fireMat = new THREE.MeshBasicMaterial({ color:0xff6a1a, transparent:true, opacity:0.45, blending:THREE.AdditiveBlending, depthWrite:false });
  // Special zombies: screamer mouth, spitter acid sac, explosive canisters, riot gear
  SH.mouthGeo = new THREE.BoxGeometry(0.24,0.12,0.04);
  SH.mouthMat = new THREE.MeshBasicMaterial({ color:0x2a0505 });
  SH.sacGeo = new THREE.BoxGeometry(0.5,0.48,0.34);
  SH.sacMat = new THREE.MeshStandardMaterial({ color:0x9ccf2a, emissive:0x4f8a00, roughness:0.4 });
  SH.canGeo = new THREE.BoxGeometry(0.2,0.52,0.2);
  SH.canMat = new THREE.MeshStandardMaterial({ color:0xd2541a, emissive:0xff5a00, emissiveIntensity:0.8, roughness:0.5, metalness:0.3 });
  SH.helmGeo = new THREE.BoxGeometry(0.52,0.2,0.52);
  SH.visorGeo = new THREE.BoxGeometry(0.48,0.26,0.04);
  SH.plateGeo = new THREE.BoxGeometry(0.62,0.5,0.1);
  SH.shieldGeo = new THREE.BoxGeometry(0.8,1.05,0.07);
  SH.stripeGeo = new THREE.BoxGeometry(0.64,0.09,0.08);
  SH.armorMat = new THREE.MeshStandardMaterial({ color:0x1e2633, roughness:0.5, metalness:0.5 });
  SH.visorMat = new THREE.MeshStandardMaterial({ color:0x3a5a7a, roughness:0.15, metalness:0.6, emissive:0x10202e });
  SH.shieldMat = new THREE.MeshStandardMaterial({ color:0x4a5a6e, roughness:0.35, metalness:0.4 });
  SH.stripeMat = new THREE.MeshBasicMaterial({ color:0xe8eef5 });
  // Spitter acid: projectile, landing marker (ring + filling disc), puddle
  SH.acidGeo = new THREE.BoxGeometry(0.32,0.32,0.32);
  SH.acidMat = new THREE.MeshBasicMaterial({ color:0xa6ff3a });
  SH.markGeo = new THREE.RingGeometry(0.86,1,32);
  SH.markMat = new THREE.MeshBasicMaterial({ color:0xa6ff3a, transparent:true, opacity:0.75, depthWrite:false });
  SH.markFillMat = new THREE.MeshBasicMaterial({ color:0xa6ff3a, transparent:true, opacity:0.2, depthWrite:false });
  SH.acidPoolMat = new THREE.MeshBasicMaterial({ color:0x8fe02a, transparent:true, opacity:0.55, depthWrite:false });
  SH.markMats = { heard:new THREE.SpriteMaterial({ map:markTexture('?', '#ffd24a'), depthWrite:false }), spotted:new THREE.SpriteMaterial({ map:markTexture('!', '#ff4d4d'), depthWrite:false }) };
  // Ground overlays (parking, forecourts) and landmark props. Box geometries sit on y = 0.
  const base = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h/2, 0); return g; };
  SH.tilePlane = new THREE.PlaneGeometry(1,1); SH.tilePlane.rotateX(-Math.PI/2);
  SH.lotMat = new THREE.MeshStandardMaterial({ color:0x2a2c30, roughness:1 });
  SH.padMat = new THREE.MeshStandardMaterial({ color:0x8f8c86, roughness:1 });
  SH.lineMat = new THREE.MeshBasicMaterial({ color:0xc9c6bb });
  SH.metalMat = new THREE.MeshStandardMaterial({ color:0x8d9196, roughness:0.5, metalness:0.4 });
  SH.darkMetalMat = new THREE.MeshStandardMaterial({ color:0x34383e, roughness:0.5, metalness:0.5 });
  SH.whiteMat = new THREE.MeshStandardMaterial({ color:0xe6e3dc, roughness:0.7 });
  SH.redMat = new THREE.MeshStandardMaterial({ color:0xd33b2c, roughness:0.6 });
  SH.navyMat = new THREE.MeshStandardMaterial({ color:0x1d3f7a, roughness:0.6 });
  SH.woodMat = new THREE.MeshStandardMaterial({ color:0x7a5a3a, roughness:0.9 });
  SH.lumberMat = new THREE.MeshStandardMaterial({ color:0xc9a56a, roughness:1 });
  SH.screenMat = new THREE.MeshStandardMaterial({ color:0x1a2a3a, emissive:0x2a6a9a, emissiveIntensity:0.6, roughness:0.3 });
  SH.shelfGeo = base(1.75, 1.45, 0.9);
  SH.goodsGeo = new THREE.BoxGeometry(0.34, 0.3, 0.2);
  SH.goodsMats = [0xd9483b,0xe8c34a,0x3b7dd9,0x4fb35a,0xe8e2d0,0xd9822b].map(c => new THREE.MeshStandardMaterial({ color:c, roughness:0.7 }));
  SH.counterGeo = base(1.7, 0.95, 0.85);
  SH.registerGeo = base(0.42, 0.3, 0.36);
  SH.lockerGeo = base(1.5, 2.0, 0.6);
  SH.lockerDoorGeo = base(0.46, 1.8, 0.04); SH.lockerDoorGeo.translate(0.23, 0, 0);
  SH.lockerMat = new THREE.MeshStandardMaterial({ color:0x5d6b78, roughness:0.5, metalness:0.4 });
  SH.armoryGeo = base(1.7, 1.9, 0.6);
  SH.armoryMat = new THREE.MeshStandardMaterial({ color:0x3d4a3e, roughness:0.6, metalness:0.3 });
  SH.rifleGeo = base(0.08, 1.15, 0.14);
  SH.deskGeo = base(1.5, 0.78, 0.9);
  SH.monitorGeo = base(0.55, 0.38, 0.06);
  SH.drawerGeo = base(0.5, 0.18, 0.5);
  SH.barGeo = base(0.09, 2.3, 0.09);
  SH.railGeo = new THREE.BoxGeometry(2, 0.1, 0.12);
  SH.pumpGeo = base(0.6, 1.4, 0.45);
  SH.pumpTopGeo = base(0.68, 0.22, 0.52);
  SH.lumberGeo = base(1.6, 0.22, 0.95);
  SH.cartGeo = base(0.5, 0.42, 0.8);
  SH.poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6); SH.poleGeo.translate(0, 0.5, 0);
  SH.flagGeo = new THREE.BoxGeometry(0.9, 0.55, 0.03);
  SH.flagMat = new THREE.MeshStandardMaterial({ color:0x2f4f9a, roughness:0.8, side:THREE.DoubleSide });
  SH.blanketMat = new THREE.MeshStandardMaterial({ color:0x7fa6c4, roughness:0.9 });
  SH.sandbagMat = new THREE.MeshStandardMaterial({ color:0xa48e66, roughness:1, flatShading:true });
  SH.tentMat = new THREE.MeshStandardMaterial({ color:0x5b6b3a, roughness:1, side:THREE.DoubleSide });
  SH.canvasMat = new THREE.MeshStandardMaterial({ color:0x6b6a48, roughness:1 });
  SH.milMat = new THREE.MeshStandardMaterial({ color:0x4f5a32, roughness:0.8 });
  SH.lightbarGeo = new THREE.BoxGeometry(0.22, 0.12, 0.4);
  SH.policeDoorGeo = new THREE.BoxGeometry(0.9, 0.24, 1.08);
  // Abandoned police cars still flash; animated in game.js animateWorld().
  SH.sirenR = new THREE.MeshStandardMaterial({ color:0xd02020, emissive:0xff2020, emissiveIntensity:1.5 });
  SH.sirenB = new THREE.MeshStandardMaterial({ color:0x2040d0, emissive:0x3060ff, emissiveIntensity:0.2 });
})();
// ---------- Weapon models ----------
// One model per weapon, built from shared geometries/materials (never disposed). Origin = the back
// of the weapon at the hand, pointing +z. The accent stripe shows the rarity (RARITY in items.js).
// Used for the gun in the player's hands and for weapons lying on the ground (loot.js).
const GG = {}, gg = (k, make) => GG[k] || (GG[k] = make());
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GM = {
  dark: new THREE.MeshStandardMaterial({ color:0x22252b, roughness:0.5, metalness:0.5 }),
  steel: new THREE.MeshStandardMaterial({ color:0x7a7f88, roughness:0.35, metalness:0.7 }),
  wood: new THREE.MeshStandardMaterial({ color:0x7a4f2c, roughness:0.8 }),
  poly: new THREE.MeshStandardMaterial({ color:0x3a3f36, roughness:0.7 }),
  red: new THREE.MeshStandardMaterial({ color:0xb8321f, roughness:0.5, metalness:0.3 }),
  string: new THREE.MeshBasicMaterial({ color:0xe8e2d0 }),
  pilot: new THREE.MeshStandardMaterial({ color:0xffa040, emissive:0xff6a00, emissiveIntensity:1.4 }),
  brew: new THREE.MeshStandardMaterial({ color:0xff6ad5, emissive:0xc0208f, emissiveIntensity:0.9, roughness:0.15, transparent:true, opacity:0.85 }),
  cork: new THREE.MeshStandardMaterial({ color:0xa07a4a, roughness:1 }),
  coil: new THREE.MeshStandardMaterial({ color:0xc88a3a, emissive:0x2aa8ff, emissiveIntensity:0.6, metalness:0.6, roughness:0.3 }),
  arc: new THREE.MeshStandardMaterial({ color:0xbff0ff, emissive:0x58d0ff, emissiveIntensity:1.6 }),
  void: new THREE.MeshStandardMaterial({ color:0x2a1450, emissive:0x7a3dff, emissiveIntensity:1.2, roughness:0.2 }),
  white: new THREE.MeshStandardMaterial({ color:0xe4e8ec, roughness:0.4, metalness:0.2 }),
  frost: new THREE.MeshStandardMaterial({ color:0xd8f4ff, emissive:0x5ac8ff, emissiveIntensity:0.9, roughness:0.2 }),
  rail: new THREE.MeshStandardMaterial({ color:0xc8f0ff, emissive:0x3aa0ff, emissiveIntensity:1.3 }),
  crystal: new THREE.MeshStandardMaterial({ color:0xc4a1ff, emissive:0x8a4dff, emissiveIntensity:1.1, roughness:0.15, flatShading:true })
};
SH.rarMats = {}; SH.rarGlow = {}; SH.rarBeam = {};
const RAR_HEX = { common:0xb9b6ae, uncommon:0x4ade80, rare:0x4aa3ff, legendary:0xff9a2a, unique:0xff5fd2 };
for (const r in RAR_HEX){
  SH.rarMats[r] = new THREE.MeshStandardMaterial({ color:RAR_HEX[r], emissive:RAR_HEX[r], emissiveIntensity:r === 'common' ? 0 : 0.7, roughness:0.4 });
  SH.rarGlow[r] = new THREE.MeshBasicMaterial({ color:RAR_HEX[r], transparent:true, opacity:r === 'common' ? 0.3 : 0.5, depthWrite:false, side:THREE.DoubleSide });
  SH.rarBeam[r] = new THREE.MeshBasicMaterial({ color:RAR_HEX[r], transparent:true, opacity:0.22, blending:THREE.AdditiveBlending, depthWrite:false });
}
SH.beamGeo = new THREE.CylinderGeometry(0.07, 0.16, 3.2, 8, 1, true); SH.beamGeo.translate(0, 1.6, 0);
// [geometry key, maker, material, x, y, z, rotX, rotY, rotZ]; 'rar' = the rarity accent.
// Boxes only, square to the gun, nothing under 0.1 thick (a held gun is small; see Model style in CLAUDE.md).
const MODELS = {
  pistol: [
    ['pSlide', () => bx(0.12,0.12,0.42), 'dark', 0,0.04,0.2], ['pGrip', () => bx(0.1,0.22,0.12), 'poly', 0,-0.12,0.06],
    ['pMuzzle', () => bx(0.1,0.1,0.06), 'steel', 0,0.04,0.44], ['pStripe', () => bx(0.126,0.02,0.22), 'rar', 0,0.105,0.2]
  ],
  shotgun: [
    ['sStock', () => bx(0.12,0.16,0.4), 'wood', 0,-0.04,0.05], ['sRecv', () => bx(0.13,0.15,0.28), 'dark', 0,0.02,0.36],
    ['sBarrel', () => bx(0.12,0.1,0.62), 'steel', 0,0.05,0.8], ['sPump', () => bx(0.14,0.1,0.24), 'wood', 0,-0.05,0.66],
    ['sBand', () => bx(0.13,0.11,0.08), 'rar', 0,0.05,1.02]
  ],
  smg: [
    ['mBody', () => bx(0.12,0.14,0.46), 'dark', 0,0.02,0.24], ['mBarrel', () => bx(0.1,0.1,0.2), 'steel', 0,0.03,0.57],
    ['mMag', () => bx(0.1,0.26,0.1), 'poly', 0,-0.18,0.3], ['mFore', () => bx(0.1,0.12,0.1), 'poly', 0,-0.11,0.46],
    ['mStock', () => bx(0.1,0.1,0.24), 'steel', 0,0,-0.1], ['mStripe', () => bx(0.126,0.02,0.18), 'rar', 0,0.1,0.18]
  ],
  rifle: [
    ['rStock', () => bx(0.11,0.16,0.52), 'wood', 0,-0.04,0.16], ['rRecv', () => bx(0.11,0.12,0.32), 'dark', 0,0.02,0.56],
    ['rBarrel', () => bx(0.1,0.1,0.72), 'steel', 0,0.03,1.06], ['rScope', () => bx(0.11,0.11,0.34), 'dark', 0,0.135,0.56],
    ['rLens', () => bx(0.12,0.12,0.04), 'rar', 0,0.135,0.745]
  ],
  bow: [
    // A squared C (riser, limbs, tips in the rarity colour) closed by the string, an arrow nocked.
    ['bRiser', () => bx(0.3,0.1,0.12), 'poly', 0,0,0.42], ['bLimb', () => bx(0.36,0.1,0.1), 'dark', 0.33,0,0.42],
    ['bLimb', null, 'dark', -0.33,0,0.42], ['bTip', () => bx(0.1,0.1,0.26), 'rar', 0.51,0,0.32],
    ['bTip', null, 'rar', -0.51,0,0.32], ['bString', () => bx(1.12,0.08,0.08), 'string', 0,0,0.2],
    ['bArrow', () => bx(0.08,0.08,0.68), 'wood', 0,0.08,0.48], ['bHead', () => bx(0.12,0.12,0.12), 'steel', 0,0.08,0.86]
  ],
  flamer: [
    ['fBody', () => bx(0.12,0.14,0.42), 'dark', 0,0.02,0.2], ['fTank', () => bx(0.16,0.16,0.36), 'red', 0,-0.14,0.22],
    ['fNozzle', () => bx(0.1,0.1,0.38), 'steel', 0,0.03,0.6], ['fPilot', () => bx(0.1,0.1,0.1), 'pilot', 0,-0.07,0.74],
    ['fGrip', () => bx(0.1,0.14,0.1), 'poly', 0,-0.1,0.46], ['fStripe', () => bx(0.126,0.02,0.12), 'rar', 0,0.1,0.3]
  ],
  potion: [
    ['qFlask', () => bx(0.24,0.24,0.24), 'brew', 0,0.02,0.2], ['qNeck', () => bx(0.1,0.1,0.1), 'brew', 0,0.19,0.2],
    ['qCork', () => bx(0.13,0.07,0.13), 'cork', 0,0.27,0.2]
  ],
  tesla: [
    ['tBody', () => bx(0.13,0.15,0.36), 'dark', 0,0.02,0.18], ['tCell', () => bx(0.1,0.14,0.14), 'arc', 0,-0.12,0.2],
    ['tRod', () => bx(0.1,0.1,0.42), 'steel', 0,0.03,0.54], ['tCoil', () => bx(0.18,0.18,0.08), 'coil', 0,0.03,0.44],
    ['tCoil', null, 'coil', 0,0.03,0.56], ['tCoil', null, 'coil', 0,0.03,0.68], ['tTip', () => bx(0.14,0.14,0.14), 'arc', 0,0.03,0.8],
    ['tStripe', () => bx(0.136,0.02,0.12), 'rar', 0,0.105,0.1]
  ],
  gravity: [
    ['gBody', () => bx(0.16,0.17,0.46), 'dark', 0,0.02,0.22], ['gBarrel', () => bx(0.17,0.17,0.3), 'steel', 0,0.04,0.6],
    ['gCore', () => bx(0.13,0.13,0.13), 'void', 0,0.04,0.8], ['gRing', () => bx(0.23,0.23,0.08), 'rar', 0,0.04,0.66],
    ['gGrip', () => bx(0.1,0.14,0.1), 'poly', 0,-0.13,0.16], ['gGrip', null, 'poly', 0,-0.12,0.42]
  ],
  railgun: [
    ['lStock', () => bx(0.11,0.14,0.4), 'dark', 0,-0.02,0.12], ['lBody', () => bx(0.13,0.13,0.4), 'white', 0,0.02,0.48],
    ['lRail', () => bx(0.16,0.08,0.82), 'steel', 0,0.03,1.0], ['lGlow', () => bx(0.08,0.02,0.78), 'rail', 0,0.08,1.0],
    ['lCoil', () => bx(0.2,0.14,0.08), 'rar', 0,0.03,0.76], ['lCoil', null, 'rar', 0,0.03,0.98], ['lCoil', null, 'rar', 0,0.03,1.2],
    ['lCell', () => bx(0.1,0.12,0.16), 'rail', 0,-0.1,0.45]
  ],
  cryo: [
    ['cBody', () => bx(0.12,0.13,0.38), 'white', 0,0.02,0.2], ['cTank', () => bx(0.17,0.17,0.34), 'frost', 0,-0.14,0.22],
    ['cNozzle', () => bx(0.1,0.1,0.34), 'steel', 0,0.03,0.55], ['cTip', () => bx(0.15,0.15,0.08), 'frost', 0,0.03,0.74],
    ['cGrip', () => bx(0.1,0.14,0.1), 'poly', 0,-0.1,0.44], ['cStripe', () => bx(0.126,0.02,0.12), 'rar', 0,0.095,0.28]
  ],
  shard: [
    ['hGrip', () => bx(0.1,0.2,0.11), 'dark', 0,-0.1,0.06], ['hFrame', () => bx(0.11,0.1,0.3), 'steel', 0,0.02,0.2],
    ['hCrystal', () => bx(0.12,0.12,0.42), 'crystal', 0,0.04,0.52],
    ['hClaw', () => bx(0.1,0.12,0.12), 'rar', 0.11,0.04,0.38], ['hClaw', null, 'rar', -0.11,0.04,0.38]
  ],
  drone: [
    ['dPad', () => bx(0.3,0.1,0.2), 'dark', 0,0,0.18], ['dScreen', () => bx(0.18,0.02,0.12), 'arc', 0,0.06,0.18],
    ['dKey', () => bx(0.1,0.1,0.1), 'steel', 0.1,0.1,0.24], ['dStripe', () => bx(0.31,0.02,0.04), 'rar', 0,0.06,0.27]
  ]
};
export function gunModel(id, rarity = 'common'){
  const g = new THREE.Group();
  for (const [k, make, mat, x, y, z, rx = 0, ry = 0, rz = 0] of MODELS[id]){
    const m = new THREE.Mesh(gg(k, make), mat === 'rar' ? SH.rarMats[rarity] : GM[mat]);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m);
  }
  return g;
}
// Unique projectiles and effects
SH.critMat = new THREE.MeshBasicMaterial({ color:0xff7a3a });
SH.arrowGeo = new THREE.BoxGeometry(0.1,0.1,0.8);
SH.arrowMat = new THREE.MeshStandardMaterial({ color:0xc9a56a, roughness:0.8 });
SH.flaskMat = GM.brew; SH.flaskGeo = new THREE.BoxGeometry(0.24,0.26,0.24);
SH.brewMat = new THREE.MeshBasicMaterial({ color:0xd23fa8, transparent:true, opacity:0.45, depthWrite:false });
SH.boltGeo = new THREE.BoxGeometry(0.07,0.07,1);
SH.boltMat = new THREE.MeshBasicMaterial({ color:0xa8eeff, transparent:true, opacity:0.95, blending:THREE.AdditiveBlending, depthWrite:false });
SH.boltCoreMat = new THREE.MeshBasicMaterial({ color:0xffffff });
SH.flameMats = [0xfff2b0, 0xffb040, 0xff6a1a, 0xb8300f].map(c => new THREE.MeshBasicMaterial({ color:c, transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false }));
SH.smokeMat = new THREE.MeshBasicMaterial({ color:0x3a3632, transparent:true, opacity:0.35, depthWrite:false });
// The guardian drone (uniques.js): body, glowing eye, four spinning rotors (r.rotors), a gun underneath.
export function droneModel(){
  const g = new THREE.Group(), rotors = [];
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(gg('drBody', () => bx(0.42,0.14,0.42)), GM.white, 0, 0, 0);
  add(gg('drDome', () => bx(0.24,0.1,0.24)), GM.dark, 0, 0.12, 0);
  add(gg('drEye', () => bx(0.12,0.1,0.1)), SH.rarMats.unique, 0, 0, 0.22);
  add(gg('drGun', () => bx(0.1,0.1,0.26)), GM.steel, 0, -0.12, 0.12);
  for (const [x, z] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
    add(gg('drArm', () => bx(0.12,0.1,0.12)), GM.dark, x*0.27, 0.03, z*0.27);
    const r = add(gg('drRotor', () => bx(0.32,0.03,0.32)), GM.rotor, x*0.3, 0.1, z*0.3); r.castShadow = false; rotors.push(r);
  }
  g.rotors = rotors;
  return g;
}
GM.rotor = new THREE.MeshBasicMaterial({ color:0xb9c0c8, transparent:true, opacity:0.35, depthWrite:false });
SH.orbGeo = new THREE.BoxGeometry(0.44,0.44,0.44); SH.wellRingGeo = squareFrame(1, 0.88);
SH.voidMat = GM.void;
SH.wellRingMat = new THREE.MeshBasicMaterial({ color:0xa070ff, transparent:true, opacity:0.75, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide });
SH.wellFloorMat = new THREE.MeshBasicMaterial({ color:0x5a2ab8, transparent:true, opacity:0.22, depthWrite:false, side:THREE.DoubleSide });
SH.gravMats = [new THREE.MeshBasicMaterial({ color:0xc8a8ff, transparent:true, opacity:0.8, blending:THREE.AdditiveBlending, depthWrite:false })];
SH.frostMats = [0xffffff, 0xdff6ff, 0xaee4ff, 0x86cfff].map(c => new THREE.MeshBasicMaterial({ color:c, transparent:true, opacity:0.75, blending:THREE.AdditiveBlending, depthWrite:false }));
SH.mistMat = new THREE.MeshBasicMaterial({ color:0xdaf2ff, transparent:true, opacity:0.25, depthWrite:false });
SH.iceGeo = new THREE.BoxGeometry(0.95,2.05,0.8); SH.iceGeo.translate(0,1.0,0);
SH.iceMat = new THREE.MeshStandardMaterial({ color:0xbfeaff, emissive:0x2a6a9a, emissiveIntensity:0.5, transparent:true, opacity:0.45, roughness:0.1, depthWrite:false });
SH.shardGeo = new THREE.BoxGeometry(0.13,0.13,0.62);
SH.shardMat = GM.crystal;
SH.droneBulletMat = new THREE.MeshBasicMaterial({ color:0xff8ae0 });
SH.markMats.turned = new THREE.SpriteMaterial({ map:markTexture('♥', '#ff6ad5'), depthWrite:false });
export const carMat = c => SH.carMats[c] || (SH.carMats[c] = new THREE.MeshStandardMaterial({ color:c, roughness:0.7, metalness:0.25 }));
