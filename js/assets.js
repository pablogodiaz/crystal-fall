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
    acid: new THREE.MeshBasicMaterial({ color:0xa6ff3a })
  };
  SH.decalGeo = new THREE.CircleGeometry(0.55, 10);
  SH.decalMat = new THREE.MeshBasicMaterial({ color:0x3d0707, transparent:true, opacity:0.75, depthWrite:false });
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
  SH.ringGeo = new THREE.RingGeometry(0.42,0.6,20);
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
  SH.glintGeo = new THREE.OctahedronGeometry(0.17,0);
  SH.glintMat = new THREE.MeshBasicMaterial({ color:0xffe08a, transparent:true, opacity:0.85 });
  // Ground loot
  SH.dropGeo = new THREE.BoxGeometry(0.5,0.32,0.4);
  SH.dropGunGeo = new THREE.BoxGeometry(0.22,0.18,1.0);
  SH.dropMats = {
    item: new THREE.MeshStandardMaterial({ color:0xd9c9a3, roughness:0.8 }),
    ammo: new THREE.MeshStandardMaterial({ color:0x5f6b3a, roughness:0.7, metalness:0.3 }),
    weapon: new THREE.MeshStandardMaterial({ color:0x25282d, roughness:0.5, metalness:0.5 })
  };
  SH.dropGlow = new THREE.MeshBasicMaterial({ color:0xffe08a, transparent:true, opacity:0.3, depthWrite:false, side:THREE.DoubleSide });
  // Throwables and hazards
  SH.bottleGeo = new THREE.CylinderGeometry(0.09,0.12,0.42,8);
  SH.bottleMat = new THREE.MeshStandardMaterial({ color:0x4f7a3a, roughness:0.3, emissive:0x7a2a00 });
  SH.pipeGeo = new THREE.CylinderGeometry(0.11,0.11,0.48,8);
  SH.pipeMat = new THREE.MeshStandardMaterial({ color:0x6d7077, roughness:0.5, metalness:0.6 });
  SH.beepGeo = new THREE.SphereGeometry(0.07,8,6);
  SH.beepMat = new THREE.MeshBasicMaterial({ color:0xff3030 });
  SH.fireGeo = new THREE.CircleGeometry(1,24);
  SH.fireMat = new THREE.MeshBasicMaterial({ color:0xff6a1a, transparent:true, opacity:0.45, blending:THREE.AdditiveBlending, depthWrite:false });
  // Special zombies: screamer mouth, spitter acid sac, explosive canisters, riot gear
  SH.mouthGeo = new THREE.BoxGeometry(0.24,0.12,0.04);
  SH.mouthMat = new THREE.MeshBasicMaterial({ color:0x2a0505 });
  SH.sacGeo = new THREE.SphereGeometry(0.3,10,8);
  SH.sacMat = new THREE.MeshStandardMaterial({ color:0x9ccf2a, emissive:0x4f8a00, roughness:0.4 });
  SH.canGeo = new THREE.CylinderGeometry(0.11,0.11,0.5,8);
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
  SH.acidGeo = new THREE.SphereGeometry(0.2,8,6);
  SH.acidMat = new THREE.MeshBasicMaterial({ color:0xa6ff3a });
  SH.markGeo = new THREE.RingGeometry(0.86,1,32);
  SH.markMat = new THREE.MeshBasicMaterial({ color:0xa6ff3a, transparent:true, opacity:0.75, depthWrite:false });
  SH.markFillMat = new THREE.MeshBasicMaterial({ color:0xa6ff3a, transparent:true, opacity:0.2, depthWrite:false });
  SH.acidPoolMat = new THREE.MeshBasicMaterial({ color:0x8fe02a, transparent:true, opacity:0.55, depthWrite:false });
})();
export const carMat = c => SH.carMats[c] || (SH.carMats[c] = new THREE.MeshStandardMaterial({ color:c, roughness:0.7, metalness:0.25 }));
