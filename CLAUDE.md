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
  2. Shoot the Crystal (HP `30 + 15*(level-1)`; melee and molotov fire also damage it; any bullet
     entering its tile counts as a hit) → `horde` — `28 + 12*(level-1)` horde zombies
     spawn 15–30 units away; all zombies become alert.
  3. When the horde is dead → `open` — the barricade on the east wall disappears and a green exit
     marker appears.
  4. Walk into the exit tile column → upgrade screen (pick 1 of 3 random upgrades, heal 40% of max HP)
     → next city with a new seed.
- **Game modes** (`state.mode`): `menu` (camera orbits a city behind the title card), `play`,
  `paused`, `craft` (workbench overlay, C), `upgrade`, `dead`. Simulation (`update`) only runs in
  `play`; cosmetic animation (`animateWorld`) runs always.
- **Player:** 100 HP, stamina-based sprint (×1.55). WASD is screen-relative on the isometric grid;
  mouse aims on a plane at gun height. Upgrades (`js/upgrades.js`) mutate player stats directly;
  weapon upgrades are modifiers (`dmgMul`, `fireMul`, `magMul`, `reloadMul`, `pellets`, `pierce`)
  applied on top of every gun's base stats.
- **Weapons** (`WEAPONS` in `js/items.js`): pistol (start), shotgun, SMG, hunting rifle. Two weapon
  slots (`player.weapons`, `player.cur`), Q swaps. Ammo is finite: each gun has its own reserve
  (`player.ammo[id]`, capped by `maxAmmo`); reloads draw from it. Each gun has its own noise
  radius (alerts zombies).
- **Melee:** F any time (left click falls back to it when the held gun has no mag or reserve): a
  0.4 s butt-stroke animation (`poseMelee` in `player.js`); the blow lands 42% in (`meleeStrike`),
  hitting zombies (and the Crystal) in a ±1 rad cone within ~1.7 units for 1 damage (× `dmgMul`)
  plus knockback.
  0.55 s cooldown, small noise radius, blocks firing while swinging.
- **Inventory:** 8 slots of stackable items (`player.inv`, `ITEMS`): bandage, medkit, canned food,
  scrap, molotov, pipe bomb. Keys 1–8 (or click) use a slot, right-click drops the stack. Full pack →
  overflow is dropped on the ground (`drops`), picked up by walking over it. Inventory, weapons,
  ammo, hunger and bleeding all live on `player`, so they carry over between cities; only `newRun`
  resets them (`resetPlayerStats`).
- **Survival:** `player.hunger` (0–1) drains in ~7 min (faster while sprinting). At 0 stamina stops
  regenerating and health drains 0.5/s. Zombie hits may cause bleeding (`bleed` chance per type in
  `ZTYPES`): −1.1 HP/s until a bandage or medkit.
- **Looting** (`js/loot.js`): containers are car trunks, dumpsters, crates and doors on some
  buildings. Hold E within range for 1.5 s (2.5 s at landmarks); a progress ring shows on screen.
  Searching makes noise (`makeNoise`) that can alert nearby zombies; trunks can set off a car alarm.
  Loot tables are in `LOOT` (`js/items.js`), rolled with `Math.random` at search time.
- **Landmarks:** 3–5 per city (`LANDMARKS`): police station (a weapon plus ammo, guarded by
  `3 + level` zombies that stay near the door and never despawn), pharmacy (bandages, medkits),
  supermarket (food), hardware store (scrap, maybe a pipe bomb). Each has a roof sign and a door;
  discovered once the tile in front of the door is revealed, then shown on the minimap.
- **Crafting** (C, `RECIPES`): molotov (3 scrap) burns a 2.6-unit area for 6 s, also damaging the
  Crystal if it's in the fire; pipe bomb (4 scrap)
  beeps for 3.5 s (alerted zombies within 32 units walk to it via `world.lure`), then explodes.
  Both are thrown at the cursor (max 13 units), landing short of walls. They hurt the player too.
- **Throwing** (`THROWABLES` in `items.js`): G throws the selected kind from wherever it sits in the
  pack; mouse wheel / T cycles (`cycleThrowable`). `player.throwSel` is a preference: if you carry
  none of it but some of another kind, `selectedThrowable()` falls back to that. Shown under the
  weapon panel. Keys 1–8 can still throw from a specific slot.
- **Zombies:** `walker`, `runner`, `brute` (`ZTYPES` in `js/zombies.js`). HP scales +30%/level,
  speed +4%/level; runner/brute odds rise with level. Unalerted zombies wander and despawn when
  >62 units away; they alert within 15 units, when shot, or when you fire within 28 units.
  Alerted zombies follow a BFS flow field toward the player (recomputed every 0.25 s).
- **Ambient spawning:** outside the horde, zombies trickle in 24–42 units away up to a cap
  (`12 + 4*level`, or `8 + 4*level` once the road is open).
- **Zombie drops:** deliberately rare so loot matters: a health cross (+20 HP, ~2.5%, more from
  brutes or when below 40% HP), otherwise ~7% a small ammo box.
- **Meta:** best run (`{ city, kills }`) stored in `localStorage['crystal-fall-best']`.
- **Controls:** WASD/arrows move, mouse aims, hold left click to fire, Shift sprints, R reloads,
  F melee, Q swaps guns, G throws (wheel/T picks molotov or pipe bomb), hold E searches, 1–8 use items (right-click a slot drops it), C crafts, Esc/P pauses,
  M mutes.

## Folder structure

```
index.html        Markup (HUD, overlay screens), import map, loads css + js/main.js
css/style.css     All styles; light/dark theme tokens on :root
js/
  main.js         Boot (input, best score, menu city) and the requestAnimationFrame loop
  config.js       Grid constants: TILE, N, tile types T, walkable(), DIRS8, names, palette
  items.js        Pure data: WEAPONS, ITEMS, RECIPES, LOOT tables, LANDMARKS (no imports)
  utils.js        Seeded RNG (rng/rand/randi/pick), mr/mri/mpick (Math.random), clamp, lerpAngle, fmtTime, $
  state.js        Shared mutable state: `state`, `world`, entity arrays, input state
  renderer.js     WebGLRenderer, scene, orthographic camera, lights (incl. pooled muzzle/fx lights), updateCamera()
  assets.js       Shared geometries/materials (SH), window textures, carMat()
  audio.js        Procedural WebAudio SFX (sfx.*), initAudio(), toggleMute()
  cityGen.js      Pure procedural city generation from a seed (grid, props, containers, landmarks)
  cityScene.js    Builds/tears down the city's Three.js meshes, containers, signs, Crystal, barricade, exit
  grid.js         Tile collision (isBlockedTile, resolveCircle), BFS flow field, fog-of-war reveal
  player.js       Player mesh, base stats + starting kit, movement/aim/reload, melee pose, hunger/bleeding
  zombies.js      Zombie types, spawning, AI (flow field, pipe-bomb lure), makeNoise, damage/death
  combat.js       Firing per weapon, melee start/strike, bullets, hurtPlayer/drainHp, Crystal hits
  inventory.js    Item stacks, weapon slots, ammo reserves, using/dropping items, crafting
  loot.js         Hold-E searching, loot rolls, ground drops, landmark discovery
  throwables.js   Molotov fire zones and pipe bombs (lure + explosion)
  fx.js           Particles, blood decals, health pickups, building fade (camera-side occluders)
  hud.js          HUD bars/text, weapon panel, inventory bar, interact prompt, toasts, minimap,
                  craft screen, banner, showScreen()
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
  `exitMarker`, `buildingMeshes`, `explored`, `mmDirty`, `lastTile`, `lure`) live on `world` in
  `state.js`; run/game state lives on `state`. Entity arrays (`zombies`, `bullets`, `drops`,
  `throwns`, `hazards`, …) are
  mutated in place (`push`/`splice`/`length = 0`), never reassigned.
  Exception: `utils.js` owns `rng`, which only it reassigns via `seedRng()`.
- **Circular imports are allowed but only between function bodies.** Top-level module code may
  only use `three`, `config`, `items`, `utils`, `state`, `renderer`, and `assets` — those modules must
  stay free of imports from gameplay modules so they always evaluate first. Don't call imported
  gameplay functions at module top level; do it from `main.js` or inside functions.
- **Two RNGs:** city layout uses the seeded `rng`/`rand`/`randi`/`pick` (deterministic per seed);
  everything else (AI, FX, spawns, loot rolls, upgrade choice) uses `Math.random`/`mr`/`mri`/`mpick`.
  Don't mix them up — calling seeded helpers outside `cityGen.js` changes generated cities.
  Container/landmark placement (`placeLoot`) runs after the base layout so it doesn't shift it.
- **City data gets runtime fields.** `buildCityScene` adds `px/pz/range/time/noise/searched/glint/open`
  to each `city.containers` entry, and `loot.js` sets `found` on landmarks. Per-city, so no reset needed.
- **Resource ownership:** per-city geometries/materials are registered with `own()` in
  `cityScene.js` and disposed in `teardownCity()`. Things in `SH` (assets.js) are shared and
  never disposed. Zombie materials are per-zombie and disposed in `disposeZombie()`.
- **Units:** grid tiles are `TILE = 2` world units; the map is `N = 46` tiles square. Tile index
  is `z*N + x`. World→tile is `Math.floor(pos/TILE)`; tile center is `(t+0.5)*TILE`.
- **Code style:** compact, dense lines matching the existing code; section header comments
  `// ---------- Name ----------`; brief comments only where intent isn't obvious.
- **UI text** is in `index.html`/`hud.js`. HUD writes go through `setText()` to avoid DOM churn;
  the inventory bar re-renders only when its contents change. Short messages go through `toast()`.
- **Building fade** (`updateFade` in `fx.js`): rays from the camera to the player and to 20 points
  on a 7-unit disc around them. Buildings hiding the player always fade; buildings hiding the disc
  fade only if their center is on the camera side of the player, so buildings beyond stay solid.
  Opacity eases toward 0.2 / 1; `faded` maps mesh → current opacity.
- **Ground heights:** roads are at y=0, block slabs (sidewalk, park, lot, plaza) top out at 0.08.
  Anything flat drawn on the ground (decals 0.09, fire 0.12) must sit above 0.08 off-road.
- **No runtime lights.** Adding/removing lights recompiles shaders; reuse `muzzleLight`/`fxLight`.

## Testing

No automated test suite. To verify changes, serve locally and play a city through:
explore → search containers/landmarks → shoot Crystal → kill horde → exit → pick upgrade → next
city (inventory and guns should carry over); also craft, throw, swap guns, pause and death.
Watch the browser console for errors. A headless check with Playwright works if you serve the
folder and (when the CDN is unreachable) route `**/three.module.js` to a local copy of r128.
Headless WebGL runs at ~5 fps and `dt` is capped at 0.05 s, so drive timing-sensitive checks by
calling `update(0.05)` from `game.js` in a loop (modules can be reached via `await import('/js/...')`).
