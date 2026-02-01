/**
 * ddjex Dev Server
 * Development server with HMR support
 */

import { createServer } from 'http';
import { readFile, watch, stat } from 'fs/promises';
import { resolve, extname } from 'path';
import { WebSocketServer } from 'ws';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

class DevServer {
  constructor(options = {}) {
    this.options = {
      port: 3000,
      hmrPort: 3001,
      root: process.cwd(),
      watch: [],
      ...options
    };

    this.clients = new Set();
    this.program = null;
    this.programPath = null;
    this.watcher = null;
  }

  /**
   * Start the dev server
   */
  async start() {
    // Create HTTP server
    this.httpServer = createServer((req, res) => this.handleRequest(req, res));

    // Create WebSocket server for HMR
    this.wss = new WebSocketServer({ port: this.options.hmrPort });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[HMR] Client connected (${this.clients.size} total)`);

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[HMR] Client disconnected (${this.clients.size} total)`);
      });

      // Send current program on connect
      if (this.program) {
        ws.send(JSON.stringify({
          type: 'init',
          payload: this.program
        }));
      }
    });

    // Start HTTP server
    this.httpServer.listen(this.options.port, () => {
      console.log(`[Dev] Server running at http://localhost:${this.options.port}`);
      console.log(`[HMR] WebSocket server on port ${this.options.hmrPort}`);
    });

    // Watch files
    if (this.options.watch.length > 0) {
      await this.startWatching();
    }

    return this;
  }

  /**
   * Handle HTTP requests
   */
  async handleRequest(req, res) {
    // API endpoints
    if (req.url === '/api/stats') {
      return this.handleStats(req, res);
    }
    if (req.url === '/api/run-tests' || req.url === '/api/run-unit-tests') {
      return this.handleRunTests(req, res, 'unit');
    }
    if (req.url === '/api/run-hmr-tests') {
      return this.handleRunTests(req, res, 'hmr');
    }
    if (req.url === '/api/run-all-tests') {
      return this.handleRunTests(req, res, 'all');
    }

    const url = req.url === '/' ? '/index.html' : req.url;
    const filePath = resolve(this.options.root, '.' + url);

    try {
      // Check if file exists
      await stat(filePath);

      // Read and serve file
      const content = await readFile(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Inject HMR client for HTML files (skip in production or if page has native ddjex websockets)
      if (ext === '.html') {
        const html = content.toString();
        const isProduction = process.env.NODE_ENV === 'production';
        const hasDdjexWebsockets = html.includes('"websockets"') && html.includes('ws://localhost:3001');

        // Don't inject HMR in production - causes reload loop on remote servers
        if (isProduction || hasDdjexWebsockets) {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(html);
          return;
        }
        const injected = this.injectHMRClient(html);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(injected);
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);

    } catch (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        console.error('[Dev] Error:', error);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    }
  }

  /**
   * Inject HMR client script into HTML
   */
  injectHMRClient(html) {
    const hmrScript = `
<script>
(function() {
  const ws = new WebSocket('ws://localhost:${this.options.hmrPort}');

  ws.onopen = () => console.log('[HMR] Connected');

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'update') {
      console.log('[HMR] Update received');
      if (window.__DDJEX_HMR__) {
        window.__DDJEX_HMR__(msg.payload);
      } else {
        location.reload();
      }
    } else if (msg.type === 'full-reload') {
      location.reload();
    }
  };

  ws.onclose = () => {
    console.log('[HMR] Disconnected, reconnecting...');
    setTimeout(() => location.reload(), 1000);
  };
})();
</script>
`;

    // Inject before </body> or at end
    if (html.includes('</body>')) {
      return html.replace('</body>', hmrScript + '</body>');
    }
    return html + hmrScript;
  }

  /**
   * Start watching files for changes
   */
  async startWatching() {
    for (const pattern of this.options.watch) {
      const filePath = resolve(this.options.root, pattern);

      try {
        const watcher = watch(filePath);

        (async () => {
          for await (const event of watcher) {
            if (event.eventType === 'change') {
              console.log(`[HMR] File changed: ${event.filename || pattern}`);
              await this.handleFileChange(filePath);
            }
          }
        })();

        console.log(`[HMR] Watching: ${pattern}`);
      } catch (error) {
        console.error(`[HMR] Failed to watch ${pattern}:`, error.message);
      }
    }
  }

  /**
   * Handle file change
   */
  async handleFileChange(filePath) {
    try {
      const ext = extname(filePath);

      if (ext === '.json') {
        // Parse and send update
        const content = await readFile(filePath, 'utf-8');
        const newProgram = JSON.parse(content);

        if (this.program) {
          // Diff and send partial update
          const update = this.diffPrograms(this.program, newProgram);
          this.broadcast({ type: 'update', payload: update });
        } else {
          // Full update
          this.broadcast({ type: 'update', payload: newProgram });
        }

        this.program = newProgram;
        this.programPath = filePath;

      } else {
        // For non-JSON files, trigger full reload
        this.broadcast({ type: 'full-reload' });
      }

    } catch (error) {
      console.error('[HMR] Update error:', error);
      this.broadcast({
        type: 'error',
        payload: { message: error.message }
      });
    }
  }

  /**
   * Diff two programs and return only changed parts
   */
  diffPrograms(oldProgram, newProgram) {
    const update = {};

    // Check each section
    if (JSON.stringify(oldProgram.state) !== JSON.stringify(newProgram.state)) {
      update.state = newProgram.state;
    }

    if (JSON.stringify(oldProgram.computed) !== JSON.stringify(newProgram.computed)) {
      update.computed = newProgram.computed;
    }

    if (JSON.stringify(oldProgram.actions) !== JSON.stringify(newProgram.actions)) {
      update.actions = newProgram.actions;
    }

    if (JSON.stringify(oldProgram.effects) !== JSON.stringify(newProgram.effects)) {
      update.effects = newProgram.effects;
    }

    if (JSON.stringify(oldProgram.components) !== JSON.stringify(newProgram.components)) {
      update.components = newProgram.components;
    }

    if (JSON.stringify(oldProgram.root) !== JSON.stringify(newProgram.root)) {
      update.root = newProgram.root;
    }

    return update;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  /**
   * Load and watch an ddjex program
   */
  async loadProgram(programPath) {
    const filePath = resolve(this.options.root, programPath);
    const content = await readFile(filePath, 'utf-8');
    this.program = JSON.parse(content);
    this.programPath = filePath;

    // Add to watch list
    if (!this.options.watch.includes(programPath)) {
      this.options.watch.push(programPath);
      await this.startWatching();
    }

    return this.program;
  }

  /**
   * Handle test execution API
   */
  async handleRunTests(req, res, type) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { spawn } = await import('child_process');
    const results = { type, tests: [] };

    const runTest = (name, cmd, args) => {
      return new Promise((resolve) => {
        const proc = spawn(cmd, args, { cwd: this.options.root });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });

        proc.on('close', (code) => {
          // Parse results from output
          const passedMatch = stdout.match(/Passed:\s*(\d+)/);
          const failedMatch = stdout.match(/Failed:\s*(\d+)/);

          resolve({
            name,
            passed: passedMatch ? parseInt(passedMatch[1]) : 0,
            failed: failedMatch ? parseInt(failedMatch[1]) : 0,
            exitCode: code,
            output: stdout,
            error: stderr
          });
        });
      });
    };

    try {
      if (type === 'unit' || type === 'all') {
        results.tests.push(await runTest('Unit Tests', 'node', ['test/run.js']));
      }
      if (type === 'hmr' || type === 'all') {
        results.tests.push(await runTest('HMR Integration', 'node', ['test/hmr-integration.js']));
      }

      results.success = results.tests.every(t => t.exitCode === 0);
      results.totalPassed = results.tests.reduce((sum, t) => sum + t.passed, 0);
      results.totalFailed = results.tests.reduce((sum, t) => sum + t.failed, 0);

      res.writeHead(200);
      res.end(JSON.stringify(results, null, 2));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * Handle stats API - dynamically count tests and patterns
   */
  async handleStats(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      const { readdir } = await import('fs/promises');
      const { spawn } = await import('child_process');

      // Count patterns
      const patternsDir = resolve(this.options.root, 'spec/examples/patterns');
      const patternFiles = await readdir(patternsDir);
      const patterns = patternFiles.filter(f => f.endsWith('.json')).length;

      // Count browser tests (test(' and testAsync(' calls)
      const browserTestFile = resolve(this.options.root, 'test/browser.html');
      const browserContent = await readFile(browserTestFile, 'utf-8');
      const browserTests = (browserContent.match(/(?:test|testAsync)\s*\(\s*'/g) || []).length;

      // Count HMR tests (test(' calls, excluding function definition)
      const hmrTestFile = resolve(this.options.root, 'test/hmr-integration.js');
      const hmrContent = await readFile(hmrTestFile, 'utf-8');
      const hmrTests = (hmrContent.match(/^\s+test\s*\(\s*'/gm) || []).length;

      // Run unit tests to get actual count
      const unitTests = await new Promise((resolve) => {
        const proc = spawn('node', ['test/run.js'], { cwd: this.options.root });
        let stdout = '';
        proc.stdout.on('data', (data) => { stdout += data; });
        proc.on('close', () => {
          const match = stdout.match(/Passed:\s*(\d+)/);
          resolve(match ? parseInt(match[1]) : 0);
        });
      });

      const stats = {
        unitTests,
        browserTests,
        hmrTests,
        patterns
      };

      res.writeHead(200);
      res.end(JSON.stringify(stats));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  /**
   * Stop the dev server
   */
  stop() {
    if (this.httpServer) {
      this.httpServer.close();
    }
    if (this.wss) {
      this.wss.close();
    }
    console.log('[Dev] Server stopped');
  }
}

/**
 * Create and start dev server
 */
async function createDevServer(options = {}) {
  const server = new DevServer(options);
  await server.start();
  return server;
}

export { DevServer, createDevServer };
