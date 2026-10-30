// ---------- Player ----------
import * as THREE from 'three';
import { TILE, N } from './config.js';
import { scene, camera } from './renderer.js';
import { SH } from './assets.js';
import { world, keys, mouse, mouseNDC } from './state.js';
import { resolveCircle, reveal } from './grid.js';
import { fire } from './combat.js';

export const player = { pos:new THREE.Vector3(), vel:new THREE.Vector3(), radius:0.45, angle:0, walk:0 };
(function buildPlayer(){
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const jacket = new THREE.MeshStandardMaterial({ color:0x2f5d8a, roughness:0.8 });
  const skin = new THREE.MeshStandardMaterial({ color:0xd9a77c, roughness:0.7 });
  const dark = new THREE.MeshStandardMaterial({ color:0x22252b, roughness:0.6, metalness:0.3 });
  const pack = new THREE.MeshStandardMaterial({ color:0x6b5537, roughness:1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.33,0.36,0.85,12), jacket); body.position.y = 1.03;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24,16,12), skin); head.position.y = 1.68;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,0.12,14), dark); cap.position.y = 1.83;
  const bp = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.55,0.25), pack); bp.position.set(0,1.1,-0.36);
  const legs = [];
  for (const sx of [-0.15,0.15]){ const l = new THREE.Mesh(SH.zLeg, SH.pantsMat); l.position.set(sx,0.62,0); inner.add(l); legs.push(l); }
  const armGeo = new THREE.BoxGeometry(0.14,0.14,0.55);
  const a1 = new THREE.Mesh(armGeo, jacket); a1.position.set(0.28,1.18,0.25);
  const a2 = new THREE.Mesh(armGeo, jacket); a2.position.set(-0.12,1.18,0.28); a2.rotation.y = 0.5;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.14,0.55), dark); gun.position.set(0.22,1.22,0.62);
  inner.add(body, head, cap, bp, a1, a2, gun);
  inner.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55,0.68,28), new THREE.MeshBasicMaterial({ color:0xf2e6c8, transparent:true, opacity:0.45, depthWrite:false }));
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.1; g.add(ring);
  const lamp = new THREE.PointLight(0xffe2b0, 0.55, 10, 2); lamp.position.y = 3; g.add(lamp);
  player.g = g; player.inner = inner; player.legs = legs;
  scene.add(g);
})();
// Base stats for a fresh run; upgrades modify these in place.
export function resetPlayerStats(){
  Object.assign(player, { hp:100, maxHp:100, speed:6, stamina:1, staminaDelay:0, fireRate:0.24, magSize:12, mag:12, reloadTime:1.3, reloadT:0, damage:1, pellets:1, pierce:0, regen:0, fireCd:0 });
}
resetPlayerStats();

// Mouse aim: ray from the camera onto a horizontal plane at gun height.
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0,1,0), -1.1);
const aimPoint = new THREE.Vector3();

export function updatePlayer(dt){
  // Screen-relative WASD mapped onto the isometric grid.
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp){ ix -= 1; iz -= 1; }
  if (keys.KeyS || keys.ArrowDown){ ix += 1; iz += 1; }
  if (keys.KeyD || keys.ArrowRight){ ix += 1; iz -= 1; }
  if (keys.KeyA || keys.ArrowLeft){ ix -= 1; iz += 1; }
  const l = Math.hypot(ix,iz), moving = l > 0;
  if (moving){ ix /= l; iz /= l; }
  let spd = player.speed;
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && moving && player.stamina > 0.02;
  if (sprint){ spd *= 1.55; player.stamina = Math.max(0, player.stamina - dt*0.4); player.staminaDelay = 0.8; }
  else { player.staminaDelay -= dt; if (player.staminaDelay <= 0) player.stamina = Math.min(1, player.stamina + dt*0.28); }
  const k = Math.min(1, dt*14);
  player.vel.x += (ix*spd - player.vel.x)*k; player.vel.z += (iz*spd - player.vel.z)*k;
  player.pos.x += player.vel.x*dt; player.pos.z += player.vel.z*dt;
  resolveCircle(player.pos, player.radius); resolveCircle(player.pos, player.radius);
  raycaster.setFromCamera(mouseNDC, camera);
  if (raycaster.ray.intersectPlane(aimPlane, aimPoint)){
    const ax = aimPoint.x - player.pos.x, az = aimPoint.z - player.pos.z;
    if (ax*ax + az*az > 0.04) player.angle = Math.atan2(ax, az);
  }
  player.g.position.copy(player.pos);
  player.g.rotation.y = player.angle;
  const v = Math.hypot(player.vel.x, player.vel.z);
  player.walk += dt*v*2.2;
  const sw = Math.sin(player.walk)*0.6*Math.min(1, v/2);
  player.legs[0].rotation.x = sw; player.legs[1].rotation.x = -sw;
  player.inner.position.y = Math.abs(Math.sin(player.walk))*0.05*Math.min(1, v/2);
  if (player.reloadT > 0){ player.reloadT -= dt; if (player.reloadT <= 0){ player.reloadT = 0; player.mag = player.magSize; } }
  player.fireCd -= dt;
  if (mouse.down) fire();
  if (player.regen > 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + player.regen*1.2*dt);
  const tx = Math.floor(player.pos.x/TILE), tz = Math.floor(player.pos.z/TILE), ti = tz*N+tx;
  if (ti !== world.lastTile){ world.lastTile = ti; reveal(tx, tz, 8); }
}
