// ---------- Net (transport) ----------
// The only module that knows about WebSockets. Everything above it sees send(to, msg) and the
// handlers set with onNet({ message(from, msg), join(id), leave(id), close(why), ready() }), so a
// Steam or WebRTC transport could replace this file. The relay (server/serve.py) serves the game
// too, so the socket URL is built from location (ws:// or wss:// behind `tailscale serve`).
// Messages are JSON; the host addresses one connection id or '*' (every client), clients always
// talk to the host. See the wire format at the top of server/serve.py.
import { state, net } from './state.js';

// Bump whenever cityGen.js, config.js layout data or the messages change: clients build the city
// from the seed, so different builds would make different cities.
export const VERSION = 6;
const H = { message(){}, join(){}, leave(){}, close(){}, ready(){} };
let ws = null, closing = false, retries = 0;

export function onNet(handlers){ Object.assign(H, handlers); }
export const wsUrl = room => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${encodeURIComponent(room)}`;
export const connected = () => !!ws && ws.readyState === 1;

// Opens the socket as 'host' or 'client'. Resolves once the relay gave us an id (and, for a host,
// the host seat); rejects with a reason a player can read.
export function connect(role, room = net.room){
  if (location.protocol === 'file:') return Promise.reject('Open the game through server/serve.py to play co-op');
  if (ws){ const old = ws; ws = null; try { old.close(); } catch(e){} }
  closing = false; net.room = room;
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = why => { if (!done){ done = true; reject(why); } };
    const s = ws = new WebSocket(wsUrl(room));
    const t = setTimeout(() => { fail('No co-op server answered. Start the game with python3 server/serve.py'); s.close(); }, 5000);
    s.onerror = () => fail('No co-op server here. Start the game with python3 server/serve.py');
    s.onmessage = e => {
      const d = e.data;
      if (d[0] === '!'){
        const [cmd, arg] = d.slice(1).split('|');
        if (cmd === 'id'){
          net.id = +arg;
          if (role === 'host') s.send('!host');
          else { setRole('client'); retries = 0; clearTimeout(t); done = true; resolve(); H.ready(); }
        } else if (cmd === 'host'){
          clearTimeout(t);
          if (arg === 'ok'){ setRole('host'); done = true; resolve(); H.ready(); }
          else { fail('Someone is already hosting on this server. Join instead'); s.close(); }
        } else if (cmd === 'join') H.join(+arg);
        else if (cmd === 'leave') H.leave(+arg);
        else if (cmd === 'hostleft'){ closing = true; H.close('The host left'); s.close(); }
        else if (cmd === 'nohost') H.message(0, { t:'nohost' });
        return;
      }
      if (net.role === 'host'){
        const i = d.indexOf('|');
        let m; try { m = JSON.parse(d.slice(i + 1)); } catch(err){ return; }
        H.message(+d.slice(0, i), m);
      } else {
        let m; try { m = JSON.parse(d); } catch(err){ return; }
        H.message(0, m);
      }
    };
    s.onclose = () => {
      clearTimeout(t);
      if (ws !== s) return;
      ws = null;
      if (!done){ fail('Lost the connection to the co-op server'); return; }
      if (closing) return;
      // A client that drops tries to get back in (the host keeps its player for a while).
      if (net.role === 'client' && retries < 5){ reconnect(room); return; }
      const was = net.role; setRole('solo');
      H.close(was === 'host' ? 'Lost the co-op server' : 'Lost the connection to the host');
    };
  });
}
function reconnect(room){
  retries++;
  setTimeout(() => connect('client', room).catch(() => {
    if (retries < 5) return reconnect(room);
    setRole('solo'); H.close('Lost the connection to the host');
  }), 500*2**retries);
}
function setRole(r){ net.role = r; state.host = r !== 'client'; }
export function disconnect(){
  closing = true;
  if (ws){ const s = ws; ws = null; try { s.close(); } catch(e){} }
  setRole('solo');
}
// Host: to = a connection id or '*'. Clients: to is ignored (everything goes to the host).
// msg can be an object or an already-encoded JSON string.
export function send(to, msg){
  if (!connected()) return;
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  ws.send(net.role === 'host' ? `${to}|${s}` : s);
}
