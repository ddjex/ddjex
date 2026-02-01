/**
 * DDJEX HMR Integration Tests
 * Tests HMR server with real WebSocket connections
 *
 * Run: node test/hmr-integration.js
 */

import { DevServer } from '../src/dev/server.js';
import { WebSocket } from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../.tmp-hmr-test');

// Test utilities
let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  return { name, fn };
}

async function runTest(t) {
  try {
    await t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${t.name}`);
    console.log(`    Error: ${e.message}`);
    failed++;
    errors.push({ test: t.name, error: e.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForMessage(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForOpen(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('Timeout waiting for connection')), timeout);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// Setup and teardown
async function setup() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

async function teardown() {
  try {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  } catch (e) {
    // Ignore
  }
}

// Tests
const tests = [
  test('DevServer starts and stops', async () => {
    const server = new DevServer({ port: 3100, hmrPort: 3101, root: TEMP_DIR });
    await server.start();

    assert(server.httpServer.listening, 'HTTP server should be listening');

    server.stop();
    await waitFor(100);
  }),

  test('WebSocket client can connect', async () => {
    const server = new DevServer({ port: 3102, hmrPort: 3103, root: TEMP_DIR });
    await server.start();

    const ws = new WebSocket('ws://localhost:3103');
    await waitForOpen(ws);

    assert(ws.readyState === WebSocket.OPEN, 'WebSocket should be open');
    assert(server.clients.size === 1, 'Server should track client');

    ws.close();
    server.stop();
    await waitFor(100);
  }),

  test('Multiple clients can connect', async () => {
    const server = new DevServer({ port: 3104, hmrPort: 3105, root: TEMP_DIR });
    await server.start();

    const ws1 = new WebSocket('ws://localhost:3105');
    const ws2 = new WebSocket('ws://localhost:3105');

    await waitForOpen(ws1);
    await waitForOpen(ws2);

    assert(server.clients.size === 2, 'Server should track both clients');

    ws1.close();
    ws2.close();
    server.stop();
    await waitFor(100);
  }),

  test('Server broadcasts to all clients', async () => {
    const server = new DevServer({ port: 3106, hmrPort: 3107, root: TEMP_DIR });
    await server.start();

    const ws1 = new WebSocket('ws://localhost:3107');
    const ws2 = new WebSocket('ws://localhost:3107');

    await waitForOpen(ws1);
    await waitForOpen(ws2);

    const received1 = waitForMessage(ws1);
    const received2 = waitForMessage(ws2);

    server.broadcast({ type: 'test', payload: { value: 42 } });

    const msg1 = await received1;
    const msg2 = await received2;

    assert(msg1.type === 'test', 'Client 1 should receive message');
    assert(msg1.payload.value === 42, 'Client 1 payload correct');
    assert(msg2.type === 'test', 'Client 2 should receive message');
    assert(msg2.payload.value === 42, 'Client 2 payload correct');

    ws1.close();
    ws2.close();
    server.stop();
    await waitFor(100);
  }),

  test('File change triggers update', async () => {
    // Create test JSON file
    const testFile = path.join(TEMP_DIR, 'test-app.json');
    const initialProgram = {
      "$ddjex": "0.3.1",
      "id": "test",
      "state": { "count": { "type": "number", "initial": 0 } }
    };
    await fs.writeFile(testFile, JSON.stringify(initialProgram, null, 2));

    const server = new DevServer({
      port: 3108,
      hmrPort: 3109,
      root: TEMP_DIR,
      watch: ['test-app.json']
    });
    await server.start();
    await server.loadProgram('test-app.json');

    const ws = new WebSocket('ws://localhost:3109');
    await waitForOpen(ws);

    // Wait a bit for watcher to be ready
    await waitFor(200);

    // Modify the file
    const updatedProgram = {
      "$ddjex": "0.3.1",
      "id": "test",
      "state": { "count": { "type": "number", "initial": 10 } }
    };

    const updatePromise = waitForMessage(ws, 3000);
    await fs.writeFile(testFile, JSON.stringify(updatedProgram, null, 2));

    const msg = await updatePromise;

    assert(msg.type === 'update', 'Should receive update message');
    assert(msg.payload.state !== undefined, 'Payload should contain state');
    assert(msg.payload.state.count.initial === 10, 'State should have new value');

    ws.close();
    server.stop();
    await waitFor(100);
  }),

  test('diffPrograms returns only changed sections', async () => {
    const server = new DevServer({ port: 3110, hmrPort: 3111, root: TEMP_DIR });

    const oldProgram = {
      state: { count: { type: 'number', initial: 0 } },
      computed: { double: { deps: ['count'], fn: { op: 'multiply', args: [{ ref: 'count' }, 2] } } },
      actions: { inc: { mutations: [{ target: 'count', op: 'add', value: 1 }] } },
      root: { type: 'div', children: [] }
    };

    const newProgram = {
      state: { count: { type: 'number', initial: 5 } }, // Changed
      computed: { double: { deps: ['count'], fn: { op: 'multiply', args: [{ ref: 'count' }, 2] } } }, // Same
      actions: { inc: { mutations: [{ target: 'count', op: 'add', value: 1 }] } }, // Same
      root: { type: 'span', children: [] } // Changed
    };

    const diff = server.diffPrograms(oldProgram, newProgram);

    assert(diff.state !== undefined, 'state should be in diff');
    assert(diff.computed === undefined, 'computed should NOT be in diff');
    assert(diff.actions === undefined, 'actions should NOT be in diff');
    assert(diff.root !== undefined, 'root should be in diff');
  }),

  test('Client disconnect is handled', async () => {
    const server = new DevServer({ port: 3112, hmrPort: 3113, root: TEMP_DIR });
    await server.start();

    const ws = new WebSocket('ws://localhost:3113');
    await waitForOpen(ws);

    assert(server.clients.size === 1, 'Client connected');

    ws.close();
    await waitFor(100);

    assert(server.clients.size === 0, 'Client removed after disconnect');

    server.stop();
    await waitFor(100);
  }),

  test('Init message sent on connect with loaded program', async () => {
    const testFile = path.join(TEMP_DIR, 'init-test.json');
    const program = {
      "$ddjex": "0.3.1",
      "id": "init-test",
      "state": { "value": { "type": "string", "initial": "hello" } }
    };
    await fs.writeFile(testFile, JSON.stringify(program, null, 2));

    const server = new DevServer({ port: 3114, hmrPort: 3115, root: TEMP_DIR });
    await server.start();
    await server.loadProgram('init-test.json');

    const ws = new WebSocket('ws://localhost:3115');
    const initMsg = waitForMessage(ws, 2000);
    await waitForOpen(ws);

    const msg = await initMsg;

    assert(msg.type === 'init', 'Should receive init message');
    assert(msg.payload.id === 'init-test', 'Payload should be the program');

    ws.close();
    server.stop();
    await waitFor(100);
  }),

  test('Non-JSON file change triggers full reload', async () => {
    const testFile = path.join(TEMP_DIR, 'style.css');
    await fs.writeFile(testFile, 'body { color: red; }');

    const server = new DevServer({
      port: 3116,
      hmrPort: 3117,
      root: TEMP_DIR,
      watch: ['style.css']
    });
    await server.start();

    const ws = new WebSocket('ws://localhost:3117');
    await waitForOpen(ws);

    await waitFor(200);

    const updatePromise = waitForMessage(ws, 3000);
    await fs.writeFile(testFile, 'body { color: blue; }');

    const msg = await updatePromise;

    assert(msg.type === 'full-reload', 'Should receive full-reload for non-JSON');

    ws.close();
    server.stop();
    await waitFor(100);
  }),

  test('HTTP server serves files', async () => {
    const testFile = path.join(TEMP_DIR, 'test.json');
    await fs.writeFile(testFile, '{"test": true}');

    const server = new DevServer({ port: 3118, hmrPort: 3119, root: TEMP_DIR });
    await server.start();

    const response = await fetch('http://localhost:3118/test.json');
    const data = await response.json();

    assert(response.status === 200, 'Status should be 200');
    assert(data.test === true, 'Content should match');

    server.stop();
    await waitFor(100);
  }),

  test('HTTP server returns 404 for missing files', async () => {
    const server = new DevServer({ port: 3120, hmrPort: 3121, root: TEMP_DIR });
    await server.start();

    const response = await fetch('http://localhost:3120/nonexistent.json');

    assert(response.status === 404, 'Status should be 404');

    server.stop();
    await waitFor(100);
  }),

  test('HTML files get HMR script injected in dev mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const testFile = path.join(TEMP_DIR, 'index.html');
    await fs.writeFile(testFile, '<html><body><h1>Test</h1></body></html>');

    const server = new DevServer({ port: 3122, hmrPort: 3123, root: TEMP_DIR });
    await server.start();

    const response = await fetch('http://localhost:3122/index.html');
    const html = await response.text();

    assert(html.includes('WebSocket'), 'Should contain WebSocket script');
    assert(html.includes('3123'), 'Should contain HMR port');
    assert(html.includes('__DDJEX_HMR__'), 'Should contain HMR global');

    server.stop();
    process.env.NODE_ENV = originalEnv;
    await waitFor(100);
  }),

  test('HTML files do NOT get HMR script in production mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const testFile = path.join(TEMP_DIR, 'index.html');
    await fs.writeFile(testFile, '<html><body><h1>Test</h1></body></html>');

    const server = new DevServer({ port: 3124, hmrPort: 3125, root: TEMP_DIR });
    await server.start();

    const response = await fetch('http://localhost:3124/index.html');
    const html = await response.text();

    assert(!html.includes('WebSocket'), 'Should NOT contain WebSocket script in production');
    assert(!html.includes('__DDJEX_HMR__'), 'Should NOT contain HMR global in production');

    server.stop();
    process.env.NODE_ENV = originalEnv;
    await waitFor(100);
  })
];

// Run all tests
async function main() {
  console.log('DDJEX HMR Integration Tests\n===========================\n');

  await setup();

  for (const t of tests) {
    await runTest(t);
  }

  await teardown();

  console.log('\n===========================');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailures:');
    for (const e of errors) {
      console.log(`  - ${e.test}: ${e.error}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
