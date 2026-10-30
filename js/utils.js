// ---------- Helpers ----------
export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// Seeded RNG for city generation (rand/randi/pick). Reseeded per city via seedRng().
// Everything else (FX, AI, spawns) uses Math.random through mr().
export let rng = Math.random;
export function seedRng(seed){ rng = mulberry32(seed); }
export const rand = (a,b) => a + rng()*(b-a);
export const randi = (a,b) => Math.floor(rand(a,b+1));
export const pick = arr => arr[Math.floor(rng()*arr.length)];
export const mr = (a,b) => a + Math.random()*(b-a);

export const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
export function lerpAngle(a,b,t){ const d = ((b-a+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI; return a + d*t; }
export const fmtTime = s => { s = Math.floor(s); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); };
export const $ = id => document.getElementById(id);
