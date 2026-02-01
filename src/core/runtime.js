/**
 * ddjex Runtime
 * Core execution engine
 */

import { StateManager, ContextManager } from './state.js';
import { Operations, resolveExpression, setStorageNamespace } from './operations.js';
import { getWebSocketManager } from './websocket.js';
import { createRouter, getRouter } from './router.js';
import { DDJEXError, ActionError } from './errors.js';
import { logger } from './logger.js';

class Runtime {
  constructor(program, target) {
    this.program = program;
    this.target = target;
    this.stateManager = new StateManager();
    this.contextManager = new ContextManager();
    this.router = null;
    this.actions = new Map();
    this.components = new Map();
    this.mountEffects = [];
    this.mounted = false;
  }

  static validate(program) {
    const errors = [];

    if (!program.$ddjex) {
      errors.push({ code: 'MISSING_VERSION', message: 'Missing $ddjex version' });
    }

    if (!program.id) {
      errors.push({ code: 'MISSING_ID', message: 'Missing program id' });
    }

    if (!program.target) {
      errors.push({ code: 'MISSING_TARGET', message: 'Missing target' });
    }

    if (!['dom', 'server', 'cli'].includes(program.target)) {
      errors.push({ code: 'INVALID_TARGET', message: `Invalid target: ${program.target}` });
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  initialize() {
    const validation = Runtime.validate(this.program);
    if (!validation.valid) {
      throw new DDJEXError('VALIDATION_FAILED', 'Program validation failed', { errors: validation.errors });
    }

    // Set storage namespace for isolation between apps
    setStorageNamespace(this.program.id);

    // Initialize contexts
    if (this.program.contexts) {
      for (const [id, def] of Object.entries(this.program.contexts)) {
        this.contextManager.defineContext(id, def);
      }
    }

    // Initialize state
    if (this.program.state) {
      for (const [id, def] of Object.entries(this.program.state)) {
        this.stateManager.defineState(id, def);
      }
    }

    // Initialize computed
    if (this.program.computed) {
      for (const [id, def] of Object.entries(this.program.computed)) {
        this.stateManager.defineComputed(id, def, (expr) => this.resolve(expr));
      }
    }

    // Initialize actions
    if (this.program.actions) {
      for (const [id, def] of Object.entries(this.program.actions)) {
        this.actions.set(id, def);
      }
    }

    // Initialize components
    if (this.program.components) {
      for (const [id, def] of Object.entries(this.program.components)) {
        this.components.set(id, def);
      }
    }

    // Initialize effects (after state/computed so they can subscribe)
    if (this.program.effects) {
      for (const effect of this.program.effects) {
        const trigger = effect.trigger || 'watch';
        const resolver = (expr, params = {}) => this.resolve(expr, params);
        const dispatcher = (actionId, ...args) => this.dispatch(actionId, ...args);

        const node = this.stateManager.defineEffect(effect.id, effect, resolver, dispatcher);

        // Collect mount/interval/timeout effects to run after mount
        if (trigger === 'mount' || trigger === 'interval' || trigger === 'timeout') {
          this.mountEffects.push(node);
        }
      }
    }

    // Initialize WebSockets
    if (this.program.websockets) {
      this.initializeWebSockets();
    }

    // Initialize Router
    if (this.program.router) {
      this.initializeRouter();
    }

    // Set up constraint resolver and invariants
    this.stateManager.setOpResolver((expr, extraParams = {}) => this.resolve(expr, extraParams));

    if (this.program.invariants) {
      this.stateManager.registerInvariants(this.program.invariants);
    }

    return this;
  }

  initializeRouter() {
    const config = this.program.router;
    this.router = createRouter({
      mode: config.mode || 'history',
      base: config.base || '/',
      notFound: config.notFound
    });

    this.router.addRoutes(config.routes);

    // Create route state for reactive bindings
    this.stateManager.defineState('$route', {
      type: 'object',
      initial: {
        path: '/',
        params: {},
        query: {},
        hash: '',
        meta: {},
        matched: []
      }
    });

    // Subscribe to route changes
    this.router.subscribe((route) => {
      if (route) {
        this.stateManager.set('$route', {
          path: route.path,
          params: route.params || {},
          query: route.query || {},
          hash: route.hash || '',
          meta: route.meta || {},
          matched: route.matched || [],
          notFound: route.notFound || false
        });
      }
    });
  }

  initializeWebSockets() {
    const wsManager = getWebSocketManager();

    for (const wsDef of this.program.websockets) {
      const { id, url, autoConnect, onOpen, onClose, onMessage, onError } = wsDef;

      // Register event handlers
      if (onOpen) {
        wsManager.on(id, 'open', (data) => {
          this.resolve(onOpen, data);
        });
      }

      if (onClose) {
        wsManager.on(id, 'close', (data) => {
          this.resolve(onClose, data);
        });
      }

      if (onMessage) {
        wsManager.on(id, 'message', (data) => {
          this.resolve(onMessage, data);
        });
      }

      if (onError) {
        wsManager.on(id, 'error', (data) => {
          this.resolve(onError, data);
        });
      }

      // Auto-connect if enabled
      if (autoConnect !== false) {
        wsManager.connect(id, url, {
          reconnect: wsDef.reconnect,
          reconnectInterval: wsDef.reconnectInterval
        }).catch(e => {
          logger.error(`WebSocket ${id} connection failed:`, e);
        });
      }
    }
  }

  resolve(expr, params = {}) {
    const context = {
      get: (id) => this.stateManager.get(id),
      getContext: (id) => this.contextManager.get(id),
      params
    };
    return resolveExpression(expr, context);
  }

  dispatch(actionId, ...args) {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new ActionError('ACTION_UNDEFINED', `Action '${actionId}' is not defined`, actionId);
    }

    // Build params from action definition and args
    const params = {};
    if (action.params) {
      action.params.forEach((paramName, index) => {
        params[paramName] = args[index];
      });
    }

    // Execute mutations in batch
    this.stateManager.batch(() => {
      for (const mutation of action.mutations) {
        const value = mutation.value !== undefined
          ? this.resolve(mutation.value, params)
          : undefined;

        if (mutation.op === 'map' || mutation.op === 'filter') {
          // For map/filter, we need to create a function from the value expression
          const currentArray = this.stateManager.get(mutation.target);
          const mappedArray = currentArray[mutation.op === 'map' ? 'map' : 'filter']((item, index) => {
            return this.resolve(mutation.value, { ...params, item, index });
          });
          this.stateManager.set(mutation.target, mappedArray);
        } else {
          this.stateManager.mutate(mutation.target, mutation.op, value, actionId);
        }
      }
    });

    // Execute action effects if any
    if (action.effects) {
      for (const effect of action.effects) {
        this.resolve(effect, params);
      }
    }
  }

  mount() {
    if (this.mounted) return;
    this.mounted = true;
    const result = this.target.mount(this);

    // Initialize router after DOM is ready
    if (this.router) {
      this.router.init();
    }

    // Run mount effects after DOM is ready
    for (const effect of this.mountEffects) {
      effect.run();
    }

    return result;
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    this.stateManager.dispose();

    // Destroy router
    if (this.router) {
      this.router.destroy();
      this.router = null;
    }

    // Disconnect WebSockets
    if (this.program.websockets) {
      const wsManager = getWebSocketManager();
      for (const wsDef of this.program.websockets) {
        wsManager.disconnect(wsDef.id);
      }
    }

    return this.target.unmount(this);
  }

  getState() {
    return this.stateManager.getSnapshot();
  }
}

class Target {
  mount(runtime) {
    throw new Error('Target.mount must be implemented');
  }

  unmount(runtime) {
    throw new Error('Target.unmount must be implemented');
  }
}

export { Runtime, Target };
