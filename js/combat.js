// ---------- Combat ----------
// Shooting, melee, bullets, and damage to the player and the Crystal.
import * as THREE from 'three';
import { TILE } from './config.js';
import { $, mr, clamp } from './utils.js';
import { scene, muzzleLight } from './renderer.js';
import { SH } from './assets.js';
import { WEAPONS, CRIT } from './items.js';
import { state, world, zombies, bullets, dev } from './state.js';
import { isOpaqueTile, groundAt, gv } from './grid.js';
import { viewed, cheats, busy, knockOff } from './player.js';
import { damageZombie, makeNoise } from './zombies.js';
import { breakAhead, hitBreak } from './breakables.js';
import { AI } from './threats.js';
import { curWeapon, magSize } from './inventory.js';
import { toast, floatText } from './hud.js';
import { weaponStats, hasMod } from './weapons.js';
import { ignite } from './uniques.js';
import { fireUnique } from './uniques.js';
import { dropArrow } from './loot.js';
import { burst } from './fx.js';
import { sfx, playSfx } from './audio.js';
import { killPlayer } from './game.js';
import { foundCrystal, checkPulse, breakCrystal } from './crystal.js';
import { emit, emitTo, sfxFor } from './host.js';
import { pushPlayer } from './player.js';

// Players can act (shoot, reload, use items…) while the game runs and they're alive.
// Not while dead, stunned or climbing over a fence.
export const canAct = p => state.mode === 'play' && !!p && !p.dead && !busy(p);
export function tryReload(p){
  if (!canAct(p)) return;
  const w = curWeapon(p);
  if ((WEAPONS[w.id].kind && !WEAPONS[w.id].reload) || p.reloadT > 0 || w.mag >= magSize(w) || p.ammo[w.id] <= 0) return;
  p.reloadT = weaponStats(w).reload; sfxFor(p, 'reload');
}
// Called every frame player p holds the trigger. Regular guns (and the bow) shoot bullets here using
// the gun's own stats (weaponStats: base stats + its modifiers); uniques with a `kind` fire in
// uniques.js. Anything that can't fire falls back to melee. Bullets remember their owner (kill credit).
export function fire(p, dt){
  if (p.reloadT > 0 || p.fireCd > 0) return;
  const w = curWeapon(p), W = WEAPONS[w.id];
  if (W.kind){
    // Uniques with a reserve (railgun, cryo) reload like guns when empty.
    if (W.reload && w.mag <= 0.01){ if (p.ammo[w.id] > 0.5) tryReload(p); else dryMelee(p); return; }
    if (!fireUnique(p, w, dt)) dryMelee(p);
    return;
  }
  if (w.mag <= 0){ if (p.ammo[w.id] > 0) tryReload(p); else dryMelee(p); return; }
  const S = weaponStats(w);
  // A bad "crit" roll jams instead; fast guns jam less per shot so they don't stall every second.
  if (S.jam && Math.random() < S.jam*clamp(S.rate/0.5, 0.15, 1)){ p.fireCd = 0.7; sfxFor(p, 'jam'); floatText('Jammed!', 'dim', p); return; }
  if (!(S.free && Math.random() < S.free)) w.mag--;
  if (S.waste && w.mag > 0 && Math.random() < S.waste) w.mag--;
  p.fireCd = S.rate;
  const crit = S.crit && Math.random() < S.crit;
  const n = S.pellets, spread = S.spread || 0.11;
  // The bow's specials: fire arrows, and every arrow recoverable.
  const fx = W.arrow ? { ignite:hasMod(w, 'firearrow'), keepAll:hasMod(w, 'retriever') } : null;
  for (let i=0;i<n;i++){
    const a = p.angle + (n > 1 ? (i-(n-1)/2)*spread : 0) + mr(-S.jitter,S.jitter);
    addBullet(W.arrow ? 'arrow' : crit ? 'crit' : 'bullet', p.pos.x + Math.sin(a)*0.9, 1.15 + p.pos.y, p.pos.z + Math.cos(a)*0.9, a, S.speed*mr(0.94,1.06), S.life,
      Object.assign({ damage:S.dmg*(crit ? CRIT : 1), pierce:S.pierce, kb:S.kb, crit, arrow:!!W.arrow, owner:p }, fx));
  }
  if (!W.arrow) muzzle(p.pos.x + Math.sin(p.angle)*1.1, p.pos.z + Math.cos(p.angle)*1.1, crit ? 4.5 : 3);
  sfx.shot(W.sound);
  // Gunfire is heard far off; zombies that can't see you walk to where it came from.
  makeNoise(p.pos.x, p.pos.z, S.noise);
  if (w.mag === 0) tryReload(p);
}
// A bullet (kind: bullet, crit, arrow, shard, drone) from (x,y,z) heading a, with gameplay fields in o
// (damage, pierce, kb, bounce, owner…; host only: ignite = sets what it hits on fire, keepAll = an arrow that
// always lands as a pickup, kill(b, z) = called when it kills). Clients get a look-alike that flies until it hits something
// (ghost: no damage); everything it does happens here on the host.
const BULLET_LOOK = () => ({ bullet:[SH.bulletGeo, SH.bulletMat], crit:[SH.bulletGeo, SH.critMat], arrow:[SH.arrowGeo, SH.arrowMat], shard:[SH.shardGeo, SH.shardMat], drone:[SH.bulletGeo, SH.droneBulletMat] });
const r2 = v => Math.round(v*100)/100;
export function addBullet(kind, x, y, z, a, speed, life, o){
  const [geo, mat] = BULLET_LOOK()[kind], m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.y = a; scene.add(m);
  // h = its height above the ground: it keeps that over hills and hollows.
  const b = Object.assign({ mesh:m, kind, dx:Math.sin(a), dz:Math.cos(a), speed, life, damage:0, pierce:0, kb:1, hit:new Set(), h:y - groundAt(x, z) }, o);
  bullets.push(b);
  if (!b.ghost) emit(['bu', kind, r2(x), r2(y), r2(z), Math.round(a*1000)/1000, r2(speed), r2(life), b.pierce, b.bounce || 0]);
  return b;
}
export function muzzle(x, z, intensity){
  muzzleLight.position.set(x, groundAt(x, z) + 1.3, z); muzzleLight.intensity = Math.max(muzzleLight.intensity, intensity);
  emit(['mz', r2(x), r2(z), intensity]);
}
// ---------- Melee ----------
// A butt-stroke with the held gun: F any time, or left click once the gun is completely dry.
// melee() starts the swing; player.js animates it and calls meleeStrike() when the blow lands.
export const MELEE_TIME = 0.4, MELEE_HIT = 0.42;  // swing length (s), fraction where the blow lands
export function melee(p){
  if (!canAct(p) || p.meleeT > 0 || p.meleeCd > 0) return;
  p.meleeT = MELEE_TIME; p.meleeHit = false; p.meleeCd = 0.55;
  p.fireCd = Math.max(p.fireCd, MELEE_TIME);
  sfx.swing();
}
function dryMelee(p){
  const w = curWeapon(p), W = WEAPONS[w.id];
  if (performance.now() - (p.dryWarned || 0) > 6000){
    p.dryWarned = performance.now();
    toast(w.id === 'flamer' ? 'Out of fuel. Refuel at a gas station pump (once per station), or press Q to swap'
      : w.id === 'potion' ? `The flask is still brewing (${Math.ceil(w.cd)} s). Press Q to swap`
      : w.id === 'tesla' ? 'Recharging. Press Q to swap'
      : w.id === 'gravity' ? 'No gravity wells left. They come back in the next city'
      : w.id === 'shard' ? 'No shards left. Break a city’s Crystal to recharge'
      : w.id === 'drone' ? `Drone battery too low to launch (needs ${WEAPONS.drone.launch}%). It recharges while docked`
      : `Out of ${W.ammo}. Search the city or press Q to swap`, 'bad', p);
  }
  melee(p);
}
// Angle between p's facing and the direction to (dx,dz).
export const offAim = (p, dx, dz) => Math.abs(((Math.atan2(dx,dz) - p.angle) % (Math.PI*2) + Math.PI*3) % (Math.PI*2) - Math.PI);
export function meleeStrike(p){
  makeNoise(p.pos.x, p.pos.z, 6);
  const dmg = 1;
  for (const z of zombies.slice()){
    const dx = z.pos.x - p.pos.x, dz = z.pos.z - p.pos.z, d = Math.hypot(dx,dz) || 0.001;
    if (d > 1.7 + z.r || z.turned > 0) continue;  // turned zombies are on your side
    if (offAim(p, dx, dz) < 1.0) damageZombie(z, dmg, dx/d*1.8, dz/d*1.8, 'melee', p);
  }
  // A kick at a fence or barricade in front of you.
  const fx = Math.sin(p.angle), fz = Math.cos(p.angle), br = breakAhead(p.pos.x, p.pos.z, fx, fz, p.radius + 0.6);
  if (br) hitBreak(br, AI.kick, fx, fz);
  const crystal = world.crystal;
  if (crystal && crystal.alive){
    const dx = crystal.pos.x - p.pos.x, dz = crystal.pos.z - p.pos.z;
    if (Math.hypot(dx,dz) < 1.7 + CRYSTAL_R && offAim(p, dx, dz) < 1.0){
      hitCrystal(dmg); burst(gv(crystal.pos.x - dx*0.3, 1.2, crystal.pos.z - dz*0.3), 'crystal', 6, 3);
    }
  }
}
// Also flies clients' ghost bullets (no damage, no sparks: those come from the host).
export function updateBullets(dt){
  const crystal = world.crystal;
  for (let i=bullets.length-1;i>=0;i--){
    const b = bullets[i]; b.life -= dt; let dead = b.life <= 0;
    // Sub-step so fast bullets can't tunnel through walls or zombies.
    const steps = Math.max(1, Math.ceil(b.speed*dt/0.35)), sdt = dt/steps;
    for (let s=0;s<steps && !dead;s++){
      const bp = b.mesh.position;
      bp.x += b.dx*b.speed*sdt; bp.z += b.dz*b.speed*sdt; bp.y = groundAt(bp.x, bp.z) + b.h;
      const tx = Math.floor(bp.x/TILE), tz = Math.floor(bp.z/TILE);
      if (crystal && crystal.alive){
        // The Crystal's whole tile is solid, so anything entering it counts as a hit (not a wall spark).
        const cx = bp.x - crystal.pos.x, cz = bp.z - crystal.pos.z, ct = world.city.crystalTile;
        if (cx*cx + cz*cz < CRYSTAL_R*CRYSTAL_R || (tx === ct.x && tz === ct.z)){ if (!b.ghost){ hitCrystal(b.damage); burst(bp.clone(), 'crystal', 5, 3); } bp.x -= b.dx*0.8; bp.z -= b.dz*0.8; dead = true; break; }
      }
      if (isOpaqueTile(tx, tz)){
        // Crystal shards ricochet: flip whichever direction crossed into the wall (both at a corner).
        if (b.bounce > 0){
          const ox = bp.x - b.dx*b.speed*sdt, oz = bp.z - b.dz*b.speed*sdt;
          const fx = isOpaqueTile(tx, Math.floor(oz/TILE)), fz = isOpaqueTile(Math.floor(ox/TILE), tz);
          if (fx || !fz) b.dx = -b.dx;
          if (fz || !fx) b.dz = -b.dz;
          bp.x = ox; bp.z = oz; b.bounce--; b.hit.clear(); b.mesh.rotation.y = Math.atan2(b.dx, b.dz);
          if (!b.ghost){ burst(bp.clone(), 'void', 3, 2); sfx.ping(); }
          continue;
        }
        if (!b.ghost) burst(bp.clone(), 'spark', 4, 2.5);
        bp.x -= b.dx*0.5; bp.z -= b.dz*0.5; dead = true; break;
      }  // cell bars let shots through
      for (const z of zombies){
        if (b.hit.has(z) || z.rise > 0 || z.turned > 0) continue;  // still digging out: shots pass over; turned ones are friends
        const zx = bp.x - z.pos.x, zz = bp.z - z.pos.z, rr = z.r + 0.14;
        if (zx*zx + zz*zz < rr*rr){
          // A riot shield stops the bullet outright, piercing or not.
          b.hit.add(z); const blocked = b.ghost ? false : damageZombie(z, b.damage, b.dx*b.kb, b.dz*b.kb, 'bullet', b.owner);
          if (b.crit && !blocked) burst(bp.clone(), 'spark', 6, 4);
          if (!b.ghost && !blocked){ if (z.dead){ if (b.kill) b.kill(b, z); } else if (b.ignite) ignite(z, b.owner); }
          if (b.pierce > 0 && !blocked) b.pierce--; else dead = true;
          break;
        }
      }
    }
    if (dead){
      scene.remove(b.mesh); bullets.splice(i,1);
      // Most arrows survive and can be picked back up where they stopped.
      if (b.arrow && !b.ghost && (b.keepAll || Math.random() < WEAPONS.bow.keep)) dropArrow(b.mesh.position.x, b.mesh.position.z);
    }
  }
}
// Damage to player p (z = the zombie that hit them: knockback and a chance to bleed). The screen
// shake and red flash are for the player being watched.
export function hurtPlayer(p, dmg, z){
  if (state.mode !== 'play' || p.dead || (dev.god && cheats(p))) return;
  p.hp -= dmg;
  if (p === viewed()) hurtFx();
  emitTo(p, ['hurt']);
  if (p.vault || p.netVault) knockOff(p);
  if (z){
    const dx = p.pos.x - z.pos.x, dz = p.pos.z - z.pos.z, l = Math.hypot(dx,dz) || 1; pushPlayer(p, dx/l*6, dz/l*6);
    if (!p.bleeding && Math.random() < z.bleed){ p.bleeding = true; toast('You’re bleeding. Use a bandage', 'bad', p); }
  }
  if (p.hp <= 0){ p.hp = 0; killPlayer(p); }
}
// Shake, red flash and grunt on the screen of a player who got hurt.
export function hurtFx(){ state.shake = Math.max(state.shake, 0.25); $('vignette').style.opacity = 0.7; playSfx('hurt'); }
// Silent health loss (bleeding). Returns true if it killed the player.
export function drainHp(p, n){
  if (dev.god && cheats(p)) return false;
  p.hp -= n;
  if (p.hp <= 0){ p.hp = 0; killPlayer(p); return true; }
  return false;
}
export const CRYSTAL_R = 1.15;  // pedestal radius
export function hitCrystal(dmg){
  const crystal = world.crystal;
  crystal.hp -= dmg; crystal.flash = 0.1; sfx.crystal();
  if (!state.crystalFound) foundCrystal();
  if (crystal.hp <= 0) breakCrystal(); else checkPulse();
}
