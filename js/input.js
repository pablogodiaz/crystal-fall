// ---------- Input ----------
import { $ } from './utils.js';
import { renderer } from './renderer.js';
import { state, keys, mouse, mouseNDC } from './state.js';
import { tryReload } from './combat.js';
import { toggleMute } from './audio.js';
import { newRun, togglePause } from './game.js';

export function initInput(){
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyR') tryReload();
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyM') toggleMute();
    if (state.mode === 'play' && ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  const cv = renderer.domElement;
  cv.addEventListener('mousemove', e => { mouseNDC.x = e.clientX/innerWidth*2 - 1; mouseNDC.y = -(e.clientY/innerHeight)*2 + 1; });
  cv.addEventListener('mousedown', e => { if (e.button === 0 && state.mode === 'play') mouse.down = true; });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; if (state.mode === 'play') togglePause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'play') togglePause(); });
  $('startBtn').addEventListener('click', newRun);
  $('retryBtn').addEventListener('click', newRun);
  $('resumeBtn').addEventListener('click', togglePause);
}
