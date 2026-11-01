// ---------- Boot & main loop ----------
import { $ } from './utils.js';
import { renderer, scene, camera, updateCamera } from './renderer.js';
import { state, dev, net } from './state.js';
import { addPlayer, viewed, updateLamp } from './player.js';
import { updateFade, updateInteriors } from './fx.js';
import { updateHUD } from './hud.js';
import { initInput } from './input.js';
import { initDev, updateDev } from './devtools.js';
import { startCity, newSeed, update, animateWorld, loadBest, bestLine } from './game.js';
import { initHost, hostTick } from './host.js';
import { clientUpdate, clientEffects } from './client.js';
import { initLobby } from './lobby.js';

addPlayer();  // P1: the player this machine controls
initHost(); initInput(); initDev(); initLobby();
$('bestText').textContent = bestLine(loadBest());
// A city is generated behind the menu so the camera has something to orbit.
startCity(1, newSeed());
$('startBtn').focus();

let last = performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last)/1000); last = now;
  const t = now/1000;
  updateDev(dt);
  let ts = 1;
  if (net.role === 'client'){ clientUpdate(dt, t); clientEffects(dt); }  // a client only mirrors the host's world (client.js)
  else {
    // Dev time scale: 0 stops the world, >1 runs several capped steps per frame.
    ts = state.mode === 'play' ? dev.timeScale : 1; const n = Math.ceil(ts);
    for (let i=0;i<n && state.mode === 'play';i++) update(dt*ts/n);
    hostTick(dt);
  }
  animateWorld(dt*ts, t);
  updateCamera(dt, viewed().pos); updateLamp();
  if (state.mode !== 'menu'){ updateFade(dt); updateInteriors(dt); updateHUD(dt, t); }
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
