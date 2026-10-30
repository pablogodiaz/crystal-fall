// ---------- Boot & main loop ----------
import { $ } from './utils.js';
import { renderer, scene, camera, updateCamera } from './renderer.js';
import { state } from './state.js';
import { player } from './player.js';
import { updateFade, updateInteriors } from './fx.js';
import { updateHUD } from './hud.js';
import { initInput } from './input.js';
import { startCity, newSeed, update, animateWorld, loadBest, bestLine } from './game.js';

initInput();
$('bestText').textContent = bestLine(loadBest());
// A city is generated behind the menu so the camera has something to orbit.
startCity(1, newSeed());
$('startBtn').focus();

let last = performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last)/1000); last = now;
  const t = now/1000;
  if (state.mode === 'play') update(dt);
  animateWorld(dt, t);
  updateCamera(dt, player.pos);
  if (state.mode !== 'menu'){ updateFade(dt); updateInteriors(dt); updateHUD(dt, t); }
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
