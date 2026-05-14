#!/usr/bin/env node

import WebTorrent from 'webtorrent';
import fs from 'fs';
import path from 'path';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: filet <full_path_of_file>');
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: File not found at ${resolvedPath}`);
  process.exit(1);
}

const stat = fs.statSync(resolvedPath);
if (!stat.isFile()) {
  console.error(`Error: ${resolvedPath} is not a file. Directories are not supported yet.`);
  process.exit(1);
}

const client = new WebTorrent();

console.log(`Preparing to share: ${path.basename(resolvedPath)}`);
console.log('Initializing WebTorrent...');

client.seed(resolvedPath, (torrent) => {
  console.log('\n======================================================');
  console.log('File is now being shared via Direct Peer Connection!');
  console.log('======================================================\n');
  
  // Instant.io URL for easy browser downloading
  const shareUrl = `https://instant.io/#${torrent.infoHash}`;
  
  console.log('Share this URL with the receiver. They can open it in any web browser to download directly from your system:');
  console.log(`\n=>  ${shareUrl}  <=\n`);
  
  console.log('Note: Keep this terminal window open until the transfer is complete.');
  console.log('Press Ctrl+C to stop sharing.\n');

  torrent.on('wire', (wire, addr) => {
    console.log(`[+] Connected to peer: ${addr || 'Unknown Browser Peer'}`);
  });

  let lastLoggedProgress = 0;
  const interval = setInterval(() => {
    if (torrent.uploaded > 0) {
      const progress = (torrent.uploaded / torrent.length) * 100;
      if (progress - lastLoggedProgress >= 5 || progress === 100) {
        console.log(`Upload Progress: ${progress.toFixed(1)}% (${(torrent.uploaded / 1024 / 1024).toFixed(2)} MB / ${(torrent.length / 1024 / 1024).toFixed(2)} MB)`);
        lastLoggedProgress = progress;
      }
    }
  }, 2000);

  torrent.on('done', () => {
     console.log('Transfer may be complete (or finished sending out chunks). Keeping the connection open for seeding.');
  });
});

client.on('error', (err) => {
  console.error('WebTorrent Error:', err.message);
  process.exit(1);
});
