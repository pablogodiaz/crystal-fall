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
    heal: new THREE.MeshBasicMaterial({ color:0x7dffa8 })
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
})();
export const carMat = c => SH.carMats[c] || (SH.carMats[c] = new THREE.MeshStandardMaterial({ color:c, roughness:0.7, metalness:0.25 }));
