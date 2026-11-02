// ---------- Companions ----------
// Stand-ins for other players until there's networking: the dev tools add them, and every step they
// fill their control state (p.ctl) the way a person at a keyboard would. They stay with the player you
// control (or the nearest other living player while you're dead), shoot the nearest zombie they can
// see, back off from ones in their face, swap to a weapon with ammo, patch themselves up and follow
// you into the exit. They never search, craft or throw. A client window opened with ?bot runs the same
// brain for its own player (client.js), so its actions go to the host through act().

import { TILE } from './config.js';
import { state, world, zombies, players } from './state.js';
import { lineOfSight } from './grid.js';
import { me } from './player.js';
import { descend } from './zombies.js';
import { useSlot, swapWeapon } from './inventory.js';
import { WEAPONS } from './items.js';
import { net } from './state.js';
import { act } from './client.js';
// On a bot client the inventory lives on the host: ask it.
const doSwap = (p, i) => net.role === 'client' ? act('swap', i) : swapWeapon(p, i);
const doUse = (p, i) => net.role === 'client' ? act('use', i) : useSlot(p, i);

const SIGHT = 15, SHOOT = 12, FOLLOW = 3.5, CATCH_UP = 10, CLOSE = 2.6;
function leader(p){
  const m = me();
  if (m && !m.dead && m !== p) return m;
  let best = null, bd = Infinity;
  for (const o of players){ if (o === p || o.dead) continue; const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z); if (d < bd){ bd = d; best = o; } }
  return best;
}
const slotOf = (p, id) => p.inv.findIndex(s => s && s.id === id);
const loaded = (p, w) => !!w && (WEAPONS[w.id].kind ? w.mag >= 1 : w.mag > 0 || p.ammo[w.id] > 0);

export function updateBot(p, dt){
  const c = p.ctl;
  c.mx = c.mz = 0; c.sprint = false; c.fire = false; c.use = false;
  if (state.mode !== 'play') return;
  // The nearest zombie in clear sight.
  let tgt = null, td = SIGHT;
  for (const z of zombies){
    if (z.dead || z.rise > 0 || z.turned > 0) continue;
    const d = Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
    if (d < td && lineOfSight(p.pos.x, p.pos.z, z.pos.x, z.pos.z)){ td = d; tgt = z; }
  }
  // Keep up with the leader (all the way into the exit once they're standing in it).
  const lead = leader(p);
  const exit = !!lead && state.phase === 'open' && Math.floor(lead.pos.x/TILE) >= world.city.n - 1;
  let mx = 0, mz = 0;
  if (lead){
    const dx = lead.pos.x - p.pos.x, dz = lead.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 0.001;
    if (d > (exit ? 0.4 : FOLLOW)){
      const dir = (d < 6 && lineOfSight(p.pos.x, p.pos.z, lead.pos.x, lead.pos.z)) ? [dx/d, dz/d] : descend(p, lead.dist) || [dx/d, dz/d];
      mx = dir[0]; mz = dir[1]; c.sprint = d > CATCH_UP;
    }
  }
  if (tgt && td < CLOSE){ mx -= (tgt.pos.x - p.pos.x)/td; mz -= (tgt.pos.z - p.pos.z)/td; }
  // Don't stand inside each other (players pass through one another), except squeezed into the exit.
  if (!exit) for (const o of players){
    if (o === p || o.dead) continue;
    const ox = p.pos.x - o.pos.x, oz = p.pos.z - o.pos.z, d = Math.hypot(ox, oz);
    if (d < 1.4 && d > 1e-3){ mx += ox/d*(1.4 - d); mz += oz/d*(1.4 - d); }
  }
  c.mx = mx; c.mz = mz;
  if (tgt){ c.aim.set(tgt.pos.x, 1.1, tgt.pos.z); c.fire = td < SHOOT; }
  else if (mx || mz) c.aim.set(p.pos.x + mx*3, 1.1, p.pos.z + mz*3);
  // Upkeep twice a second: a weapon with ammo in hand, bleeding stopped, a medkit when it's bad.
  p.botT = (p.botT || 0) - dt;
  if (p.botT > 0) return;
  p.botT = 0.5;
  if (!loaded(p, p.weapons[p.cur])){ const i = p.weapons.findIndex(w => w && loaded(p, w)); if (i >= 0) doSwap(p, i); }
  const kit = slotOf(p, 'medkit'), band = slotOf(p, 'bandage');
  if (p.hp < p.maxHp*0.45 && kit >= 0) doUse(p, kit);
  else if (p.bleeding && band >= 0) doUse(p, band);
  else if (p.bleeding && kit >= 0) doUse(p, kit);
}
