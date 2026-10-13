// filet signaling server, as a Cloudflare Worker.
//
// This server never sees file contents. It only matches a sender (the CLI)
// with receivers (the web page) and forwards their small WebRTC handshake
// messages so the two sides can open a direct connection to each other.
//
// Each share room is a Durable Object. The Worker routes WebSocket upgrades
// to the right room:
//   wss://host/new            sender creates a room   -> { type: 'created', room }
//   wss://host/room/<room>    receiver joins a room   -> { type: 'joined', peerId }
//                                               sender <- { type: 'peer-joined', peerId }
//
// Messages after that (all JSON):
//   sender   -> { type: 'signal', to: peerId, data }   receiver <- { type: 'signal', from: 'host', data }
//   receiver -> { type: 'signal', data }               sender   <- { type: 'signal', from: peerId, data }
//   either   -> { type: 'ping' }                         <- { type: 'pong' }
//   on sender disconnect:   receivers <- { type: 'host-left' }
//   on receiver disconnect: sender    <- { type: 'peer-left', peerId }

const MAX_PEERS_PER_ROOM = 50;
const ROOM_ID_RE = /^[A-Za-z0-9_-]{4,32}$/;

const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') {
      return text('filet signaling server\n');
    }

    let room = null;
    let role = null;

    if (url.pathname === '/new') {
      role = 'host';
      room = newId(6);
    } else {
      const m = url.pathname.match(/^\/room\/([^/]+)$/);
      if (m && ROOM_ID_RE.test(m[1])) {
        role = 'peer';
        room = m[1];
      }
    }

    if (!role) return text('not found\n', 404);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return text('expected a WebSocket upgrade\n', 426);
    }

    const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
    const target = new URL(`https://room/${role}`);
    target.searchParams.set('room', room);
    return stub.fetch(new Request(target, request));
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    // Answer keep-alive pings without waking the object from hibernation.
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
  }

  host() {
    return this.state.getWebSockets('host')[0] || null;
  }

  peers() {
    return this.state.getWebSockets('peer');
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.pathname === '/host' ? 'host' : 'peer';
    const room = url.searchParams.get('room');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'host') {
      if (this.host()) {
        return text('room already has a sender\n', 409);
      }
      this.state.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ role, peerId: 'host', room });
      send(server, { type: 'created', room });
    } else {
      const host = this.host();
      const peerId = newId(4);
      // Accept first so the page gets a proper protocol error instead of a
      // bare connection failure.
      this.state.acceptWebSocket(server, ['peer', peerId]);
      server.serializeAttachment({ role, peerId, room });
      if (!host) {
        send(server, { type: 'error', error: 'no-such-room' });
        server.close(4404, 'no such room');
      } else if (this.peers().length > MAX_PEERS_PER_ROOM) {
        send(server, { type: 'error', error: 'room-full' });
        server.close(4429, 'room full');
      } else {
        send(server, { type: 'joined', peerId });
        send(host, { type: 'peer-joined', peerId });
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    const me = ws.deserializeAttachment() || {};

    switch (msg.type) {
      case 'signal': {
        if (me.role === 'host') {
          const to = String(msg.to || '');
          const peer = this.peers().find((p) => p.deserializeAttachment()?.peerId === to);
          if (peer) send(peer, { type: 'signal', from: 'host', data: msg.data });
        } else if (me.role === 'peer') {
          send(this.host(), { type: 'signal', from: me.peerId, data: msg.data });
        }
        break;
      }
      case 'ping':
        send(ws, { type: 'pong' });
        break;
      default:
        // 'create' and 'join' from older clients are harmless no-ops here.
        break;
    }
  }

  webSocketClose(ws) {
    this.leave(ws);
  }

  webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'host') {
      for (const peer of this.peers()) {
        send(peer, { type: 'host-left' });
        try { peer.close(4410, 'sender left'); } catch { /* ignore */ }
      }
    } else if (me.role === 'peer') {
      send(this.host(), { type: 'peer-left', peerId: me.peerId });
    }
  }
}

function send(ws, obj) {
  if (!ws) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* socket already gone */ }
}

function newId(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
