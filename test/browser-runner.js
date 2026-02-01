/**
 * DDJEX Browser Test Runner
 *
 * This script starts a local HTTP server and opens the browser tests.
 *
 * Usage:
 *   node test/browser-runner.js
 *
 * Requirements:
 *   - A modern browser (Chrome, Firefox, Safari, Edge)
 *   - Node.js
 *
 * The script will:
 *   1. Start a local HTTP server on port 3333
 *   2. Open the browser test page
 *   3. Output instructions for viewing results
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PORT = 3333;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Simple HTTP server
const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === '/' ? '/test/browser.html' : req.url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/test/browser.html`;
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           DDJEX Browser Test Runner                        ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}               ║
║                                                           ║
║  Opening browser tests...                                 ║
║                                                           ║
║  Press Ctrl+C to stop the server                          ║
╚═══════════════════════════════════════════════════════════╝
`);

  // Try to open browser
  const platform = process.platform;
  let cmd;

  if (platform === 'darwin') {
    cmd = spawn('open', [url]);
  } else if (platform === 'win32') {
    cmd = spawn('start', ['', url], { shell: true });
  } else {
    // Linux
    cmd = spawn('xdg-open', [url]);
  }

  cmd.on('error', () => {
    console.log(`  Please open manually: ${url}`);
  });
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  process.exit(0);
});
