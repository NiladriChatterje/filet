import http from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

// filet signaling server.
//
// This server never sees file contents. It only matches a sender (the CLI)
// with receivers (the web page) and forwards their small WebRTC handshake
// messages so the two sides can open a direct connection to each other.
//
// Protocol (all messages are JSON):
//   sender   -> { type: 'create' }                       <- { type: 'created', room }
//   receiver -> { type: 'join', room }                   <- { type: 'joined', peerId }
//                                               sender  <- { type: 'peer-joined', peerId }
//   sender   -> { type: 'signal', to: peerId, data }   receiver <- { type: 'signal', from: 'host', data }
//   receiver -> { type: 'signal', data }               sender   <- { type: 'signal', from: peerId, data }
//   either   -> { type: 'ping' }                         <- { type: 'pong' }
//   on sender disconnect:   receivers <- { type: 'host-left' }
//   on receiver disconnect: sender    <- { type: 'peer-left', peerId }

const PORT = Number(process.env.PORT) || 8080;
const MAX_PEERS_PER_ROOM = 50;

const rooms = new Map(); // room -> { host: WebSocket, peers: Map<peerId, WebSocket> }

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`filet signaling server\nactive rooms: ${rooms.size}\n`);
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function newId(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function newRoomId() {
  let id;
  do { id = newId(6); } while (rooms.has(id));
  return id;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.room = null;
  ws.peerId = null;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'create': {
        if (ws.role) return;
        const room = newRoomId();
        rooms.set(room, { host: ws, peers: new Map() });
        ws.role = 'host';
        ws.room = room;
        send(ws, { type: 'created', room });
        break;
      }

      case 'join': {
        if (ws.role) return;
        const entry = rooms.get(String(msg.room || ''));
        if (!entry) {
          send(ws, { type: 'error', error: 'no-such-room' });
          return;
        }
        if (entry.peers.size >= MAX_PEERS_PER_ROOM) {
          send(ws, { type: 'error', error: 'room-full' });
          return;
        }
        const peerId = newId(4);
        entry.peers.set(peerId, ws);
        ws.role = 'peer';
        ws.room = msg.room;
        ws.peerId = peerId;
        send(ws, { type: 'joined', peerId });
        send(entry.host, { type: 'peer-joined', peerId });
        break;
      }

      case 'signal': {
        const entry = rooms.get(ws.room);
        if (!entry) return;
        if (ws.role === 'host') {
          const peer = entry.peers.get(String(msg.to || ''));
          if (peer) send(peer, { type: 'signal', from: 'host', data: msg.data });
        } else if (ws.role === 'peer') {
          send(entry.host, { type: 'signal', from: ws.peerId, data: msg.data });
        }
        break;
      }

      case 'ping':
        send(ws, { type: 'pong' });
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    const entry = rooms.get(ws.room);
    if (!entry) return;
    if (ws.role === 'host') {
      for (const peer of entry.peers.values()) send(peer, { type: 'host-left' });
      rooms.delete(ws.room);
    } else if (ws.role === 'peer') {
      entry.peers.delete(ws.peerId);
      send(entry.host, { type: 'peer-left', peerId: ws.peerId });
    }
  });
});

// Drop connections that stopped answering pings (e.g. laptop went to sleep).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`filet signaling server listening on port ${PORT}`);
});
