# Crystal Fall — notes for Claude

Isometric zombie roguelike in Three.js. Plain ES modules, **no build step, no npm**:
the repo is served as-is by GitHub Pages. Keep this file updated whenever you change
game design, file layout, or conventions.

## Running locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Three.js **r128** comes from cdnjs through the import map
in `index.html` (`"three"` → `three.js/r128/three.module.js`). Don't bump the version casually:
lighting intensities, `PCFSoftShadowMap` look, and APIs are tuned for r128.

## Game design

- **Run structure:** one life per run. Each run is a sequence of procedurally generated
  quarantined cities (City 1, 2, 3…). Difficulty scales with `state.level`.
- **City loop** (`state.phase`):
  1. `explore` — find the Crystal (violet beam) in the plaza block. It counts as "found" when
     you get within 19 units or shoot it.
  2. Shoot the Crystal (HP `30 + 15*(level-1)`) → `horde` — `28 + 12*(level-1)` horde zombies
     spawn 15–30 units away; all zombies become alert.
  3. When the horde is dead → `open` — the barricade on the east wall disappears and a green exit
     marker appears.
  4. Walk into the exit tile column → upgrade screen (pick 1 of 3 random upgrades, heal 40% of max HP)
     → next city with a new seed.
- **Game modes** (`state.mode`): `menu` (camera orbits a city behind the title card), `play`,
  `paused`, `upgrade`, `dead`. Simulation (`update`) only runs in `play`; cosmetic animation
  (`animateWorld`) runs always.
- **Player:** 100 HP, 12-round mag, 1.3 s reload, stamina-based sprint (×1.55). WASD is
  screen-relative on the isometric grid; mouse aims on a plane at gun height.
  Upgrades (`js/upgrades.js`) mutate player stats directly.
- **Zombies:** `walker`, `runner`, `brute` (`ZTYPES` in `js/zombies.js`). HP scales +30%/level,
  speed +4%/level; runner/brute odds rise with level. Unalerted zombies wander and despawn when
  >62 units away; they alert within 15 units, when shot, or when you fire within 28 units.
  Alerted zombies follow a BFS flow field toward the player (recomputed every 0.25 s).
- **Ambient spawning:** outside the horde, zombies trickle in 24–42 units away up to a cap
  (`12 + 4*level`, or `8 + 4*level` once the road is open).
- **Pickups:** killed zombies sometimes drop a medkit (+25 HP); more likely from brutes or when
  you're below 40% HP.
- **Meta:** best run (`{ city, kills }`) stored in `localStorage['crystal-fall-best']`.
- **Controls:** WASD/arrows move, mouse aims, hold left click to fire, Shift sprints, R reloads,
  Esc/P pauses, M mutes.

## Folder structure

```
index.html        Markup (HUD, overlay screens), import map, loads css + js/main.js
css/style.css     All styles; light/dark theme tokens on :root
js/
  main.js         Boot (input, best score, menu city) and the requestAnimationFrame loop
  config.js       Grid constants: TILE, N, tile types T, walkable(), DIRS8, names, palette
  utils.js        Seeded RNG (rng/rand/randi/pick), mr (Math.random range), clamp, lerpAngle, fmtTime, $
  state.js        Shared mutable state: `state`, `world`, entity arrays, input state
  renderer.js     WebGLRenderer, scene, orthographic camera, lights, resize, updateCamera()
  assets.js       Shared geometries/materials (SH), window textures, carMat()
  audio.js        Procedural WebAudio SFX (sfx.*), initAudio(), toggleMute()
  cityGen.js      Pure procedural city generation from a seed (grid + prop lists)
  cityScene.js    Builds/tears down the city's Three.js meshes, Crystal, barricade, exit marker
  grid.js         Tile collision (isBlockedTile, resolveCircle), BFS flow field, fog-of-war reveal
  player.js       Player mesh, base stats, movement/aim/reload update
  zombies.js      Zombie types, spawning, AI, damage/death
  combat.js       Firing, bullets, hurtPlayer, Crystal hits
  fx.js           Particles, blood decals, health pickups, building fade
  hud.js          HUD bars/text, minimap, banner, showScreen()
  upgrades.js     Upgrade definitions
  game.js         Game flow: startCity/newRun, crystal/horde/exit transitions, death, pause,
                  spawning, update() and animateWorld()
  input.js        Keyboard/mouse/focus listeners
```

## Conventions

- **No build tooling.** Only browser-native ES modules with relative `./x.js` imports
  (include the `.js` extension). The only bare specifier is `'three'`, mapped in `index.html`.
  New external libs go in the import map with a pinned version from cdnjs.
- **Shared mutable state lives on objects, not exported `let`s.** Importers can't reassign
  module bindings, so per-city references (`city`, `cityGroup`, `crystal`, `barricade`,
  `exitMarker`, `buildingMeshes`, `explored`, `mmDirty`, `lastTile`) live on `world` in
  `state.js`; run/game state lives on `state`. Entity arrays (`zombies`, `bullets`, …) are
  mutated in place (`push`/`splice`/`length = 0`), never reassigned.
  Exception: `utils.js` owns `rng`, which only it reassigns via `seedRng()`.
- **Circular imports are allowed but only between function bodies.** Top-level module code may
  only use `three`, `config`, `utils`, `state`, `renderer`, and `assets` — those modules must stay
  free of imports from gameplay modules so they always evaluate first. Don't call imported
  gameplay functions at module top level; do it from `main.js` or inside functions.
- **Two RNGs:** city layout uses the seeded `rng`/`rand`/`randi`/`pick` (deterministic per seed);
  everything else (AI, FX, spawns, upgrade choice) uses `Math.random`/`mr`. Don't mix them up —
  calling seeded helpers outside `cityGen.js` changes generated cities.
- **Resource ownership:** per-city geometries/materials are registered with `own()` in
  `cityScene.js` and disposed in `teardownCity()`. Things in `SH` (assets.js) are shared and
  never disposed. Zombie materials are per-zombie and disposed in `disposeZombie()`.
- **Units:** grid tiles are `TILE = 2` world units; the map is `N = 46` tiles square. Tile index
  is `z*N + x`. World→tile is `Math.floor(pos/TILE)`; tile center is `(t+0.5)*TILE`.
- **Code style:** compact, dense lines matching the existing code; section header comments
  `// ---------- Name ----------`; brief comments only where intent isn't obvious.
- **UI text** is in `index.html`/`hud.js`. HUD writes go through `setText()` to avoid DOM churn.

## Testing

No automated test suite. To verify changes, serve locally and play a city through:
explore → shoot Crystal → kill horde → exit → pick upgrade → next city; also pause and death.
Watch the browser console for errors. A headless check with Playwright works if you serve the
folder and (when the CDN is unreachable) route `**/three.module.js` to a local copy of r128.
