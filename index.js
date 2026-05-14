#!/usr/bin/env node

import express from 'express';
import localtunnel from 'localtunnel';
import path from 'path';
import fs from 'fs';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: filet <path_to_file>');
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: File not found at ${resolvedPath}`);
  process.exit(1);
}

const stat = fs.statSync(resolvedPath);
if (!stat.isFile()) {
  console.error(`Error: ${resolvedPath} is not a file.`);
  process.exit(1);
}

const app = express();
const fileName = path.basename(resolvedPath);

// Serve the file directly
app.get('/', (req, res) => {
  console.log(`[+] Download requested from ${req.ip}`);

  // Set headers to force download and suggest filename
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  res.download(resolvedPath, fileName, (err) => {
    if (err) {
      if (res.headersSent) {
        // Headers already sent, can't do much
      } else {
        console.error('[-] Error sending file:', err.message);
        res.status(500).send('Error downloading file');
      }
    } else {
      console.log(`[+] Successfully sent ${fileName}`);
    }
  });
});

const start = async () => {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`Preparing to share: ${resolvedPath}`);
    console.log(`Local server running on port ${port}`);
    console.log('Establishing secure tunnel relay...');

    try {
      const tunnel = await localtunnel({ port });

      console.log('\n======================================================');
      console.log('File is now accessible via Direct Tunnel!');
      console.log('======================================================\n');
      console.log('Share this URL with the receiver. Opening it will download the file directly from your machine:');
      console.log(`\n=>  ${tunnel.url}  <=\n`);

      console.log('Note: Keep this terminal open until the download is complete.');
      console.log('Note: The first time the URL is opened, the receiver may see a localtunnel "bypass" page. They just need to click "Click to Continue".');
      console.log('Press Ctrl+C to stop sharing.\n');

      tunnel.on('close', () => {
        console.log('\nTunnel closed. Stopping server.');
        process.exit(0);
      });

    } catch (err) {
      console.error('\nError creating tunnel:', err.message);
      process.exit(1);
    }
  });
};

start();
