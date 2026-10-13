# Filet CLI

**Filet** is a lightweight command-line tool for instant, direct file sharing. It generates a public URL for any local file or files on your machine so that someone else can download them directly from you, without the files ever being uploaded to a third-party server.

Transfers go **peer to peer** whenever the two networks allow it. The file bytes travel straight from your machine to the receiver's browser over WebRTC. A relay is kept as an automatic fallback for networks where a direct connection cannot be made.

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

The CLI prints a share link. Send it to the receiver and keep the terminal open until their download finishes, then press Ctrl+C.

## Testing a share

1. Run `filet` on any file and copy the link it prints.
2. Open the link on another device, ideally on a different network such as a phone on mobile data.
3. The status line on the page turns green once the direct connection is established. The terminal logs the receiver connecting.
4. Click **Download**. Chrome and Edge ask where to save and then stream the file to disk. Other browsers save it when the progress bar completes.
5. If the status turns yellow, that network blocks peer-to-peer traffic. The page shows a relay link instead, which downloads the file through the fallback path.

## How it works

1. You run `filet <paths>`. A local HTTP server starts on a random port.
2. The CLI connects to a small **signaling server** hosted on Cloudflare Workers and creates a room. The share link carries that room code.
3. In the background, a **localtunnel** relay is also opened to the local HTTP server.
4. When the receiver opens the link, their browser joins the same room. The CLI and the browser exchange a WebRTC handshake (a few KB) through the signaling server and then open a **direct data channel** between the two machines. Files are streamed over that channel in 16 KB chunks with backpressure.
5. If the direct connection cannot be established within 15 seconds (for example on a strict corporate NAT), the page shows the relay link instead, and the download goes through localtunnel.

The signaling server never sees file contents. The relay only carries bytes when the direct path fails.

## Project layout

| Path | What it is | Where it runs |
|---|---|---|
| `index.js`, `lib/` | The CLI published to npm as `filet-cli` | your machine |
| `signaling/` | Signaling server: a Cloudflare Worker with one Durable Object per room | Cloudflare Workers |
| `docs/` | Static receiver page | GitHub Pages |

## Technologies

* **Node.js** runtime, written as ES modules.
* **node-datachannel** for WebRTC data channels on the sender side.
* **ws** for the signaling WebSocket client in the CLI.
* **Cloudflare Workers + Durable Objects** host the signaling server. Each room is one Durable Object using the WebSocket hibernation API.
* **Express** serves files over HTTP for the relay path.
* **localtunnel** exposes that HTTP server publicly as the fallback relay.
* Public **STUN** servers (Google) for NAT discovery. No TURN server is used, so the relay path covers the cases STUN cannot.

## Browser notes

* Chrome and Edge stream the download straight to disk and ask where to save it first.
* Firefox and Safari buffer the file in memory and then save it, so very large files are limited by available RAM there.
