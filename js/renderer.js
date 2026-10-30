// ---------- Renderer / scene / camera ----------
import * as THREE from 'three';
import { TILE, N } from './config.js';
import { $, mr } from './utils.js';
import { state } from './state.js';

const container = $('game');
export const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2029);
const VIEW = 28;
export const camera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,320);
const CAM_OFFSET = new THREE.Vector3(40,48,40);
export const camFocus = new THREE.Vector3();
function resize(){
  const a = innerWidth / innerHeight;
  const v = a < 1 ? VIEW * 1.25 : VIEW;
  camera.left = -v*a/2; camera.right = v*a/2; camera.top = v/2; camera.bottom = -v/2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight(0x93a8c8, 0x2a2520, 0.62); scene.add(hemi);
scene.add(new THREE.AmbientLight(0xffffff, 0.12));
const sun = new THREE.DirectionalLight(0xffcf98, 0.85);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera, { left:-36, right:36, top:36, bottom:-36, near:1, far:150 });
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);
const SUN_OFFSET = new THREE.Vector3(-26,50,14);
export const muzzleLight = new THREE.PointLight(0xffc870, 0, 9, 2); scene.add(muzzleLight);
// Pooled light for fires/explosions (adding lights at runtime would recompile shaders).
export const fxLight = new THREE.PointLight(0xff8a3a, 0, 16, 2); scene.add(fxLight);

// Crystal takeover tint: k = 0 normal daylight, 1 the city drowned in violet. Only colors and
// intensities change, so no shader recompiles.
const TINT = [[hemi.color, 0x93a8c8, 0xa070ff], [hemi.groundColor, 0x2a2520, 0x2c1748], [sun.color, 0xffcf98, 0xc9a0ff], [scene.background, 0x1b2029, 0x1d1130]]
  .map(([c, a, b]) => [c, new THREE.Color(a), new THREE.Color(b)]);
export function setTint(k){
  for (const [c, a, b] of TINT) c.copy(a).lerp(b, k);
  hemi.intensity = 0.62 + 0.1*k; sun.intensity = 0.85 - 0.2*k;
}

// Orbits the city on the menu, otherwise follows `target` (the player).
export function updateCamera(dt, target){
  if (state.mode === 'menu'){
    state.menuT += dt;
    const c = N*TILE/2;
    camFocus.set(c + Math.sin(state.menuT*0.08)*22, 0, c + Math.cos(state.menuT*0.08)*22);
  } else {
    camFocus.lerp(target, Math.min(1, dt*9));
  }
  camera.position.copy(camFocus).add(CAM_OFFSET);
  camera.lookAt(camFocus);
  if (state.shake > 0){
    state.shake -= dt;
    const s = Math.max(0, state.shake)*0.7;
    camera.position.x += mr(-s,s); camera.position.y += mr(-s,s); camera.position.z += mr(-s,s);
  }
  sun.position.copy(camFocus).add(SUN_OFFSET); sun.target.position.copy(camFocus);
}
