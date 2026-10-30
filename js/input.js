// ---------- Input ----------
import { $ } from './utils.js';
import { renderer } from './renderer.js';
import { state, keys, mouse, mouseNDC } from './state.js';
import { tryReload, melee } from './combat.js';
import { toggleMute } from './audio.js';
import { newRun, togglePause, toggleCraft } from './game.js';
import { swapWeapon, useSlot, startAim, releaseThrow, cancelAim, cycleThrowable } from './inventory.js';
import { craftFromKey } from './hud.js';

export function initInput(){
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (state.mode === 'play' && ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyR') tryReload();
    if (e.code === 'KeyQ') swapWeapon();
    if (e.code === 'KeyF') melee();
    if (e.code === 'KeyG') startAim();
    if (e.code === 'KeyT') cycleThrowable(1);
    if (e.code === 'KeyC') toggleCraft();
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit){ if (state.mode === 'craft') craftFromKey(+digit[1] - 1); else useSlot(+digit[1] - 1); }
    if (e.code === 'Escape' || e.code === 'KeyP'){ if (state.mode === 'craft') toggleCraft(); else togglePause(); }
    if (e.code === 'KeyM') toggleMute();
  });
  addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyG') releaseThrow(); });
  const cv = renderer.domElement;
  cv.addEventListener('mousemove', e => { mouseNDC.x = e.clientX/innerWidth*2 - 1; mouseNDC.y = -(e.clientY/innerHeight)*2 + 1; });
  cv.addEventListener('mousedown', e => {
    if (e.button === 0 && state.mode === 'play') mouse.down = true;
    if (e.button === 2) cancelAim();
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  // Mouse wheel picks the throwable. Trackpads send bursts of small deltas, so accumulate and
  // allow at most one step per 150 ms.
  let wheelAcc = 0, wheelT = 0;
  cv.addEventListener('wheel', e => {
    if (state.mode !== 'play') return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    const now = performance.now();
    if (Math.abs(wheelAcc) >= 40 && now - wheelT > 150){ cycleThrowable(Math.sign(wheelAcc)); wheelAcc = 0; wheelT = now; }
  }, { passive:false });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; cancelAim(); if (state.mode === 'play') togglePause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'play') togglePause(); });
  $('startBtn').addEventListener('click', newRun);
  $('retryBtn').addEventListener('click', newRun);
  $('resumeBtn').addEventListener('click', togglePause);
  $('craftClose').addEventListener('click', toggleCraft);
}
