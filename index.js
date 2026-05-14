#!/usr/bin/env node

import express from 'express';
import localtunnel from 'localtunnel';
import path from 'path';
import fs from 'fs';

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
  });
}

const app = express();

if (filesToShare.length === 1) {
  const file = filesToShare[0];
  app.get('/', (req, res) => {
    console.log(`[+] Download requested from ${req.ip}`);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.download(file.resolvedPath, file.fileName, (err) => {
      if (err) {
        if (!res.headersSent) {
          console.error('[-] Error sending file:', err.message);
          res.status(500).send('Error downloading file');
        }
      } else {
        console.log(`[+] Successfully sent ${file.fileName}`);
      }
    });
  });
} else {
  app.get('/', (req, res) => {
    console.log(`[+] Index page requested from ${req.ip}`);
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
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
      <ul>
    `;
    filesToShare.forEach((file, index) => {
        html += `
        <li>
          <span class="filename">${file.fileName}</span>
          <a href="/download/${index}" class="download-btn">Download</a>
        </li>`;
    });
    html += `
      </ul>
    </body>
    </html>`;
    res.send(html);
  });

  filesToShare.forEach((file, index) => {
    app.get(`/download/${index}`, (req, res) => {
      console.log(`[+] Download requested for ${file.fileName} from ${req.ip}`);
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.download(file.resolvedPath, file.fileName, (err) => {
        if (err) {
          if (!res.headersSent) {
            console.error(`[-] Error sending file ${file.fileName}:`, err.message);
            res.status(500).send('Error downloading file');
          }
        } else {
          console.log(`[+] Successfully sent ${file.fileName}`);
        }
      });
    });
  });
}

const start = async () => {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    if (filesToShare.length === 1) {
      console.log(`Preparing to share: ${filesToShare[0].resolvedPath}`);
    } else {
      console.log(`Preparing to share ${filesToShare.length} files:`);
      filesToShare.forEach(f => console.log(` - ${f.resolvedPath}`));
    }
    console.log(`Local server running on port ${port}`);
    console.log('Establishing secure tunnel relay...');

    try {
      const tunnel = await localtunnel({ port });

      console.log('\n======================================================');
      console.log('Files are now accessible via Direct Tunnel!');
      console.log('======================================================\n');
      console.log('Share this URL with the receiver. Opening it will allow them to download the file(s) directly from your machine:');
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
