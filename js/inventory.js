// ---------- Inventory & weapons ----------
// Item stacks in player.inv (INV_SLOTS slots of { id, n } or null), two weapon slots in
// player.weapons ({ id, mag } or null), reserve ammo per weapon in player.ammo.
// All of it lives on `player`, so it carries over between cities.
import { WEAPONS, ITEMS, RECIPES, THROWABLES } from './items.js';
import { state } from './state.js';
import { player, refreshGun } from './player.js';
import { spawnDrop } from './loot.js';
import { throwItem } from './throwables.js';
import { toast } from './hud.js';
import { sfx } from './audio.js';

export const curWeapon = () => player.weapons[player.cur];
export const magSize = w => Math.round(WEAPONS[w.id].mag * player.magMul);
export const carried = () => player.weapons.filter(Boolean).map(w => w.id);
export function countItem(id){ let n = 0; for (const s of player.inv) if (s && s.id === id) n += s.n; return n; }

// Fills existing stacks first, then empty slots. Returns how many were added.
export function addItem(id, n){
  const max = ITEMS[id].max; let left = n;
  for (const s of player.inv){ if (!left) break; if (s && s.id === id && s.n < max){ const k = Math.min(left, max - s.n); s.n += k; left -= k; } }
  for (let i=0;i<player.inv.length && left > 0;i++) if (!player.inv[i]){ const k = Math.min(left, max); player.inv[i] = { id, n:k }; left -= k; }
  return n - left;
}
export function removeItem(id, n){
  for (let i=player.inv.length-1;i>=0 && n>0;i--){
    const s = player.inv[i]; if (!s || s.id !== id) continue;
    const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) player.inv[i] = null;
  }
}
// Returns how many rounds fit under the reserve cap.
export function addAmmo(id, n){
  const k = Math.max(0, Math.min(n, WEAPONS[id].maxAmmo - player.ammo[id]));
  player.ammo[id] += k; return k;
}
// 'new' = took a free weapon slot, 'ammo' = already carried (its rounds go to the reserve), 'full' = no room.
export function giveWeapon(id, mag){
  if (mag === undefined) mag = WEAPONS[id].mag;
  if (carried().includes(id)){ addAmmo(id, mag); return 'ammo'; }
  const i = player.weapons.indexOf(null);
  if (i < 0) return 'full';
  player.weapons[i] = { id, mag };
  return 'new';
}
// Swaps the held weapon for one on the ground; returns the weapon put down.
export function replaceWeapon(id, mag){
  const old = curWeapon();
  player.weapons[player.cur] = { id, mag }; player.reloadT = 0; player.fireCd = 0.3; refreshGun();
  return old;
}
export function swapWeapon(){
  if (state.mode !== 'play') return;
  const o = 1 - player.cur; if (!player.weapons[o]) return;
  player.cur = o; player.reloadT = 0; player.fireCd = 0.3; refreshGun(); sfx.swap();
}

const heal = n => { player.hp = Math.min(player.maxHp, player.hp + n); };
const consume = i => { const s = player.inv[i]; s.n--; if (!s.n) player.inv[i] = null; };
export function useSlot(i){
  if (state.mode !== 'play') return;
  const s = player.inv[i]; if (!s) return;
  switch (s.id){
    case 'bandage':
      if (!player.bleeding && player.hp >= player.maxHp) return toast('You don’t need a bandage');
      consume(i); heal(10); sfx.use();
      toast(player.bleeding ? 'Bleeding stopped' : 'Bandaged up', 'good'); player.bleeding = false; return;
    case 'medkit':
      if (!player.bleeding && player.hp >= player.maxHp) return toast('Already at full health');
      consume(i); heal(50); player.bleeding = false; sfx.use(); return toast('+50 health', 'good');
    case 'food':
      if (player.hunger > 0.95) return toast('You’re not hungry');
      consume(i); player.hunger = Math.min(1, player.hunger + 0.35); sfx.use(); return toast('+35 food', 'good');
    case 'scrap': return toast('Press C to craft with scrap');
    case 'molotov': case 'pipebomb':
      if (throwItem(s.id)) consume(i); return;
  }
}
// ---------- Throwables ----------
// The selection is a preference: if you have none of the selected kind but some of another,
// G throws (and the HUD shows) the one you have.
export function selectedThrowable(){
  if (countItem(player.throwSel)) return player.throwSel;
  return THROWABLES.find(id => countItem(id)) || player.throwSel;
}
export function throwSelected(){
  if (state.mode !== 'play') return;
  const id = selectedThrowable();
  if (!countItem(id)) return toast('No throwables. Craft some with scrap (C)');
  if (throwItem(id)) removeItem(id, 1);
}
// Picks the next throwable kind you're carrying. Carrying none just changes the preference.
export function cycleThrowable(dir){
  if (state.mode !== 'play') return;
  const n = THROWABLES.length, cur = THROWABLES.indexOf(selectedThrowable());
  const order = Array.from({ length:n-1 }, (_, i) => THROWABLES[((cur + dir*(i+1)) % n + n) % n]);
  const next = order.find(id => countItem(id));
  if (next){ player.throwSel = next; sfx.swap(); }
  else if (countItem(THROWABLES[cur])) toast(`Only ${ITEMS[THROWABLES[cur]].name.toLowerCase()}s in your pack`);
  else player.throwSel = order[0];
}
// Right-click a slot: drop the whole stack at your feet.
export function dropSlot(i){
  if (state.mode !== 'play') return;
  const s = player.inv[i]; if (!s) return;
  player.inv[i] = null;
  spawnDrop('item', s.id, s.n, player.pos.x, player.pos.z, true);
  toast(`Dropped ${s.n} ${ITEMS[s.id].name}`);
}
// Returns an error message, or null on success.
export function craft(id){
  const r = RECIPES.find(r => r.id === id);
  if (countItem('scrap') < r.scrap) return `Needs ${r.scrap} scrap`;
  removeItem('scrap', r.scrap);
  if (!addItem(id, 1)){ addItem('scrap', r.scrap); return 'No room in your pack'; }
  sfx.craft();
  return null;
}
