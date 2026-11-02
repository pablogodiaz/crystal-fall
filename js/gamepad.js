// ---------- Gamepad ----------
// Controllers (Switch Pro / Joy-Cons, Xbox, PlayStation…) through the browser's Gamepad API, standard
// mapping, buttons by position. pollPad() runs every frame from main.js: in play it fills `pad` (state.js),
// which readLocal (player.js) folds into the controls of the player you control, and turns button presses
// into the same one-shot actions the keyboard sends (act()); while an overlay screen is up, the d-pad and
// left stick move focus between its buttons and the right face button presses one.
//   Left stick move · right stick aim (tilt further to aim further: throws, the gravity well) · ZR fire ·
//   hold ZL aim a throw, release to throw (bottom button cancels) · L / left stick click sprint ·
//   right button hold to search / pick up · bottom melee · left reload · top swap (hold: drop the gun) ·
//   R next throwable · d-pad ←/→ pick an item, ↑ use it (hold: drop it), ↓ or right stick click map ·
//   − workbench · + pause. While dead: right button / R / → next player, L / ← previous.
import * as THREE from 'three';
import { $ } from './utils.js';
import { camera } from './renderer.js';
import { state, pad, mouse } from './state.js';
import { me } from './player.js';
import { togglePause, toggleCraft, crafting, spectate } from './game.js';
import { startAim, cancelAim } from './inventory.js';
import { act } from './client.js';
import { throwNow } from './input.js';

const B = { bottom:0, right:1, left:2, top:3, L:4, R:5, ZL:6, ZR:7, minus:8, plus:9, LS:10, RS:11, up:12, down:13, dleft:14, dright:15 };
const DEAD = 0.25, HOLD = 0.6, AIM_MIN = 2.5, AIM_MAX = 13, FOLLOW = 0.4;  // stick deadzone; hold time; aim reach; s before aim follows your feet
const now = [], was = [], heldT = [];
let used = {}, idleT = 9, hist = [], navT = 0, navDir = '';

const down = i => !!now[i];
const pressed = i => now[i] && !was[i];
const released = i => !now[i] && was[i];
// Radial deadzone, rescaled so just past it is 0 and full tilt is 1.
function stick(gp, a){
  const x = gp.axes[a] || 0, y = gp.axes[a+1] || 0, m = Math.hypot(x, y);
  if (m < DEAD) return null;
  const k = Math.min(1, (m - DEAD)/(1 - DEAD))/m;
  return { x:x*k, y:y*k, m:Math.min(1, (m - DEAD)/(1 - DEAD)) };
}
// Screen direction (x right, y down) → world direction on the ground, undoing the camera's foreshortening,
// so pushing a stick toward a point on screen walks/aims at that point.
const look = new THREE.Vector3();
function toWorld(sx, sy){
  camera.getWorldDirection(look);
  const h = Math.hypot(look.x, look.z) || 1, fx = look.x/h, fz = look.z/h, sinE = Math.max(0.2, -look.y);
  const wx = -fz*sx - fx*sy/sinE, wz = fx*sx - fz*sy/sinE, l = Math.hypot(wx, wz) || 1;
  return [wx/l, wz/l];
}
function firstPad(){
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of list) if (gp && gp.connected) return gp;
  return null;
}
export function padOff(){
  if (!pad.on) return;
  pad.on = false; pad.mx = pad.mz = 0; pad.fire = pad.sprint = pad.use = pad.map = false;
  document.body.classList.remove('pad'); markSlot();
}
function padOn(){ if (!pad.on){ pad.on = true; document.body.classList.add('pad'); markSlot(); } }

export function pollPad(dt){
  const gp = firstPad();
  if (!gp){ if (pad.on) padOff(); return; }
  for (let i=0;i<17;i++){ was[i] = now[i]; const b = gp.buttons[i]; now[i] = !!b && (b.pressed || b.value > 0.5); }
  const ls = stick(gp, 0), rs = stick(gp, 2);
  if (ls || rs || now.some(Boolean)) padOn();
  if (!pad.on) return;
  for (let i=0;i<17;i++){ heldT[i] = now[i] ? (heldT[i] || 0) + dt : 0; if (!now[i] && !was[i]) used[i] = false; }
  const screen = document.querySelector('.screen:not(.hidden)');
  if (screen) return menu(screen, ls, dt);
  play(ls, rs, dt);
}

// ---------- Play ----------
function play(ls, rs, dt){
  const p = me();
  if (ls){ const [x, z] = toWorld(ls.x, ls.y); pad.mx = x; pad.mz = z; } else pad.mx = pad.mz = 0;
  // Aim: the right stick's direction and tilt. Letting go keeps where it pointed just before it sprang
  // back (below); after a moment of not touching it, aim follows the way you walk.
  const t = performance.now()/1000;
  if (rs){
    const [x, z] = toWorld(rs.x, rs.y);
    pad.ax = x; pad.az = z; pad.aimD = AIM_MIN + (AIM_MAX - AIM_MIN)*rs.m; idleT = 0;
    hist.push([t, x, z, pad.aimD]); while (hist.length && hist[0][0] < t - 0.3) hist.shift();
  } else {
    // The stick springs back through ever smaller tilts, so the furthest sample of the last 0.15 s is where it was held.
    if (idleT === 0 && hist.length){ let h = null; for (const s of hist) if (s[0] >= t - 0.15 && (!h || s[3] >= h[3])) h = s; if (h){ pad.ax = h[1]; pad.az = h[2]; pad.aimD = h[3]; } }
    if (idleT === 0) hist = [];
    idleT += dt;
    if (idleT > FOLLOW && ls && !p.aiming){ pad.ax = pad.mx; pad.az = pad.mz; }
  }
  pad.sprint = down(B.L) || down(B.LS);
  pad.map = down(B.RS) || down(B.down);
  if (p.dead){
    pad.fire = pad.use = false;
    if (state.mode === 'play'){
      if (pressed(B.right) || pressed(B.R) || pressed(B.dright) || pressed(B.ZR)) spectate(1);
      if (pressed(B.L) || pressed(B.dleft) || pressed(B.ZL)) spectate(-1);
    }
    return;
  }
  pad.use = down(B.right);
  pad.fire = down(B.ZR) && !p.aiming;
  if (pressed(B.ZL)) startAim(p);
  if (released(B.ZL)) throwNow();
  if (pressed(B.bottom)){ if (p.aiming) cancelAim(p); else act('melee'); }
  if (pressed(B.left)) act('reload');
  if (pressed(B.R)) act('cycle', 1);
  tapHold(B.top, () => act('swap'), () => act('drop'));
  if (pressed(B.dleft)) pickSlot(p, -1);
  if (pressed(B.dright)) pickSlot(p, 1);
  tapHold(B.up, () => act('use', pad.sel), () => act('dropSlot', pad.sel));
  if (pressed(B.minus)) toggleCraft();
  if (pressed(B.plus)) togglePause();
}
// A button that does one thing when tapped and another when held for HOLD s (fires once).
function tapHold(i, tap, hold){
  if (down(i) && heldT[i] >= HOLD && !used[i]){ used[i] = true; hold(); }
  if (released(i) && !used[i]) tap();
}
// D-pad ←/→ step through the pack, skipping empty slots (unless it's all empty).
function pickSlot(p, dir){
  const n = p.inv.length;
  for (let k=1;k<=n;k++){ const i = ((pad.sel + dir*k) % n + n) % n; if (p.inv[i]){ pad.sel = i; return markSlot(); } }
}
function markSlot(){
  const els = $('inventory').children;
  for (let i=0;i<els.length;i++) els[i].classList.toggle('pad-sel', pad.on && i === pad.sel);
}

// ---------- Menus ----------
// Spatial focus: the nearest enabled, visible button in the pushed direction (straight ahead counts
// more than off to the side). Held directions repeat after a pause.
function menu(screen, ls, dt){
  pad.mx = pad.mz = 0; pad.fire = pad.use = pad.sprint = pad.map = false; mouse.down = false;
  let dir = down(B.up) ? 'u' : down(B.down) ? 'd' : down(B.dleft) ? 'l' : down(B.dright) ? 'r' : '';
  if (!dir && ls && ls.m > 0.5) dir = Math.abs(ls.x) > Math.abs(ls.y) ? (ls.x > 0 ? 'r' : 'l') : (ls.y > 0 ? 'd' : 'u');
  if (!dir) navDir = '';
  else if (dir !== navDir){ navDir = dir; navT = 0.35; moveFocus(screen, dir); }
  else if ((navT -= dt) <= 0){ navT = 0.12; moveFocus(screen, dir); }
  const btns = buttons(screen), f = document.activeElement;
  if (pressed(B.right)){ if (btns.includes(f)) f.click(); else if (btns[0]) btns[0].focus(); }
  if (pressed(B.bottom)) back(screen);
  if (pressed(B.plus)){ if (state.mode === 'paused') togglePause(); else if (crafting()) toggleCraft(); }
  if (pressed(B.minus) && crafting()) toggleCraft();
}
const buttons = screen => [...screen.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null);
function moveFocus(screen, dir){
  const btns = buttons(screen), f = document.activeElement;
  if (!btns.length) return;
  if (!btns.includes(f)){ btns[0].focus(); return; }
  const r = f.getBoundingClientRect(), cx = r.left + r.width/2, cy = r.top + r.height/2;
  const [dx, dy] = { u:[0,-1], d:[0,1], l:[-1,0], r:[1,0] }[dir];
  let best = null, bs = Infinity;
  for (const b of btns){
    if (b === f) continue;
    const q = b.getBoundingClientRect(), ox = q.left + q.width/2 - cx, oy = q.top + q.height/2 - cy;
    const ahead = ox*dx + oy*dy, side = Math.abs(ox*dy - oy*dx);
    if (ahead <= 4) continue;
    const s = ahead + side*2;
    if (s < bs){ bs = s; best = b; }
  }
  if (best){ best.focus(); best.scrollIntoView({ block:'nearest' }); }
}
// The bottom button backs out: leave the workbench, resume, or the upgrade screen's ← Back.
function back(screen){
  if (crafting()) return toggleCraft();
  if (state.mode === 'paused') return togglePause();
  const b = buttons(screen).find(b => b.textContent.trim().startsWith('←'));
  if (b) b.click();
}
