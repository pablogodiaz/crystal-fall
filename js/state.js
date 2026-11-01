// ---------- Shared mutable state ----------
// ES module bindings are read-only for importers, so anything that gets
// reassigned across modules lives on one of these objects.
import * as THREE from 'three';
import { N } from './config.js';

export const state = { mode:'menu', level:1, seed:0, phase:'explore', crystalFound:false, spawnTimer:0, flowTimer:0,
  // Takeover (after the Crystal breaks): seconds left, surge spawns still to come, alive takeover zombies, next countdown beep.
  takeover:0, surge:0, hordeAlive:0, tick:0,
  kills:0, cityKills:0, runTime:0, cityTime:0, shake:0, menuT:0,
  // Threat unlocks (specials.js): run's intro order, id -> city it appeared in, banners already shown.
  threatOrder:[], threatIntro:{}, seenThreats:new Set(), forceThreat:null,
  cheated:false,  // dev tools touched this run: shows a Dev chip, best run isn't saved
  // Players: me = index (in `players`) of the one this machine controls, view = the one the camera
  // follows (someone else while you're dead and spectating). host = this machine runs the simulation
  // and may pause / open the dev tools (always true until there's networking).
  me:0, view:0, host:true,
  exitT:0, exitIn:0 };  // seconds every living player has stood in the open exit; how many are in it

// Per-city references, replaced by startCity() / teardownCity().
export const world = {
  city:null, cityGroup:null, buildingMeshes:[], crystal:null, barricade:null, exitMarker:null,
  explored:new Uint8Array(N*N), mmDirty:true,
  lure:null,  // active pipe bomb that alerted zombies walk toward
  // Walk-in landmarks: { shell, roof, key, k } per building (k = cutaway 0..1), and tile -> index+1 inside one.
  interiors:[], interiorAt:null
};

// Live entity lists (mutated in place, never reassigned). players: everyone in the session (player.js).
export const players = [];
export const zombies = [], dying = [], bullets = [], particles = [], pickups = [], decals = [];
// Ground loot, thrown molotovs/pipe bombs in flight, and landed fires/bombs.
export const drops = [], throwns = [], hazards = [];
// Spitter acid in flight, acid puddles, and scream shockwave rings.
export const spits = [], puddles = [], rings = [];

// Dev tools (` key, devtools.js). Cheat flags read by gameplay code; timeScale (0 = frozen) and
// zoom are applied in main.js. spawn = { type, mods } overrides the next rollThreat().
export const dev = { open:false, god:false, ammo:false, stamina:false, noclip:false, ignored:false, freeze:false,
  oneHit:false, clickTp:false, speed:1, timeScale:1, zoom:1, spawn:null };

// Networking (net.js): role 'solo' | 'host' (runs the simulation, others join) | 'client' (mirrors the
// host's world: client.js). id = this connection's id at the relay. state.host = role !== 'client'.
export const net = { role:'solo', id:0, room:'main', name:'' };

// Raw input state, written by input.js.
export const keys = {};
export const mouse = { down:false };
export const mouseNDC = new THREE.Vector2();
