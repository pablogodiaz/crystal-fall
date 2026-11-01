// ---------- Player ----------
import * as THREE from 'three';
import { TILE, N } from './config.js';
import { scene, camera } from './renderer.js';
import { SH } from './assets.js';
import { WEAPONS, INV_SLOTS } from './items.js';
import { world, keys, mouse, mouseNDC } from './state.js';
import { resolveCircle, reveal } from './grid.js';
import { fire, drainHp, meleeStrike, MELEE_TIME, MELEE_HIT } from './combat.js';
import { curWeapon, magSize } from './inventory.js';
import { burst } from './fx.js';
import { makeNoise } from './zombies.js';
import { AI } from './threats.js';

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
  // Melee swoosh: a flat arc in front of the player, shown during the strike.
  const swish = new THREE.Mesh(new THREE.RingGeometry(0.75,1.75,18,1,-Math.PI/2-0.95,1.9),
    new THREE.MeshBasicMaterial({ color:0xfff1d0, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide }));
  swish.rotation.x = -Math.PI/2; swish.position.y = 1.05; swish.visible = false; g.add(swish);
  inner.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55,0.68,28), new THREE.MeshBasicMaterial({ color:0xf2e6c8, transparent:true, opacity:0.45, depthWrite:false }));
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.1; g.add(ring);
  const lamp = new THREE.PointLight(0xffe2b0, 0.55, 10, 2); lamp.position.y = 3; g.add(lamp);
  player.g = g; player.inner = inner; player.legs = legs; player.gun = gun; player.arms = [a1, a2]; player.swish = swish; player.gunZ = 0.62;
  scene.add(g);
})();
// Base stats for a fresh run; upgrades modify these in place. Weapon stats live in WEAPONS;
// dmgMul/fireMul/magMul/reloadMul/pellets/pierce are upgrade modifiers applied on top.
export function resetPlayerStats(){
  Object.assign(player, { hp:100, maxHp:100, speed:4.6, stamina:1, staminaDelay:0, staminaRate:1, winded:false, boost:0,
    reloadT:0, fireCd:0, meleeT:0, meleeCd:0, meleeHit:false,
    dmgMul:1, fireMul:1, magMul:1, reloadMul:1, pellets:0, pierce:0, regen:0,
    bleeding:false, throwSel:'molotov', aiming:false, bleedFx:0, stepT:0,
    weapons:[{ id:'pistol', mag:12 }, null], cur:0, ammo:{ pistol:36, shotgun:0, smg:0, rifle:0 },
    inv:[{ id:'bandage', n:1 }, { id:'drink', n:1 }].concat(new Array(INV_SLOTS-2).fill(null)) });
}
// Barrel length follows the held weapon.
export function refreshGun(){
  const k = WEAPONS[player.weapons[player.cur].id].gun;
  player.gun.scale.z = k; player.gunZ = 0.35 + 0.275*k; poseMelee(0);
}
// Melee pose for swing progress k (0 = rest): wind up with the gun turned across the chest and
// pulled back, then drive it forward stock-first with a body twist, then recover.
const ease = x => x*x*(3 - 2*x);
function poseMelee(k){
  let a = 0, b = 0;  // a = wind-up amount, b = thrust amount
  if (k > 0 && k < 0.35) a = ease(k/0.35);
  else if (k >= 0.35 && k < 0.55){ b = ease((k-0.35)/0.2); a = 1 - b; }
  else if (k >= 0.55 && k < 1) b = 1 - ease((k-0.55)/0.45);
  const turn = Math.max(a, b), [a1, a2] = player.arms, gun = player.gun;
  player.inner.rotation.y = 0.55*a - 0.5*b;
  gun.rotation.set(-0.4*a, 1.3*turn, 0);
  gun.position.set(0.22 - 0.22*turn, 1.22 + 0.16*a, player.gunZ - 0.3*a + 0.45*b);
  a1.position.z = 0.25 - 0.2*a + 0.35*b; a1.rotation.x = -0.5*a;
  a2.position.z = 0.28 - 0.2*a + 0.4*b; a2.rotation.y = 0.5 + 0.4*b;
  const sw = player.swish, sk = (k - 0.38)/0.4;
  sw.visible = sk > 0 && sk < 1;
  if (sw.visible){ sw.material.opacity = 0.6*(1 - sk); sw.rotation.z = -0.5 + sk*0.9; }
}
resetPlayerStats();

// Mouse aim: ray from the camera onto a horizontal plane at gun height.
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0,1,0), -1.1);
export const aimPoint = new THREE.Vector3();
// Stamina: walking is slower than a runner, so sprinting is how you get away. Sprint drains
// stamina (staminaRate upgrade, energy-drink boost cut it); it refills after a short pause,
// faster standing still. Running dry leaves you winded: no sprint and a slower walk until
// stamina is back to WINDED_OK.
const SPRINT_MUL = 1.75, SPRINT_DRAIN = 0.28, REGEN = 0.24, REGEN_STILL = 1.7, REGEN_DELAY = 1, WINDED_OK = 0.4, WINDED_MUL = 0.8, BOOST_DRAIN = 0.4;

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
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && moving && !player.winded;
  if (player.boost > 0) player.boost = Math.max(0, player.boost - dt);
  if (sprint){
    spd *= SPRINT_MUL; player.staminaDelay = REGEN_DELAY;
    player.stamina = Math.max(0, player.stamina - dt*SPRINT_DRAIN*player.staminaRate*(player.boost > 0 ? BOOST_DRAIN : 1));
    if (player.stamina <= 0) player.winded = true;
    // Running footsteps carry; walking is silent (zombies only notice you by sight).
    player.stepT -= dt;
    if (player.stepT <= 0){ player.stepT = AI.stepT; makeNoise(player.pos.x, player.pos.z, AI.sprintNoise); }
  } else {
    player.staminaDelay -= dt;
    if (player.staminaDelay <= 0) player.stamina = Math.min(1, player.stamina + dt*REGEN*(moving ? 1 : REGEN_STILL));
    if (player.winded && player.stamina >= WINDED_OK) player.winded = false;
  }
  if (player.winded) spd *= WINDED_MUL;
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
  if (player.reloadT > 0){
    player.reloadT -= dt;
    if (player.reloadT <= 0){
      const w = curWeapon(), k = Math.min(magSize(w) - w.mag, player.ammo[w.id]);
      player.reloadT = 0; w.mag += k; player.ammo[w.id] -= k;
    }
  }
  player.fireCd -= dt; player.meleeCd -= dt;
  if (player.meleeT > 0){
    player.meleeT = Math.max(0, player.meleeT - dt);
    const k = 1 - player.meleeT/MELEE_TIME;
    if (!player.meleeHit && k >= MELEE_HIT){ player.meleeHit = true; meleeStrike(); }
    poseMelee(player.meleeT > 0 ? k : 0);
  }
  if (mouse.down) fire();
  if (player.regen > 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + player.regen*1.2*dt);
  if (player.bleeding){
    player.bleedFx -= dt;
    if (player.bleedFx <= 0){ player.bleedFx = 0.35; burst(new THREE.Vector3(player.pos.x, 0.9, player.pos.z), 'blood', 1, 1); }
  }
  if (player.bleeding && drainHp(1.1*dt)) return;
  const tx = Math.floor(player.pos.x/TILE), tz = Math.floor(player.pos.z/TILE), ti = tz*N+tx;
  if (ti !== world.lastTile){ world.lastTile = ti; reveal(tx, tz, 8); }
}
