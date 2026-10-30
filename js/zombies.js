// ---------- Zombies ----------
// Spawning, steering, damage and death. Type/modifier numbers live in threats.js; screamer and
// spitter behaviour in specials.js.
import * as THREE from 'three';
import { TILE, N, DIRS8, walkable } from './config.js';
import { mr, lerpAngle } from './utils.js';
import { scene } from './renderer.js';
import { SH } from './assets.js';
import { state, world, zombies, dying } from './state.js';
import { distField, isBlockedTile, resolveCircle } from './grid.js';
import { player } from './player.js';
import { hurtPlayer } from './combat.js';
import { burst, addDecal, spawnPickup } from './fx.js';
import { dropZombieAmmo } from './loot.js';
import { queueBlast } from './throwables.js';
import { rollThreat, updateScreamer, cancelScream, updateSpitter, poseSpecial } from './specials.js';
import { ZTYPES, ZMODS, SCALE } from './threats.js';
import { sfx } from './audio.js';

const SHIRTS = [0x6b4a3a,0x4a5a6b,0x5a5a4a,0x7a3a3a,0x3a4a3a,0x6a6a72,0x8a7a5a];
// Base body plus the visual tell of its type (screamer mouth, spitter sac) and each modifier
// (explosive canisters + orange glow, riot helmet/vest/shield). em = resting emissive per material.
function createZombieMesh(type, mods){
  const S = ZTYPES[type];
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
  const bodyMat = new THREE.MeshStandardMaterial({ color:SHIRTS[Math.floor(Math.random()*SHIRTS.length)], roughness:0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color:S.skin, roughness:0.8 });
  const mats = [bodyMat, skinMat], em = [0, 0], parts = {};
  const body = new THREE.Mesh(SH.zBody, bodyMat); body.position.y = 1.03; body.rotation.x = 0.12;
  const head = new THREE.Mesh(SH.zHead, skinMat); head.position.set(0,1.68,0.06); head.rotation.z = mr(-0.25,0.25);
  const a1 = new THREE.Mesh(SH.zArm, skinMat); a1.position.set(0.43,1.3,0.32);
  const a2 = new THREE.Mesh(SH.zArm, skinMat); a2.position.set(-0.43,1.3,0.32);
  const l1 = new THREE.Mesh(SH.zLeg, SH.pantsMat); l1.position.set(0.17,0.62,0);
  const l2 = new THREE.Mesh(SH.zLeg, SH.pantsMat); l2.position.set(-0.17,0.62,0);
  b.add(body, head, a1, a2, l1, l2);
  if (type === 'screamer'){
    // Gaunt, long head with its own material so it can glow during the wind-up.
    const hm = new THREE.MeshStandardMaterial({ color:S.skin, roughness:0.6 }); head.material = hm; mats.push(hm); em.push(0);
    head.scale.set(0.9,1.15,0.9); body.scale.x = 0.8;
    const mouth = new THREE.Mesh(SH.mouthGeo, SH.mouthMat); mouth.position.set(0,-0.1,0.225); head.add(mouth);
    Object.assign(parts, { head, headMat:hm, mouth });
  }
  if (type === 'spitter'){
    body.scale.set(1.15,1,1.3);
    const sac = new THREE.Mesh(SH.sacGeo, SH.sacMat); sac.position.set(0,1.0,0.27); b.add(sac); parts.sac = sac;
  }
  if (mods.explosive){
    bodyMat.emissive.setHex(0x8a3000); em[0] = 0x8a3000;
    const cans = parts.cans = new THREE.Group(); b.add(cans);
    for (const sx of [-0.16,0.16]){ const c = new THREE.Mesh(SH.canGeo, SH.canMat); c.position.set(sx,1.1,-0.3); cans.add(c); }
  }
  if (mods.armored){
    const helm = new THREE.Mesh(SH.helmGeo, SH.armorMat); helm.position.y = 0.2;
    const visor = new THREE.Mesh(SH.visorGeo, SH.visorMat); visor.position.set(0,0.01,0.235);
    head.add(helm, visor);
    const plate = new THREE.Mesh(SH.plateGeo, SH.armorMat); plate.position.set(0,1.14,0.22);
    const shield = new THREE.Mesh(SH.shieldGeo, SH.shieldMat); shield.position.set(0,1.12,0.76);
    const stripe = new THREE.Mesh(SH.stripeGeo, SH.stripeMat); stripe.position.y = 0.22; shield.add(stripe);
    b.add(plate, shield);
  }
  b.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(S.scale);
  return { g, b, mats, em, parts, head, legs:[l1,l2], arms:[a1,a2] };
}
// guard = stays near its spawn point (police station) and never despawns.
// exclude = a type this spawn may not roll (screams don't spawn more screamers).
// rise = seconds spent clawing out of the ground (invulnerable meanwhile); 0 = already standing.
export function spawnZombieAt(x,z,horde,alert,guard,exclude,rise = mr(RISE[0], RISE[1])){
  const lv = state.level, { type, mods } = rollThreat(!!guard, exclude);
  const S = ZTYPES[type], A = ZMODS.armored, m = createZombieMesh(type, mods);
  m.g.position.set(x,0,z); m.g.rotation.y = Math.random()*Math.PI*2;
  scene.add(m.g);
  const hp = S.hp * (1 + SCALE.hp*(lv-1));
  const zz = { type, mods, g:m.g, b:m.b, mats:m.mats, em:m.em, parts:m.parts, head:m.head, legs:m.legs, arms:m.arms, pos:m.g.position, vel:new THREE.Vector3(),
    hp, speed:mr(S.speed[0],S.speed[1])*(1+SCALE.speed*(lv-1))*(mods.armored ? A.speedMul : 1), r:S.r, dmg:S.dmg, bleed:S.bleed,
    kb:S.kb*(mods.armored ? A.kbMul : 1), atkCd:0, flash:0,
    horde, guard:!!guard, hx:x, hz:z, alert:!!alert || horde, wanderT:0, wx:0, wz:0, phase:Math.random()*6, groan:mr(3,10),
    dead:false, fuse:0, los:false, losT:Math.random()*0.2, windup:0, screamed:false, spitT:0, spitCd:mr(1,2.5), stun:0, side:Math.random() < 0.5 ? -1 : 1, rise, riseT:rise };
  if (mods.explosive) zz.warn = makeWarnRing();
  if (rise > 0){
    // Facing the player (if it's coming for them), buried up to the top of its head.
    if (zz.alert) m.g.rotation.y = Math.atan2(player.pos.x - x, player.pos.z - z);
    m.b.position.y = -RISE_DEPTH;
    addDecal(x, z, 1.3, SH.holeMat); burst(new THREE.Vector3(x, 0.2, z), 'dirt', 8, 2.5);
    if (Math.hypot(player.pos.x - x, player.pos.z - z) < 22) sfx.dig();
  }
  zombies.push(zz); if (horde) state.hordeAlive++;
  return zz;
}

// ---------- Rising from the ground ----------
const RISE = [1.1, 1.5], RISE_DEPTH = 1.95;
// Hunched forward and clawing at the dirt with alternating arms while the body pushes up.
function updateRise(z, dt){
  z.rise -= dt;
  if (z.rise <= 0){
    z.rise = 0; z.b.position.y = 0; z.b.rotation.set(0, 0, 0);
    burst(new THREE.Vector3(z.pos.x, 0.3, z.pos.z), 'dirt', 6, 2);
    return;
  }
  const k = 1 - z.rise/z.riseT, u = 1 - k, t = z.riseT - z.rise;
  z.b.position.y = -RISE_DEPTH*u**1.5;
  z.b.rotation.set(0.55*u, 0, Math.sin(t*14)*0.1*u);
  z.arms[0].rotation.x = -0.1 - 0.9*u + Math.sin(t*9)*0.4*u;
  z.arms[1].rotation.x = -0.1 - 0.9*u - Math.sin(t*9)*0.4*u;
  if (Math.random() < dt*14*u) burst(new THREE.Vector3(z.pos.x + mr(-0.4,0.4), 0.15, z.pos.z + mr(-0.4,0.4)), 'dirt', 2, 2);
}

// ---------- Explosive warning ring ----------
// Ground ring at the true blast radius: faint while it's hunting you, bright with a filling disc
// once the fuse is lit. Its own materials (opacity changes), disposed with the zombie.
function makeWarnRing(){
  const g = new THREE.Group(), mk = (geo, op) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color:0xff6a1a, transparent:true, opacity:op, depthWrite:false, side:THREE.DoubleSide }));
    m.rotation.x = -Math.PI/2; g.add(m); return m;
  };
  g.ring = mk(SH.blastRingGeo, 0.3); g.fill = mk(SH.blastFillGeo, 0.06);
  g.position.y = 0.13; g.visible = false; scene.add(g);
  return g;
}
function updateWarnRing(z, nd, t){
  const w = z.warn, E = ZMODS.explosive;
  w.visible = !z.dead && (z.fuse > 0 || (z.alert && nd < 14));
  if (!w.visible) return;
  w.position.x = z.pos.x; w.position.z = z.pos.z;
  if (z.fuse > 0){
    const k = 1 - z.fuse/E.fuse, blink = Math.floor(z.fuse*16) % 2;
    w.ring.scale.setScalar(E.radius); w.ring.material.opacity = blink ? 1 : 0.6;
    w.fill.scale.setScalar(Math.max(0.05, k)*E.radius); w.fill.material.opacity = 0.35;
  } else {
    w.ring.scale.setScalar(E.radius); w.ring.material.opacity = 0.28 + Math.sin(t*5)*0.1;
    w.fill.scale.setScalar(E.radius); w.fill.material.opacity = 0.05;
  }
}
// Random reachable tile whose distance from the player is within [minD, maxD].
export function findSpawnTile(minD, maxD){
  const g = world.city.grid;
  for (let i=0;i<70;i++){
    const tx = 1 + Math.floor(Math.random()*(N-3)), tz = 1 + Math.floor(Math.random()*(N-2));
    const id = tz*N+tx;
    if (!walkable(g[id]) || distField[id] < 0) continue;
    const wx = (tx+0.5)*TILE, wz = (tz+0.5)*TILE;
    const d = Math.hypot(wx-player.pos.x, wz-player.pos.z);
    if (d >= minD && d <= maxD) return { x:wx + mr(-0.4,0.4), z:wz + mr(-0.4,0.4) };
  }
  return null;
}
// Random reachable tile center minR..maxR from (x,z) (widening if crowded by buildings),
// at least 5 units from the player.
export function findSpawnNear(x, z, minR, maxR){
  const g = world.city.grid;
  for (let i=0;i<80;i++){
    const a = Math.random()*Math.PI*2, d = mr(minR, maxR + i*0.1);
    const tx = Math.floor((x + Math.sin(a)*d)/TILE), tz = Math.floor((z + Math.cos(a)*d)/TILE);
    if (tx < 1 || tz < 1 || tx >= N-1 || tz >= N-1) continue;
    const id = tz*N+tx;
    if (!walkable(g[id]) || distField[id] < 0) continue;
    const wx = (tx+0.5)*TILE + mr(-0.4,0.4), wz = (tz+0.5)*TILE + mr(-0.4,0.4);
    if (Math.hypot(wx-player.pos.x, wz-player.pos.z) >= 5) return { x:wx, z:wz };
  }
  return null;
}
export function disposeZombie(z){
  scene.remove(z.g); for (const m of z.mats) m.dispose();
  if (z.warn){ scene.remove(z.warn); z.warn.ring.material.dispose(); z.warn.fill.material.dispose(); }
}
// Alerts every unalerted zombie within r of (x,z).
export function makeNoise(x, z, r){
  for (const o of zombies) if (!o.alert && Math.hypot(o.pos.x-x, o.pos.z-z) < r) o.alert = true;
}
// cause = 'bullet' | 'melee' | 'blast' | 'fire' (fire is damage over time: no blood burst or hit
// sound); it also picks the death animation. (dx,dz) = hit direction and knockback.
// Armored zombies take frontMul damage from hits landing within frontArc of where they face.
// Returns true if the shield took the hit (bullets stop there instead of piercing).
// Zombies still rising out of the ground can't be hurt.
export function damageZombie(z, dmg, dx, dz, cause){
  if (z.dead || z.rise > 0) return false;
  const quiet = cause === 'fire';
  const A = ZMODS.armored, l = Math.hypot(dx,dz);
  const blocked = z.mods.armored && l > 0 && -(Math.sin(z.g.rotation.y)*dx + Math.cos(z.g.rotation.y)*dz)/l > Math.cos(A.frontArc);
  if (blocked) dmg *= A.frontMul;
  z.hp -= dmg; z.alert = true; z.flash = 0.08;
  for (const m of z.mats) m.emissive.setHex(quiet ? 0x804010 : blocked ? 0x2a3a55 : 0x663333);
  z.vel.x += dx*z.kb; z.vel.z += dz*z.kb;
  if (!quiet){
    if (blocked){ burst(new THREE.Vector3(z.pos.x - dx/l*0.8*z.g.scale.x, 1.2, z.pos.z - dz/l*0.8*z.g.scale.x), 'spark', 5, 3); sfx.clank(); }
    else { burst(new THREE.Vector3(z.pos.x, 1.2, z.pos.z), 'blood', 4, 3); sfx.hit(); }
  }
  if (z.hp <= 0) killZombie(z, true, cause, dx, dz, dmg);
  return blocked;
}
// Pipe-bomb concussion: frozen and swaying for t seconds; wind-ups (scream, spit) are interrupted.
export function stunZombie(z, t){
  if (z.dead || z.rise > 0) return;
  z.stun = Math.max(z.stun, t); z.alert = true; z.spitT = 0;
  if (z.windup > 0) cancelScream(z);
}
// credit = false for an exploder's own detonation: no kill counted, no drops.
// cause/dx/dz/dmg describe the killing blow (see damageZombie) and shape the corpse.
function killZombie(z, credit = true, cause, dx = 0, dz = 0, dmg = 0){
  z.dead = true;
  if (z.warn) z.warn.visible = false;
  const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i,1);
  if (z.horde) state.hordeAlive--;
  if (credit){ state.kills++; state.cityKills++; }
  addDecal(z.pos.x, z.pos.z);
  burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 'blood', 10, 4);
  for (const m of z.mats) m.emissive.setHex(0);
  if (z.type === 'screamer') cancelScream(z);
  if (z.mods.explosive) z.parts.cans.visible = false;
  // Exploders blow themselves apart too.
  dying.push(makeCorpse(z, z.mods.explosive ? 'blast' : cause, dx, dz, dmg));
  if (z.mods.explosive){
    const E = ZMODS.explosive;
    queueBlast(z.pos.x, z.pos.z, credit ? E.chain : 0, E.radius, E.dmgZombie, E.dmgPlayer);
  }
  if (!credit) return;
  // Health drops are rare on purpose: most healing comes from searching the city.
  const chance = 0.025 + (player.hp < player.maxHp*0.4 ? 0.03 : 0) + ZTYPES[z.type].heal;
  if (Math.random() < chance) spawnPickup(z.pos.x, z.pos.z);
  else if (Math.random() < 0.07) dropZombieAmmo(z.pos.x, z.pos.z);
}
export function updateZombies(dt){
  const p = player.pos, lure = world.lure, E = ZMODS.explosive, t = state.cityTime;
  SH.canMat.emissiveIntensity = 0.9 + Math.sin(t*6)*0.5;
  for (let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    const dx = p.x - z.pos.x, dz = p.z - z.pos.z, dist = Math.hypot(dx,dz) || 0.0001;
    if (z.rise > 0){ updateRise(z, dt); continue; }
    if (!z.alert && dist < 15) z.alert = true;
    if (!z.alert && !z.horde && !z.guard && dist > 62){ disposeZombie(z); zombies.splice(i,1); continue; }
    let desX = 0, desZ = 0, spd = z.speed, hold = false, mv = null;
    if (z.stun > 0) z.stun -= dt;
    const stunned = z.stun > 0;
    // Specials: a winding-up screamer roots in place; an alerted spitter picks its own spacing.
    if (stunned){}
    else if (z.type === 'screamer') hold = updateScreamer(z, dt, dist);
    else if (z.type === 'spitter') mv = updateSpitter(z, dt, dist, dx, dz);
    const lx = lure ? lure.x - z.pos.x : 0, lz = lure ? lure.z - z.pos.z : 0, ld = lure ? Math.hypot(lx,lz) : 1e9;
    if (hold || stunned){}
    else if (mv){ desX = mv[0]; desZ = mv[1]; spd *= mv[2]; }
    else if (z.alert && ld < 32 && dist > 3.5){
      // A beeping pipe bomb pulls alerted zombies off the player.
      if (ld > 0.9){ desX = lx/ld; desZ = lz/ld; }
    } else if (z.alert){
      if (dist < 4.5){ desX = dx/dist; desZ = dz/dist; }
      else {
        // Step toward the neighbouring tile with the lowest flow-field distance.
        const tx = Math.floor(z.pos.x/TILE), tz = Math.floor(z.pos.z/TILE);
        let best = (tx>=0&&tz>=0&&tx<N&&tz<N) ? distField[tz*N+tx] : -1, bx = -1, bz = -1;
        for (const [ox,oz] of DIRS8){
          const nx = tx+ox, nz = tz+oz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const d = distField[nz*N+nx]; if (d < 0) continue;
          if (ox !== 0 && oz !== 0 && (isBlockedTile(tx+ox,tz) || isBlockedTile(tx,tz+oz))) continue;
          if (best < 0 || d < best){ best = d; bx = nx; bz = nz; }
        }
        if (bx >= 0){ const ax = (bx+0.5)*TILE - z.pos.x, az = (bz+0.5)*TILE - z.pos.z, l = Math.hypot(ax,az) || 1; desX = ax/l; desZ = az/l; }
        else { desX = dx/dist; desZ = dz/dist; }
      }
    } else {
      z.wanderT -= dt;
      if (z.wanderT <= 0){
        const a = Math.random()*Math.PI*2;
        const hx = z.hx - z.pos.x, hz = z.hz - z.pos.z, hd = Math.hypot(hx,hz);
        if (z.guard && hd > 6){ z.wx = hx/hd; z.wz = hz/hd; }
        else if (Math.random() < 0.35){ z.wx = 0; z.wz = 0; } else { z.wx = Math.sin(a); z.wz = Math.cos(a); }
        z.wanderT = mr(2,4);
      }
      desX = z.wx; desZ = z.wz; spd *= 0.3;
    }
    // Separation from other zombies
    let sx = 0, sz = 0;
    for (const o of zombies){
      if (o === z) continue;
      const ox = z.pos.x - o.pos.x, oz = z.pos.z - o.pos.z, rr = z.r + o.r, d2 = ox*ox + oz*oz;
      if (d2 < rr*rr && d2 > 1e-6){ const d = Math.sqrt(d2), f = (rr-d)/rr; sx += ox/d*f; sz += oz/d*f; }
    }
    desX += sx*1.6; desZ += sz*1.6;
    const k = Math.min(1, dt*6);
    z.vel.x += (desX*spd - z.vel.x)*k; z.vel.z += (desZ*spd - z.vel.z)*k;
    z.pos.x += z.vel.x*dt; z.pos.z += z.vel.z*dt;
    const minD = z.r + player.radius;
    const ndx = p.x - z.pos.x, ndz = p.z - z.pos.z, nd = Math.hypot(ndx,ndz);
    if (nd < minD && nd > 1e-4){ z.pos.x = p.x - ndx/nd*minD; z.pos.z = p.z - ndz/nd*minD; }
    resolveCircle(z.pos, z.r);
    const vl = Math.hypot(z.vel.x, z.vel.z);
    if (stunned){}
    else if (hold || mv) z.g.rotation.y = lerpAngle(z.g.rotation.y, Math.atan2(dx, dz), Math.min(1, dt*8));
    else if (vl > 0.2) z.g.rotation.y = lerpAngle(z.g.rotation.y, Math.atan2(z.vel.x, z.vel.z), Math.min(1, dt*8));
    z.phase += dt*(vl*2.4 + 0.5);
    const sw = Math.sin(z.phase)*0.6*Math.min(1, vl/1.5);
    z.legs[0].rotation.x = sw; z.legs[1].rotation.x = -sw;
    z.arms[0].rotation.x = -0.1 + Math.sin(z.phase*0.5)*0.15; z.arms[1].rotation.x = -0.1 - Math.sin(z.phase*0.5+1)*0.15;
    z.b.rotation.z = Math.sin(z.phase*0.5)*0.06;
    z.atkCd -= dt;
    if (nd < minD + 0.35 && z.atkCd <= 0 && !stunned){ z.atkCd = 1.0; hurtPlayer(z.dmg, z); if (state.mode !== 'play') return; }
    if (z.flash > 0){ z.flash -= dt; if (z.flash <= 0) z.mats.forEach((m,j) => m.emissive.setHex(z.em[j])); }
    if (z.mods.explosive){
      // Arms a short fuse next to the player, blinking white, then detonates.
      if (!z.fuse && !stunned && nd < minD + E.trigger){ z.fuse = E.fuse; sfx.fuse(); }
      if (z.fuse > 0){
        z.fuse -= dt;
        z.mats[0].emissive.setHex(Math.floor(z.fuse*16) % 2 ? 0xffffff : 0xff5000); z.mats[0].emissiveIntensity = 2;
        if (z.fuse <= 0){ killZombie(z, false, 'blast'); continue; }
      } else z.mats[0].emissiveIntensity = 0.8 + Math.sin(t*6 + z.phase)*0.5;
      updateWarnRing(z, nd, t);
    }
    poseSpecial(z);
    if (stunned){
      // Dazed: slow drunken sway, arms hanging, the odd spark above the head.
      z.b.rotation.z = Math.sin(t*7 + z.phase)*0.2; z.b.rotation.x = 0.15;
      z.arms[0].rotation.x = z.arms[1].rotation.x = 0.3;
      if (Math.random() < dt*4) burst(new THREE.Vector3(z.pos.x, 2.1*z.g.scale.y, z.pos.z), 'spark', 1, 0.8);
    } else if (z.stun < 0){ z.stun = 0; z.b.rotation.x = 0; }
    if (z.alert){ z.groan -= dt; if (z.groan <= 0){ z.groan = mr(5,11); if (dist < 14) sfx.groan(); } }
  }
}

// ---------- Death ----------
// Corpses ragdoll over in the direction of the killing blow, limbs flopping loose. Sometimes a
// limb or the head tears off and tumbles away (more likely from heavy hits); blasts tear the whole
// body apart and fling the pieces. Everything lies on the ground for a while, then sinks away.
// Detached pieces (gibs) are moved to the scene but keep the zombie's materials, so they are
// removed together with the corpse in disposeCorpse().
const FALL = 0.5, LIE = [2.5, 4], SINK = 1.2, GRAV = 20, tmpV = new THREE.Vector3(), tmpBox = new THREE.Box3();
const ease = x => x*x*(3 - 2*x);
function addGib(d, m, vx, vy, vz, spin){
  scene.attach(m);
  d.gibs.push({ m, vx, vy, vz, sx:mr(-spin,spin), sy:mr(-spin,spin), sz:mr(-spin,spin), rest:false, bled:false });
}
function makeCorpse(z, cause, dx, dz, dmg){
  const d = { z, t:0, gibs:[], lie:mr(LIE[0], LIE[1]), vx:z.vel.x, vz:z.vel.z, spurt:0, blast:cause === 'blast' };
  let l = Math.hypot(dx, dz), ux, uz;
  if (l > 0.01){ ux = dx/l; uz = dz/l; } else { const a = Math.random()*Math.PI*2; ux = Math.sin(a); uz = Math.cos(a); }
  z.b.position.y = 0; z.g.updateMatrixWorld(true);
  if (d.blast){
    // Every visible piece flies outward from the body and along the blast, spinning.
    for (const m of z.b.children.slice()){
      if (!m.visible) continue;
      m.getWorldPosition(tmpV);
      const ox = tmpV.x - z.pos.x, oz = tmpV.z - z.pos.z, s = mr(3,7);
      addGib(d, m, ux*s + ox*5 + mr(-2.5,2.5), mr(5,10), uz*s + oz*5 + mr(-2.5,2.5), 16);
    }
    burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 'blood', 18, 7);
    for (let i=0;i<3;i++) addDecal(z.pos.x + mr(-1.2,1.2), z.pos.z + mr(-1.2,1.2), mr(0.8,1.3));
    return d;
  }
  // Fall so the head lands along the hit direction: on its back if that's behind it, otherwise
  // face down (whichever needs less twist).
  let yaw = Math.atan2(-ux, -uz) - z.g.rotation.y + mr(-0.4,0.4);
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  d.dir = -1;
  if (Math.abs(yaw) > Math.PI/2){ yaw = Math.atan2(Math.sin(yaw - Math.PI), Math.cos(yaw - Math.PI)); d.dir = 1; }
  d.yaw = yaw; z.b.rotation.order = 'YXZ'; z.b.rotation.set(0, 0, 0);
  // Limbs flop toward a random sprawl.
  const limbs = [z.arms[0], z.arms[1], z.legs[0], z.legs[1], z.head];
  d.flop = limbs.map((m, i) => ({ m, x0:m.rotation.x, z0:m.rotation.z,
    x1:i < 2 ? mr(-1.4,0.6) : i < 4 ? mr(-0.5,0.5) : mr(-0.6,0.6), z1:i < 2 ? (i ? -1 : 1)*mr(0.3,1.3) : i < 4 ? (i === 2 ? 1 : -1)*mr(0,0.45) : mr(-0.7,0.7) }));
  if (cause === 'fire') d.vx = d.vz = 0;
  const lose = cause === 'fire' ? 0 : 0.28 + (dmg >= 3 ? 0.35 : 0) + (cause === 'melee' ? 0.1 : 0);
  if (Math.random() < lose){
    // Lose one or two pieces: arms most often, then the head, rarely a leg.
    const pool = [[0,3],[1,3],[4,2],[2,1],[3,1]], n = Math.random() < 0.3 ? 2 : 1;
    for (let k=0;k<n;k++){
      let r = Math.random()*pool.reduce((s, e) => s + e[1], 0), pick = 0;
      for (let j=0;j<pool.length;j++){ r -= pool[j][1]; if (r <= 0){ pick = j; break; } }
      const m = limbs[pool[pick][0]]; pool.splice(pick, 1);
      const s = mr(1.5,3.5);
      addGib(d, m, ux*s + mr(-1.5,1.5), mr(2.5,5), uz*s + mr(-1.5,1.5), 9);
      d.flop = d.flop.filter(f => f.m !== m);
    }
    d.spurt = 0.8;
    burst(new THREE.Vector3(z.pos.x, 1.3, z.pos.z), 'blood', 10, 4);
  }
  return d;
}
function updateGib(p, dt){
  const m = p.m, pos = m.position;
  p.vy -= GRAV*dt;
  const nx = pos.x + p.vx*dt, nz = pos.z + p.vz*dt;
  // Bounce off buildings instead of flying through them.
  if (isBlockedTile(Math.floor(nx/TILE), Math.floor(pos.z/TILE))) p.vx *= -0.4; else pos.x = nx;
  if (isBlockedTile(Math.floor(pos.x/TILE), Math.floor(nz/TILE))) p.vz *= -0.4; else pos.z = nz;
  pos.y += p.vy*dt;
  m.rotation.x += p.sx*dt; m.rotation.y += p.sy*dt; m.rotation.z += p.sz*dt;
  if (Math.random() < dt*18) burst(pos, 'blood', 1, 0.6);
  if (pos.y > 0.2) return;
  pos.y = 0.2;
  if (!p.bled){ p.bled = true; addDecal(pos.x, pos.z, mr(0.4,0.7)); }
  if (p.vy < -3){ p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; p.sx *= 0.5; p.sy *= 0.5; p.sz *= 0.5; return; }
  // Settle flat on a face and rest on the ground.
  p.rest = true;
  const snap = a => Math.round(a/(Math.PI/2))*(Math.PI/2);
  m.rotation.set(Math.random() < 0.5 ? 0 : Math.PI, m.rotation.y, snap(m.rotation.z));
  m.updateMatrixWorld(true); tmpBox.setFromObject(m); pos.y += 0.09 - tmpBox.min.y;
}
export function disposeCorpse(d){ for (const p of d.gibs) scene.remove(p.m); disposeZombie(d.z); }
export function updateDying(dt){
  for (let i=dying.length-1;i>=0;i--){
    const d = dying[i], z = d.z; d.t += dt;
    for (const p of d.gibs) if (!p.rest) updateGib(p, dt);
    if (!d.blast){
      // Topple with gravity, a small bounce on impact, sliding along with the hit's momentum.
      const k = Math.min(1, d.t/FALL), bounce = d.t > FALL && d.t < FALL + 0.3 ? Math.sin((d.t - FALL)/0.3*Math.PI)*0.14 : 0;
      z.b.rotation.y = d.yaw*ease(Math.min(1, d.t/(FALL*0.7)));
      z.b.rotation.x = d.dir*(Math.PI/2*k*k - bounce);
      if (d.t < d.lie) z.b.position.y = 0.2*k;
      for (const f of d.flop){ const e = ease(k); f.m.rotation.x = f.x0 + (f.x1 - f.x0)*e; f.m.rotation.z = f.z0 + (f.z1 - f.z0)*e; }
      const damp = Math.exp(-5*dt); d.vx *= damp; d.vz *= damp;
      z.pos.x += d.vx*dt; z.pos.z += d.vz*dt; resolveCircle(z.pos, 0.3);
      if (d.spurt > 0){
        d.spurt -= dt;
        if (Math.random() < dt*30){ z.b.getWorldPosition(tmpV); burst(tmpV.set(tmpV.x, 0.6 + 0.6*(1-k), tmpV.z), 'blood', 1, 1.5); }
      }
    }
    if (d.t > d.lie){
      const s = (d.t - d.lie)/SINK;
      z.b.position.y = 0.2 - 0.8*s;
      for (const p of d.gibs) if (p.rest) p.m.position.y -= dt*0.5;
      if (s >= 1){ disposeCorpse(d); dying.splice(i,1); }
    }
  }
}
