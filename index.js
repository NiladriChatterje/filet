#!/usr/bin/env node

import express from 'express';
import localtunnel from 'localtunnel';
import path from 'path';
import fs from 'fs';
import { startDirectHost, shutdownDirect } from './lib/direct.js';

// Where the receiver page is hosted (GitHub Pages) and where the signaling server
// runs (Cloudflare Workers). Both can be overridden with environment variables, which is
// handy for local testing.
const PAGE_URL = (process.env.FILET_PAGE_URL || 'https://niladrichatterje.github.io/filet').replace(/\/+$/, '');
const SIGNAL_URL = process.env.FILET_SIGNAL_URL || 'wss://filet-signal.radongtxgpu.workers.dev';

const filePaths = process.argv.slice(2);

if (filePaths.length === 0) {
  console.error('Usage: filet <path_to_file> [path_to_file2 ...]');
  process.exit(1);
}

const filesToShare = [];

for (const fp of filePaths) {
  const resolvedPath = path.resolve(fp);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found at ${resolvedPath}`);
    process.exit(1);
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    console.error(`Error: ${resolvedPath} is not a file.`);
    process.exit(1);
  }
  filesToShare.push({
    resolvedPath,
    fileName: path.basename(resolvedPath),
    size: stat.size,
  });
}

// ---------------------------------------------------------------------------
// Relay path: a plain HTTP server exposed through localtunnel. This is the
// fallback used when a direct WebRTC connection cannot be established.
// ---------------------------------------------------------------------------

const app = express();

function sendFile(file, req, res) {
  console.log(`[+] Relay download requested for ${file.fileName} from ${req.ip}`);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.download(file.resolvedPath, file.fileName, (err) => {
    if (err) {
      if (!res.headersSent) {
        console.error(`[-] Error sending file ${file.fileName}:`, err.message);
        res.status(500).send('Error downloading file');
      }
    } else {
      console.log(`[+] Successfully sent ${file.fileName} via relay`);
    }
  });
}

if (filesToShare.length === 1) {
  app.get('/', (req, res) => sendFile(filesToShare[0], req, res));
} else {
  app.get('/', (req, res) => {
    console.log(`[+] Relay index page requested from ${req.ip}`);
    const items = filesToShare.map((file, index) => `
        <li>
          <span class="filename">${escapeHtml(file.fileName)}</span>
          <a href="/download/${index}" class="download-btn">Download</a>
        </li>`).join('');
    res.send(`<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>filet - Shared Files</title>
      <style>
        body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
        h1 { border-bottom: 1px solid #ccc; padding-bottom: 10px; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; padding: 15px; background: #f9f9f9; border: 1px solid #eee; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }
        .filename { font-weight: bold; color: #333; }
        a { text-decoration: none; }
        .download-btn { background: #0066cc; color: white; padding: 8px 15px; border-radius: 4px; font-size: 14px; }
        .download-btn:hover { background: #0052a3; }
      </style>
    </head>
    <body>
      <h1>Shared Files (${filesToShare.length})</h1>
      <ul>${items}
      </ul>
    </body>
    </html>`);
  });

  filesToShare.forEach((file, index) => {
    app.get(`/download/${index}`, (req, res) => sendFile(file, req, res));
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Startup: bring up the local server, then race the direct (WebRTC) path and
// the relay (localtunnel) path. Direct is preferred; relay is the fallback.
// ---------------------------------------------------------------------------

let direct = null;
let server = null;

function shareLink(room) {
  // PAGE_URL is normally a site root; allow a direct path to index.html too.
  return PAGE_URL.endsWith('.html') ? `${PAGE_URL}#${room}` : `${PAGE_URL}/#${room}`;
}

function banner(text) {
  console.log('\n======================================================');
  console.log(text);
  console.log('======================================================\n');
}

function shutdown(code) {
  if (direct) direct.close();
  shutdownDirect();
  if (server) server.close();
  process.exit(code);
}

process.on('SIGINT', () => {
  console.log('\nStopping sharing.');
  shutdown(0);
});

const start = () => {
  server = app.listen(0, async () => {
    const port = server.address().port;
    if (filesToShare.length === 1) {
      console.log(`Preparing to share: ${filesToShare[0].resolvedPath}`);
    } else {
      console.log(`Preparing to share ${filesToShare.length} files:`);
      filesToShare.forEach((f) => console.log(` - ${f.resolvedPath}`));
    }
    console.log(`Local server running on port ${port}`);

    // Relay tunnel, started in the background so it is ready as a fallback.
    let fallbackUrl = null;
    const tunnelReady = localtunnel({ port })
      .then((tunnel) => {
        fallbackUrl = tunnel.url;
        tunnel.on('close', () => {
          if (direct) {
            console.log('\n[-] Relay tunnel closed. Direct transfers still work.');
          } else {
            console.log('\nTunnel closed. Stopping server.');
            shutdown(0);
          }
        });
        if (direct) direct.updateFallback();
        return tunnel.url;
      })
      .catch((err) => {
        console.error(`[-] Relay tunnel unavailable: ${err.message}`);
        return null;
      });

    console.log('Connecting to signaling server for direct transfer...');

    try {
      direct = await startDirectHost({
        signalUrl: SIGNAL_URL,
        files: filesToShare,
        getFallbackUrl: () => fallbackUrl,
      });

      banner('Files are now accessible via Direct Transfer!');
      console.log('Share this URL with the receiver. Opening it will download the file(s) straight from your machine, peer to peer:');
      console.log(`\n=>  ${PAGE_URL}/#${direct.room}  <=\n`);
      console.log('If a direct connection is not possible on their network, the page offers the relay link below instead.');

      tunnelReady.then((url) => {
        if (url) console.log(`[+] Relay fallback ready: ${url}`);
      });
    } catch (err) {
      console.error(`[-] Direct transfer unavailable (${err.message}). Falling back to relay.`);
      console.log('Establishing relay tunnel...');
      const url = await tunnelReady;
      if (!url) {
        console.error('\nNo way to share the file: both direct and relay paths failed.');
        shutdown(1);
        return;
      }
      banner('Files are now accessible via Relay Tunnel!');
      console.log('Share this URL with the receiver. Opening it will allow them to download the file(s) through the relay:');
      console.log(`\n=>  ${url}  <=\n`);
      console.log('Note: The first time the URL is opened, the receiver may see a localtunnel "bypass" page. They just need to click "Click to Continue".');
    }

    console.log('Note: Keep this terminal open until the download is complete.');
    console.log('Press Ctrl+C to stop sharing.\n');
  });
};

start();
