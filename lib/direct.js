import fs from 'fs';
import WebSocket from 'ws';
import nodeDataChannel from 'node-datachannel';

// Direct (peer-to-peer) transfer host.
//
// The CLI opens a WebSocket to the signaling server and creates a "room".
// Each receiver that opens the share page joins that room, and the two sides
// exchange WebRTC offer/answer/ICE messages through the signaling server.
// Once the data channel is open, file bytes flow directly between the two
// machines and never touch the signaling server.

const CHUNK_SIZE = 16 * 1024;        // safe cross-browser data channel message size
const HIGH_WATER = 1024 * 1024;      // pause sending when this much is buffered
const LOW_WATER = 256 * 1024;        // resume once the buffer drains to this
const SIGNAL_TIMEOUT_MS = 15_000;
const ICE_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

nodeDataChannel.initLogger('Error', () => {});

const noop = () => {};

export function startDirectHost({ signalUrl, files, getFallbackUrl, log = console.log }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${signalUrl.replace(/\/+$/, '')}/new`);
    const peers = new Map();
    let settled = false;   // promise resolved or rejected
    let connected = false; // room was created successfully
    let keepAlive = null;

    const send = (obj) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* ignore */ }
      reject(err);
    };

    const timer = setTimeout(
      () => fail(new Error('timed out waiting for the signaling server')),
      SIGNAL_TIMEOUT_MS,
    );

    const manifest = () => ({
      type: 'info',
      files: files.map((f, index) => ({ index, name: f.fileName, size: f.size })),
      fallbackUrl: getFallbackUrl() || null,
    });

    const host = {
      room: null,
      updateFallback() {
        for (const peerId of peers.keys()) {
          send({ type: 'signal', to: peerId, data: manifest() });
        }
      },
      close() {
        clearInterval(keepAlive);
        for (const peer of peers.values()) peer.close();
        peers.clear();
        try { ws.close(); } catch { /* ignore */ }
      },
    };

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'created':
          settled = true;
          connected = true;
          clearTimeout(timer);
          host.room = msg.room;
          keepAlive = setInterval(() => send({ type: 'ping' }), 25_000);
          resolve(host);
          break;

        case 'peer-joined': {
          log(`[+] Receiver ${msg.peerId} opened the link, negotiating direct connection...`);
          const peer = createPeer(msg.peerId, {
            files,
            log,
            send: (data) => send({ type: 'signal', to: msg.peerId, data }),
            onClose: () => peers.delete(msg.peerId),
          });
          peers.set(msg.peerId, peer);
          send({ type: 'signal', to: msg.peerId, data: manifest() });
          break;
        }

        case 'signal':
          peers.get(msg.from)?.handleSignal(msg.data);
          break;

        case 'peer-left':
          peers.get(msg.peerId)?.close();
          peers.delete(msg.peerId);
          break;

        case 'error':
          fail(new Error(msg.error || 'signaling error'));
          break;

        default:
          break;
      }
    });

    ws.on('error', (err) => {
      if (!settled) fail(err);
      else if (connected) log(`[-] Signaling connection error: ${err.message}`);
    });

    ws.on('close', () => {
      if (!settled) {
        fail(new Error('signaling server closed the connection'));
      } else if (connected) {
        clearInterval(keepAlive);
        log('[-] Lost connection to the signaling server. Transfers in progress continue, but new receivers cannot connect directly.');
      }
    });
  });
}

function createPeer(peerId, { files, send, log, onClose }) {
  const pc = new nodeDataChannel.PeerConnection(`peer-${peerId}`, { iceServers: ICE_SERVERS });
  let closed = false;
  let queue = Promise.resolve();

  pc.onLocalDescription((sdp, type) => send({ type, sdp }));
  pc.onLocalCandidate((candidate, mid) => send({ candidate, sdpMid: mid }));

  pc.onStateChange((state) => {
    if (state === 'connected') log(`[+] Direct connection established with receiver ${peerId}`);
    if (state === 'failed') log(`[-] Direct connection with receiver ${peerId} failed. They will be offered the relay link instead.`);
    if (state === 'failed' || state === 'closed') close();
  });

  pc.onDataChannel((dc) => {
    dc.onMessage((msg) => {
      if (typeof msg !== 'string') return;
      let req;
      try { req = JSON.parse(msg); } catch { return; }
      if (req.type !== 'get') return;

      const file = files[req.index];
      if (!file) {
        dc.sendMessage(JSON.stringify({ type: 'error', index: req.index, error: 'no such file' }));
        return;
      }
      queue = queue
        .then(() => sendFile(dc, file, req.index, peerId, log))
        .catch((err) => log(`[-] Transfer of ${file.fileName} to ${peerId} stopped: ${err.message}`));
    });
    dc.onError((err) => log(`[-] Data channel error with receiver ${peerId}: ${err}`));
  });

  function close() {
    if (closed) return;
    closed = true;
    try { pc.close(); } catch { /* ignore */ }
    onClose();
  }

  return {
    handleSignal(data) {
      if (closed || !data) return;
      try {
        if (data.sdp) {
          pc.setRemoteDescription(data.sdp, data.type);
        } else if (data.candidate) {
          pc.addRemoteCandidate(data.candidate, data.sdpMid || '0');
        }
      } catch (err) {
        log(`[-] Bad signaling message from receiver ${peerId}: ${err.message}`);
      }
    },
    close,
  };
}

async function sendFile(dc, file, index, peerId, log) {
  if (!dc.isOpen()) throw new Error('channel closed');

  log(`[+] Sending ${file.fileName} directly to receiver ${peerId}`);
  dc.sendMessage(JSON.stringify({ type: 'start', index, name: file.fileName, size: file.size }));

  const stream = fs.createReadStream(file.resolvedPath, { highWaterMark: CHUNK_SIZE });
  try {
    for await (const chunk of stream) {
      if (!dc.isOpen()) throw new Error('channel closed');
      if (dc.bufferedAmount() > HIGH_WATER) await drained(dc);
      dc.sendMessageBinary(chunk);
    }
  } finally {
    stream.destroy();
  }

  if (!dc.isOpen()) throw new Error('channel closed');
  dc.sendMessage(JSON.stringify({ type: 'done', index }));
  log(`[+] Successfully sent ${file.fileName} to receiver ${peerId}`);
}

// Wait until the data channel's send buffer drains. Uses the native
// bufferedAmountLow event, with a polling safety net in case the buffer
// drained before the callback was registered.
function drained(dc) {
  return new Promise((resolve, reject) => {
    let done = false;
    let poll = null;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      dc.onBufferedAmountLow(noop);
      if (err) reject(err);
      else resolve();
    };
    dc.setBufferedAmountLowThreshold(LOW_WATER);
    dc.onBufferedAmountLow(() => finish());
    poll = setInterval(() => {
      if (!dc.isOpen()) finish(new Error('channel closed'));
      else if (dc.bufferedAmount() <= LOW_WATER) finish();
    }, 50);
  });
}

export function shutdownDirect() {
  try { nodeDataChannel.cleanup(); } catch { /* ignore */ }
}
