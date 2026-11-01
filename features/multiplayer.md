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
    already encrypted). Optional: `tailscale serve` for an `https://`/`wss://` address. The full
    host/join steps, Tailscale included, go in README.md (step 10).
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
| `hello` | on connect | `{ name, v }`: `v` = game version; the host answers a mismatch with `reject` and the client shows "Host runs a different version, reload" |
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
   Log connects and disconnects. Make it room-aware from the start (`/ws/<room>`, one room is
   fine for now) and cap message size, so it ports to a public relay (see "Public hosting later").
2. **Net module** (`js/net.js`): connect, send, receive, reconnect, and a `net` object on `state.js`
   (`role: 'solo'|'host'|'client'`, `id`). `state.host = net.role !== 'client'`. Gameplay code only
   sees `send(to, msg)`, `onMessage(from, msg)`, `onJoin(id)`, `onLeave(id)`; the WebSocket lives
   behind that, so a Steam or WebRTC transport can replace it later. Build the URL from `location`.
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
    instances) and the in-game controls text. **README.md must describe how to host and join**,
    including playing across different networks via Tailscale:
    - One-time setup: install Tailscale on every machine. Get everyone into one tailnet: invite
      them, or share just the host's machine (admin console → Machines → Share… → their email).
      Turn on MagicDNS.
    - Each session: the host runs `python3 server/serve.py` (it must listen on all interfaces and
      print its LAN and Tailscale addresses). Friends open `http://<host-machine-name>:8000` (or the
      `100.x.y.z` address from `tailscale ip -4`) and click **Join co-op**.
    - Troubleshooting: `tailscale ping <host>` (fails → the share or invite is missing); the page
      doesn't load → the host's firewall is blocking port 8000 (allow Python / the Tailscale adapter);
      custom tailnet ACLs must allow port 8000; "via DERP" in the ping means relayed, so expect
      higher latency.
    - Optional HTTPS: `tailscale serve --bg 8000` → `https://<machine>.<tailnet>.ts.net` (the game's
      WebSocket then uses `wss://` automatically, so `js/net.js` must build its URL from
      `location`).

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

## Public hosting later

Tailscale + `serve.py` is for playing with friends. If the game goes public, the host-authoritative
design stays: only the transport and where the relay runs change. Options, in the order to consider them:

1. **Public relay with room codes** (the next step). The game stays static (GitHub Pages, Cloudflare
   Pages or itch.io); the same game-agnostic relay runs in the cloud, and the host gets a room code
   (`KX4P`) to share. `net.js` connects to `wss://<relay>/ws/<room>` (Pages is `https://`, so the relay
   needs TLS). Where:
   - Cloudflare Workers + Durable Objects: one Durable Object per room holding its sockets, no
     servers, edge-close to players, no egress fees. Relay rewritten in JS (same ~100 lines).
   - A small VPS (Hetzner, DigitalOcean, OVH): `serve.py`'s relay nearly as is, behind Caddy for TLS;
     generous included traffic.
   - Fly.io / Render / Railway: easy container deploys, but check egress pricing: 80 KB/s × 3 clients
     ≈ 0.9 GB per room-hour.
   A relay also means the host uploads each snapshot once and the relay fans it out.
2. **Steam** (if it becomes a product): wrap in Electron / NW.js / Tauri, use Steamworks (e.g.
   `steamworks.js`): lobbies, friend invites, "Join game", and Steam Datagram Relay (free relayed P2P
   with NAT traversal). The same messages go over Steam networking instead of a WebSocket; no servers
   to host. $100 Steam Direct fee.
3. **Discord Activities:** the web build inside a Discord voice call, made for playing with friends.
   Still needs a relay (option 1) behind it, plus Discord's SDK, proxy and CSP rules.
4. **WebRTC P2P:** rejected above for LAN/tailnet (mDNS), but it works on the public internet with a
   signalling server and TURN for the ~10–20% of connections that can't go direct (Cloudflare TURN,
   metered.ca, coturn). Near-zero server cost and unreliable channels suit snapshots, but the host
   uploads to every client and there are two services to run. Only if relay bandwidth costs hurt.
5. **Dedicated servers** (Edgegap, AWS GameLift, Rivet, Colyseus Cloud, Nakama, Agones): the
   simulation runs server-side, so no host advantage and runs survive the host leaving. Needs
   `update()` running in Node without Three.js, a large refactor (gameplay code creates meshes and
   effects inline), plus a paid server per run. Not worth it for 2–4 player PvE co-op without public
   matchmaking.

Not suitable: Firebase / Supabase Realtime / Ably / Pusher (priced and rate-limited for chat-like
traffic, not 20 Hz snapshots). Check current pricing before choosing; the notes above are a starting point.

Do these now so those doors stay open (already folded into the steps above):
- **Transport behind `net.js`** (step 2): `send`/`onMessage`/`onJoin`/`onLeave` only.
- **Version check in `hello`**: clients generate the city from the seed, so different builds make
  different cities. Bump the version whenever `cityGen.js`, `config.js` layout data or the messages
  change. A public site will have stale cached builds.
- **Rooms in the relay** (step 1), plus caps on message size (and rate, before going public).
- **Binary snapshots** (quantised positions, deltas) before City 6+ with four players goes over the
  public internet; JSON is fine on a tailnet.
- **The host leaving ends the run.** The non-deterministic simulation makes host migration
  impractical; that's normal for listen-server co-op.

## Open questions

- Should loot rolled for one player (weapon finds) be visible to all as a ground drop (as now), or
  per player? It's shared today; keep it unless it feels bad.
- Friendly fire: off (bullets ignore players), as now.
- Later: cities and loot that grow with player count (requested). This is separate from
  networking: scale `CITY_BLOCKS` and the `LOOT` rolls by player count in `generateCity` and pass
  the count with the seed so clients generate the same city.
