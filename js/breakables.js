// ---------- Breakables ----------
// Fences (built with the city: picket, farm rails, chain-link, cemetery iron) and plank barricades
// that players put up. Each is a T.FENCE tile in world.breaks (tile index -> b): it stops feet but not
// sight, shots or throws. A zombie's path leads through one only when going round costs more (grid.js
// breakCost, from its health), and then it bangs on it until it gives (zombies.js). Players kick fences
// (melee), take their own barricades down and repair wooden ones with planks (hold E); blasts hit them.
// Host-authoritative: clients get 'br+' (a barricade put up), 'brh' (hit: health left + direction)
// and 'br-' (broken, or taken down), and mirror them with the same functions.
import * as THREE from 'three';
import { TILE, N, T, BREAKABLES, BARRICADE, walkable } from './config.js';
import { mr } from './utils.js';
import { world, zombies, players, drops, pickups } from './state.js';
import { AI } from './threats.js';
import { clearFlowCache, updateFlow, groundAt, tileLevel, levelOf } from './grid.js';
import { burst } from './fx.js';
import { makeNoise } from './zombies.js';
import { sfx } from './audio.js';
import { emit, sfxFor } from './host.js';
import { toast, floatText } from './hud.js';
import { countItem, removeItem, addItem } from './inventory.js';
const r2 = v => Math.round(v*100)/100;

// Barricade look: two posts, three boards across and one nailed on the slant. Shared, never disposed.
const WOOD = new THREE.MeshStandardMaterial({ color:0x8f6d45, roughness:0.95 }), WOOD2 = new THREE.MeshStandardMaterial({ color:0x6b5034, roughness:0.95 });
const POST = new THREE.BoxGeometry(0.16, 1.4, 0.16).translate(0, 0.7, 0), BOARD = new THREE.BoxGeometry(2.05, 0.26, 0.08);
const falling = [];  // broken ones toppling over (cosmetic)

// world.breaks from the city's fence props (cityScene keeps each prop's mesh on p.g); world.broken =
// city fences destroyed so far (for players joining mid-run).
export function initBreaks(c){
  world.breaks = new Map(); world.broken = []; falling.length = 0;
  for (const p of c.props){
    if (p.kind !== 'fence') continue;
    const B = BREAKABLES[p.style], idx = p.z*N + p.x;
    world.breaks.set(idx, { idx, x:p.x, z:p.z, kind:p.style, hp:B.hp, max:B.hp, under:p.under, g:p.g, lean:0, shake:0, dx:0, dz:1 });
  }
}
const center = b => [(b.x + 0.5)*TILE, (b.z + 0.5)*TILE];
// Zombie paths are stale once a tile opens or closes: drop them all (they're rebuilt on demand).
function gridChanged(host){
  clearFlowCache(); world.mmDirty = true;
  for (const z of zombies) z.fk = -1;
  if (host) updateFlow();
}

// ---------- Damage ----------
// A blow of dmg pushing toward (dx,dz) (the breakable leans away from it a bit more each time).
export function hitBreak(b, dmg, dx, dz){
  if (!world.breaks.has(b.idx)) return;
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  b.hp -= dmg;
  const [x, z] = center(b), wood = BREAKABLES[b.kind].wood;
  burst(new THREE.Vector3(x - dx*0.5, groundAt(x, z) + mr(0.4, 1.1), z - dz*0.5), wood ? 'wood' : 'spark', wood ? 5 : 3, 2.5);
  sfx.bang(!wood);
  if (b.hp <= 0) return breakDown(b, dx, dz);
  emit(['brh', b.idx, r2(b.hp/b.max), r2(dx), r2(dz)]);
  showHit(b, dx, dz);
}
export function showHit(b, dx, dz){
  if (dx || dz){ b.dx = dx; b.dz = dz; b.shake = 0.25; }
  b.lean = (1 - b.hp/b.max)*0.4;
  if (!falling.includes(b)) falling.push(b);
}
// Gone: the tile opens, the fence or barricade topples over away from the blow.
export function breakDown(b, dx, dz, local){
  world.breaks.delete(b.idx); world.city.grid[b.idx] = b.under;
  b.dx = dx || b.dx; b.dz = dz || b.dz; b.fall = 0.001; b.shake = 0;
  if (!falling.includes(b)) falling.push(b);
  if (!b.placed) world.broken.push(b.idx);
  gridChanged(!local);
  if (local) return;
  const [x, z] = center(b);
  emit(['br-', b.idx, r2(b.dx), r2(b.dz), 0]);
  sfx.splinter(); makeNoise(x, z, 14);
  burst(new THREE.Vector3(x, groundAt(x, z) + 0.6, z), BREAKABLES[b.kind].wood ? 'wood' : 'spark', 10, 3.5);
}
// Taken down by hand: the tile opens and the barricade is just gone.
export function removeBreak(b, local){
  world.breaks.delete(b.idx); world.city.grid[b.idx] = b.under;
  if (b.g && b.g.parent) b.g.parent.remove(b.g);
  gridChanged(!local);
  if (!local) emit(['br-', b.idx, 0, 0, 1]);
}
// Explosions knock down what's near: dmg at the middle, less toward the edge of radius r.
export function blastBreaks(x, z, r, dmg){
  if (!world.breaks) return;
  for (const b of [...world.breaks.values()]){
    const [bx, bz] = center(b), d = Math.hypot(bx - x, bz - z);
    if (d < r + 1) hitBreak(b, dmg*(1 - 0.6*Math.min(1, d/(r + 1))), bx - x, bz - z);
  }
}
// The breakable a zombie (or a kicking player) at (x,z) would walk into going (dx,dz), if any.
export function breakAhead(x, z, dx, dz, reach){
  if (!world.breaks || !world.breaks.size) return null;
  const l = Math.hypot(dx, dz) || 1;
  return world.breaks.get(Math.floor((z + dz/l*reach)/TILE)*N + Math.floor((x + dx/l*reach)/TILE)) || null;
}

// ---------- Barricades ----------
// Player p boards up the tile ~1.6 units in front of them (same level, nothing standing in it).
// Returns true when it went up (the caller uses up the item).
export function placeBarricade(p){
  const c = world.city, fx = Math.sin(p.angle), fz = Math.cos(p.angle), own = Math.floor(p.pos.z/TILE)*N + Math.floor(p.pos.x/TILE);
  let tx = Math.floor((p.pos.x + fx*1.6)/TILE), tz = Math.floor((p.pos.z + fz*1.6)/TILE);
  if (tz*N + tx === own){ tx = Math.floor((p.pos.x + fx*2.4)/TILE); tz = Math.floor((p.pos.z + fz*2.4)/TILE); }
  const idx = tz*N + tx, x = (tx + 0.5)*TILE, z = (tz + 0.5)*TILE;
  const no = msg => { toast(msg, 'bad', p); return false; };
  if (tx < 1 || tz < 1 || tx >= c.n - 2 || tz >= c.n - 1 || !walkable(c.grid[idx])) return no('Can’t put a barricade there');
  if (tileLevel(tx, tz) !== levelOf(p.pos.y)) return no('The ground there isn’t level with you');
  const inTile = (o, r) => Math.abs(o.x - x) < TILE/2 + r && Math.abs(o.z - z) < TILE/2 + r;
  if (zombies.some(o => !o.dead && inTile(o.pos, o.r)) || players.some(o => !o.dead && inTile(o.pos, o.radius))) return no('Something’s in the way');
  if (drops.some(d => inTile({ x:d.px, z:d.pz }, 0)) || pickups.some(h => inTile(h.g.position, 0))) return no('Pick up what’s there first');
  addBarricade(tx, tz, Math.abs(fx) > Math.abs(fz) ? 1 : 0, BREAKABLES.planks.hp);
  emit(['br+', tx, tz, Math.abs(fx) > Math.abs(fz) ? 1 : 0, 1]);
  gridChanged(true);
  sfx.hammer(); makeNoise(p.pos.x, p.pos.z, 10);
  floatText('Barricade up', 'good', p);
  return true;
}
// Builds a barricade on tile (tx,tz); rot 1 = it runs along z (you faced along x). Host and clients.
export function addBarricade(tx, tz, rot, hp){
  const c = world.city, idx = tz*N + tx;
  if (world.breaks.has(idx)) return world.breaks.get(idx);
  const x = (tx + 0.5)*TILE, z = (tz + 0.5)*TILE, g = new THREE.Group(), inner = new THREE.Group();
  g.position.set(x, groundAt(x, z), z); inner.rotation.y = rot ? Math.PI/2 : 0; g.add(inner); world.cityGroup.add(g);
  const part = (geo, mat, px, py, pz, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.z = rz || 0; m.castShadow = m.receiveShadow = true; inner.add(m); return m; };
  for (const sx of [-0.82, 0.82]) part(POST, WOOD2, sx, 0, 0);
  [0.35, 0.72, 1.1].forEach((y, i) => part(BOARD, i % 2 ? WOOD2 : WOOD, mr(-0.06, 0.06), y, 0.1, mr(-0.07, 0.07)));
  part(BOARD, WOOD, 0, 0.72, 0.16, rot ? -0.45 : 0.45).scale.x = 0.95;
  const b = { idx, x:tx, z:tz, kind:'planks', hp, max:BREAKABLES.planks.hp, under:c.grid[idx], g, placed:true, rot, lean:0, shake:0, dx:0, dz:1 };
  c.grid[idx] = T.FENCE; world.breaks.set(idx, b);
  if (hp < b.max) showHit(b, 0, 0);
  gridChanged(false);
  return b;
}

// ---------- Hold E: repair, take down ----------
// The jobs near player p (cached on the breakable so the interact target keeps its identity):
// repairing a damaged wooden one costs a plank; your barricades come down for one plank back.
export function breakJobs(p){
  const out = [];
  if (!world.breaks) return out;
  for (const b of world.breaks.values()){
    const [x, z] = center(b), d = Math.hypot(x - p.pos.x, z - p.pos.z);
    if (d > 2.3) continue;
    const B = BREAKABLES[b.kind];
    if (B.wood && b.hp < b.max - 0.5 && countItem(p, 'planks')){
      b.jobR = b.jobR || { kind:'repair', b, px:x, pz:z, time:1.2, range:2.3, noise:9, name:B.name };
      out.push([b.jobR, d]);
    } else if (b.placed){
      b.jobT = b.jobT || { kind:'takedown', b, px:x, pz:z, time:BARRICADE.takeDown, range:2.3, noise:6, name:B.name };
      out.push([b.jobT, d]);
    }
  }
  return out;
}
export const jobLabel = t => t.kind === 'repair' ? `Repair the ${t.name} (1 plank)` : `Take down the ${t.name}`;
export function finishJob(p, t){
  const b = t.b;
  if (!world.breaks.has(b.idx)) return;
  if (t.kind === 'repair'){
    if (!countItem(p, 'planks')) return;
    removeItem(p, 'planks', 1);
    b.hp = Math.min(b.max, b.hp + BARRICADE.repair); showHit(b, 0, 0);
    emit(['brh', b.idx, r2(b.hp/b.max), 0, 0]);
    sfx.hammer(); floatText(`−1 🪵 Planks · ${B(b)} repaired`, 'good', p);
  } else {
    removeBreak(b);
    if (addItem(p, 'planks', 1)) floatText('+1 🪵 Planks', 'good', p);
    sfxFor(p, 'pickup');
  }
}
const B = b => BREAKABLES[b.kind].name;

// ---------- Look ----------
// Leaning (more the more it's been hit), a shudder on each blow, and toppling once broken.
export function animateBreaks(dt){
  for (let i=falling.length-1;i>=0;i--){
    const b = falling[i];
    if (!b.g){ falling.splice(i, 1); continue; }
    let a = b.lean;
    if (b.fall){ b.fall = Math.min(1, b.fall + dt*2.5); a = 1.45*b.fall*b.fall; }
    if (b.shake > 0){ b.shake -= dt; a += Math.sin(b.shake*60)*0.06*(b.shake/0.25); }
    b.g.rotation.x = b.dz*a; b.g.rotation.z = -b.dx*a;
    if (b.fall >= 1 || (!b.fall && b.shake <= 0)) falling.splice(i, 1);
  }
}

// ---------- Mid-run join ----------
export function breakSync(){
  const out = [];
  if (!world.breaks) return out;
  for (const idx of world.broken) out.push(['br-', idx, 0, 1, 0]);
  for (const b of world.breaks.values()){
    if (b.placed) out.push(['br+', b.x, b.z, b.rot, r2(b.hp/b.max)]);
    else if (b.hp < b.max) out.push(['brh', b.idx, r2(b.hp/b.max), 0, 0]);
  }
  return out;
}
// A client applying the host's events.
export function mirrorBreak(ev){
  const [k, a, b, c, d, f] = ev;
  if (k === 'br+'){ const o = addBarricade(a, b, c, (d || 1)*BREAKABLES.planks.hp); return o; }
  const o = world.breaks && world.breaks.get(a); if (!o) return;
  if (k === 'brh'){ o.hp = b*o.max; showHit(o, c, d); }
  else if (k === 'br-'){ if (f) removeBreak(o, true); else breakDown(o, b, c, true); }
}
