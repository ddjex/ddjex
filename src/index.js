/**
 * ddjex - AI-Native JavaScript Runtime
 *
 * A JavaScript framework optimized for LLM code generation.
 * All programs are JSON. No custom syntax. Maximum predictability.
 *
 * Usage:
 *   import { createApp, DOMTarget, ServerTarget, CLITarget } from 'ddjex';
 *
 *   const program = { "$ddjex": "0.1.0", ... };
 *   const app = createApp(program, new DOMTarget('#app'));
 *   app.mount();
 */

import { Runtime, Target } from './core/runtime.js';
import { StateManager } from './core/state.js';
import { Operations, AsyncOperations, resolveExpression, isAsyncOperation } from './core/operations.js';
import { validate, Validator, ValidationError } from './core/validator.js';
import { DOMTarget } from './targets/dom.js';
import { ServerTarget } from './targets/server.js';
import { CLITarget } from './targets/cli.js';
import { SSRTarget, renderToString, renderToDocument } from './targets/ssr.js';
import { HMRClient, createHMRRuntime } from './dev/hmr.js';
import { WebSocketManager, getWebSocketManager } from './core/websocket.js';
import { Validators, validateValue, validateForm, createFormState } from './core/form-validation.js';

/**
 * Create an ddjex application
 * @param {Object} program - The ddjex program (JSON)
 * @param {Target} target - The target runtime (DOM, Server, CLI)
 * @returns {Runtime} The initialized runtime
 */
function createApp(program, target) {
  const runtime = new Runtime(program, target);
  runtime.initialize();
  return runtime;
}

/**
 * Parse and validate an ddjex program from JSON string
 * @param {string} json - The JSON string
 * @returns {Object} Parsed program or error
 */
function parse(json) {
  try {
    const program = JSON.parse(json);
    const validation = Runtime.validate(program);
    if (!validation.valid) {
      return { error: true, code: 'VALIDATION_FAILED', errors: validation.errors };
    }
    return program;
  } catch (e) {
    return { error: true, code: 'PARSE_ERROR', message: e.message };
  }
}

/**
 * Load an ddjex program from a file (Node.js only)
 * @param {string} path - Path to the JSON file
 * @returns {Promise<Object>} Parsed program
 */
async function load(path) {
  const fs = await import('fs/promises');
  const json = await fs.readFile(path, 'utf-8');
  return parse(json);
}

/**
 * Run an ddjex program
 * @param {Object|string} program - The program or path to program
 * @param {Object} options - Runtime options
 * @returns {Promise<Runtime>} The running runtime
 */
async function run(program, options = {}) {
  // Load from file if string
  if (typeof program === 'string') {
    program = await load(program);
    if (program.error) {
      throw program;
    }
  }

  // Determine target
  let target;
  switch (program.target) {
    case 'dom':
      target = new DOMTarget(options.container || '#app');
      break;
    case 'server':
      target = new ServerTarget(options);
      break;
    case 'cli':
      target = new CLITarget(options.args);
      break;
    default:
      throw { error: true, code: 'INVALID_TARGET', message: `Unknown target: ${program.target}` };
  }

  const runtime = createApp(program, target);
  await runtime.mount();
  return runtime;
}

// Export everything
export {
  // Main API
  createApp,
  parse,
  load,
  run,

  // Core classes
  Runtime,
  Target,
  StateManager,

  // Validation
  validate,
  Validator,
  ValidationError,

  // Targets
  DOMTarget,
  ServerTarget,
  CLITarget,
  SSRTarget,

  // SSR
  renderToString,
  renderToDocument,

  // Dev/HMR
  HMRClient,
  createHMRRuntime,

  // WebSocket
  WebSocketManager,
  getWebSocketManager,

  // Form Validation
  Validators,
  validateValue,
  validateForm,
  createFormState,

  // Utilities
  Operations,
  AsyncOperations,
  resolveExpression,
  isAsyncOperation
};

// Default export for convenience
export default {
  createApp,
  parse,
  load,
  run,
  validate,
  Runtime,
  DOMTarget,
  ServerTarget,
  CLITarget,
  SSRTarget,
  renderToString,
  renderToDocument,
  Operations,
  AsyncOperations
};
