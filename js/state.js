// ---------- Shared mutable state ----------
// ES module bindings are read-only for importers, so anything that gets
// reassigned across modules lives on one of these objects.
import * as THREE from 'three';
import { N } from './config.js';

export const state = { mode:'menu', level:1, phase:'explore', crystalFound:false, hordeToSpawn:0, hordeAlive:0, spawnTimer:0, flowTimer:0,
  kills:0, cityKills:0, runTime:0, cityTime:0, shake:0, menuT:0 };

// Per-city references, replaced by startCity() / teardownCity().
export const world = {
  city:null, cityGroup:null, buildingMeshes:[], crystal:null, barricade:null, exitMarker:null,
  explored:new Uint8Array(N*N), mmDirty:true, lastTile:-1
};

// Live entity lists (mutated in place, never reassigned).
export const zombies = [], dying = [], bullets = [], particles = [], pickups = [], decals = [];

// Raw input state, written by input.js.
export const keys = {};
export const mouse = { down:false };
export const mouseNDC = new THREE.Vector2();
