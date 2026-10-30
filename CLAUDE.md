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
- **Map:** `B = 10` × 10 blocks of 5×5 tiles between 2-tile roads (`N = 74` tiles, 148 units
  across). You start in the north-west corner (tile 2,2); the Crystal's plaza is a block with
  `bx + bz >= B` (far side of the map); the exit is on the east wall.
- **Districts** (`DISTRICTS` in `config.js`, `assignDistricts` in `cityGen.js`): every block is
  downtown (a core near the middle: towers, dumpsters, crowded), industrial (a pocket on the east
  or south edge: warehouses, crate yards, ruins), residential/suburbs (ring around downtown: gabled
  houses on lawns, parks) or outskirts (everything else, always including the start: fields, ruins,
  sparse farmhouses, quiet). `density` (×0.75–1.25 per block, stored per tile in `city.density`)
  weights resident zombie spawns; the district also sets the block types and how many dumpsters,
  crates, cars and searchable doors get built, so dense areas are dangerous and loot-rich and the
  outskirts are quiet and bare. The HUD shows the district you're in under the city name.
- **City loop** (`state.phase`):
  1. `explore` — find the Crystal (violet beam) in the plaza block. It counts as "found" when
     you get within 19 units or shoot it.
  2. Shoot the Crystal (HP `30 + 15*(level-1)`; melee and molotov fire also damage it; any bullet
     entering its tile counts as a hit). From City 3 on (`CRYSTAL.pulseFrom`), the first hit that
     leaves it at ≤50% HP makes it **pulse** once (`checkPulse` in `crystal.js`): a violet ring/screen
     wave, everything within 60 units is alerted, and `8 + 2*(level-3)` (max 18) zombies rise
     4–12 units around it with staggered rise times. Afterwards it spins faster and burns brighter.
  3. Broken → `takeover` (all cities): the screen sweeps violet from the Crystal (`screenWave`) and
     the city stays tinted (`setTint` in `renderer.js` lerps light/background colors; `#taint` is a
     `mix-blend-mode: color` overlay, `#taintWave` the sweeping rim). A 3-minute countdown
     (`state.takeover`, shown big in the objective panel; the crystal bar drains with it; beeps in
     the last 10 s) runs while everything spawns alert: a surge of `10 + 3*(level-1)` 15–30 units
     away, then a steady stream (interval and cap in `CRYSTAL`, ramping up as the clock runs
     down). Takeover zombies have `z.horde` set and are counted in `state.hordeAlive`.
  4. Timer hits 0 → `endTakeover()` + `open` — the tint fades, leftover takeover zombies become
     ordinary ones, the barricade on the east wall disappears and a green exit marker appears.
  5. Walk into the exit tile column → upgrade screen (pick 1 of 3 random upgrades, heal 40% of max HP)
     → next city with a new seed.
- **Game modes** (`state.mode`): `menu` (camera orbits a city behind the title card), `play`,
  `paused`, `craft` (workbench overlay, C), `upgrade`, `dead`. Simulation (`update`) only runs in
  `play`; cosmetic animation (`animateWorld`) runs always.
- **Player:** 100 HP, walk speed 4.6 (slower than runners, so sprinting matters). Sprint is ×1.75
  and drains stamina (~3.6 s from full); it refills after a 1 s pause, 1.7× faster standing still.
  Running dry makes you **winded** (`player.winded`): no sprint and 0.8× walk until stamina is back
  to 40%. Tunables are the constants above `updatePlayer` in `player.js`. WASD is screen-relative on the isometric grid;
  mouse aims on a plane at gun height. Upgrades (`js/upgrades.js`) mutate player stats directly;
  weapon upgrades are modifiers (`dmgMul`, `fireMul`, `magMul`, `reloadMul`, `pellets`, `pierce`)
  applied on top of every gun's base stats.
- **Weapons** (`WEAPONS` in `js/items.js`): pistol (start), shotgun, SMG, hunting rifle. Two weapon
  slots (`player.weapons`, `player.cur`), Q swaps. Ammo is finite: each gun has its own reserve
  (`player.ammo[id]`, capped by `maxAmmo`); reloads draw from it. Each gun has its own noise
  radius (alerts zombies). Ammo finds (searches, zombie drops) are biased by `AMMO_ODDS` (`ammoType`
  in `loot.js`): 55% the held gun, 25% your other gun (a gun with a full reserve is skipped; with
  one gun it gets both shares), 20% any gun, so new weapons don't dilute what you need.
- **Melee:** F any time (left click falls back to it when the held gun has no mag or reserve): a
  0.4 s butt-stroke animation (`poseMelee` in `player.js`); the blow lands 42% in (`meleeStrike`),
  hitting zombies (and the Crystal) in a ±1 rad cone within ~1.7 units for 1 damage (× `dmgMul`)
  plus knockback.
  0.55 s cooldown, small noise radius, blocks firing while swinging.
- **Inventory:** 8 slots of stackable items (`player.inv`, `ITEMS`): bandage, medkit, energy drink
  (full stamina + sprint drains 60% less for 20 s via `player.boost`), scrap, molotov, pipe bomb. Keys 1–8 (or click) use a slot, right-click drops the stack. Full pack →
  overflow is dropped on the ground (`drops`), picked up by walking over it. Inventory, weapons,
  ammo and bleeding all live on `player`, so they carry over between cities; only `newRun`
  resets them (`resetPlayerStats`).
- **Bleeding:** zombie hits may cause bleeding (`bleed` chance per type in `ZTYPES`): −1.1 HP/s until
  a bandage or medkit. (There is no hunger system; it was removed.)
- **Looting** (`js/loot.js`): containers are car trunks, dumpsters, crates, doors on some
  buildings (labelled shop/house/warehouse by building style) and the props inside walk-in landmarks. Hold E within range for 1.5 s (2.5 s at landmarks); a progress ring shows on screen.
  Searching makes noise (`makeNoise`) that can alert nearby zombies; trunks can set off a car alarm.
  Loot tables are in `LOOT` (`js/items.js`), rolled with `Math.random` at search time.
- **Landmarks** (`LANDMARKS` in `items.js`, ASCII `TEMPLATES` + `placeLandmarks`/`stamp` in
  `cityGen.js`): every city has a police station, a supermarket and a hardware store, plus 1–2
  pharmacies and 1–2 gas stations, each on the best-scoring free spot for its kind (`LM_SPEC.score`
  per district) and kept apart. Templates are mirrored/transposed so their front faces +z or +x
  (the camera side). Each has its own look: roof sign with icon, colour band, glass storefront.
  - **Walk-in** (`enter: true`; police station, supermarket): fill a 2×2 group of blocks, the roads
    between them included. Walls are full `T.BUILDING` tiles around `T.FLOOR` tiles with an open
    entrance; loot is in searchable props inside, not at a door. Supermarket: shelf aisles
    (`shelf` containers), checkouts, a parking lot with cars and carts, `2 + ceil(level/2)` shoppers
    inside. Police station: armory (`armory`: a gun you don't have + ammo), lockers, desks, two cells
    behind bars (`T.BARS`: blocks walking, shots and sight pass) where a prisoner may be stuck, a
    yard with flashing police cars (`cruiser` trunks), a flag; `3 + level` guards, half inside and
    half by the entrance. While you're inside, the roof lifts off and the walls drop to knee height
    (`updateInteriors` in `fx.js`).
  - **Door-searched** (pharmacy: bandages, medkits, green cross; hardware store: scrap, maybe a pipe
    bomb, lumber yard and a crate; gas station: molotovs, scrap, maybe a drink, canopy over pumps and
    a price pylon): one block, a solid shop searched through its awninged front door.
  - Discovered once the tile in front of the door/entrance is revealed, then shown on the map;
    dimmed there once everything in it (`l.cts`) is searched.
- **Crafting** (C, `RECIPES`): molotov (3 scrap) burns a 2.6-unit area for 6 s, also damaging the
  Crystal if it's in the fire; pipe bomb (4 scrap)
  beeps for 3.5 s (its beeps are forced noises; hunting and searching zombies within 32 units walk to it via `world.lure`), then a concussion
  blast (`stunBlast`) stuns zombies within 6 units for up to 2.5 s (`stunZombie`, `z.stun`: frozen,
  swaying, can't attack, wind-ups cancelled) and shoves them back. It deals **no damage** to anyone.
  Both are thrown at the cursor (max 13 units), landing short of walls. Fire hurts the player too.
- **Throwing** (`THROWABLES` in `items.js`): hold right click to aim (`player.aiming`; `updateThrowPreview` in
  `throwables.js` draws the effect radius at the landing point plus a dotted arc, sharing
  `throwPath`/`arcY` with the real throw), release to throw the selected kind from wherever it sits
  in the pack, a left click while aiming cancels (and doesn't fire). Mouse wheel / T cycles (`cycleThrowable`). `player.throwSel` is a preference: if you carry
  none of it but some of another kind, `selectedThrowable()` falls back to that. Shown under the
  weapon panel. Keys 1–8 can still throw from a specific slot.
- **Zombies:** every number lives in `js/threats.js` (pure data; senses in `AI`). A zombie has one type from
  `ZTYPES` (`walker`, `runner`, `brute`, `screamer`, `spitter`) and any number of stacking
  modifiers from `ZMODS` (`explosive`, `armored`), rolled independently per spawn (`rollThreat` in
  `specials.js`). HP scales +30%/city, speed +4%/city; each type/modifier's odds are
  `chance = [base, perCity, max]` counted from the city it was introduced in (walker fills the rest).
- **Zombie senses** (`AI` in `threats.js`, Senses section of `zombies.js`): zombies live in their
  district. Each has a home (its spawn point) and a `mode`:
  `idle` (wanders within 7 units of home) → `search` (heard a noise: walks to it, shows a yellow `?`,
  looks around 4 s) → `hunt` (saw you or got shot/hit: red `!`, `z.alert`) → `search` at your last
  known spot once it forgets you → `return` (walks home) → `idle`.
  - Sight (`perceive`, every 0.2–0.3 s, needs a clear line): idle/searching ones notice you within 13
    units in a ±1.9 rad cone ahead or 3.5 units from any side (you can sneak up from behind);
    hunters keep track to 26 units.
  - Memory: a hunter that can't see you goes to your last known position and forgets you after 6 s.
  - Leash: past `leash` (30 units; guards 9) from home, a hunter forgets 3× faster and its memory
    only refreshes while you're within `closeR` (9); then it walks home, ignoring you unless you
    come that close. So crowds don't follow you out of downtown.
  - Hearing (`makeNoise(x, z, r, force)`): gunfire (each gun's `noise`), searching, melee, sprint
    footsteps (8 units every 0.3 s; walking is silent), car alarms, fire, explosions. Zombies beyond
    60% of r only hear it with a clear line (walls muffle). Hunters that lost sight take it as your
    new position; others go and look, unless it's further than 1.25× their leash from home
    (`force`, the pipe bomb, ignores that). `alertNear` (screams, the Crystal's pulse) tells
    everything in range where you are.
  - Paths: hunters that see you descend the player flow field (`distField`, every 0.25 s); everything
    else walks straight to its target when it's in view, or down `flowTo(tile)` (a BFS field toward
    that tile, cached and shared in `grid.js`).
  - Takeover zombies (and everything within `CRYSTAL.breakR` when it breaks) are `tracked`: they
    always know where you are, no leash. When it ends they become residents where they stand.
  - Idle zombies more than 48 units away skip crowd separation and animation.
- **Threat progression:** City 1 has walkers and runners (`THREAT_BASE`). Each later city
  introduces one more threat from `THREAT_POOL`, in an order shuffled per run (`shuffleThreats`,
  `state.threatOrder`); earlier ones keep appearing. The newest is forced onto the first
  `INTRO_FORCED` spawns of its city. The first time a type/modifier with a `tip` comes within
  `SPOT_RANGE` of the player, a "New threat: …" banner shows (`state.seenThreats`, queued behind
  other banners via `queueBanner`).
  - **Screamer:** pale, gaunt, open mouth. On line of sight within `sight` it roots for 1.5 s while
    its head swells and glows and its arms rise, then screams once: alerts everything within
    `alertR` and spawns 6–10 zombies (never screamers) nearby (takeover members during the takeover).
    Killing it during the wind-up cancels the scream.
  - **Spitter:** green and bloated with a glowing acid sac. Keeps 7–13 units away (backs off,
    sidesteps) and lobs acid on an arc; a green ring + filling disc marks the landing spot. The
    acid leaves a puddle that hurts the player (not zombies) for a few seconds.
  - **Explosive:** orange-glowing body and canisters. Explodes on death (after a short delay so
    blasts can chain) or after a blinking 0.45 s fuse once next to the player; hurts zombies and
    the player (`explosion`/`queueBlast` in `throwables.js`). The true blast radius is shown on the
    ground: a faint pulsing orange ring under it while it's alert and within 14 units, bright with a
    filling disc once the fuse is lit (`makeWarnRing`/`updateWarnRing`). Every `explosion()` also
    sweeps a `shockwave()` ring out to its radius and leaves a scorch decal; pipe-bomb stun blasts
    get a blue shockwave.
  - **Armored:** riot helmet, visor, vest and a shield with a white stripe. Hits within `frontArc`
    of its facing deal `frontMul` damage (sparks + clank) and stop the bullet even if it would pierce
    (`damageZombie` returns `blocked`); flanks, fire and blasts from behind hit fully. Police-station guards get extra odds once it's unlocked.
- **Spawning out of the ground:** every zombie spawned during play (`spawnZombieAt`'s `rise`,
  1.1–1.5 s) claws its way up out of a dirt hole (`updateRise`): hunched, buried to the head, arms
  clawing, dirt flying. While `z.rise > 0` it can't be hurt, stunned or hit by bullets (they pass
  over) and doesn't move or attack. `startCity`'s initial population and police guards pass
  `rise = 0` and are already standing.
- **Death animations** (`makeCorpse`/`updateDying` in `zombies.js`, driven by the killing blow's
  `cause` passed to `damageZombie`: `'bullet' | 'melee' | 'blast' | 'fire'`): corpses topple with
  gravity toward the hit direction (onto their back or face, whichever needs less twist), bounce,
  slide with the knockback and sprawl their limbs. Some lose an arm, the head or rarely a leg (~28%,
  more from hits of 3+ damage and melee, never from fire): the piece becomes a *gib* that tumbles
  away bleeding and settles flat on the ground. Blast deaths (explosions, exploders themselves)
  fling every body part. Corpses lie 2.5–4 s, then sink away.
- **Population:** `startCity` spawns `POP.base + POP.perLevel*level` residents (standing, at least
  26 units from the start) on tiles picked with probability = district density (`findDistrictTile`),
  plus the walk-in landmarks' guards, prisoners and shoppers. Nobody despawns. Killed residents are
  slowly replaced (every 1.5–4 s, out of sight ≥32 units away, idle, by density) up to the same
  count (70% once the road is open).
- **Zombie drops:** deliberately rare so loot matters: a health cross (+20 HP, ~2.5%, more from
  brutes (`heal` in `ZTYPES`) or when below 40% HP), otherwise ~7% a small ammo box (14% during
  the takeover, `CRYSTAL.ammoDrop`, so the takeover's nonstop fighting stays possible). An
  exploder's own detonation gives no kill and no drop.
- **Pickup feedback:** everything you collect (ground drops, search results, health crosses) floats
  up over the player as "+1 🩹 Bandage" (`floatText` in `hud.js`; several at once rise one after
  another). Ground drops and health crosses within 2.8 units get a small name tag below them
  (`dropName` in `loot.js`). Toasts are kept for notes (full pack, new gun hint, alarms).
- **Maps:** the minimap follows the player (46 tiles across, the Crystal/exit pinned to its edge
  when off it); hold Tab for the whole explored city. Both draw from one cached tile layer.
- **Meta:** best run (`{ city, kills }`) stored in `localStorage['crystal-fall-best']`.
- **Controls:** WASD/arrows move, mouse aims, hold left click to fire, Shift sprints, R reloads,
  F melee, Q swaps guns, hold right click to aim + release to throw (wheel/T picks molotov or pipe bomb, left click cancels), hold E searches, 1–8 use items (right-click a slot drops it), C crafts, hold Tab for the map, Esc/P pauses,
  M mutes.

## Folder structure

```
index.html        Markup (HUD, overlay screens), import map, loads css + js/main.js
css/style.css     All styles; light/dark theme tokens on :root
js/
  main.js         Boot (input, best score, menu city) and the requestAnimationFrame loop
  config.js       Grid constants: TILE, B, N, tile types T, walkable()/seeThrough(), DIRS8, names, palettes,
                  DISTRICTS, POP
  items.js        Pure data: WEAPONS, ITEMS, RECIPES, LOOT tables, LANDMARKS (no imports)
  threats.js      Pure data: zombie types (ZTYPES), modifiers (ZMODS), unlock pool/order, banner tips,
                  Crystal pulse and takeover tuning (CRYSTAL), zombie senses (AI)
  utils.js        Seeded RNG (rng/rand/randi/pick), mr/mri/mpick (Math.random), clamp, lerpAngle, fmtTime, $
  state.js        Shared mutable state: `state`, `world`, entity arrays, input state
  renderer.js     WebGLRenderer, scene, orthographic camera, lights (incl. pooled muzzle/fx lights), updateCamera(),
                  setTint() (takeover violet)
  assets.js       Shared geometries/materials (SH, incl. landmark props and ?/! marks), window, corrugated
                  and checker textures, carMat()
  audio.js        Procedural WebAudio SFX (sfx.*), initAudio(), toggleMute()
  cityGen.js      Pure procedural city generation from a seed: districts, blocks, landmark templates,
                  wrecks, containers, density map
  cityScene.js    Builds/tears down the city's Three.js meshes: buildings by style, walk-in landmark
                  shells/roofs, props, containers, signs, Crystal, barricade, exit
  grid.js         Tile collision (isBlockedTile, isOpaqueTile, resolveCircle), BFS flow fields (player,
                  cached flowTo), line of sight, fog-of-war reveal
  player.js       Player mesh, base stats + starting kit, movement/sprint/stamina, aim/reload, melee pose, bleeding
  zombies.js      Zombie meshes (incl. type/modifier tells, ?/! mark), spawning + rising from the ground,
                  senses (sight, hearing via makeNoise/alertNear, memory, leash), steering (flow fields,
                  pipe-bomb lure), damage (armor), stun, explosive fuse and warning ring, death
                  (ragdoll corpses, gibs)
  specials.js     Threat unlocks and rolls, screamer/spitter behaviour, acid, "New threat" banners
  combat.js       Firing per weapon, melee start/strike, bullets, hurtPlayer/drainHp, Crystal hits
  crystal.js      Crystal found/pulse/break, its animation, takeover end, violet tint + screen wave
  inventory.js    Item stacks, weapon slots, ammo reserves, using/dropping items, crafting
  loot.js         Hold-E searching, loot rolls, ground drops, landmark discovery
  throwables.js   Molotov fire zones, pipe bombs (lure + stun blast), exploder explosion()/queueBlast()
  fx.js           Particles, decals (blood/dirt/scorch), shockwave rings, health pickups, building fade,
                  walk-in landmark cutaway
  hud.js          HUD bars/text, weapon panel, inventory bar, interact prompt, floating pickup text,
                  drop name tags, toasts, minimap + full map, district line,
                  craft screen, banner, showScreen()
  upgrades.js     Upgrade definitions
  game.js         Game flow: startCity/newRun, populate(), takeover countdown + spawning, exit, death,
                  pause, resident respawns, update() and animateWorld()
  input.js        Keyboard/mouse/focus listeners
```

## Conventions

- **Branch names must be meaningful.** Name every new branch `<type>/<short-kebab-summary>` describing
  the change (e.g. `feature/special-zombies`, `fix/molotov-and-crystal-damage`); never use random,
  auto-generated or generic names like `claude/laughing-gates-gg9mij`, `patch-1` or `wip`.
  This applies even when the session's setup assigns a branch such as `claude/<random-words>`:
  the repo owner explicitly permits (and wants) you to create and push a meaningfully named
  branch instead, starting from the latest `main`. Mention the branch name in your reply.
- **No build tooling.** Only browser-native ES modules with relative `./x.js` imports
  (include the `.js` extension). The only bare specifier is `'three'`, mapped in `index.html`.
  New external libs go in the import map with a pinned version from cdnjs.
- **Shared mutable state lives on objects, not exported `let`s.** Importers can't reassign
  module bindings, so per-city references (`city`, `cityGroup`, `crystal`, `barricade`,
  `exitMarker`, `buildingMeshes`, `interiors`, `interiorAt`, `explored`, `mmDirty`, `lastTile`, `lure`) live on `world` in
  `state.js`; run/game state lives on `state`. Entity arrays (`zombies`, `bullets`, `drops`,
  `throwns`, `hazards`, `spits`, `puddles`, `rings`, …) are
  mutated in place (`push`/`splice`/`length = 0`), never reassigned.
  Exception: `utils.js` owns `rng`, which only it reassigns via `seedRng()`.
- **Flow-field cache:** `flowTo()` fields are keyed by tile; call `clearFlowCache()` whenever the
  grid changes (`startCity`, `openRoad`). Zombies hold their own reference, so evicted fields are
  never recycled.
- **Circular imports are allowed but only between function bodies.** Top-level module code may
  only use `three`, `config`, `items`, `threats`, `utils`, `state`, `renderer`, and `assets` — those modules must
  stay free of imports from gameplay modules so they always evaluate first. Don't call imported
  gameplay functions at module top level; do it from `main.js` or inside functions.
- **Two RNGs:** city layout uses the seeded `rng`/`rand`/`randi`/`pick` (deterministic per seed);
  everything else (AI, FX, spawns, loot rolls, upgrade choice) uses `Math.random`/`mr`/`mri`/`mpick`.
  Don't mix them up — calling seeded helpers outside `cityGen.js` changes generated cities.
  Generation order: districts → plaza → landmarks → district blocks → wrecks → `placeLoot`
  (dumpsters, crates, trunks, doors) → density.
- **City data gets runtime fields.** `buildCityScene` adds `px/pz/range/time/noise/searched/glint/open`
  to each `city.containers` entry, and `loot.js` sets `found` on landmarks. Per-city, so no reset needed.
  Landmark records: `{ type, cts (container indices), ox/oz (tile in front of the door/entrance),
  cx/cz (center, tiles) }`, plus `interior, floor, cells, yard` for walk-in ones.
- **Resource ownership:** per-city geometries/materials are registered with `own()` in
  `cityScene.js` and disposed in `teardownCity()` (`G(key, make)` caches a per-city geometry shared
  by every mesh of that shape). Things in `SH` (assets.js) are shared and
  never disposed. Zombie materials are per-zombie and disposed in `disposeZombie()`
  (zombie gear/tell meshes use shared `SH` geometry and materials), as are an exploder's warning
  ring materials. Gibs are zombie meshes re-parented to the scene that keep those materials, so a
  dead zombie is always removed with `disposeCorpse()` (gibs + zombie), also in `teardownCity()`.
  `rings` entries (`{ mesh, t, T, r0, r1, op }`) own their material, disposed when they finish.
- **Units:** grid tiles are `TILE = 2` world units; the map is `N = 74` tiles square (`B = 10`
  blocks; roads are the tiles where `(t-1) % 7 < 2`). Tile index is `z*N + x`. World→tile is
  `Math.floor(pos/TILE)`; tile center is `(t+0.5)*TILE`. Block of a tile: `floor((t-1)/7)` clamped.
- **Code style:** compact, dense lines matching the existing code; section header comments
  `// ---------- Name ----------`; brief comments only where intent isn't obvious.
- **UI text** is in `index.html`/`hud.js`. HUD writes go through `setText()` to avoid DOM churn;
  the inventory bar re-renders only when its contents change. Short messages go through `toast()`;
  things the player gains go through `floatText()`. World-anchored DOM (interact prompt, floaters,
  drop tags) is projected with the camera every frame in `updateHUD`.
- **Building fade** (`updateFade` in `fx.js`): rays from the camera to the player and to 20 points
  on a 7-unit disc around them. Buildings hiding the player always fade; buildings hiding the disc
  fade only if their center is on the camera side of the player, so buildings beyond stay solid.
  Opacity eases toward 0.2 / 1; `faded` maps mesh → current opacity. Multi-mesh buildings (walk-in
  landmarks) point every part at one `userData.fadeKey` mesh that holds `userData.mats`; the gas
  canopy sets `userData.center`. Fadeable meshes and their children must use their own materials
  (fading mutates them), never `SH` ones.
- **Ground heights:** roads are at y=0, block slabs (sidewalk, park, lot, plaza) top out at 0.08.
  Anything flat drawn on the ground (ground overlays — parking, forecourts, shop floors — 0.083,
  parking lines 0.086, decals 0.09, acid 0.11, fire 0.12, acid marker and exploder warning ring 0.13,
  shockwaves 0.14) must sit above 0.08 off-road.
- **No runtime lights.** Adding/removing lights recompiles shaders; reuse `muzzleLight`/`fxLight`.

## Testing

No automated test suite. To verify changes, serve locally and play a city through:
explore (check districts feel different, walk into the police station and supermarket) → search
containers/landmarks → lose a hunting zombie by breaking line of sight, check it walks home →
shoot Crystal (pulse from City 3) → survive the takeover
(set `state.takeover` low to skip ahead) → exit → pick upgrade → next
city (inventory and guns should carry over); also craft, throw, swap guns, pause and death.
Watch the browser console for errors. A headless check with Playwright works if you serve the
folder and (when the CDN is unreachable) route `**/three.module.js` to a local copy of r128.
Headless WebGL runs at ~5 fps and `dt` is capped at 0.05 s, so drive timing-sensitive checks by
calling `update(0.05)` from `game.js` in a loop (modules can be reached via `await import('/js/...')`).
