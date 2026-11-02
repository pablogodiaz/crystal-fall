// ---------- Input ----------
// Keyboard and mouse drive the player this machine controls (me()): held keys and the mouse are
// read every step by player.js (readLocal); one-shot actions call the game with me(). While you're
// dead, clicks and Q switch which living player you watch.
import { $ } from './utils.js';
import { renderer } from './renderer.js';
import { state, keys, mouse, mouseNDC, dev, players, net, pad } from './state.js';
import { me } from './player.js';
import { toggleMute } from './audio.js';
import { newRun, togglePause, toggleCraft, crafting, spectate } from './game.js';
import { startAim, releaseThrow, cancelAim, selectedThrowable, countItem } from './inventory.js';
import { act } from './client.js';
import { craftFromKey, toast } from './hud.js';
import { padOff } from './gamepad.js';
import { isDevKey, toggleDev, devTypingIn, teleportToCursor } from './devtools.js';

export function initInput(){
  addEventListener('keydown', e => {
    if (isDevKey(e)){
      e.preventDefault();
      if (!e.repeat){ if (state.host) toggleDev(); else toast('Only the host can open the dev tools'); }
      return;
    }
    if (devTypingIn(e.target)) return;  // typing into a dev tools field
    keys[e.code] = true; padOff();
    if (state.mode === 'play' && ['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    const p = me();
    if (p.dead && state.mode === 'play'){
      if (e.code === 'KeyQ' || e.code === 'Space') spectate(1);
    } else {
      if (e.code === 'KeyR') act('reload');
      if (e.code === 'KeyQ') act('swap');
      if (e.code === 'KeyG') act('drop');
      if (e.code === 'KeyF') act('melee');
      if (e.code === 'KeyT') act('cycle', 1);
      if (e.code === 'KeyC') toggleCraft();
    }
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit){ if (crafting()) craftFromKey(+digit[1] - 1); else act('use', +digit[1] - 1); }
    if (e.code === 'Escape' || e.code === 'KeyP'){ if (crafting()) toggleCraft(); else togglePause(); }
    if (e.code === 'KeyM') toggleMute();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const cv = renderer.domElement;
  cv.addEventListener('mousemove', e => { if (pad.on && Math.abs(e.movementX) + Math.abs(e.movementY) > 2) padOff(); mouseNDC.x = e.clientX/innerWidth*2 - 1; mouseNDC.y = -(e.clientY/innerHeight)*2 + 1; });
  // Hold right click to aim a throwable, release to throw; a left click while aiming cancels it.
  cv.addEventListener('mousedown', e => {
    const p = me(); padOff();
    if (e.button === 0 && dev.clickTp && state.mode === 'play'){ teleportToCursor(); return; }
    if (p.dead){ if (state.mode === 'play') spectate(e.button === 2 ? -1 : 1); return; }
    if (e.button === 0){ if (p.aiming) cancelAim(p); else if (state.mode === 'play') mouse.down = true; }
    if (e.button === 2) startAim(p);
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; if (e.button === 2) throwNow(); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  // Mouse wheel picks the throwable. Trackpads send bursts of small deltas, so accumulate and
  // allow at most one step per 150 ms.
  let wheelAcc = 0, wheelT = 0;
  cv.addEventListener('wheel', e => {
    if (state.mode !== 'play') return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    const now = performance.now();
    if (Math.abs(wheelAcc) >= 40 && now - wheelT > 150){ act('cycle', Math.sign(wheelAcc)); wheelAcc = 0; wheelT = now; }
  }, { passive:false });
  // Losing focus pauses a solo game; with others playing only the host's Esc pauses, so it just lets go of everything.
  const away = () => { for (const k in keys) keys[k] = false; mouse.down = false; cancelAim(me()); if (state.mode === 'play' && players.length === 1) togglePause(); };
  addEventListener('blur', away);
  document.addEventListener('visibilitychange', () => { if (document.hidden) away(); });
  $('startBtn').addEventListener('click', () => newRun());  // (the lobby buttons are in lobby.js)
  $('retryBtn').addEventListener('click', () => newRun());
  $('resumeBtn').addEventListener('click', togglePause);
  $('craftClose').addEventListener('click', toggleCraft);
}
// Releasing right click: the throw happens on the host, which needs the aim point (and what's selected).
export function throwNow(){
  const p = me();
  if (net.role !== 'client') return releaseThrow(p);
  if (!p.aiming) return;
  p.aiming = false;
  const id = selectedThrowable(p);
  if (countItem(p, id)) act('throw', [Math.round(p.ctl.aim.x*100)/100, Math.round(p.ctl.aim.z*100)/100, id]);
}
