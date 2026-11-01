# crystal-fall

Isometric zombie roguelike built with Three.js. Find each city's Crystal, shatter it, survive the horde, and take the road to the next city. Scavenge cars, dumpsters, crates and buildings for ammo, food and medicine, and craft molotovs and pipe bombs from scrap. Play alone or in co-op with up to four players.

Runs straight from GitHub Pages: plain ES modules, no build step. To play solo locally:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000. See [CLAUDE.md](CLAUDE.md) for design notes and code layout.

## Co-op (2–4 players)

One player hosts: their browser runs the game and everyone else's browser follows it. The host also runs a small server that serves the game and relays messages between the players. It's one Python file that uses only the standard library, so there's nothing to install apart from Python 3.

### Hosting

```bash
python3 server/serve.py            # port 8000; add --port 9000 to use another one
```

It listens on every network interface and prints the addresses to share, for example:

```
Crystal Fall server on port 8000. Open one of these (friends too):
  this machine  http://localhost:8000
  LAN           http://192.168.1.20:8000
  Tailscale     http://100.101.102.103:8000
  Tailscale     http://my-laptop:8000
```

Open http://localhost:8000, type your name, click **Host co-op**, wait for your friends to show up in the lobby, then click **Start run**. Friends can also join a run that has already started: they appear next to you with a fresh kit. Only the host can pause, and only the host has the dev tools. If the host closes the game, the run ends for everyone.

### Joining

Open the host's address (from the list above), type your name and click **Join co-op**. Everyone has to open the game from the host's server, not from GitHub Pages: the server that hosts the game is also the one that passes the messages along. If your connection drops, a bot plays your character for 30 seconds. Join again with the same name to take it back.

### On the same network (LAN)

Use the host's `LAN` address. If the page doesn't load, the host's firewall is probably blocking port 8000. Allow incoming connections for Python, or for that port, on private networks.

### Across the internet with Tailscale

[Tailscale](https://tailscale.com) puts your machines on one private network (a *tailnet*) wherever they are, and its traffic is encrypted. You don't need to forward any ports.

**One-time setup**

1. Install Tailscale on every machine that will play and sign in.
2. Get everyone into the same tailnet. Either invite your friends to yours (admin console → **Users** → **Invite users**), or share just the host's machine with them (admin console → **Machines** → the host's machine → **Share…** → their email). Each friend accepts with their own Tailscale account.
3. Turn on **MagicDNS** (admin console → **DNS**) so friends can use the machine's name instead of its IP address.

**Each session**

1. The host runs `python3 server/serve.py`.
2. Friends open `http://<host-machine-name>:8000`, or `http://100.x.y.z:8000` with the address from `tailscale ip -4` on the host. Then they click **Join co-op**.

**Troubleshooting**

- `tailscale ping <host-machine-name>` from a friend's machine. If it fails, the invite or the share is missing, or the host's Tailscale is off.
- The ping works but the page doesn't load: the host's firewall is blocking port 8000. Allow Python (or the port) on the Tailscale network adapter.
- Custom tailnet ACLs have to allow port 8000 to the host.
- `via DERP` in the ping output means the connection is relayed through Tailscale's servers. It still works, but expect more lag.

**Optional HTTPS:** on the host, `tailscale serve --bg 8000` publishes the server at `https://<machine>.<tailnet>.ts.net`, reachable from your tailnet. The game then switches its connection to `wss://` by itself.
