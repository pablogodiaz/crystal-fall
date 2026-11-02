# Crystal Fall — notes for Claude

Isometric zombie roguelike in Three.js. Plain ES modules, **no build step, no npm**:
the repo is served as-is by GitHub Pages. Keep this file updated whenever you change
game design, file layout, or conventions.

## Running locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. For co-op, run `python3 server/serve.py` instead (same port, also
serves the game, plus the WebSocket relay; see "Networking"). Three.js **r128** comes from cdnjs through the import map
in `index.html` (`"three"` → `three.js/r128/three.module.js`). Don't bump the version casually:
lighting intensities, `PCFSoftShadowMap` look, and APIs are tuned for r128.

## Game design

- **Run structure:** one life per run. Each run is a sequence of procedurally generated
  quarantined cities (City 1, 2, 3…). Difficulty scales with `state.level`.
- **Players:** a session has 1–4 players (`players` in `state.js`, `MAX_PLAYERS`),
  each a full player object (`addPlayer`/`removePlayer` in `player.js`; slot colours `LOOKS`: jacket,
  ring, HUD css). `state.me` = the index this machine controls (`me()`), `state.view` = the one the
  camera/HUD follow (`viewed()`: you, or whoever you spectate), `state.host` = this machine runs the
  simulation (false on a networked client). Every player moves from its control state
  `p.ctl = { mx, mz, sprint, fire, use, aim }`: `readLocal` (keyboard/mouse) fills it for `me()`, host.js for
  remote players (`p.remote` = their connection id), `bots.js` for everyone else. One-shot actions (reload,
  swap, items, throws, crafting) are calls that take the player; input goes through `act(name, arg)`
  (client.js), which calls `ACTS` (host.js) here or sends it to the host. Players can be people on other
  machines (see "Networking") or **companions** (bots) added from the dev tools: they follow you (or the nearest
  living player), shoot the nearest zombie in sight, back off, swap to a loaded weapon, bandage/medkit
  themselves and follow you into the exit; they never search, craft or throw.
  - **Death:** `killPlayer(p)` (game.js): the player's body vanishes and they get back up as a zombie
    (`spawnTurnedPlayer`: a walker in their jacket and cap, swaying first). While anyone is alive the run
    goes on; if it was you, you spectate (`spectate(dir)`: click / Q / Space cycles, a bar says so, the HUD
    shows the watched player). The dead keep their gear and come back at the start of the next city with
    `REVIVE` (50%) health (`placePlayers`/`revivePlayer`). Everyone dead → game over ("Everyone turned").
  - **Shared world:** containers are shared (whoever finishes the search gets loot rolled for them),
    ground drops go to whoever walks over them (a dropped item only skips the player who dropped it,
    `d.held`, until they step away, so you can hand things over), health crosses to the first hurt player,
    the explored map is shared, kills count for the team (`state.kills`) and per player (`p.kills`).
  - **Zombie scaling** (`COOP` in `threats.js`): the city's population (residents, landmark guards,
    respawns) ×`residents()` = 1 + 0.5 per extra player; what spawns mid-fight (takeover surge, stream
    and cap, the Crystal's pulse, screams) ×`crowd(true)` = 1 + 0.75 per extra living player, spread over
    the players (`findSpawnTile` picks a random living player as anchor and keeps every spawn away from
    all of them), so two players together face all of it. The frame-time ceiling (`zombieCap()`, 260
    solo) grows with `residents()`.
  - **Host only:** Esc/P pause (pauses everyone) and the dev tools (`` ` ``). With more than one player the
    workbench (C) doesn't pause: `p.crafting` freezes only your controls; losing window focus only
    pauses a solo game.
  - **Upgrades:** each player gets their own hand (`completeCity`; a card already dealt to another player is
    redrawn once, so hands differ), the dead pick too; each sees the result and presses Continue,
    and the next city starts when everyone has (`pickUpgrade` then `readyUp`, `p.picked`/`p.ready`; players
    this machine doesn't control pick at random (`autoChoice`), "Waiting for …" shows otherwise).
  - **HUD:** a coloured name chip (`P2 (watching)` while spectating), name + health tags over the other
    players (`updatePlayerTags`), other players as coloured dots on the maps. Toasts are only for you
    (`toast(msg, kind, p)` ignores other players'); pickup floaters only for the watched player
    (`floatText(msg, kind, p)`). One lamp follows the watched player (`updateLamp`).
- **Networking** (co-op over LAN/Tailscale; `features/multiplayer.md` has the plan and what's left):
  **host-authoritative.** `server/serve.py` (stdlib Python) serves the files and a game-agnostic WebSocket
  relay at `/ws/<room>`; `net.js` is the only code that knows about sockets (`connect`, `send(to, msg)`,
  `onNet({ message, join, leave, close, ready })`, URL from `location`, `VERSION` checked in `hello`; bump
  it when `cityGen.js`, `config.js` layout data or messages change). `net.role`: `solo` | `host` | `client`.
  - **Host** (`host.js`): runs `update()` as always. Clients' `hello` → `addPlayer()` with `p.remote`
    (a player who dropped out within `LOST` = 30 s and comes back with the same name gets theirs back;
    meanwhile a bot plays them). Their `c` messages (30 Hz) fill `p.ctl` and `p.net` (the position their
    machine moved them to: `movePlayer` accepts it while it's within 4 units and their `tp` matches;
    otherwise `p.tp++` snaps them back); `a` messages call `ACTS`. Every 50 ms (`hostTick` → `flushNow`)
    each client gets one `k` message: `e` (events for everyone, `emit`), `pe` (for that player, `emitTo`),
    `s` (run state), `p` (every player: position, angle, hp, flags, held weapon, melee, stamina, `tp`,
    drone, rail charge), `z` (zombies within 64 units of the player they watch: nid, position, facing,
    flags from `zombieFlags`, hp %) and `f` (full HUD state for their player and the one they watch, only
    when it changed). Joining mid-run gets `syncEvents()` (the world as events) in the `w` welcome.
  - **Smoothing** (`smooth.js`, snapshot interpolation): positions from another machine arrive in steps
    and at uneven times, so they're never drawn as they land. Every tick (`ts`, host clock) and control
    message (`ts`, client clock) is stamped; each remote thing keeps a few samples (`track`) and is drawn
    a little in the past, blended between the two samples around that moment (`at`): remote players on
    the host 70 ms behind (`REMOTE_DELAY` in `player.js`, their facing comes from the client too), other
    players, zombies and drones on a client 100 ms behind (`DELAY` in `client.js`). The clock offset
    (`syncClock`) eases rather than jumps; teleports (`tp`) and gaps over 0.5 s restart the samples.
  - **Client** (`client.js`): never calls `update()`. `startCity(level, seed)` builds the same city
    (skipping `populate`); everything else is mirrored: events spawn/kill zombies (`mirrorSpawn`/
    `mirrorKill`, corpses play out locally), drops (`dropMesh`), health crosses, hazards, throws, acid,
    wells and orbs as **ghosts** (same meshes, no gameplay), ghost bullets (`addBullet(…, { ghost })`, fly
    and stop at walls/zombies in `updateBullets`), searched containers, landmarks, Crystal steps
    (`crystalFx`), the road (`roadFx`), upgrades (`showUpgrades`, then `showUpgradeResult` from the host's `upgr`), game over (`showGameOver`). Snapshots
    move other players and zombies (smoothed, see below); `animateMirror` drives zombie looks from flags.
    Its own player is predicted with `movePlayer` and reported; knockback arrives as `kick`.
  - **Fences and barricades:** `br+` (a barricade put up), `brh` (a hit: health left, direction), `br-`
    (broken, or taken down); `mirrorBreak` applies them, `breakSync` adds them to the mid-run sync.
  - **Effects reach clients by themselves:** `burst`, `addDecal`, `addRing`/`shockwave`, `shake` (fx.js) and
    every `sfx.*` call (wrapped in `initHost`) are emitted unless passed `local` (ambient effects of things
    clients mirror, corpses, gibs, rising dirt, menu). Sounds and messages for one player: `sfxFor(p, name)`,
    `toast(msg, kind, p)`, `floatText(…, p)`, `shake(a, p)`; for everyone: `toastAll`, `bannerAll`.
  - **Session rules:** pause and dev tools are host-only (clients see the pause screen without Resume).
    Mid-run joiners spawn next to a living player with a fresh kit (between cities: counted as picked).
    The host leaving sends every client back to the menu ("The host left"). Best runs are saved on every
    machine from the host's result (`over` event).
  - **Lobby** (`lobby.js`): menu buttons Host co-op / Join co-op, a name field
    (`localStorage['crystal-fall-name']`), the lobby card (address to share, players, host's Start run).
  - **Autopilot client** (`?bot` or `?bot=Name` in the URL, `net.bot`): the window joins whoever hosts on
    the server (retrying every 3 s, rejoining after the host leaves) and plays its own player with the
    companions' brain (`updateBot`, flow fields from `updateFlow` every 0.25 s; swaps and item use go
    through `act`), picking upgrades at random. For trying co-op alone over the real network path.
  - A remote player whose machine stops sending controls for 0.5 s (hidden tab, frozen window) stops
    moving and firing on the host (`p.ctlAt` in `hostTick`).
- **Map:** a city is `b` × `b` blocks of 5×5 tiles between 2-tile roads, `n = 7b + 4` tiles across
  (`city.b`, `city.n`). It grows with the run (`CITY_BLOCKS` in `config.js`): 10×10 blocks
  (74 tiles) in Cities 1–2, 12×12 (88) from City 3, 14×14 (102) from City 6, with a "The cities are
  getting bigger" banner. You start in the north-west corner (tile 2,2); the Crystal's plaza is a
  block with `bx + bz >= b` (far side of the map); the exit is on the east wall (column `n - 1`).
- **Districts** (`DISTRICTS` + `LAYOUT` in `config.js`, `assignDistricts` in `cityGen.js`): every
  block is downtown (towers, dumpsters, crowded), industrial (warehouses, crate yards, ruins),
  residential/suburbs (gabled houses on lawns, parks) or outskirts (fields, ruins, sparse
  farmhouses, quiet). Placement is random per city: downtown cores anywhere at least
  `startGap` blocks from the start (and `coreGap` apart), each ringed by suburbs, plus industrial
  pockets; the rest, and always the start's own blocks (`bx + bz <= 1`), is outskirts. Core and
  pocket counts scale with the city's area (`b²/100`).
  Later cities sprawl: more cores (`cores[1]` per city), bigger cores and rings (`coreGrow`,
  `ringGrow`). `block.density` = resident zombies per block (`density + perLevel*(city-1)`,
  ×0.75–1.25), so every district gets busier each city; with the growing map that's about 40
  residents in City 1, 94 in City 3, 140 in City 5, 225 in City 6 and 300 in City 8. The district also sets the block types and how many
  dumpsters, crates, cars and searchable doors get built, so dense areas are dangerous and
  loot-rich and the outskirts are quiet and bare. The HUD shows the district you're in under the
  city name. Besides towers, houses, warehouses, yards, lots, parks, fields, farms and ruins, a block can be a
  **construction** site (steel frame building, a tower crane that fades when in the way, pipes, lumber,
  chain-link fence along a side or two), a **cemetery** (iron fence with a gate per side, graves (some dug
  open), a crypt with a searchable door or an old tree; ×1.8 residents, `BLOCK_DENSITY`), a relief **camp**
  (tents, a first-aid tent, burn barrels, a fence), a **pond** park (water blocks walking, not sight), or a
  shell **crater** (a hole in the middle, some flooded, scorch, rubble, a burnt car). Construction sites,
  cemeteries, camps and craters never go on the start's own blocks (`EVENTFUL`).
- **City condition** (`CONDITIONS` in `config.js`, `city.cond`, rolled first off the seed so
  `cityCondition(seed)` finds one cheaply): what happened to the city, shown in the "City N" banner
  and the dev tools. *Holding up* (mild), *Evacuated* (checkpoints, fences, camps), *Gridlock* (wrecks,
  jams, pileups, buses), *Shelled* (craters, ruins, broken buildings, collapses). It scales the damage
  passes (`closures`, `wrecks`, `broken`), weights the closure kinds (`kinds`) and multiplies block type
  weights (`mul`).
- **Damage and scars** (`damage`, `addCrashes`, `addClosures`, `addWrecks` in `cityGen.js`):
  - Broken buildings (`breakBuilding`): towers/warehouses stop at `cut` of their height with jagged
    `chunks`, a torn slab, rebar, blown-out holes and rubble (`debris`, no collision) around them;
    burnt houses are charred, some with the roof caved in (`caved`), on scorched ground. Sooty towers
    (`soot`) are blackened with holes. Broken and burnt buildings have no searchable door.
  - Wrecks: lane wrecks as before (never both lanes), more of them by condition, some in jams (2–4 in a
    row), some on their roof (`pose: 'flip'`) or side, some burnt out (`burnt`: charred, fewer trunks).
    Crashes: two cars smashed together at a crossing, cars driven into buildings (`crash`, `ox/oz`).
  - **Road closures / dead ends** (`CLOSURES` per 100 blocks + per city, × condition): both lanes of a
    road and the open sidewalk tiles beside them, usually at a street's mouth (a dead end) or halfway.
    Kinds: concrete jersey barriers or sawhorses (`barrier`), a chain-link quarantine fence (`fence`), an army
    `checkpoint` (sandbags, a truck with a searchable bed, maybe a military crate), a `pileup` of wrecks, a
    crashed `bus` (some on their side), a `collapse` of rubble (breaking the towers beside it).
    Fences, barriers, sandbags and graves are `T.LOW`, water `T.WATER`: they block walking but not sight,
    shots or throws (`throwPath` flies over them and never lands on them); cars, buses, rubble are
    `T.OBSTACLE`. Every blocking change goes through `tryBlock`, which keeps it only if every tile
    reachable from the start still is, so nothing (Crystal, exit, landmarks, any street) gets cut off.
    Nothing blocks near the start, the exit or a landmark entrance (`clearSpot`).
  - Smoke plumes rise from burning wrecks, houses, broken towers and lit barrels (`c.smoke`, one
    instanced mesh animated by `animateCity` in `cityScene.js`).
- **Raised ground** (`addHeights`/`raise` in `cityGen.js`, `buildRaised` in `cityScene.js`): grassy **hills** in
  parks, fields, farms and camps (a 2×2–3×2 top, one or two ramps), **loading docks** along warehouse fronts
  (concrete, a ramp at one end) and **terraces** in downtown parks (the middle 3×3 up two flights of steps).
  `city.level` per tile: 0 ground, 1 ramp/stairs (`city.rampDir`: index into `[[1,0],[-1,0],[0,1],[0,-1]]`, the
  way up), 2 raised (`RAISE` = 1.1 up). Anyone can step up one level or drop down any number; nobody climbs
  from the ground straight onto a raised tile. So the top is a spot to hold with one way up: zombies below
  can't reach you (attacks need the two heights within 0.6, `shoveFromPlayers`), they have to come up the
  ramp. Enforced by `resolveCircle` (it reads the mover's height `pos.y`, then sets it to `groundAt`), the
  path fields (`bfs`) and `descend`, `walkClear` (straight lines); sight, shots and throws ignore heights.
  Raised tiles get no containers, closures or wrecks; each one is kept only if it cuts nothing off.
- **Fences and barricades** (`breakables.js`, `BREAKABLES` in `config.js`): every fence is a breakable
  `T.FENCE` tile (`world.breaks`: tile index → `{ kind, hp, max, under, g }`): picket fences round some
  suburban yards, rail fences round farms and fields, chain-link (construction sites, camps, quarantine
  closures), cemetery iron. They stop feet but not sight, shots or throws. Players craft **barricades**
  (C: 2 planks + 1 scrap; use the item to board up the tile ~1.6 units in front of you, on your level,
  with nothing standing in it, `placeBarricade`). **Planks** come from lumber piles (searchable stacks in
  yards, building sites and the hardware store), the hardware store, crates, dumpsters and houses. Hold E
  at a damaged wooden one to repair it (+12 hp, a plank), or at your own barricade to take it down (a plank
  back) (`breakJobs`/`finishJob` through `updateInteract`). Melee kicks a fence for `AI.kick`; explosions
  hit them (`blastBreaks`). A breakable leans more with each hit and topples when broken (`animateBreaks`).
  - **Zombies and fences:** path fields treat a fence as passable at a cost of `breakCost` = 1 + hp ×
    `AI.breakCost` tiles (`bfs` in `grid.js`, a BFS that holds the dearer steps back), so a zombie's way
    leads through one only when going round is longer. When the tile it wants to step into is a breakable
    (`breakAhead`), it stops and bangs on it (`poseBang`, `z.banging` → `F.bang` for clients) every
    `AI.bang` s for its dmg × `AI.bangDmg`, each blow a noise (`AI.bangNoise`) that draws more. Breaking or
    placing one clears the flow cache and every zombie's path (`gridChanged`). Hunters only charge
    straight at a nearby player when they can walk the line (`walkClear`), otherwise they follow the field.
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
  5. Every living player stands in the exit tile column for `EXIT_WAIT` (3 s, ticking; stepping out
     resets it, `updateExit`, `state.exitT`/`exitIn`, shown in the objective panel) → upgrade screen
     (each player picks 1 of 3 upgrade cards, the living heal 40% of max HP) → next city with a new seed.
- **Upgrades** (`UPGRADES` in `js/upgrades.js`; screen in `game.js`): gunsmithing cards, every one about
  your weapons.
  - **Dealing** (`dealCards`): a hand is `HAND` (3) weighted draws without repeats from the whole deck
    (`deck(level)`: every card whose `from` city has been reached), **whatever you carry**. Each card has a
    `tier` whose weight is in `CARD_TIERS` (common 1, uncommon 0.7, rare 0.5, legendary 0.35); a drawn card
    that can't change anything you carry (`cardFits`/`targets`) becomes the **Ammo cache** (`fallback`, never
    drawn itself: fills every carried weapon's reserve), at most once per hand, so the hand shrinks. That
    way dropping weapons before the exit can't raise the odds of the cards you want (it was how to farm
    Holster). Tiers: common = Gunsmith, Tinker, Calibrate, Strip down, Wild card, Trade-in; uncommon =
    Masterwork, Prototype, Supply drop; rare = Transplant; legendary = Holster (dealt from the end of City 3,
    about 12% of hands). The card shows its tier in the weapon rarity colours (`data-r`; legendary glows).
  Flow: pick a card → pick the weapon it works on (only the ones it fits) → Gunsmith / Transplant: pick the
  modifier (`modChoices`) → Transplant: pick the weapon that gets it (`destChoices`) → result screen (what
  changed + the weapon's card) → Continue. A choice is `[card id, slot, modifier, destination]`
  (`validChoice`; clients send it with `act('upgrade', …)`, the host rolls it in `applyCard` and answers with
  an `upgr` event). New modifiers are always random, good or bad by `WEAPON_ODDS.good`.
  - **Gunsmith**: replace a modifier of your choice with a random one the weapon doesn't have (weapons
    with modifiers, so never a Common). **Masterwork**: a gun one tier up plus that tier's extra random
    modifier (not Legendary, not uniques). **Tinker**: reroll every modifier (kinds and strengths), same
    count. **Calibrate**: same modifiers, reroll each strength (`modValue`). **Strip down**: remove a random
    modifier; a gun drops one tier with it. **Wild card**: flip a random modifier that has a bad side, as
    far up the other side's range as it was. **Prototype**: add a random modifier to a unique (up to 3):
    one of its stat kinds or one of its specials. **Transplant**: move a modifier (never a special) from
    one weapon to another that suits it and doesn't have it; a gun receiving it goes up a tier (so not a
    Legendary), a unique holds up to 3; the donor is destroyed (if you held it, you now hold the receiver). **Trade-in**: swap a gun for another standard gun type, same rarity,
    new modifiers, some of its ammo. **Supply drop**: `p.supply`, a weapon find with one city's extra luck
    tossed next to you at the next city start (`supplyDrops`). **Holster**: a third weapon slot.
  - Rarity always matches the number of modifiers on a standard gun (Masterwork, Strip down and
    Transplant move both). Calibrate and Wild card leave specials alone.
- **Game modes** (`state.mode`): `menu` (camera orbits a city behind the title card), `play`,
  `paused`, `craft` (workbench overlay, C), `upgrade`, `dead`. Simulation (`update`) only runs in
  `play`; cosmetic animation (`animateWorld`) runs always.
- **Player** (each of them): 100 HP, walk speed 4.6 (slower than runners, so sprinting matters). Sprint is ×1.75
  and drains stamina (~3.6 s from full); it refills after a 1 s pause, 1.7× faster standing still.
  Running dry makes you **winded** (`player.winded`): no sprint and 0.8× walk until stamina is back
  to 40%. Tunables are the constants above `updatePlayer` in `player.js`. WASD is screen-relative on the isometric grid;
  mouse aims on a plane at gun height (`readLocal` turns both into `p.ctl`). There are no player stat
  upgrades: a weapon's numbers are its base stats plus its own modifiers (`weaponStats(w)` in `weapons.js`).
- **Weapons** (`WEAPONS` in `js/items.js`, instances in `js/weapons.js`): standard guns (`GUNS`:
  pistol (start), shotgun, SMG, hunting rifle) and uniques (`UNIQUES`). Two weapon slots, three with the
  Holster upgrade (`player.weapons`, `player.cur`), Q cycles to the next one (`swapWeapon`/`nextSlot`;
  `swapWeapon(p, i)` jumps to slot i), G drops the held one (`dropWeapon`; you always keep one).
  A slot holds a weapon *instance* `{ id, rarity, mods, mag, uid, cd, idle }` (`makeWeapon`), so two
  shotguns are two different guns. Ammo is finite: each gun type has its own reserve
  (`player.ammo[id]`, capped by `maxAmmo`; uniques without `find` have none); reloads draw from it.
  Each gun has its own noise radius (alerts zombies). Ammo finds (searches, zombie drops) are biased
  by `AMMO_ODDS` (`ammoType` in `loot.js`): 55% the held gun, 25% your other gun (a gun with a full
  reserve or no reserve ammo is skipped; with one gun it gets both shares), 20% any standard gun.
  A find that lands on a unique's ammo (arrows, slugs, coolant) only stays that with
  `AMMO_ODDS.unique` (25%); otherwise it goes to a standard gun you carry, so unique ammo stays rare.
  - **Rarity** (`RARITY`, `rollWeapon`/`rollRarity`/`rollMods`): every found standard gun is Common,
    Uncommon, Rare or Legendary with 0/1/2/3 random modifiers from `WMODS` (all different: damage,
    fire rate, magazine, reload, accuracy, range, noise, knockback, ammo use, crits, plus the rarer
    `pellets` (Spread shot: +1–2 bullets per shot) and `pierce` (Armor piercing: +1–2 zombies), which are
    always good and whole numbers (`int`, weight `w`)). Each modifier is good or bad 50/50
    (`WEAPON_ODDS.good`) with its own strength range, so an Uncommon can beat a Legendary. Rolls are
    weighted by `WMODS[].w` (`rollMods(n, id, have)`, `rollMod`, `modValue`). `thrift` good = chance a shot is free, bad = chance it wastes a round; `crit` good =
    chance of a ×`CRIT` hit (orange bullet), bad = chance to jam (scaled down for fast guns).
    Rarity weights shift toward the rarer tiers each city; `luck` on a container (`LOOT[].luck`:
    lockers, police cars, army trucks, military crates, the armory; `LUCK_SHOP` for the gun shop)
    counts as extra cities. `weaponTitle` = "Rare Shotgun" (Commons and uniques: plain name).
    Colours: `--r-*` tokens in `style.css` (`data-r` attribute sets `--rc`), `RARITY[].hex`/`SH.rar*`
    in the world.
  - **Unique modifiers:** uniques are found without modifiers; only the Prototype upgrade adds them (Gunsmith
    and Tinker then reroll them), from the unique's pool (`modPool`/`freeMods`): its stat kinds (`mods` in
    `WEAPONS`) plus its **specials**. Specials (`SPECIALS` in `items.js`, `{ k, s:1, v:0 }` on the weapon,
    `isSpecial`/`hasMod`) are effects only that unique can have, always good, roll weight `SPECIAL_W`; the
    weapon card lists them last with a ✦ in the unique colour; Transplant never moves them:
    bow: Fire arrows (`ignite` on hit), Retriever (every arrow lands); flamethrower: Napalm (dying while
    burning leaves a fire patch, `napalmPatch`), Sticky fuel (×3 burn time); flask: Contagion (the bitten
    turn for 8 s, without spreading it further; `turnZombie(z, t, { by, contagion, poison })`), Poisoned brew
    (they die when it wears off, credited to the thrower); Arc caster: Capacitor (a kill refunds a shot),
    Supercooled (`chillZombie` per hit); gravity well: Singularity (damage over time inside), Implosion (the
    pop hurts); railgun: Phase beam (through every wall), Concussive (1.5 s stun); cryo: Shrapnel ice (a
    zombie it froze bursts on shattering, `z.shrapnelBy`/`shrapnelBurst`), Frostbite (the frost hurts, cause
    `'frost'`, quiet like fire); Crystal shard: Splinter (a killing shard splits in two, once; bullets' `kill`
    hook), Crystal leech (25% per kill: +1 shard); drone: Medic drone (+1 HP/s while flying), Incendiary
    rounds. Bullets can carry `ignite`, `keepAll` and `kill(b, z)` (host only). Their stat kinds mean what
    fits it: `mag` = fuel/coolant tank, charge, battery, shard capacity or ±1 gravity well (the code reads
    `magSize(w)` as the cap, the HUD shows fuel/charge/battery as % of it), `rate` = railgun charge time
    (`S.charge`) or flask brew time (`S.cooldown`), `range` = spray/bolt/beam/drone reach or the flask's
    splash (`S.range`; also the throw preview), plus `dmg`, `reload`, `noise`, `kb`, `acc`, `pellets`,
    `pierce` where they apply. `modText(m, id)` words them per weapon.
  - **Uniques** (`unique: true`, rolled instead of a gun with `WEAPON_ODDS.unique` odds, ×2 from
    lucky sources, only ones you don't carry; found without modifiers, `kind` = how they fire, `fireUnique` in
    `js/uniques.js`): **flamethrower** (`flame`: hold to spray a fire cone, `mag` = fuel, ignites
    zombies (`burning`), hurts the Crystal; refuels only at gas station pumps, hold E, once per
    station (`l.refueled`, pump targets cached on `city.pumps`)), **Turncoat flask** (`potion`:
    thrown like a molotov via `throwPotion`; zombies in the splash are *turned* for 16 s, then a
    60 s brew (`w.cd`); a radius preview shows while it's ready in your hands), **Arc caster**
    (`arc`: chain lightning to up to 5 zombies, stuns, `mag` = charge that recharges after
    `regenDelay`), **compound bow** (a regular gun with `arrow`: nearly silent, pierces, comes with
    `start` arrows, and `keep` of its arrows land as pickups (`dropArrow`)), **gravity well launcher**
    (`grav`: one orb per click (`w.latch`) flies to the cursor via `throwPath` and opens a well for 4 s
    that drags zombies toward its middle and keeps them dazed (`stunZombie`), its noise drawing more in,
    then pops and stuns; 3 charges, refilled in `resetUniques` at every city start; radius preview while
    loaded), **railgun** (`rail`: hold to charge `w.charge` (`chargeRail`), release to fire
    (`updateRail` watches `mouse.down`; early release fizzles): a beam hitting everything within
    `r + 0.35` of the line, through the first wall it meets and stopped by the second, cause `'rail'`
    (ignores riot shields); slugs reload from a reserve like a gun), **cryo sprayer** (`cryo`: shares
    the flamethrower's `spray`/`puff` code; frost calls `chillZombie`; coolant reloads from canisters
    found like ammo, rarely), **Crystal shard** (`shard`: each shot fans 3 shards (`pellets`, more with a
    `pellets` modifier) piercing 5 zombies; shards are bullets with `bounce`, reflected off walls
    in `updateBullets` (their hit set clears on each bounce); `rechargeShards` from `breakCrystal` is the
    only refill) and **guardian drone** (`drone`: click toggles `w.out`; flying, one shared
    `droneModel()` circles you and shoots the nearest visible zombie whatever you hold, draining its
    battery in 40 s; recharges docked in about 2 min and needs `launch` (25%) to take off; dropping or
    swapping it away docks it).
  - **Frozen zombies** (Frozen section of `zombies.js`): `z.chill` 0..1 slows them (up to `slow`) and
    wears off; at 1 `freezeZombie`: an ice block (`SH.iceGeo`, child of `z.g`), blue glow (`setGlow`,
    shared with turned zombies), no moving/attacking/fuses for `freeze` s (the update loop skips them,
    only you shove them; wells still drag them). Any non-fire hit shatters them (`damageZombie` kills
    with cause `'blast'`), fire thaws them.
  - **Turned zombies** (Turned section of `zombies.js`, `turnZombie`): pink glow and a ♥ mark;
    they hunt the nearest other zombie (`z.foe`, flow fields like everything else) and bite it
    (`WEAPONS.potion.bite` × their damage, cause `'bite'`); bitten zombies fight back for 4 s. They
    never hurt you; your bullets, melee, flames and lightning pass them by (blasts don't). With no
    foe they follow you. When it wears off they walk home.
  - **Models** (`gunModel` in `assets.js`): one shared-geometry model per weapon, with a stripe
    in its rarity colour; the same model is held by the player (`refreshGun`) and spins on the
    ground (1.8×, rarity ring, a light beam from Rare up).
  - **Tooltip / loadout** (`hud.js`): the nearest weapon on the ground within 3.2 units gets a card
    (`weaponCard`: stats, modifiers green/red, unique description, DPS against your held gun, how
    to take it). Holding Tab shows every slot's card bottom right of the full map (`#loadout`).
  - **Pickups:** weapons are never picked up by walking over them. Every weapon find is tossed out
    of the container onto the ground (with a sting sound and a "Found: …" floater) so it can't go
    unnoticed; hold E next to it to pick it up into a free slot, or to swap it for the one in your
    hands. After any E action, E must be released before the next one starts (`p.interact.lock`).
- **Melee:** F any time (left click falls back to it when the held gun has no mag or reserve, or
  a unique can't fire: no fuel, brewing, recharging): a
  0.4 s butt-stroke animation (`poseMelee` in `player.js`); the blow lands 42% in (`meleeStrike`),
  hitting zombies (and the Crystal) in a ±1 rad cone within ~1.7 units for 1 damage
  plus knockback.
  0.55 s cooldown, small noise radius, blocks firing while swinging.
- **Inventory:** 8 slots of stackable items (`player.inv`, `ITEMS`): bandage, medkit, energy drink
  (full stamina + sprint drains 60% less for 20 s via `player.boost`), scrap, molotov, pipe bomb, planks, barricade. Keys 1–8 (or click) use a slot, right-click drops the stack. Full pack →
  overflow is dropped on the ground (`drops`), picked up by walking over it. Inventory, weapons,
  ammo and bleeding all live on the player object, so they carry over between cities; only `newRun`
  resets them (`resetPlayerStats(p)`).
- **Bleeding:** zombie hits may cause bleeding (`bleed` chance per type in `ZTYPES`): −1.1 HP/s until
  a bandage or medkit. (There is no hunger system; it was removed.)
- **Looting** (`js/loot.js`): containers are car trunks, dumpsters, crates, doors on some
  buildings (labelled shop/house/warehouse by building style) and the props inside walk-in landmarks. Hold E within range for 1.5 s (2.5 s at landmarks); a progress ring shows on screen.
  Searching makes noise (`makeNoise`) that can alert nearby zombies; trunks can set off a car alarm.
  Loot tables are in `LOOT` (`js/items.js`), rolled with `Math.random` at search time. `weapon`
  entries roll a weapon instance (`rollWeapon(luck)`); most containers have a small chance, crates,
  lockers and military gear more.
- **Landmarks** (`LANDMARKS` in `items.js`, ASCII `TEMPLATES` + `LM_SPEC` + `placeLandmarks`/`stamp`
  in `cityGen.js`): every city has a police station, a supermarket and a hardware store, plus 1–2
  pharmacies and 1–2 gas stations. New kinds unlock as the run goes on (`LANDMARKS[].from`, with a
  "New landmark" banner and `tip` the first time): hospital from City 3, gun shop from City 4, army
  outpost from City 6. `LM_SPEC.n` = [min, max] per city; `more` kinds (supermarket, pharmacy, gas,
  gun shop) likely get one extra copy in bigger cities. Each goes on the best-scoring free spot
  for its kind (`LM_SPEC.score` per district), big ones first, kept apart. Templates are mirrored/transposed so their front faces +z or +x
  (the camera side). Each has its own look: roof sign with icon, colour band, glass storefront.
  - **Walk-in** (`enter: true`; police station, supermarket, hospital): fill a 2×2 group of blocks, the roads
    between them included. Walls are full `T.BUILDING` tiles around `T.FLOOR` tiles with an open
    entrance; loot is in searchable props inside, not at a door. Supermarket: shelf aisles
    (`shelf` containers), checkouts, a parking lot with cars and carts, `2 + ceil(level/2)` shoppers
    inside. Police station: armory (`armory`: a lucky weapon roll, usually a gun type you don't have, + ammo), lockers, desks, two cells
    behind bars (`T.BARS`: blocks walking, shots and sight pass) where a prisoner may be stuck, a
    yard with flashing police cars (`cruiser` trunks), a flag; `3 + level` guards, half inside and
    half by the entrance. Hospital: an open ward with beds, a dispensary and hall lined with
    medicine cabinets (`medcab`), a reception desk, gurneys, ambulances outside (`ambulance` trunks),
    a red helipad cross on the roof, `2 + ceil(level/2)` patients inside. While you're inside, the
    roof lifts off and the walls drop to knee height (`updateInteriors` in `fx.js`).
  - **Open-air** (`open: true`; army outpost): a 2×2 lot walled with sandbags around a gate, on
    dirt: tents, a watchtower, an army truck (`humvee` trunk) and military crates (`milcrate`:
    ammo-heavy, maybe a gun); `3 + ceil(level/2)` soldier guards inside (riot-gear odds like police).
  - **Door-searched** (pharmacy: bandages, medkits, green cross; hardware store: scrap, maybe a pipe
    bomb, lumber yard and a crate; gas station: molotovs, scrap, maybe a drink, canopy over pumps and
    a price pylon; gun shop: three ammo finds and a 60% chance of a weapon, usually a gun type you don't have, dark walls
    and barred windows; its gun rolls with `LUCK_SHOP`): one block, a solid shop searched through its awninged front door.
  - Discovered once the tile in front of the door/entrance is revealed, then shown on the map;
    dimmed there once everything in it (`l.cts`) is searched.
- **Crafting** (C, `RECIPES`, each with a `cost` of materials): barricade (2 planks + 1 scrap, see above); molotov (3 scrap) burns a 2.6-unit area for 6 s, also damaging the
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
  district. Each works against one player at a time: `z.tgt` while hunting (the nearest one it saw,
  got hit by (`damageZombie`'s `by`) or was told about), otherwise the nearest living one; if its
  player dies it has to find someone else. Each has a home (its spawn point) and a `mode`:
  `idle` (wanders within 7 units of home) → `search` (heard a noise: walks to it, shows a yellow `?`,
  looks around 4 s) → `hunt` (saw you or got shot/hit: red `!`, `z.alert`) → `search` at your last
  known spot once it forgets you → `return` (walks home) → `idle`.
  - Sight (`perceive`, every 0.2–0.3 s, checks every living player, needs a clear line): idle/searching ones notice you within 13
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
  - Paths: hunters that see their player descend that player's flow field (`p.dist`, every 0.25 s; fields go
    through fences at a cost and follow the raised-ground rules, see above); everything
    else walks straight to its target when it's in view, or down `flowTo(tile)` (a BFS field toward
    that tile, cached and shared in `grid.js`).
  - Takeover zombies (and everything within `CRYSTAL.breakR` when it breaks) are `tracked`: they
    always know where the nearest living player is, no leash. When it ends they become residents where they stand.
  - Idle zombies more than 48 units from every player skip crowd separation and animation; zombies more
    than 50 units from the watched player aren't rendered (`z.g.visible`).
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
- **Population:** `populate` (in `game.js`) gives each block `floor(density + random)` standing
  residents (×`residents()` with more players) on random reachable tiles of its patch (the block plus
  the roads north and west of it, `findBlockTile`), at least `POP.startGap` units from every player, plus
  the walk-in landmarks' guards, prisoners and shoppers. Nobody despawns. Killed residents are slowly replaced (every
  1.5–4 s, idle, at least `POP.respawnGap` units from you) while the city has fewer than the sum of
  its blocks' densities (70% once the road is open), into the block furthest below its share
  (counted by each zombie's home block, `blockIndex` in `grid.js`). The takeover's spawns are
  capped by `CRYSTAL.cap`; a 260-zombie ceiling (`zombieCap()`, grows with players) guards frame time.
- **Zombie drops:** deliberately rare so loot matters: a health cross (+20 HP, ~2.5%, more from
  brutes (`heal` in `ZTYPES`) or when below 40% HP), otherwise ~7% a small ammo box (14% during
  the takeover, `CRYSTAL.ammoDrop`, so the takeover's nonstop fighting stays possible). An
  exploder's own detonation gives no kill and no drop.
- **Ground drops spread out** (`freeSpot` in `loot.js`): every drop (and health cross) lands on the
  nearest spot at least 1 unit from other drops/crosses, on an open tile in sight of where it fell,
  so piles fan out instead of stacking. Drops given a `from` point (search results) are tossed there
  in a short arc (`d.fly`) and can't be picked up mid-air.
- **Pickup feedback:** everything you collect (ground drops, search results, health crosses) floats
  up over the player as "+1 🩹 Bandage" (`floatText` in `hud.js`; several at once rise one after
  another). Ground drops and health crosses within 2.8 units get a small name tag below them
  (`dropName` in `loot.js`). Toasts are kept for notes (full pack, new gun hint, alarms).
- **Maps:** the minimap follows the player (46 tiles across, the Crystal/exit pinned to its edge
  when off it); hold Tab for the whole explored city (scaled to the city's size). Both draw from one cached tile layer.
- **Meta:** best run (`{ city, kills }`, team kills) stored in `localStorage['crystal-fall-best']`. Runs where dev
  tools were used (`state.cheated`) aren't saved.
- **Dev tools** (`js/devtools.js`, the `` ` `` key = `Backquote`, the key left of 1 on any layout; works in
  every mode, including the menu): a panel on the right for trying anything out. **Whenever you add a
  feature that's awkward to reach in normal play (a new city phase, item, weapon, threat, landmark,
  upgrade, tunable), add a way to trigger or test it here and list it below.**
  - Readout: fps, mode, city/size/seed, zombie count (takeover ones), kills, tile, district, Crystal HP
    or takeover time.
  - Player cheats apply only to the player you control (`cheats(p)` in `player.js`): god mode
    (`hurtPlayer`/`drainHp` do nothing, no bleeding), infinite ammo (mags and
    reserves refilled every frame), infinite stamina, noclip (no `resolveCircle`, clamped to the
    city), ignored by zombies (they can't see or attack you; noise still draws them; turning it on
    calms everyone), one-hit kills (`damageZombie`), click to teleport (left click on the ground
    teleports instead of shooting), move speed ×0.5–3; heal/revive (also from the death screen or while
    spectating), cure or cause bleeding, +25 max HP, hurt 25, die (turn; spectate if companions live).
  - Players: + / − companion (bots, up to 4 players), kill one (turns into a zombie), revive all where
    they fell, "Play as P*n*" to take control of any player (the others become companions); the
    readout lists everyone's health and kills. "Refill everyone" tops up companions' ammo too.
  - City: go to any city number with an optional seed or a condition (finds a random seed that rolls it;
    the readout shows the current one; from the menu this starts a run there), prev /
    next / restart (same seed), clear city (upgrade screen); find the Crystal, take it to 50% (pulse),
    break it, takeover → 10 s, open the road; reveal the map. Inventory, guns and upgrades carry over.
  - Threats this city: tick/untick which types and modifiers roll (`state.threatIntro`, reset by
    the next city), plus the run's unlock order.
  - Teleport: start, Crystal, exit, every landmark of the city, the nearest road closure of each kind,
    the nearest construction site / cemetery / camp / pond / crater, a broken building, the nearest hill /
    loading dock / terrace and fence of each kind (snapped to the nearest open tile).
  - Fences & barricades: put up a barricade in front of you (no item needed), hit every fence within 12
    units for half its health, break them all. Planks and barricades are in "+1 of any item".
  - Zombies: spawn ×1–50 of any type with any modifiers near you (`dev.spawn` overrides
    `rollThreat`), hunting or not, rising or standing; kill all (no kills/drops; exploders still
    blow), calm all, alert all; freeze zombies (skips `updateZombies`).
  - Items & weapons: +1 of any item (shift-click: a full stack), any gun at a picked rarity (or
    random) with random modifiers, any unique (both replace the held one when every slot is full)
    with full ammo; reroll the held weapon's modifiers (a unique's too, once it has some); scatter 6 random weapon finds around you (normal
    or lucky odds, for the tooltip); refill ammo (also fuel, charge and the flask); refill every gas
    pump; turn or freeze the zombies near you; fill/empty the pack.
  - Upgrades: "Upgrade screen: every card" (clears the city and deals you every card that fits, to try the
    whole pick → weapon → modifier → result flow; ignores `from`), "Card odds" (each card's chance to be in a
    hand at this city, from 4000 simulated hands, `cardOdds`), each card as a button that plays it at once on
    the held weapon (or the first it fits; a random modifier and destination where it asks), and every
    special (✦) as a button that puts it on its unique (giving you the unique first if needed, past the cap).
  - World: time scale (stopped, 0.25–3×; >1 runs several capped `update` steps per frame), camera
    zoom, hide HUD.
  - Using anything sets `state.cheated` (a violet "Dev" chip under the stamina bar; the best run
    isn't saved). The player cheats in `SAVED` are remembered in `localStorage['crystal-fall-dev']`;
    time scale, zoom, freeze and click-teleport reset on reload.
- **Controls:** WASD/arrows move, mouse aims, hold left click to fire, Shift sprints, R reloads,
  F melee, Q swaps guns, G drops the held one, hold right click to aim + release to throw (wheel/T picks molotov or pipe bomb, left click cancels), hold E searches, 1–8 use items (right-click a slot drops it), C crafts, hold Tab for the map, Esc/P pauses (host only), click / Q / Space switch who you watch while dead,
  M mutes, `` ` `` opens the dev tools.

## Folder structure

```
server/serve.py   Co-op server: static files + WebSocket relay (/ws/<room>), Python standard library only
index.html        Markup (HUD, overlay screens), import map, loads css + js/main.js
css/style.css     All styles; light/dark theme tokens on :root
js/
  main.js         Boot (P1, input, best score, menu city) and the requestAnimationFrame loop
  config.js       Grid constants: TILE, B/N (largest city), CITY_BLOCKS/cityBlocks() (size per city),
                  tile types T, walkable()/seeThrough(), DIRS8, names, palettes, DISTRICTS, LAYOUT, POP
  items.js        Pure data: WEAPONS (guns + uniques), RARITY, WMODS, ITEMS, RECIPES, LOOT tables,
                  LANDMARKS (no imports)
  weapons.js      Weapon instances: makeWeapon, rarity/modifier/unique rolls, weaponStats, titles,
                  modifier text
  threats.js      Pure data: zombie types (ZTYPES), modifiers (ZMODS), unlock pool/order, banner tips,
                  Crystal pulse and takeover tuning (CRYSTAL), zombie senses (AI)
  utils.js        Seeded RNG (rng/rand/randi/pick), mr/mri/mpick (Math.random), clamp, lerpAngle, fmtTime, $
  state.js        Shared mutable state: `state`, `world`, `dev` (dev tools flags), entity arrays, input state
  renderer.js     WebGLRenderer, scene, orthographic camera, lights (incl. pooled muzzle/fx lights), updateCamera(),
                  setTint() (takeover violet)
  assets.js       Shared geometries/materials (SH, incl. landmark props and ?/!/♥ marks), window, corrugated
                  and checker textures, carMat(), gunModel() (weapon models, rarity materials)
  audio.js        Procedural WebAudio SFX (sfx.*), initAudio(), toggleMute()
  cityGen.js      Pure procedural city generation from a seed: condition, districts, blocks, landmark
                  templates, broken buildings, crashes, road closures (reachability-checked), wrecks, containers
  breakables.js   Fences and plank barricades: damage, breaking down, placing, repair/take-down jobs, the
                  lean/topple animation, network mirror and sync
  cityScene.js    Builds/tears down the city's Three.js meshes: buildings by style (broken, burnt, frames,
                  crypts), cars (poses), scars (scorch, ponds, craters, debris), smoke, walk-in landmark
                  shells/roofs, props (fences, barriers, bus, crane, graves…), containers, signs, Crystal,
                  barricade, exit; animateCity()
  grid.js         Tile collision (isBlockedTile, isOpaqueTile, resolveCircle), BFS flow fields (player,
                  cached flowTo), line of sight, blockIndex, fog-of-war reveal
  player.js       Players: add/remove (meshes per slot colour), me()/viewed()/nearestPlayer(), co-op scaling
                  (residents/crowd/zombieCap), base stats + starting kit, local controls (readLocal), movement/
                  sprint/stamina, aim/reload, melee pose, bleeding, the lamp
  bots.js         Companions: fill a non-local player's controls (follow, shoot, back off, heal, exit)
  zombies.js      Zombie meshes (incl. type/modifier tells, ?/! mark), spawning + rising from the ground,
                  senses (sight, hearing via makeNoise/alertNear, memory, leash), steering (flow fields,
                  pipe-bomb lure), turned zombies (Turncoat flask), frozen zombies (cryo), damage (armor),
                  stun, explosive fuse
                  and warning ring, death
                  (ragdoll corpses, gibs)
  specials.js     Threat unlocks and rolls, screamer/spitter behaviour, acid, "New threat" banners
  combat.js       Firing per weapon (rarity modifiers: crits, jams, free/wasted rounds), melee start/strike,
                  bullets (and arrows), hurtPlayer/drainHp, Crystal hits
  uniques.js      Unique weapons: flamethrower + cryo sprayer (spray cones, puffs, burning, refuel),
                  Turncoat flask splash, Arc caster (chain lightning bolts), gravity wells (orbs, pull),
                  railgun (charge, beam), Crystal shard (fire, recharge), guardian drone; cooldowns/recharges
  crystal.js      Crystal found/pulse/break, its animation, takeover end, violet tint + screen wave
  inventory.js    Item stacks, weapon slots (give/replace/drop), ammo reserves, using/dropping items, crafting
  loot.js         Hold-E searching (and gas-pump refuels, weapon swaps), loot rolls, ground drops (weapon
                  models, arrows), landmark discovery
  throwables.js   Molotov fire zones, pipe bombs (lure + stun blast), the flask's flight, exploder
                  explosion()/queueBlast()
  fx.js           Particles, decals (blood/dirt/scorch), shockwave rings, health pickups, building fade,
                  walk-in landmark cutaway
  hud.js          HUD bars/text, weapon panel, weapon cards (ground tooltip, Tab loadout), inventory bar,
                  interact prompt, floating pickup text, drop name tags, toasts, minimap + full map, district line,
                  craft screen, banner, showScreen()
  upgrades.js     Upgrade cards (gunsmithing on your weapons): which fit, dealing, validating and
                  playing a choice
  game.js         Game flow: startCity/newRun, placing/reviving/killing players, spectating, populate(),
                  takeover countdown + spawning, exit wait, per-player upgrades, game over, pause/craft,
                  resident respawns, update() and animateWorld()
  input.js        Keyboard/mouse/focus listeners (one-shot actions go through act())
  net.js          Transport: WebSocket to the relay, send/onNet, reconnect, VERSION
  host.js         Host session: remote players, ACTS, emit/emitTo/sfxFor, ticks (snapshots, full state),
                  mid-run sync, disconnects; nextId() network ids
  client.js       Client session: mirrors the host's world (events, snapshots, interpolation), predicts its
                  own player, act()
  lobby.js        Host co-op / Join co-op buttons and the lobby card, the ?bot autopilot
  smooth.js       Snapshot interpolation: timestamped samples, clock offset, drawing remote things slightly in the past
  devtools.js     Dev tools panel (` key): cheats, city/phase jumps, teleport, spawning, items, time scale
features/
  multiplayer.md  Plan for the rest of co-op (networking: relay server, host/client split, messages)
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
  `exitMarker`, `buildingMeshes`, `interiors`, `interiorAt`, `explored`, `mmDirty`, `lure`) live on `world` in
  `state.js`; run/game state lives on `state` (incl. `seed` of the current city and `cheated`); dev tools flags
  live on `dev`, so gameplay code reads them without importing `devtools.js`. Players are objects in the
  `players` array (`state.me`/`state.view` index into it); **anything a player does takes the player as
  a parameter** (`fire(p, dt)`, `useSlot(p, i)`, `weaponStats(w, p)`, `hurtPlayer(p, dmg, z)`…), never
  a global "the player". Per-player state (interact target, last revealed tile, flow field `p.dist`,
  drone model, rail/flame timers) lives on the player. UI code uses `me()` for what you do and `viewed()`
  for what's shown. Entity arrays (`zombies`, `bullets`, `drops`,
  `throwns`, `hazards`, `spits`, `puddles`, `rings`, `players`, …) are
  mutated in place (`push`/`splice`/`length = 0`), never reassigned.
  Exception: `utils.js` owns `rng`, which only it reassigns via `seedRng()`.
  Weapons are instances on `p.weapons` and on ground drops (`d.w`); mutate them in place. Bullets,
  burning, fire zones and thrown items carry their player (`owner`/`by`) for kill credit.
- **Networked entities:** anything the host creates that clients must see gets a network id (`nid` from
  `nextId()`), an event when it appears and goes (`emit([...])`), and a way to build it without its
  gameplay (a `…Mesh(…, ghost)` function or `mirror…`), so host and client share the look. Code that
  clients also run (corpses, rising, `animate…` functions) must only make `local` effects. Keep event
  arrays short and numbers rounded (`r2`). Personal sounds/messages take the player (`sfxFor`, `toast(…, p)`).
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
  Generation order: condition → districts → plaza → landmarks → district blocks → `damage` → `addCrashes`
  → `addClosures` → `addWrecks` → `placeLoot` (dumpsters, crates, trunks, doors). Cosmetic details that
  should look the same on every machine (rubble heaps, graves, broken-building holes) take a seed stored
  in the city data and `srand` in `cityScene.js`, not `Math.random`.
- **City data gets runtime fields.** `buildCityScene` adds `px/pz/range/time/noise/searched/glint/open`
  to each `city.containers` entry, and `loot.js` sets `found` on landmarks. Per-city, so no reset needed.
  Landmark records: `{ type, cts (container indices), ox/oz (tile in front of the door/entrance/gate),
  cx/cz (center, tiles) }`, plus `interior, floor, cells, yard` for walk-in ones and `floor, yard`
  for open-air ones. `city.floors` maps a walk-in kind to its floor tiles; landmark vehicles in
  `city.cars` carry `style` (`police`, `ambulance`, `military`).
- **Resource ownership:** per-city geometries/materials are registered with `own()` in
  `cityScene.js` and disposed in `teardownCity()` (`G(key, make)` caches a per-city geometry shared
  by every mesh of that shape). Things in `SH` (assets.js) are shared and
  never disposed. Zombie materials are per-zombie and disposed in `disposeZombie()`
  (zombie gear/tell meshes use shared `SH` geometry and materials), as are an exploder's warning
  ring materials. Gibs are zombie meshes re-parented to the scene that keep those materials, so a
  dead zombie is always removed with `disposeCorpse()` (gibs + zombie), also in `teardownCity()`.
  `rings` entries (`{ mesh, t, T, r0, r1, op }`) own their material, disposed when they finish.
  Player bodies share geometry and skin/cap/pack materials (`PG` in `player.js`); their jacket, ring and
  swoosh materials are their own, disposed by `removePlayer`.
- **Tile types:** `walkable` = road, exit, sidewalk, grass, plaza, floor; `seeThrough` adds `BARS`, `LOW`,
  `WATER` and `FENCE` (block walking only; `FENCE` tiles are breakables in `world.breaks`). `OBSTACLE`, `BUILDING`, `WALL` block everything. The minimap colours
  each type (`MM_COLORS` in `hud.js`), so a new tile type needs a colour there.
- **Heights:** a player's or zombie's `pos.y` is the ground under it (0 except on raised ground and ramps):
  `resolveCircle` keeps it up to date, so anything that moves something must go through it, and anything
  that places something (teleports, spawns, joins) snaps it with `toGround(pos)`. Things drawn on the ground
  (drops, health crosses, decals, fire, acid, pipe bombs, particles' floor, gibs) add `groundAt(x, z)`.
- **Units:** grid tiles are `TILE = 2` world units. Tile arrays (`grid`, `explored`, flow fields,
  `interiorAt`, `level`, …) are always `N*N` with `N = 102` (the largest city, `B = 14` blocks) and indexed
  `z*N + x`; a smaller city fills the top-left `n×n` and every tile outside it is `T.WALL`, so
  bounds checks against `N` stay correct. Use `city.n`/`city.b` (not `N`/`B`) for anything about
  the city's extent: its edge walls, exit column, ground planes, loops over its blocks, map
  scaling. Roads are the tiles where `(t-1) % 7 < 2`. World→tile is `Math.floor(pos/TILE)`; tile
  center is `(t+0.5)*TILE`. Block of a point: `blockIndex(x, z)` in `grid.js` (index into
  `city.blocks`, `bz*b + bx`).
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
  Anything flat drawn on the ground (ground overlays — parking, forecourts, shop floors — 0.083, pond rims
  0.084, scorch 0.0845, crater floors 0.086, water 0.088, crater holes 0.09,
  parking lines 0.086, decals 0.09, acid 0.11, fire 0.12, acid marker and exploder warning ring 0.13,
  shockwaves 0.14) must sit above 0.08 off-road.
- **No runtime lights.** Adding/removing lights recompiles shaders; reuse `muzzleLight`/`fxLight` (and
  the one player lamp, which follows the watched player; players don't get a light each).

## Testing

No automated test suite. The dev tools (`` ` ``) shortcut most of this: jump to a city, teleport to a
landmark, spawn the threat you changed, skip the takeover. To verify changes, serve locally and play a city through:
explore (check districts feel different and each city condition looks like itself (dev tools: City → Condition):
dead ends, pileups, checkpoints, buses, collapses, crashes, broken/burnt buildings, smoke, the construction
site crane, cemetery, camp, pond, crater; stand on a hill / dock / terrace and check zombies come up the
ramp and can't hit you from below; craft and place a barricade, watch zombies bang through it (or a fence)
when the way round is long, repair it, take it down; walk into the police station and supermarket; from City
3/4/6 the hospital, gun shop and army outpost) → search
containers/landmarks (weapon finds: rarity colours, the ground tooltip, Tab loadout; "Scatter 6 guns" in the dev
tools) → try each unique (flamethrower + a gas pump refuel, flask, arc caster, bow arrows, gravity well,
railgun through a wall, cryo then shatter, shards bouncing + recharging on a Crystal break, drone) →
lose a hunting zombie by breaking line of sight, check it walks home →
shoot Crystal (pulse from City 3) → survive the takeover
(set `state.takeover` low to skip ahead) → exit → pick upgrade (card → weapon → modifier → result →
Continue; "Upgrade screen: every card" in the dev tools deals them all) → next
city (inventory and guns should carry over); also craft, throw, swap guns, pause and death.
For co-op, add companions in the dev tools (Players): check zombies split their attention, a companion
dying turns into a zombie, dying yourself spectates (click/Q cycles), the exit waits for everyone for 3 s,
each player gets different upgrade cards, the dead come back next city, and zombie counts go up.
Headless, `addPlayer()` from `player.js` plus `startCity()` places everyone; `killPlayer(p)` and
`spectate(1)` are in `game.js`.
For networking, run `python3 server/serve.py` and open two windows side by side (background tabs
throttle `requestAnimationFrame`): one clicks Host co-op, the other Join co-op. Check the client sees the
same city and zombies, its moves, shots, throws, searches and item use happen on the host, upgrades, the
next city, death/spectating and pause reach it (or open the second window at `/?bot` and let it play), a third window can join mid-run, closing a client leaves a
bot for 30 s, and closing the host sends clients back to the menu. Headless, open two Playwright contexts
on the server; drive the host with `update(0.05)` plus `hostTick(0.05)` (host.js) in a loop.
Watch the browser console for errors. A headless check with Playwright works if you serve the
folder and (when the CDN is unreachable) route `**/three.module.js` to a local copy of r128.
Headless WebGL runs at ~5 fps and `dt` is capped at 0.05 s, so drive timing-sensitive checks by
calling `update(0.05)` from `game.js` in a loop (modules can be reached via `await import('/js/...')`).
