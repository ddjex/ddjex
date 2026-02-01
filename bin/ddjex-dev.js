#!/usr/bin/env node

/**
 * ddjex Dev Server CLI
 * Usage: ddjex-dev [options] [program.json]
 */

import { createDevServer } from '../src/dev/server.js';
import { resolve } from 'path';

const args = process.argv.slice(2);
const options = {
  port: 3000,
  hmrPort: 3001,
  root: process.cwd(),
  watch: []
};

let programPath = null;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '-p' || arg === '--port') {
    options.port = parseInt(args[++i], 10);
  } else if (arg === '--hmr-port') {
    options.hmrPort = parseInt(args[++i], 10);
  } else if (arg === '-r' || arg === '--root') {
    options.root = resolve(args[++i]);
  } else if (arg === '-w' || arg === '--watch') {
    options.watch.push(args[++i]);
  } else if (arg === '-h' || arg === '--help') {
    console.log(`
ddjex Dev Server

Usage: ddjex-dev [options] [program.json]

Options:
  -p, --port <port>       HTTP server port (default: 3000)
  --hmr-port <port>       HMR WebSocket port (default: 3001)
  -r, --root <path>       Root directory (default: cwd)
  -w, --watch <file>      Additional files to watch
  -h, --help              Show this help

Examples:
  ddjex-dev app.json
  ddjex-dev -p 8080 --watch styles.css app.json
  ddjex-dev -r ./public app.json
`);
    process.exit(0);
  } else if (!arg.startsWith('-')) {
    programPath = arg;
    options.watch.push(arg);
  }
}

// Start server
console.log('');
console.log('  ddjex Dev Server');
console.log('  ===============');
console.log('');

const server = await createDevServer(options);

if (programPath) {
  try {
    await server.loadProgram(programPath);
    console.log(`[Dev] Loaded: ${programPath}`);
  } catch (error) {
    console.error(`[Dev] Failed to load ${programPath}:`, error.message);
  }
}

console.log('');
console.log('  Press Ctrl+C to stop');
console.log('');

// Handle shutdown
process.on('SIGINT', () => {
  console.log('');
  server.stop();
  process.exit(0);
});
