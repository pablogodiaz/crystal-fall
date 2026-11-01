#!/usr/bin/env python3
"""Crystal Fall co-op server: serves the game and relays WebSocket messages.

    python3 server/serve.py [--port 8000]

Everyone opens the game from this machine's address (http://<this-machine>:8000) and the game's
WebSocket goes to /ws/<room> on the same port. The relay doesn't understand the game: it gives every
connection an id and forwards text messages between the room's host and its clients.

Wire format (text frames, see js/net.js):
  relay -> anyone   "!id|<n>"            your connection id, sent on connect
  anyone -> relay   "!host"              claim the room's host seat; answer "!host|ok" or "!host|taken"
  client -> relay   "<payload>"          forwarded to the host as "<from>|<payload>" ("!nohost" if none)
  host -> relay     "<to>|<payload>"     to = a connection id or "*" (every client); payload forwarded as is
  relay -> host     "!join|<n>" / "!leave|<n>"   a client connected / disconnected
  relay -> clients  "!hostleft"          the host disconnected (no host migration)
Python standard library only: http.server plus a small RFC 6455 implementation.
"""
import argparse, base64, functools, hashlib, os, socket, struct, subprocess, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
MAX_MSG = 2 * 1024 * 1024  # bytes per message (snapshots are a few KB)
MAX_ROOM = 8               # connections per room (4 players plus reconnect slack)

lock = threading.Lock()
rooms = {}                 # room name -> { 'host': Conn | None, 'conns': { id: Conn } }
next_id = [0]


def log(*a):
    print(*a, flush=True)


class Conn:
    def __init__(self, handler, room):
        with lock:
            next_id[0] += 1
            self.id = next_id[0]
        self.h, self.room, self.wlock, self.open = handler, room, threading.Lock(), True

    def send(self, text):
        data = text.encode('utf-8')
        n = len(data)
        head = bytes([0x81]) + (bytes([n]) if n < 126 else struct.pack('!BH', 126, n) if n < 65536 else struct.pack('!BQ', 127, n))
        self.frame(head + data)

    def frame(self, raw):
        if not self.open:
            return
        try:
            with self.wlock:
                self.h.wfile.write(raw)
                self.h.wfile.flush()
        except OSError:
            self.open = False


def unmask(data, mask):
    n = len(data)
    if not n:
        return data
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, 'big') ^ int.from_bytes(m, 'big')).to_bytes(n, 'big')


def read_frames(rf):
    """Yields (opcode, payload) for complete messages; continuation frames are joined."""
    buf, op0 = b'', None
    while True:
        h = rf.read(2)
        if len(h) < 2:
            return
        fin, op, masked, n = h[0] & 0x80, h[0] & 0x0F, h[1] & 0x80, h[1] & 0x7F
        if n == 126:
            n = struct.unpack('!H', rf.read(2))[0]
        elif n == 127:
            n = struct.unpack('!Q', rf.read(8))[0]
        if n > MAX_MSG or len(buf) + n > MAX_MSG:
            raise ValueError('message too big')
        mask = rf.read(4) if masked else None
        data = rf.read(n)
        if len(data) < n:
            return
        if mask:
            data = unmask(data, mask)
        if op >= 0x8:  # control frames are never fragmented
            yield op, data
            continue
        if op:
            op0, buf = op, data
        else:
            buf += data
        if fin:
            yield op0, buf
            buf = b''


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet: the relay logs joins and leaves instead

    def end_headers(self):
        # Always fresh files: clients build the city from the same code as the host.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0].startswith('/ws') and self.headers.get('Upgrade', '').lower() == 'websocket':
            return self.websocket()
        return super().do_GET()

    def websocket(self):
        room = self.path.split('?')[0][3:].strip('/') or 'main'
        key = self.headers.get('Sec-WebSocket-Key', '')
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        with lock:
            r = rooms.setdefault(room, {'host': None, 'conns': {}})
            full = len(r['conns']) >= MAX_ROOM
        if full:
            self.send_error(503, 'Room full')
            return
        self.send_response(101, 'Switching Protocols')
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept)
        self.end_headers()
        self.close_connection = True
        c = Conn(self, room)
        with lock:
            r['conns'][c.id] = c
        log(f'[{room}] #{c.id} connected from {self.client_address[0]}')
        c.send(f'!id|{c.id}')
        host = r['host']
        if host:
            host.send(f'!join|{c.id}')
        try:
            for op, data in read_frames(self.rfile):
                if op == 0x8:
                    c.frame(b'\x88\x00')
                    break
                if op == 0x9:
                    c.frame(bytes([0x8A, len(data)]) + data if len(data) < 126 else b'\x8a\x00')
                    continue
                if op != 0x1:
                    continue
                self.relay(c, r, data.decode('utf-8', 'replace'))
        except (OSError, ValueError) as e:
            log(f'[{room}] #{c.id} error: {e}')
        finally:
            self.drop(c, r)

    def relay(self, c, r, text):
        if text == '!host':
            with lock:
                ok = r['host'] is None or r['host'] is c
                if ok:
                    r['host'] = c
                others = [o for o in r['conns'].values() if o is not c]
            c.send('!host|ok' if ok else '!host|taken')
            if ok:
                log(f'[{c.room}] #{c.id} is the host')
                for o in others:  # already connected: introduce them
                    c.send(f'!join|{o.id}')
            return
        host = r['host']
        if c is host:
            to, _, payload = text.partition('|')
            with lock:
                targets = [o for i, o in r['conns'].items() if o is not c and (to == '*' or str(i) == to)]
            for o in targets:
                o.send(payload)
        elif host:
            host.send(f'{c.id}|{text}')
        else:
            c.send('!nohost')

    def drop(self, c, r):
        c.open = False
        with lock:
            r['conns'].pop(c.id, None)
            was_host = r['host'] is c
            if was_host:
                r['host'] = None
            others = list(r['conns'].values())
            host = r['host']
            if not r['conns']:
                rooms.pop(c.room, None)
        log(f'[{c.room}] #{c.id} disconnected' + (' (host)' if was_host else ''))
        if was_host:
            for o in others:
                o.send('!hostleft')
        elif host:
            host.send(f'!leave|{c.id}')


def addresses():
    """(label, address) pairs worth sharing: LAN and Tailscale."""
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))  # no packet is sent; just picks the outgoing interface
        out.append(('LAN', s.getsockname()[0]))
        s.close()
    except OSError:
        pass
    try:
        ip = subprocess.run(['tailscale', 'ip', '-4'], capture_output=True, text=True, timeout=3).stdout.split()
        if ip:
            out.append(('Tailscale', ip[0]))
            out.append(('Tailscale', socket.gethostname()))
    except (OSError, subprocess.SubprocessError):
        pass
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8000)))
    ap.add_argument('--bind', default='0.0.0.0', help='interface to listen on (default: all)')
    a = ap.parse_args()
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer((a.bind, a.port), functools.partial(Handler, directory=ROOT))
    log(f'Crystal Fall server on port {a.port}. Open one of these (friends too):')
    log(f'  this machine  http://localhost:{a.port}')
    for label, addr in addresses():
        log(f'  {label:<12}  http://{addr}:{a.port}')
    log('Ctrl+C stops it.')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log('\nStopped.')
        sys.exit(0)


if __name__ == '__main__':
    main()
