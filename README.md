# Filet CLI

**Filet** is a lightweight command-line tool for instant, direct file sharing. It generates a public URL for any local file or files on your machine so that someone else can download them directly from you, without the files ever being uploaded to a third-party server.

Since version 1.1, transfers go **peer to peer** whenever the two networks allow it. The file bytes travel straight from your machine to the receiver's browser over WebRTC. A relay (localtunnel) is kept as an automatic fallback for networks where a direct connection cannot be made.

## Installation

```bash
npm install -g filet-cli
```

The `-g` flag is required so the `filet` command is added to your PATH.

## Usage

```bash
# Share a single file
filet ./file1.txt

# Share multiple files
filet ./file1.txt ./file2.js ./file3.html
```

The CLI prints a link such as `https://filet-share.netlify.app/#Q7gJ9xAB`. Send it to the receiver. Keep the terminal open until their download finishes, then press Ctrl+C.

## How it works

1. You run `filet <paths>`. A local HTTP server starts on a random port.
2. The CLI connects to a small **signaling server** and creates a room. The share link carries that room code.
3. In the background, a **localtunnel** relay is also opened to the local HTTP server.
4. When the receiver opens the link, their browser joins the same room. The CLI and the browser exchange a WebRTC handshake (a few KB) through the signaling server and then open a **direct data channel** between the two machines. Files are streamed over that channel in 16 KB chunks with backpressure.
5. If the direct connection cannot be established within 15 seconds (for example on a strict corporate NAT), the page shows the relay link instead, and the download goes through localtunnel as before.

The signaling server never sees file contents. The relay only carries bytes when the direct path fails.

## Project layout

| Path | What it is | Where it runs |
|---|---|---|
| `index.js`, `lib/` | The CLI published to npm as `filet-cli` | your machine |
| `signaling/` | WebSocket signaling server (Node + `ws`) | Render |
| `web/` | Static receiver page | Netlify |

## Deploying your own

### 1. Signaling server on Render

Create a new **Web Service** from this repo with these settings, or use the included `render.yaml` as a Blueprint:

| Setting | Value |
|---|---|
| Root Directory | `signaling` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance type | Free is fine |

Note the service URL, for example `https://filet-signal.onrender.com`. The WebSocket URL is the same with `wss://`.

On the free tier the service sleeps after 15 minutes idle. The CLI waits up to 60 seconds for it to wake, and the relay tunnel is prepared in parallel so nothing is lost.

### 2. Receiver page on Netlify

Deploy the `web/` folder as a static site. The included `netlify.toml` already sets `web` as the publish directory, so connecting the repo to Netlify is enough. Before deploying, open `web/index.html` and set the signaling URL:

```js
const CONFIG = {
  signalUrl: 'wss://filet-signal.onrender.com',
};
```

### 3. Point the CLI at your deployment

Set the two constants at the top of `index.js`:

```js
const PAGE_URL = 'https://filet-share.netlify.app';
const SIGNAL_URL = 'wss://filet-signal.onrender.com';
```

They can also be overridden at runtime with the `FILET_PAGE_URL` and `FILET_SIGNAL_URL` environment variables, which is useful for local testing:

```bash
# terminal 1
cd signaling && PORT=8787 node server.js

# terminal 2
FILET_SIGNAL_URL=ws://localhost:8787 filet ./file.txt
# then open web/index.html#r=<room>&s=ws://localhost:8787 in a browser
```

## Technologies

* **Node.js** runtime, written as ES modules.
* **node-datachannel** for WebRTC data channels on the sender side.
* **ws** for the signaling WebSocket client and server.
* **Express** serves files over HTTP for the relay path.
* **localtunnel** exposes that HTTP server publicly as the fallback relay.
* Public **STUN** servers (Google) for NAT discovery. No TURN server is used, so the relay path covers the cases STUN cannot.

## Browser notes

* Chrome and Edge stream the download straight to disk and ask where to save it first.
* Firefox and Safari buffer the file in memory and then save it, so very large files are limited by available RAM there.
