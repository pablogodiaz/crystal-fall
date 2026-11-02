// ---------- Zombies ----------
// Spawning, senses (sight, hearing, memory, home leash), steering, damage and death.
// Type/modifier/AI numbers live in threats.js; screamer and spitter behaviour in specials.js.
import * as THREE from 'three';
import { TILE, N, DIRS8, walkable, BREAKABLES } from './config.js';
import { mr, lerpAngle } from './utils.js';
import { scene } from './renderer.js';
import { SH } from './assets.js';
import { state, world, zombies, dying, dev, players, net } from './state.js';
import { reachable, isBlockedTile, resolveCircle, lineOfSight, flowTo, groundAt, levelOf, walkClear } from './grid.js';
import { breakAhead, hitBreak } from './breakables.js';
import { viewed, nearestPlayer, nearestDist, cheats, capParts } from './player.js';
import { hurtPlayer } from './combat.js';
import { burst, addDecal, spawnPickup } from './fx.js';
import { dropZombieAmmo } from './loot.js';
import { queueBlast } from './throwables.js';
import { rollThreat, updateScreamer, cancelScream, updateSpitter, poseSpecial } from './specials.js';
import { ZTYPES, ZMODS, SCALE, CRYSTAL, AI, VAULT } from './threats.js';
import { WEAPONS, SPECIALS } from './items.js';
import { sfx, playSfx } from './audio.js';
import { emit, nextId } from './host.js';
import { isBurning, shrapnelBurst } from './uniques.js';

const SHIRTS = [0x6b4a3a,0x4a5a6b,0x5a5a4a,0x7a3a3a,0x3a4a3a,0x6a6a72,0x8a7a5a];
// Base body plus the visual tell of its type (screamer mouth, spitter sac) and each modifier
// (explosive canisters + orange glow, riot helmet/vest/shield). em = resting emissive per material.
export function createZombieMesh(type, mods){
  const S = ZTYPES[type];
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
  const bodyMat = new THREE.MeshStandardMaterial({ color:SHIRTS[Math.floor(Math.random()*SHIRTS.length)], roughness:0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color:S.skin, roughness:0.8 });
  const mats = [bodyMat, skinMat], em = [0, 0], parts = {};
  const body = new THREE.Mesh(SH.zBody, bodyMat); body.position.y = 1.03;
  const head = new THREE.Mesh(SH.zHead, skinMat); head.position.set(0,1.68,0.06);
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
  // '?' / '!' over the head when it hears something or spots you.
  const mark = new THREE.Sprite(SH.markMats.heard); mark.position.y = 2.6; mark.visible = false; g.add(mark);
  g.scale.setScalar(S.scale);
  return { g, b, mats, em, parts, head, legs:[l1,l2], arms:[a1,a2], mark };
}
// horde = part of the takeover (always knows where you are). alert = starts out hunting you.
// guard = 'police' | 'shop' | 'cell': stays close to its spawn point (short leash; police guards
// roll riot gear more often). Everyone else lives in its district: home = its spawn point.
// exclude = a type this spawn may not roll (screams don't spawn more screamers).
// rise = seconds spent clawing out of the ground (invulnerable meanwhile); 0 = already standing.
// kind = { type, mods, look } instead of a roll (a player who turned: look = their jacket colour).
export function spawnZombieAt(x,z,horde,alert,guard,exclude,rise = mr(RISE[0], RISE[1]),kind){
  const lv = state.level, { type, mods } = kind || rollThreat(guard === 'police', exclude);
  const S = ZTYPES[type], A = ZMODS.armored, m = createZombieMesh(type, mods);
  m.g.position.set(x, groundAt(x, z), z); m.g.rotation.y = Math.random()*Math.PI*2;
  scene.add(m.g);
  const hp = S.hp * (1 + SCALE.hp*(lv-1));
  const zz = { type, mods, g:m.g, b:m.b, mats:m.mats, em:m.em, parts:m.parts, head:m.head, legs:m.legs, arms:m.arms, pos:m.g.position, vel:new THREE.Vector3(),
    hp, speed:mr(S.speed[0],S.speed[1])*(1+SCALE.speed*(lv-1))*(mods.armored ? A.speedMul : 1), r:S.r, dmg:S.dmg, bleed:S.bleed,
    kb:S.kb*(mods.armored ? A.kbMul : 1), atkCd:0, flash:0,
    horde, guard:!!guard, hx:x, hz:z, leash:guard ? AI.guardLeash : AI.leash, wanderT:0, wx:0, wz:0, phase:Math.random()*6, groan:mr(3,10),
    // Senses (see the Senses section): mode, last known target lx/lz, memory left, sight, path.
    // tgt = the player it's after (hunting), lx/lz = where it thinks they are.
    mode:'idle', alert:false, tracked:false, tgt:null, lx:x, lz:z, mem:0, sees:false, direct:false, percT:Math.random()*0.25, searchT:0, giveUp:0, fk:-1, ff:null,
    mark:m.mark, markT:0,
    turned:0, foe:null, foeT:0, chill:0, frozen:0, ice:null, dead:false, fuse:0, los:false, losT:Math.random()*0.2, windup:0, screamed:false, spitT:0, spitCd:mr(1,2.5), stun:0, side:Math.random() < 0.5 ? -1 : 1, rise, riseT:rise,
    nid:nextId(), hp0:hp, look:kind && kind.look !== undefined ? kind.look : null };
  if (zz.look !== null) applyLook(zz, zz.look);
  const t = (alert || horde) && nearestPlayer(x, z);
  if (t) Object.assign(zz, { mode:'hunt', alert:true, mem:AI.memory, tgt:t, lx:t.pos.x, lz:t.pos.z, tracked:!!horde });
  if (mods.explosive) zz.warn = makeWarnRing();
  if (rise > 0){
    // Facing the player it's coming for (if any), buried up to the top of its head.
    if (t) m.g.rotation.y = Math.atan2(t.pos.x - x, t.pos.z - z);
    m.b.position.y = -RISE_DEPTH;
    addDecal(x, z, 1.3, SH.holeMat); burst(new THREE.Vector3(x, 0.2, z), 'dirt', 8, 2.5);
    const v = viewed(); if (v && Math.hypot(v.pos.x - x, v.pos.z - z) < 22) playSfx('dig');
  }
  zombies.push(zz); if (horde) state.hordeAlive++;
  emit(spawnEvent(zz));
  return zz;
}
// What a client needs to build its copy of z (mirrorSpawn).
export const spawnEvent = z => ['z+', z.nid, z.type, Object.keys(z.mods), Math.round(z.pos.x*100)/100, Math.round(z.pos.z*100)/100,
  Math.round(z.g.rotation.y*100)/100, Math.round(z.rise*100)/100, Math.round(z.riseT*100)/100, z.look];
// A turned player's look: their jacket on the body, their cap on the head.
function applyLook(z, hex){
  z.mats[0].color.setHex(hex);
  const [geo, mat] = capParts(), cap = new THREE.Mesh(geo, mat); cap.position.set(0, 0.27, -0.02); cap.castShadow = true; z.head.add(cap);
}
// A player who dies gets back up as one of them: a walker in their jacket and cap, swaying a moment first.
export function spawnTurnedPlayer(p){
  const z = spawnZombieAt(p.pos.x, p.pos.z, false, false, false, null, 0, { type:'walker', mods:{}, look:p.mats[0].color.getHex() });
  z.g.rotation.y = p.angle;
  z.stun = 1.8; z.fromPlayer = p.name;
  burst(new THREE.Vector3(p.pos.x, 1.2, p.pos.z), 'blood', 14, 3);
  return z;
}

// ---------- Rising from the ground ----------
const RISE = [1.1, 1.5], RISE_DEPTH = 1.95;
// Hunched forward and clawing at the dirt with alternating arms while the body pushes up.
function updateRise(z, dt){
  z.rise -= dt;
  if (z.rise <= 0){
    z.rise = 0; z.b.position.y = 0; z.b.rotation.set(0, 0, 0);
    burst(new THREE.Vector3(z.pos.x, 0.3, z.pos.z), 'dirt', 6, 2, true);
    return;
  }
  const k = 1 - z.rise/z.riseT, u = 1 - k, t = z.riseT - z.rise;
  z.b.position.y = -RISE_DEPTH*u**1.5;
  z.b.rotation.set(0.55*u, 0, Math.sin(t*14)*0.1*u);
  z.arms[0].rotation.x = -0.1 - 0.9*u + Math.sin(t*9)*0.4*u;
  z.arms[1].rotation.x = -0.1 - 0.9*u - Math.sin(t*9)*0.4*u;
  if (Math.random() < dt*14*u) burst(new THREE.Vector3(z.pos.x + mr(-0.4,0.4), 0.15, z.pos.z + mr(-0.4,0.4)), 'dirt', 2, 2, true);
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
// Random tile minD..maxD from a random living player that they can walk to, and at least minD from
// everyone (so it never pops up next to someone else), or null. Spawns spread over the players, so a
// group standing together draws all of them.
export function findSpawnTile(minD, maxD){
  const g = world.city.grid, alive = players.filter(p => !p.dead);
  if (!alive.length) return null;
  for (let i=0;i<80;i++){
    const p = alive[Math.floor(Math.random()*alive.length)], a = Math.random()*Math.PI*2, d = mr(minD, maxD);
    const tx = Math.floor((p.pos.x + Math.sin(a)*d)/TILE), tz = Math.floor((p.pos.z + Math.cos(a)*d)/TILE);
    if (tx < 1 || tz < 1 || tx >= N-2 || tz >= N-1) continue;
    const id = tz*N+tx;
    if (!walkable(g[id]) || p.dist[id] < 0) continue;
    const wx = (tx+0.5)*TILE + mr(-0.4,0.4), wz = (tz+0.5)*TILE + mr(-0.4,0.4);
    if (nearestDist(wx, wz) >= minD*0.9) return { x:wx, z:wz };
  }
  return null;
}
// Random reachable tile in block b's patch (the block plus the roads north and west of it), at
// least minD from every player, or null.
export function findBlockTile(b, minD){
  const g = world.city.grid;
  for (let i=0;i<25;i++){
    const tx = b.x0 - 2 + Math.floor(Math.random()*7), tz = b.z0 - 2 + Math.floor(Math.random()*7), id = tz*N+tx;
    if (tx < 1 || tz < 1 || tx >= N-2 || tz >= N-1 || !walkable(g[id]) || !reachable(id)) continue;
    const wx = (tx+0.5)*TILE + mr(-0.4,0.4), wz = (tz+0.5)*TILE + mr(-0.4,0.4);
    if (nearestDist(wx, wz) >= minD) return { x:wx, z:wz };
  }
  return null;
}
// Random reachable tile center minR..maxR from (x,z) (widening if crowded by buildings),
// at least 5 units from every player.
export function findSpawnNear(x, z, minR, maxR){
  const g = world.city.grid;
  for (let i=0;i<80;i++){
    const a = Math.random()*Math.PI*2, d = mr(minR, maxR + i*0.1);
    const tx = Math.floor((x + Math.sin(a)*d)/TILE), tz = Math.floor((z + Math.cos(a)*d)/TILE);
    if (tx < 1 || tz < 1 || tx >= N-1 || tz >= N-1) continue;
    const id = tz*N+tx;
    if (!walkable(g[id]) || !reachable(id)) continue;
    const wx = (tx+0.5)*TILE + mr(-0.4,0.4), wz = (tz+0.5)*TILE + mr(-0.4,0.4);
    if (nearestDist(wx, wz) >= 5) return { x:wx, z:wz };
  }
  return null;
}
export function disposeZombie(z){
  scene.remove(z.g); for (const m of z.mats) m.dispose();
  if (z.warn){ scene.remove(z.warn); z.warn.ring.material.dispose(); z.warn.fill.material.dispose(); }
}
// ---------- Senses ----------
// mode: 'idle' -> 'search' (heard something) -> 'hunt' (saw you / got hit) -> 'search' (lost you)
// -> 'return' (walks home) -> 'idle'. Numbers and the full rules are with AI in threats.js.
const MARK_T = 1.3;
function setMode(z, m){ z.mode = m; z.alert = m === 'hunt'; }
function mark(z, kind){ z.mark.material = SH.markMats[kind]; z.markT = MARK_T; z.mark.visible = true; }
function updateMark(z, dt){
  if (z.markT <= 0) return;
  z.markT -= dt;
  const k = MARK_T - z.markT;
  z.mark.scale.setScalar(0.8*Math.min(1, k*8)*(1 + Math.max(0, 0.2 - k)*2));
  if (z.markT <= 0) z.mark.visible = false;
}
// It knows exactly where player p is (it saw them, got hit by them, heard a scream); without p, the
// living player nearest to it. tracked = keeps knowing without needing sight (the takeover).
export function alertZombie(z, tracked, p){
  if (z.dead || z.turned > 0) return;
  if (!p || p.dead) p = nearestPlayer(z.pos.x, z.pos.z);
  if (!p) return;
  if (z.mode !== 'hunt') mark(z, 'spotted');
  setMode(z, 'hunt'); z.mem = AI.memory; z.tgt = p; z.lx = p.pos.x; z.lz = p.pos.z;
  if (tracked) z.tracked = true;
}
// Everything within r of (x,z) learns where p is (screams), or where its nearest player is (the Crystal's pulse).
export function alertNear(x, z, r, p){ for (const o of zombies) if (Math.hypot(o.pos.x-x, o.pos.z-z) < r) alertZombie(o, false, p); }
// Players zombies can perceive and attack (dev tools: "ignored by zombies" hides the one you control).
const ignored = p => dev.ignored && cheats(p);
function nearestHuntable(x, z){
  let best = null, bd = Infinity;
  for (const p of players){ if (p.dead || ignored(p)) continue; const d = (p.pos.x - x)**2 + (p.pos.z - z)**2; if (d < bd){ bd = d; best = p; } }
  return best;
}
// A sound at (x,z) heard within r (only within muffle*r through walls). Hunters that lost sight of
// you take it as your new position; everyone else walks over to look. Noises far from a zombie's
// home are ignored unless forced (pipe-bomb beeps).
export function makeNoise(x, z, r, force){
  if (net.role === 'client') return;  // clients only mirror zombies (a predicted sprint step lands here)
  for (const o of zombies){
    if (o.dead || o.tracked || o.turned > 0 || (o.mode === 'hunt' && o.sees)) continue;
    const d = Math.hypot(o.pos.x-x, o.pos.z-z);
    if (d >= r || (d > r*AI.muffle && !lineOfSight(o.pos.x, o.pos.z, x, z))) continue;
    if (o.mode === 'hunt'){ o.lx = x; o.lz = z; o.mem = Math.max(o.mem, AI.memory*0.6); o.percT = 0; continue; }
    if (!force && Math.hypot(x - o.hx, z - o.hz) > o.leash*AI.noiseLeash) continue;
    if (o.mode !== 'search' || Math.hypot(x - o.lx, z - o.lz) > 4) mark(o, 'heard');
    setMode(o, 'search'); o.lx = x; o.lz = z; o.searchT = AI.search; o.giveUp = AI.giveUp; o.percT = 0;
  }
}
// Sight, a few times a second: idle and searching zombies only notice a player in front of them (or
// right next to them); hunters keep track further out. Out past its leash, a hunter's memory only
// refreshes while its player is within closeR, and one walking home ignores everyone unless they
// come that close (so it doesn't turn round at the edge of its turf). With several players in view
// it goes for the nearest. Also decides whether the current target can be walked to in a straight
// line or needs a flow field.
function perceive(z){
  const hunt = z.mode === 'hunt', away = Math.hypot(z.pos.x - z.hx, z.pos.z - z.hz) > z.leash;
  const range = hunt ? AI.sightHunt : z.mode === 'return' && away ? AI.closeR : AI.sight;
  let see = null, sd = range;
  for (const p of players){
    if (p.dead || ignored(p)) continue;
    const dx = p.pos.x - z.pos.x, dz = p.pos.z - z.pos.z, dist = Math.hypot(dx, dz);
    if (dist >= sd) continue;
    const off = Math.abs(((Math.atan2(dx, dz) - z.g.rotation.y) % (Math.PI*2) + Math.PI*3) % (Math.PI*2) - Math.PI);
    if ((hunt || dist < AI.feel || off < AI.cone) && lineOfSight(z.pos.x, z.pos.z, p.pos.x, p.pos.z)){ see = p; sd = dist; }
  }
  z.sees = !!see;
  if (see && !hunt) alertZombie(z, false, see);
  else if (see){ z.tgt = see; z.lx = see.pos.x; z.lz = see.pos.z; if (!away || sd < AI.closeR) z.mem = AI.memory; }
  if (z.mode !== 'idle' && !see){
    const ret = z.mode === 'return', tx = ret ? z.hx : z.lx, tz = ret ? z.hz : z.lz;
    z.direct = Math.hypot(tx - z.pos.x, tz - z.pos.z) < 30 && lineOfSight(z.pos.x, z.pos.z, tx, tz) && walkClear(z.pos.x, z.pos.z, tx, tz, z.pos.y);
  }
}
// Memory and patience: hunters forget you (fast once far from home), searchers give up, and
// everyone ends up walking back to their own district.
function think(z, dt, dist){
  const home = Math.hypot(z.pos.x - z.hx, z.pos.z - z.hz);
  const goHome = () => { setMode(z, 'return'); z.giveUp = AI.giveUp*2; z.percT = 0; };
  if (z.mode === 'hunt'){
    const away = home > z.leash;
    if (!z.sees || (away && dist > AI.closeR)) z.mem -= dt*(away ? 3 : 1);
    if (z.mem > 0) return;
    if (away) goHome();
    else { setMode(z, 'search'); z.searchT = AI.search; z.giveUp = AI.giveUp; mark(z, 'heard'); }
  } else if (z.mode === 'search'){
    z.giveUp -= dt;
    if (Math.hypot(z.lx - z.pos.x, z.lz - z.pos.z) < 2.2) z.searchT -= dt;
    if (z.searchT <= 0 || z.giveUp <= 0) goHome();
  } else if (z.mode === 'return'){
    z.giveUp -= dt;
    if (home < 3) setMode(z, 'idle');
    else if (z.giveUp <= 0){ z.hx = z.pos.x; z.hz = z.pos.z; setMode(z, 'idle'); }  // can't get home: settle here
  }
}
// Step toward the neighbouring tile with the lowest value in a flow field (null if none is lower).
// z = anything with a pos (bots.js uses it to follow players).
// Never toward a raised tile it can't climb onto (fields only lead up ramps, but a neighbour up a
// ledge can still score lower).
export function descend(z, f){
  const tx = Math.floor(z.pos.x/TILE), tz = Math.floor(z.pos.z/TILE), L = world.city.level, lv = levelOf(z.pos.y);
  let best = (tx>=0&&tz>=0&&tx<N&&tz<N) ? f[tz*N+tx] : -1, bx = -1, bz = -1;
  for (const [ox,oz] of DIRS8){
    const nx = tx+ox, nz = tz+oz;
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
    const d = f[nz*N+nx]; if (d < 0) continue;
    if (L && L[nz*N+nx] > lv + 1) continue;
    if (ox !== 0 && oz !== 0 && (isBlockedTile(tx+ox,tz) || isBlockedTile(tx,tz+oz))) continue;
    if (best < 0 || d < best){ best = d; bx = nx; bz = nz; }
  }
  if (bx < 0) return null;
  const ax = (bx+0.5)*TILE - z.pos.x, az = (bz+0.5)*TILE - z.pos.z, l = Math.hypot(ax,az) || 1;
  return [ax/l, az/l];
}
// Direction toward (x,tz): straight there when it's in plain view, otherwise down a flow field.
function steerTo(z, x, tz){
  const ax = x - z.pos.x, az = tz - z.pos.z, l = Math.hypot(ax, az) || 1;
  if (z.direct || l < 2.5) return [ax/l, az/l];
  const fx = Math.floor(x/TILE), fz = Math.floor(tz/TILE);
  if (z.fk !== fz*N + fx){ z.fk = fz*N + fx; z.ff = flowTo(fx, fz); }
  return descend(z, z.ff) || [ax/l, az/l];
}
// Ambling around (cx,cz): a new random heading (or a pause) every few seconds, back toward the
// center once further than R from it.
function wander(z, dt, cx, cz, R){
  z.wanderT -= dt;
  if (z.wanderT <= 0){
    const hx = cx - z.pos.x, hz = cz - z.pos.z, hd = Math.hypot(hx,hz), a = Math.random()*Math.PI*2;
    if (hd > R){ z.wx = hx/hd; z.wz = hz/hd; }
    else if (Math.random() < 0.35){ z.wx = 0; z.wz = 0; } else { z.wx = Math.sin(a); z.wz = Math.cos(a); }
    z.wanderT = mr(2,4);
  }
  return [z.wx, z.wz];
}
// ---------- Turned (Turncoat flask) ----------
// A turned zombie glows pink with a ♥ over its head and, for z.turned seconds, hunts the nearest
// other zombie (z.foe) instead of you: it can't hurt you, your bullets, melee, fire and lightning pass
// it by (blasts still don't care). With nobody to fight it tags along near you. A zombie it bites
// fights back (foe = the biter, for foeT seconds). Afterwards it forgets everything and walks home.
const TURN_EM = 0x7a1a68, ICE_EM = 0x2a6aa8;
// Emissive override (turned pink, frozen blue); null restores the zombie's resting glow.
function setGlow(z, hex){
  if (hex !== null){ if (!z.em0) z.em0 = z.em.slice(); z.em = z.em0.map(() => hex); }
  else if (z.em0){ z.em = z.em0; z.em0 = null; }
  z.mats.forEach((m, j) => m.emissive.setHex(z.em[j]));
}
// o = the flask's specials: { by (thrower, for kill credit), contagion, poison }.
export function turnZombie(z, t, o){
  if (z.dead) return;
  z.turnBy = o && o.by || null; z.contagion = !!(o && o.contagion); z.poison = !!(o && o.poison);
  if (z.frozen > 0) thaw(z);
  if (!(z.turned > 0)) setGlow(z, TURN_EM);
  z.turned = t; z.foe = null; z.foeT = 0; z.fuse = 0; z.spitT = 0; z.stun = 0;
  if (z.windup > 0) cancelScream(z);
  setMode(z, 'idle'); z.sees = false;
  z.mark.material = SH.markMats.turned; z.mark.scale.setScalar(0.7); z.mark.visible = true; z.markT = 0;
}
function unturn(z){
  z.turned = 0; z.foe = null; z.mark.visible = false;
  setGlow(z, null);
  setMode(z, 'return'); z.giveUp = AI.giveUp*2;
}

// ---------- Frozen (Cryo sprayer) ----------
// Frost chills a zombie (z.chill 0..1, slower by up to WEAPONS.cryo.slow; it wears off by `thaw`/s).
// At 1 it freezes solid for `freeze` s inside a block of ice: no moving, attacking or fuses, and the
// next hit of any kind shatters it (fire thaws it instead).
export function chillZombie(z, amt){
  if (z.dead || z.rise > 0 || z.frozen > 0) return;
  z.chill = Math.min(1, (z.chill || 0) + amt);
  if (z.chill >= 1) freezeZombie(z, WEAPONS.cryo.freeze);
}
export function freezeZombie(z, t){
  if (z.dead || z.rise > 0) return;
  if (z.turned > 0) unturn(z);
  z.frozen = t; z.chill = 1; z.fuse = 0; z.spitT = 0; z.stun = 0; z.vel.set(0, 0, 0);
  if (z.windup > 0) cancelScream(z);
  z.b.rotation.set(0, 0, 0); setGlow(z, ICE_EM);
  if (!z.ice){ z.ice = new THREE.Mesh(SH.iceGeo, SH.iceMat); z.g.add(z.ice); }
  burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 'ice', 8, 2); sfx.freeze();
}
function thaw(z){
  z.frozen = 0; z.chill = 0.4;
  if (z.ice){ z.g.remove(z.ice); z.ice = null; }
  setGlow(z, null);
  if (!z.dead) burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 'ice', 6, 2.5);
}
// Who z is fighting right now (null = nobody: business as usual).
function foeOf(z, dt){
  if (z.turned > 0){
    z.foeT -= dt;
    if (!z.foe || z.foe.dead || z.foe.turned > 0 || z.foeT <= 0){
      z.foeT = 0.6; z.foe = null; let best = 20;
      for (const o of zombies){
        if (o === z || o.dead || o.rise > 0 || o.turned > 0) continue;
        const d = Math.hypot(o.pos.x - z.pos.x, o.pos.z - z.pos.z); if (d < best){ best = d; z.foe = o; }
      }
    }
    return z.foe;
  }
  if (z.foe){ z.foeT -= dt; if (z.foe.dead || !(z.foe.turned > 0) || z.foeT <= 0) z.foe = null; }
  return z.foe;
}
function bite(z, foe){
  const dx = foe.pos.x - z.pos.x, dz = foe.pos.z - z.pos.z, l = Math.hypot(dx, dz) || 1;
  z.atkCd = 1;
  damageZombie(foe, z.dmg*(z.turned > 0 ? WEAPONS.potion.bite : WEAPONS.potion.bite*0.7)*(1 + SCALE.hp*(state.level-1)), dx/l*0.6, dz/l*0.6, 'bite', z.turned > 0 ? z.turnBy : null);
  if (foe.dead || foe.turned > 0 || !(z.turned > 0)) return;
  // Contagion (a flask special): the bitten turn too, for a while, without passing it on.
  if (z.contagion) turnZombie(foe, SPECIALS.contagion.turn, { by:z.turnBy, poison:z.poison });
  else { foe.foe = z; foe.foeT = 4; }
}

// cause = 'bullet' | 'melee' | 'blast' | 'fire' | 'bite' | 'rail' (railgun: goes through riot shields)
// (fire is damage over time: no blood burst or hit
// sound); it also picks the death animation. (dx,dz) = hit direction and knockback.
// Armored zombies take frontMul damage from hits landing within frontArc of where they face.
// Returns true if the shield took the hit (bullets stop there instead of piercing).
// Zombies still rising out of the ground can't be hurt. by = the player who dealt it (it turns on
// them, and they get the kill), if any.
export function damageZombie(z, dmg, dx, dz, cause, by){
  if (z.dead || z.rise > 0) return false;
  if (z.frozen > 0){
    // Frozen solid: fire melts the ice, anything else shatters it, zombie and all.
    if (cause === 'fire'){ thaw(z); return false; }
    if (dmg > 0){
      burst(new THREE.Vector3(z.pos.x, 1.1, z.pos.z), 'ice', 22, 6); sfx.shatterIce();
      killZombie(z, true, 'blast', dx, dz, 99, by);
      if (z.shrapnelBy) shrapnelBurst(z);  // frozen by a cryo sprayer with Shrapnel ice
      return false;
    }
  }
  const quiet = cause === 'fire' || cause === 'frost';  // burning and frostbite: no blood or hit sound every tick
  const A = ZMODS.armored, l = Math.hypot(dx,dz);
  const blocked = cause !== 'rail' && z.mods.armored && l > 0 && -(Math.sin(z.g.rotation.y)*dx + Math.cos(z.g.rotation.y)*dz)/l > Math.cos(A.frontArc);
  if (blocked) dmg *= A.frontMul;
  if (dev.oneHit) dmg = Math.max(dmg, z.hp);
  z.hp -= dmg; z.flash = 0.08;
  if (cause === 'bullet' || cause === 'melee' || cause === 'rail') alertZombie(z, false, by);
  for (const m of z.mats) m.emissive.setHex(quiet ? 0x804010 : blocked ? 0x2a3a55 : 0x663333);
  z.vel.x += dx*z.kb; z.vel.z += dz*z.kb;
  if (!quiet){
    if (blocked){ burst(new THREE.Vector3(z.pos.x - dx/l*0.8*z.g.scale.x, 1.2, z.pos.z - dz/l*0.8*z.g.scale.x), 'spark', 5, 3); sfx.clank(); }
    else { burst(new THREE.Vector3(z.pos.x, 1.2, z.pos.z), 'blood', 4, 3); sfx.hit(); }
  }
  if (z.hp <= 0) killZombie(z, true, cause, dx, dz, dmg, by);
  return blocked;
}
// Pipe-bomb concussion: frozen and swaying for t seconds; wind-ups (scream, spit) are interrupted.
export function stunZombie(z, t){
  if (z.dead || z.rise > 0) return;
  z.stun = Math.max(z.stun, t); z.spitT = 0;
  if (z.windup > 0) cancelScream(z);
}
// credit = false for an exploder's own detonation: no kill counted, no drops.
// cause/dx/dz/dmg describe the killing blow (see damageZombie) and shape the corpse; by = its player.
export function killZombie(z, credit = true, cause, dx = 0, dz = 0, dmg = 0, by){
  z.dead = true; z.mark.visible = false;
  emit(['z-', z.nid, z.mods.explosive ? 'blast' : cause || 'bullet', Math.round(dx*100)/100, Math.round(dz*100)/100, Math.round(dmg*10)/10]);
  if (z.ice){ z.g.remove(z.ice); z.ice = null; } z.frozen = 0;
  if (z.warn) z.warn.visible = false;
  const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i,1);
  if (z.horde) state.hordeAlive--;
  if (credit){ state.kills++; state.cityKills++; if (by) by.kills++; }
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
  // Health drops are rare on purpose: most healing comes from searching the city. Low health (of
  // whoever made the kill, or the nearest player) makes them a little likelier; ammo suits their guns.
  const p = by && !by.dead ? by : nearestPlayer(z.pos.x, z.pos.z);
  const chance = 0.025 + (p && p.hp < p.maxHp*0.4 ? 0.03 : 0) + ZTYPES[z.type].heal;
  if (Math.random() < chance) spawnPickup(z.pos.x, z.pos.z);
  else if (p && Math.random() < (state.phase === 'takeover' ? CRYSTAL.ammoDrop : 0.07)) dropZombieAmmo(z.pos.x, z.pos.z, p);
}
// Shoves z out of every living player it overlaps (players push zombies, not the other way round).
// Returns the player within striking reach, preferring its target.
function shoveFromPlayers(z, tp){
  let reach = null;
  for (const p of players){
    if (p.dead) continue;
    const minD = z.r + p.radius, ndx = p.pos.x - z.pos.x, ndz = p.pos.z - z.pos.z, nd = Math.hypot(ndx, ndz);
    // Up on a ledge (or a ramp's top) above it, a player is out of its reach.
    if (Math.abs(p.pos.y - z.pos.y) > 0.6 && !p.vault && !p.netVault) continue;
    if (nd < minD + 0.35 && (!reach || p === tp)) reach = p;
    if (nd < minD && nd > 1e-4){ z.pos.x = p.pos.x - ndx/nd*minD; z.pos.z = p.pos.z - ndz/nd*minD; }
  }
  return reach;
}
// Each zombie works against one player at a time: its target while hunting (z.tgt), otherwise the
// nearest living one (tp, with dx/dz/dist toward them). Visibility and sounds follow the player being
// watched (viewed); skipping work for far-off idle zombies goes by the nearest player.
export function updateZombies(dt){
  const view = viewed(), lure = world.lure, E = ZMODS.explosive, t = state.cityTime;
  SH.canMat.emissiveIntensity = 0.9 + Math.sin(t*6)*0.5;
  for (let i=zombies.length-1;i>=0;i--){
    const z = zombies[i];
    if (z.tgt && z.tgt.dead){ z.tgt = null; z.sees = false; }  // its player died (or left): it has to find someone else
    if (z.tracked && !(z.turned > 0)){ const h = nearestHuntable(z.pos.x, z.pos.z); if (h) z.tgt = h; }
    const near = nearestPlayer(z.pos.x, z.pos.z), tp = (z.mode === 'hunt' && z.tgt) || near;
    const nd = near ? Math.hypot(near.pos.x - z.pos.x, near.pos.z - z.pos.z) : Infinity;
    const dx = tp ? tp.pos.x - z.pos.x : 0, dz = tp ? tp.pos.z - z.pos.z : 0, dist = tp ? Math.hypot(dx,dz) || 0.0001 : Infinity;
    const vd = Math.hypot(view.pos.x - z.pos.x, view.pos.z - z.pos.z);
    z.g.visible = vd < 50;  // well off-screen (and out of the shadow camera): skip rendering it
    if (!(z.turned > 0)) updateMark(z, dt);
    if (z.rise > 0){ updateRise(z, dt); continue; }
    if (z.frozen > 0){
      // A statue: it only gets shoved aside by players (and dragged by gravity wells).
      z.frozen -= dt;
      if (z.frozen <= 0) thaw(z);
      else { shoveFromPlayers(z, null); resolveCircle(z.pos, z.r); continue; }
    }
    if (z.climb){ climbStep(z, dt); continue; }
    if (z.chill > 0) z.chill = Math.max(0, z.chill - dt*WEAPONS.cryo.thaw);
    if (z.turned > 0){
      z.turned -= dt;
      if (z.turned <= 0){
        unturn(z);
        // Poisoned brew (a flask special): when the turn wears off, it drops dead.
        if (z.poison){ burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 'brew', 10, 3); killZombie(z, true, 'melee', 0, 0, 1, z.turnBy); continue; }
      }
    }
    const turned = z.turned > 0, foe = foeOf(z, dt);
    if (turned || foe){}  // busy fighting (or on your side): no senses
    else if (z.tracked && z.tgt && !ignored(z.tgt)){ z.sees = true; z.lx = z.tgt.pos.x; z.lz = z.tgt.pos.z; }
    else {
      z.percT -= dt;
      if (z.percT <= 0){ z.percT = mr(0.2, 0.3); perceive(z); }
      think(z, dt, dist);
    }
    // Idle zombies far from everyone skip crowd separation and animation.
    const far = nd > 48 && z.mode === 'idle' && !turned && !foe;
    let desX = 0, desZ = 0, spd = z.speed*(z.chill > 0 ? 1 - WEAPONS.cryo.slow*z.chill : 1), hold = false, mv = null, dir = null;
    if (z.stun > 0) z.stun -= dt;
    const stunned = z.stun > 0;
    // Specials: a winding-up screamer roots in place; an alerted spitter picks its own spacing.
    if (stunned || turned || foe){}
    else if (z.type === 'screamer') hold = updateScreamer(z, dt, dist, tp);
    else if (z.type === 'spitter') mv = updateSpitter(z, dt, dist, dx, dz, tp);
    const lx = lure ? lure.x - z.pos.x : 0, lz = lure ? lure.z - z.pos.z : 0, ld = lure ? Math.hypot(lx,lz) : 1e9;
    let fd = 1e9;
    if (hold || stunned){}
    else if (foe){
      // Close in on the zombie it's fighting: straight at it nearby, around buildings further out.
      const fx = foe.pos.x - z.pos.x, fz = foe.pos.z - z.pos.z; fd = Math.hypot(fx, fz) || 0.001;
      z.direct = fd < 6; dir = fd < 2.5 ? [fx/fd, fz/fd] : steerTo(z, foe.pos.x, foe.pos.z);
    } else if (turned){
      // Nobody left to fight: stays near the nearest player.
      if (!near){ dir = wander(z, dt, z.hx, z.hz, AI.wander); spd *= AI.speed.idle; }
      else if (nd > 3.5){ z.direct = nd < 8; dir = steerTo(z, near.pos.x, near.pos.z); } else { dir = wander(z, dt, near.pos.x, near.pos.z, 2.5); spd *= AI.speed.idle; }
    }
    else if (mv){ desX = mv[0]; desZ = mv[1]; spd *= mv[2]; }
    else if ((z.mode === 'hunt' || z.mode === 'search') && ld < 32 && dist > 3.5){
      // A beeping pipe bomb pulls hunting and searching zombies off the players.
      if (ld > 0.9){ desX = lx/ld; desZ = lz/ld; }
    } else if (z.mode === 'hunt'){
      if (z.sees && tp){
        // Down its player's flow field, or straight at them up close (or when cut off, e.g. in a cell).
        dir = dist < 4.5 && walkClear(z.pos.x, z.pos.z, tp.pos.x, tp.pos.z, z.pos.y) ? null : descend(z, tp.dist);
        if (!dir){ desX = dx/dist; desZ = dz/dist; }
      }
      // Lost sight: go to where it last saw (or heard) you, and look around there.
      else if (Math.hypot(z.lx - z.pos.x, z.lz - z.pos.z) > 1.2) dir = steerTo(z, z.lx, z.lz);
      else { dir = wander(z, dt, z.lx, z.lz, 2); spd *= AI.speed.search; }
    } else if (z.mode === 'search'){
      spd *= AI.speed.search;
      dir = Math.hypot(z.lx - z.pos.x, z.lz - z.pos.z) > 2.2 ? steerTo(z, z.lx, z.lz) : wander(z, dt, z.lx, z.lz, 3);
    } else if (z.mode === 'return'){ spd *= AI.speed.return; dir = steerTo(z, z.hx, z.hz); }
    else { dir = wander(z, dt, z.hx, z.hz, z.guard ? 4 : AI.wander); spd *= AI.speed.idle; }
    if (dir){ desX = dir[0]; desZ = dir[1]; }
    // A fence or barricade where it wants to go (its path leads through it, or it's lunging at a player
    // behind it): it stands there banging on it until it gives.
    const bang = !stunned && !turned && !foe && z.mode !== 'idle' && (desX || desZ) ? breakAhead(z.pos.x, z.pos.z, desX, desZ, z.r + 0.5) : null;
    z.banging = !!bang;
    // Runners go over low fences instead.
    if (bang && z.type === 'runner' && VAULT.runners && !dev.noClimb && BREAKABLES[bang.kind].vault && startClimb(z, bang)){ z.banging = false; continue; }
    if (bang){
      const bx = desX, bz = desZ; desX = desZ = 0;
      z.g.rotation.y = lerpAngle(z.g.rotation.y, Math.atan2(bx, bz), Math.min(1, dt*10));
      z.bangT = (z.bangT || mr(0.2, 0.6)) - dt;
      if (z.bangT <= 0){ z.bangT = AI.bang*mr(0.85, 1.15); z.bangA = BANG_T; hitBreak(bang, z.dmg*AI.bangDmg, bx, bz); makeNoise(z.pos.x, z.pos.z, AI.bangNoise); }
    } else z.bangT = 0;
    // Separation from other zombies
    if (!far){
      let sx = 0, sz = 0;
      for (const o of zombies){
        if (o === z) continue;
        const ox = z.pos.x - o.pos.x, oz = z.pos.z - o.pos.z, rr = z.r + o.r, d2 = ox*ox + oz*oz;
        if (d2 < rr*rr && d2 > 1e-6){ const d = Math.sqrt(d2), f = (rr-d)/rr; sx += ox/d*f; sz += oz/d*f; }
      }
      desX += sx*1.6; desZ += sz*1.6;
    }
    const k = Math.min(1, dt*6);
    z.vel.x += (desX*spd - z.vel.x)*k; z.vel.z += (desZ*spd - z.vel.z)*k;
    z.pos.x += z.vel.x*dt; z.pos.z += z.vel.z*dt;
    const reach = shoveFromPlayers(z, tp);
    resolveCircle(z.pos, z.r);
    const vl = Math.hypot(z.vel.x, z.vel.z);
    if (stunned){}
    else if ((hold || mv) && !foe && !turned) z.g.rotation.y = lerpAngle(z.g.rotation.y, Math.atan2(dx, dz), Math.min(1, dt*8));
    else if (vl > 0.2 && !z.banging) z.g.rotation.y = lerpAngle(z.g.rotation.y, Math.atan2(z.vel.x, z.vel.z), Math.min(1, dt*8));
    if (far) continue;
    z.phase += dt*(vl*2.4 + 0.5);
    const sw = Math.sin(z.phase)*0.6*Math.min(1, vl/1.5);
    z.legs[0].rotation.x = sw; z.legs[1].rotation.x = -sw;
    z.arms[0].rotation.x = -0.1 + Math.sin(z.phase*0.5)*0.15; z.arms[1].rotation.x = -0.1 - Math.sin(z.phase*0.5+1)*0.15;
    z.b.rotation.z = Math.sin(z.phase*0.5)*0.06;
    poseBang(z, dt);
    z.atkCd -= dt;
    if (foe && !stunned && z.atkCd <= 0 && fd < z.r + foe.r + 0.4) bite(z, foe);
    if (reach && z.atkCd <= 0 && !stunned && !turned && !ignored(reach)){ z.atkCd = 1.0; hurtPlayer(reach, z.dmg, z); if (state.mode !== 'play') return; }
    if (z.flash > 0){ z.flash -= dt; if (z.flash <= 0) z.mats.forEach((m,j) => m.emissive.setHex(z.em[j])); }
    if (z.mods.explosive){
      // Arms a short fuse next to a player, blinking white, then detonates.
      // A turned exploder lights its fuse next to the zombie it's fighting instead.
      if (!z.fuse && !stunned && (turned ? fd < z.r + E.trigger : nd < z.r + 0.45 + E.trigger)){ z.fuse = E.fuse; sfx.fuse(); }
      if (z.fuse > 0){
        z.fuse -= dt;
        z.mats[0].emissive.setHex(Math.floor(z.fuse*16) % 2 ? 0xffffff : 0xff5000); z.mats[0].emissiveIntensity = 2;
        if (z.fuse <= 0){ killZombie(z, false, 'blast'); continue; }
      } else z.mats[0].emissiveIntensity = 0.8 + Math.sin(t*6 + z.phase)*0.5;
      updateWarnRing(z, vd, t);
    }
    poseSpecial(z);
    if (stunned){
      // Dazed: slow drunken sway, arms hanging, the odd spark above the head.
      z.b.rotation.z = Math.sin(t*7 + z.phase)*0.2; z.b.rotation.x = 0.15;
      z.arms[0].rotation.x = z.arms[1].rotation.x = 0.3;
      if (Math.random() < dt*4) burst(new THREE.Vector3(z.pos.x, 2.1*z.g.scale.y, z.pos.z), 'spark', 1, 0.8, true);
    } else if (z.stun < 0){ z.stun = 0; z.b.rotation.x = 0; }
    if (z.flash <= 0 && turned && Math.random() < dt*3) burst(new THREE.Vector3(z.pos.x, 1.9*z.g.scale.y, z.pos.z), 'brew', 1, 0.6, true);
    if (z.alert){ z.groan -= dt; if (z.groan <= 0){ z.groan = mr(5,11); if (vd < 14) playSfx('groan'); } }
  }
}

// ---------- Climbing (runners over low fences) ----------
// Over fence b to the tile beyond it, in VAULT.climb s (it can still be shot; the update loop skips it).
function startClimb(z, b){
  const fx = (b.x + 0.5)*TILE - z.pos.x, fz = (b.z + 0.5)*TILE - z.pos.z;
  const ax = Math.abs(fx) >= Math.abs(fz) ? Math.sign(fx) : 0, az = ax ? 0 : Math.sign(fz), lx = b.x + ax, lz = b.z + az;
  const L = world.city.level, r = z.r;
  if (!walkable(world.city.grid[lz*N + lx]) || (L && L[lz*N + lx] > levelOf(z.pos.y) + 1)) return false;
  const ex = ax ? (ax > 0 ? lx*TILE + r + 0.15 : (lx + 1)*TILE - r - 0.15) : Math.min((b.x + 1)*TILE - r, Math.max(b.x*TILE + r, z.pos.x));
  const ez = az ? (az > 0 ? lz*TILE + r + 0.15 : (lz + 1)*TILE - r - 0.15) : Math.min((b.z + 1)*TILE - r, Math.max(b.z*TILE + r, z.pos.z));
  z.climb = { t:0, sx:z.pos.x, sz:z.pos.z, sy:z.pos.y, ex, ez, ey:groundAt(ex, ez) };
  z.vel.set(0, 0, 0); z.g.rotation.y = Math.atan2(ex - z.pos.x, ez - z.pos.z);
  return true;
}
function climbStep(z, dt){
  const c = z.climb; c.t += dt;
  const k = Math.min(1, c.t/VAULT.climb), up = Math.sin(k*Math.PI);
  z.pos.x = c.sx + (c.ex - c.sx)*k; z.pos.z = c.sz + (c.ez - c.sz)*k; z.pos.y = c.sy + (c.ey - c.sy)*k + up*VAULT.height;
  poseClimb(z, up);
  if (k >= 1){ z.climb = null; poseClimb(z, 0); resolveCircle(z.pos, z.r); }
}
// Hauling itself over: arms reaching up and over, legs dangling behind.
function poseClimb(z, up){
  z.arms[0].rotation.x = z.arms[1].rotation.x = -2.2*up; z.legs[0].rotation.x = 0.8*up; z.legs[1].rotation.x = 0.4*up; z.b.rotation.x = 0.4*up;
}

// A blow on a fence or barricade: both arms come up and hammer down, the body lunging into it.
const BANG_T = 0.4;
function poseBang(z, dt){
  if (!(z.bangA > 0)) return;
  z.bangA -= dt;
  const k = Math.sin(Math.max(0, 1 - z.bangA/BANG_T)*Math.PI);
  z.arms[0].rotation.x = z.arms[1].rotation.x = -2.4 + k*1.3;
  z.b.rotation.x = k*0.3;
  if (z.bangA <= 0) z.b.rotation.x = 0;
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
    burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 'blood', 18, 7, true);
    for (let i=0;i<3;i++) addDecal(z.pos.x + mr(-1.2,1.2), z.pos.z + mr(-1.2,1.2), mr(0.8,1.3), undefined, true);
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
    burst(new THREE.Vector3(z.pos.x, 1.3, z.pos.z), 'blood', 10, 4, true);
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
  if (Math.random() < dt*18) burst(pos, 'blood', 1, 0.6, true);
  const fl = groundAt(pos.x, pos.z);
  if (pos.y > fl + 0.2) return;
  pos.y = fl + 0.2;
  if (!p.bled){ p.bled = true; addDecal(pos.x, pos.z, mr(0.4,0.7), undefined, true); }
  if (p.vy < -3){ p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; p.sx *= 0.5; p.sy *= 0.5; p.sz *= 0.5; return; }
  // Settle flat on a face and rest on the ground.
  p.rest = true;
  const snap = a => Math.round(a/(Math.PI/2))*(Math.PI/2);
  m.rotation.set(Math.random() < 0.5 ? 0 : Math.PI, m.rotation.y, snap(m.rotation.z));
  m.updateMatrixWorld(true); tmpBox.setFromObject(m); pos.y += fl + 0.09 - tmpBox.min.y;
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
        if (Math.random() < dt*30){ z.b.getWorldPosition(tmpV); burst(tmpV.set(tmpV.x, 0.6 + 0.6*(1-k), tmpV.z), 'blood', 1, 1.5, true); }
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

// ---------- Client mirror ----------
// On a client (client.js) every zombie is a copy of the host's: built from its spawn event, moved by
// snapshots, and animated here from the flags the host sends (zombieFlags). It never thinks or
// fights; its death is the host's kill event, played out with the same corpse code.
const MODES = ['idle', 'search', 'hunt', 'return'];
export const F = { stun:4, frozen:8, turned:16, fuse:32, windup:64, spit:128, burning:256, rising:512, bang:1024, climb:2048 };
export function zombieFlags(z){
  return MODES.indexOf(z.mode) | (z.stun > 0 ? F.stun : 0) | (z.frozen > 0 ? F.frozen : 0) | (z.turned > 0 ? F.turned : 0)
    | (z.fuse > 0 ? F.fuse : 0) | (z.windup > 0 ? F.windup : 0) | (z.spitT > 0 ? F.spit : 0) | (isBurning(z) ? F.burning : 0) | (z.rise > 0 ? F.rising : 0) | (z.banging ? F.bang : 0) | (z.climb ? F.climb : 0);
}
export function mirrorSpawn(nid, type, modList, x, z, ry, rise, riseT, look){
  const mods = {}; for (const k of modList) mods[k] = true;
  const S = ZTYPES[type], m = createZombieMesh(type, mods);
  m.g.position.set(x, groundAt(x, z), z); m.g.rotation.y = ry; scene.add(m.g);
  const zz = { nid, type, mods, g:m.g, b:m.b, mats:m.mats, em:m.em, parts:m.parts, head:m.head, legs:m.legs, arms:m.arms, pos:m.g.position,
    vel:new THREE.Vector3(), r:S.r, mark:m.mark, markT:0, mode:'idle', alert:false, rise, riseT:riseT || rise, phase:Math.random()*6, flash:0,
    hp:100, dead:false, turned:0, frozen:0, ice:null, stun:0, fuse:0, windup:0, spitT:0, groan:mr(3,10), f:rise > 0 ? F.rising : 0, ghost:true };
  if (mods.explosive) zz.warn = makeWarnRing();
  if (look !== null && look !== undefined) applyLook(zz, look);
  if (rise > 0) m.b.position.y = -RISE_DEPTH*(rise/zz.riseT)**1.5;
  zombies.push(zz);
  return zz;
}
export function mirrorKill(z, cause, dx, dz, dmg){
  if (z.dead) return;
  z.dead = true; z.mark.visible = false;
  if (z.ice){ z.g.remove(z.ice); z.ice = null; }
  if (z.warn) z.warn.visible = false;
  const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i, 1);
  for (const m of z.mats) m.emissive.setHex(0);
  if (z.windup > 0 || z.spitT > 0) cancelScream(z);
  if (z.mods.explosive) z.parts.cans.visible = false;
  z.rise = 0;
  dying.push(makeCorpse(z, cause, dx, dz, dmg));
}
// hp = percent of its health left: a drop flashes it like a hit on the host.
export function mirrorHit(z, hp){
  if (hp < z.hp && !(z.turned > 0) && !z.ice && !(z.fuse > 0)){ z.flash = 0.08; for (const m of z.mats) m.emissive.setHex(0x663333); }
  z.hp = hp;
}
// Per frame: z.f (flags) and its interpolated speed vl drive marks, ice, glow, poses and particles.
export function animateMirror(z, dt, t, vd, vl){
  const f = z.f, mode = MODES[f & 3], S = ZTYPES[z.type], E = ZMODS.explosive;
  z.g.visible = vd < 50;
  if (z.rise > 0){
    if (f & F.rising){ updateRise(z, dt); if (z.rise <= 0) z.rise = 0.01; return; }
    z.rise = 0; z.b.position.y = 0; z.b.rotation.set(0, 0, 0); burst(new THREE.Vector3(z.pos.x, 0.3, z.pos.z), 'dirt', 6, 2, true);
  }
  // Turned: pink glow and a heart; frozen: a block of ice and a blue glow.
  if ((f & F.turned) && !(z.turned > 0)){ z.turned = 1; setGlow(z, TURN_EM); z.mark.material = SH.markMats.turned; z.mark.scale.setScalar(0.7); z.mark.visible = true; z.markT = 0; }
  else if (!(f & F.turned) && z.turned > 0){ z.turned = 0; z.mark.visible = false; setGlow(z, null); }
  if ((f & F.frozen) && !z.ice){ z.ice = new THREE.Mesh(SH.iceGeo, SH.iceMat); z.g.add(z.ice); z.b.rotation.set(0, 0, 0); setGlow(z, ICE_EM); }
  else if (!(f & F.frozen) && z.ice){ z.g.remove(z.ice); z.ice = null; setGlow(z, null); }
  if (!z.turned){
    if (mode !== z.mode && (mode === 'hunt' || (mode === 'search' && z.mode !== 'hunt'))) mark(z, mode === 'hunt' ? 'spotted' : 'heard');
    else if (mode === 'search' && z.mode === 'hunt') mark(z, 'heard');
    updateMark(z, dt);
  }
  z.mode = mode; z.alert = mode === 'hunt';
  if (z.ice) return;  // a statue
  if (z.flash > 0){ z.flash -= dt; if (z.flash <= 0) z.mats.forEach((m, j) => m.emissive.setHex(z.em[j])); }
  const stunned = !!(f & F.stun);
  if (vd < 48 || !stunned){
    z.phase += dt*(vl*2.4 + 0.5);
    const sw = Math.sin(z.phase)*0.6*Math.min(1, vl/1.5);
    z.legs[0].rotation.x = sw; z.legs[1].rotation.x = -sw;
    z.arms[0].rotation.x = -0.1 + Math.sin(z.phase*0.5)*0.15; z.arms[1].rotation.x = -0.1 - Math.sin(z.phase*0.5+1)*0.15;
    z.b.rotation.z = Math.sin(z.phase*0.5)*0.06;
  }
  // Climbing a fence: the arc and pose on our own clock while the flag is on.
  if (f & F.climb){ z.climbT = Math.min(VAULT.climb, (z.climbT || 0) + dt); const up = Math.sin(z.climbT/VAULT.climb*Math.PI); z.pos.y += up*VAULT.height; poseClimb(z, up); return; }
  else if (z.climbT){ z.climbT = 0; poseClimb(z, 0); }
  // Banging on a fence: swing on the host's rhythm while the flag is on.
  if (f & F.bang){ z.bangT = (z.bangT || 0) - dt; if (z.bangT <= 0){ z.bangT = AI.bang; z.bangA = BANG_T; } }
  poseBang(z, dt);
  // Wind-ups run their own clocks from when the flag came on.
  if (f & F.windup){ if (!(z.windup > 0)) z.windup = S.windup; z.windup = Math.max(0.01, z.windup - dt); }
  else if (z.windup > 0) cancelScream(z);
  if (f & F.spit){ if (!(z.spitT > 0)) z.spitT = S.windup; z.spitT = Math.max(0.01, z.spitT - dt); }
  else if (z.spitT > 0){ z.spitT = 0; cancelScream(z); }
  if (z.mods.explosive){
    if (f & F.fuse){
      if (!(z.fuse > 0)) z.fuse = E.fuse;
      z.fuse = Math.max(0.01, z.fuse - dt);
      z.mats[0].emissive.setHex(Math.floor(z.fuse*16) % 2 ? 0xffffff : 0xff5000); z.mats[0].emissiveIntensity = 2;
    } else { z.fuse = 0; z.mats[0].emissiveIntensity = 0.8 + Math.sin(t*6 + z.phase)*0.5; }
    updateWarnRing(z, vd, t);
  }
  poseSpecial(z);
  if (stunned){
    z.b.rotation.z = Math.sin(t*7 + z.phase)*0.2; z.b.rotation.x = 0.15;
    z.arms[0].rotation.x = z.arms[1].rotation.x = 0.3;
    if (Math.random() < dt*4) burst(new THREE.Vector3(z.pos.x, 2.1*z.g.scale.y, z.pos.z), 'spark', 1, 0.8, true);
  } else if (z.stunned){ z.b.rotation.x = 0; }
  z.stunned = stunned;
  if (z.turned && Math.random() < dt*3) burst(new THREE.Vector3(z.pos.x, 1.9*z.g.scale.y, z.pos.z), 'brew', 1, 0.6, true);
  if ((f & F.burning) && Math.random() < dt*14) burst(new THREE.Vector3(z.pos.x + mr(-0.3,0.3), mr(0.6,1.6)*z.g.scale.y, z.pos.z + mr(-0.3,0.3)), 'fire', 1, 0.8, true);
  if (z.alert){ z.groan -= dt; if (z.groan <= 0){ z.groan = mr(5,11); if (vd < 14) playSfx('groan'); } }
}
