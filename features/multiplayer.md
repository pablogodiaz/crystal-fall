# Multiplayer: remaining plan

Co-op over a local network or Tailscale, 2–4 players. Stage 1 (players array, per-player controls,
co-op rules, dev-tools companions) is done on `feature/multiplayer-core`; see CLAUDE.md, "Players".
This file covers what's left. Build it on a new branch on top of that one, e.g.
`feature/multiplayer-net`.

## Decisions

- **Host-authoritative.** One browser (the host) runs the whole simulation exactly as today
  (`update()` in `game.js`). Other browsers (clients) send their controls and actions, and receive
  snapshots and one-off events. No lockstep: about 140 gameplay calls use `Math.random`, `dt` varies,
  and effects run inside gameplay code, so a deterministic simulation isn't realistic.
- **Transport: a tiny relay server the host runs, which also serves the game.** One command on the
  host's machine (`python3 server/serve.py`) serves the static files *and* a WebSocket endpoint
  (`/ws`) on the same port. Everyone opens the game from the host's address, so the WebSocket is
  same-origin: no mixed-content problems, no signalling server, no CDN dependency for networking.
  - Python standard library only (no pip): `http.server` plus a hand-rolled RFC 6455 handshake and
    framing (text frames, ping/pong, close). This is about 100–150 lines. The relay doesn't understand
    the game. It assigns each connection an id and forwards messages between the host and clients, so
    the game logic stays in JS.
  - LAN: `http://<host-lan-ip>:8000`. Tailscale: `http://<machine-name>:8000` (tailnet traffic is
    already encrypted). Optional: `tailscale serve` for an `https://`/`wss://` address.
  - Rejected: WebRTC/PeerJS. It needs signalling, and Chrome hides LAN addresses behind mDNS names,
    which don't resolve across a tailnet. GitHub Pages can't host a relay, so networked games are
    always played from the host's server (solo still works on Pages).
- **The city comes from the seed.** Clients build the same city locally with
  `startCity(level, seed)` (`cityGen.js` is deterministic). Only the moving parts go over the wire.
- **JSON messages** to start with. Switch the snapshot to a binary `ArrayBuffer` only if bandwidth
  or GC shows up in profiling. 260 zombies × ~16 bytes × 20 Hz ≈ 80 KB/s, fine on a LAN.

## Messages

Client → host (via relay):

| type | when | payload |
|---|---|---|
| `hello` | on connect | `{ name }` |
| `ctl` | 30 Hz | `p.ctl` fields: `mx, mz, sprint, fire, use, aim:[x,z]`, plus `seq` |
| `act` | on input | `{ a:'reload'\|'swap'\|'drop'\|'melee'\|'cycle'\|'use'\|'dropSlot'\|'aim'\|'throw'\|'cancelAim'\|'craft'\|'upgrade', arg }` |

Host → clients:

| type | when | payload |
|---|---|---|
| `welcome` | after `hello` | `{ you:index, players:[…], level, seed, run state }` |
| `city` | `startCity` | `{ level, seed }`: clients run `startCity` themselves, then wait for snapshots |
| `snap` | 20 Hz | players (pos, vel, angle, hp, stamina, flags, cur weapon), zombies (id, x, z, rotY, mode/alert/rise/stun/frozen/turned/fuse, hp%), drops (id, kind, x, z, fly), hazards, Crystal hp, phase, takeover clock, exitT |
| `you` | on change | the client's own full player state (inv, weapons, ammo, upgrades): it only changes on actions, so it doesn't go in every snapshot |
| `ev` | as they happen | `spawn` (zombie id, type, mods, x, z, rise, look), `kill` (id, cause, dx, dz, dmg), `shot` (owner, origin, angle(s), kind, crit), `boom`, `stun`, `sfx`, `banner`, `toast` (to one player), `float` (to one player), `searched` (container index), `drop`/`pickup` (drop id), `turned` (player), `upgrades` (that player's 3 offers), `mode` (pause/upgrade/dead) |

## Work, in order

1. **Relay server** (`server/serve.py`): static files + `/ws`, a connection registry, forward
   client → host and host → one/all clients. The first connection to send `host` becomes the host.
   Log connects and disconnects.
2. **Net module** (`js/net.js`): connect, send, receive, reconnect, and a `net` object on `state.js`
   (`role: 'solo'|'host'|'client'`, `id`). `state.host = net.role !== 'client'`.
3. **Lobby UI** (`index.html` + `hud.js`): menu buttons **Host co-op** / **Join co-op**, a lobby card
   with the address to share, the list of connected players (name, colour) and, for the host,
   **Start run**. Name field remembered in `localStorage`.
4. **Remote players on the host:** `hello` → `addPlayer()` with `p.remote = connId`. In
   `updatePlayers`, remote players use the `ctl` last received instead of `readLocal`/`updateBot`.
   `act` messages call the same functions input.js calls (`tryReload(p)`, `useSlot(p, i)`,
   `pickUpgrade(p, u)`…). Throws need the aim point from the message.
5. **Stable ids:** `z.id`, `d.id` (drops), `h.id` (hazards) from a counter on the host; maps on the
   client (`id → object`).
6. **Client mode** (`net.role === 'client'`): the main loop does not call `update()`. It applies
   snapshots, runs `animateWorld` plus client-side interpolation, and renders.
   - Zombies: `spawn` events create the mesh with `createZombieMesh(type, mods)` (export it). The
     player-zombie `look` recolours it. Snapshots move them, with interpolation between the last two
     snapshots (~100 ms behind). Walk cycle, marks, stun sway, rise animation and warn rings are
     driven from the replicated flags. `kill` events run `makeCorpse`, so death animations stay local.
   - Bullets: `shot` events spawn cosmetic bullets that fly and stop at walls locally (no damage).
     Damage only ever happens on the host.
   - Drops, health crosses, hazards (fire, bombs, acid, wells), Crystal and tint, searched
     containers (`c.open()`), exit marker, takeover clock: from snapshots and events.
   - Effects with sound (`burst`, `shockwave`, `sfx.*`) come from events. Refactor the few hot
     paths so gameplay code calls an `fx(…)` helper that plays locally on the host and broadcasts.
7. **Own-player prediction on clients:** move your own player locally with the same
   `updatePlayer` movement code. When a snapshot arrives, correct toward the host's position
   (snap if more than ~1.5 units off, otherwise ease). Aim angle is always local.
8. **HUD on clients:** reads `me()` like now. Its inventory, weapons, ammo and interact target come
   from `you` messages and the snapshot. The upgrade screen uses the offers from `upgrades`. Toasts
   and floaters come as targeted events.
9. **Session rules:**
   - Pause is host-only. Clients see the pause screen without a Resume button.
   - Dev tools are host-only (already gated on `state.host`).
   - Joining mid-run: the player spawns next to the host's player with a fresh kit. Joining during
     the upgrade screen counts them as having picked.
   - Disconnect: the player stays as a companion (`updateBot`) for 30 s, then is removed. If they
     reconnect with the same name, they take it back. If the host disconnects, every client returns
     to the menu ("Host left"). There's no host migration.
   - Best run is saved on every machine with the team result. `state.cheated` comes from the host.
10. **Docs:** update CLAUDE.md (net module, message list, client/host split, how to test two
    instances) and the in-game controls text.

## Testing

- Two tabs on one machine: `python3 server/serve.py`, then one tab hosts and the other joins at
  `localhost:8000`. Background tabs throttle `requestAnimationFrame`, so put them in two windows side
  by side, or drive the host headless.
- Playwright: two pages in one browser (host + client). Drive the host's `update(0.05)` in a loop,
  check that the client's zombie count and positions follow the host's, a client `act` (reload, use
  bandage) changes the host's state, and city change, exit wait, upgrades and death/spectate work
  across both.
- Real LAN / Tailscale check with two machines before merging. Watch the bandwidth in DevTools
  (Network → WS) at City 6+ with four players.

## Open questions

- Should loot rolled for one player (weapon finds) be visible to all as a ground drop (as now), or
  per player? It's shared today; keep it unless it feels bad.
- Friendly fire: off (bullets ignore players), as now.
- Later: cities and loot that grow with player count (requested). This is separate from
  networking: scale `CITY_BLOCKS` and the `LOOT` rolls by player count in `generateCity` and pass
  the count with the seed so clients generate the same city.
