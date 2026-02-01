/**
 * ddjex Hot Module Replacement
 * Enables live updates without full page refresh
 */

class HMRClient {
  constructor(options = {}) {
    this.options = {
      port: 3001,
      host: 'localhost',
      reconnectInterval: 1000,
      ...options
    };
    this.ws = null;
    this.runtime = null;
    this.listeners = new Map();
    this.connected = false;
  }

  /**
   * Connect to HMR server
   */
  connect(runtime) {
    this.runtime = runtime;

    if (typeof WebSocket === 'undefined') {
      console.warn('[HMR] WebSocket not available');
      return this;
    }

    const url = `ws://${this.options.host}:${this.options.port}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      console.log('[HMR] Connected');
      this.emit('connected');
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.log('[HMR] Disconnected, reconnecting...');
      this.emit('disconnected');
      setTimeout(() => this.connect(runtime), this.options.reconnectInterval);
    };

    this.ws.onerror = (error) => {
      console.error('[HMR] Error:', error);
      this.emit('error', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error('[HMR] Invalid message:', e);
      }
    };

    return this;
  }

  /**
   * Handle incoming HMR message
   */
  handleMessage(message) {
    switch (message.type) {
      case 'update':
        this.applyUpdate(message.payload);
        break;
      case 'full-reload':
        console.log('[HMR] Full reload required');
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
        break;
      case 'error':
        console.error('[HMR] Server error:', message.payload);
        this.emit('error', message.payload);
        break;
      default:
        console.warn('[HMR] Unknown message type:', message.type);
    }
  }

  /**
   * Apply hot update to running application
   */
  applyUpdate(update) {
    if (!this.runtime) {
      console.warn('[HMR] No runtime connected');
      return;
    }

    console.log('[HMR] Applying update...');
    const startTime = performance.now();

    try {
      // Save current state
      const savedState = this.runtime.getState();

      // Update program parts
      if (update.state) {
        this.updateState(update.state, savedState);
      }

      if (update.computed) {
        this.updateComputed(update.computed);
      }

      if (update.actions) {
        this.updateActions(update.actions);
      }

      if (update.effects) {
        this.updateEffects(update.effects);
      }

      if (update.components) {
        this.updateComponents(update.components);
      }

      if (update.root) {
        this.updateRoot(update.root);
      }

      const elapsed = (performance.now() - startTime).toFixed(2);
      console.log(`[HMR] Update applied in ${elapsed}ms`);
      this.emit('update', update);

    } catch (error) {
      console.error('[HMR] Update failed:', error);
      this.emit('error', error);
    }
  }

  /**
   * Update state definitions while preserving values
   */
  updateState(newState, savedState) {
    const sm = this.runtime.stateManager;

    for (const [id, def] of Object.entries(newState)) {
      if (sm.states.has(id)) {
        // Keep existing value if type matches
        const currentValue = savedState[id];
        const newType = def.type;
        const canPreserve = this.canPreserveValue(currentValue, newType);

        if (!canPreserve) {
          sm.set(id, def.initial);
        }
      } else {
        // New state - define it
        sm.defineState(id, def);
      }
    }

    // Remove deleted state
    for (const id of sm.states.keys()) {
      if (!(id in newState)) {
        sm.states.delete(id);
      }
    }
  }

  /**
   * Check if value can be preserved for new type
   */
  canPreserveValue(value, type) {
    if (value === null || value === undefined) return true;

    switch (type) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && !Array.isArray(value);
      default: return true;
    }
  }

  /**
   * Update computed definitions
   */
  updateComputed(newComputed) {
    const sm = this.runtime.stateManager;

    // Remove old computed
    for (const id of sm.computed.keys()) {
      if (!(id in newComputed)) {
        sm.computed.delete(id);
      }
    }

    // Add/update computed
    for (const [id, def] of Object.entries(newComputed)) {
      sm.defineComputed(id, def, (expr) => this.runtime.resolve(expr));
    }
  }

  /**
   * Update action definitions
   */
  updateActions(newActions) {
    this.runtime.actions.clear();
    for (const [id, def] of Object.entries(newActions)) {
      this.runtime.actions.set(id, def);
    }
  }

  /**
   * Update effect definitions
   */
  updateEffects(newEffects) {
    const sm = this.runtime.stateManager;

    // Clear old effects
    sm.effects.clear();

    // Add new effects
    for (const effect of newEffects) {
      sm.defineEffect(effect.id, effect, (expr) => this.runtime.resolve(expr));
    }
  }

  /**
   * Update component definitions
   */
  updateComponents(newComponents) {
    this.runtime.components.clear();
    for (const [id, def] of Object.entries(newComponents)) {
      this.runtime.components.set(id, def);
    }
  }

  /**
   * Update root and re-render
   */
  updateRoot(newRoot) {
    this.runtime.program.root = newRoot;

    // Re-render if DOM target
    if (this.runtime.target && this.runtime.target.container) {
      const container = this.runtime.target.container;
      container.innerHTML = '';
      const element = this.runtime.target.renderNode(newRoot, {});
      container.appendChild(element);
    }
  }

  /**
   * Event handling
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        callback(data);
      }
    }
  }

  /**
   * Disconnect from HMR server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

/**
 * Create HMR-enabled runtime
 */
async function createHMRRuntime(program, target, options = {}) {
  const { Runtime } = await import('../core/runtime.js');

  const runtime = new Runtime(program, target);
  runtime.initialize();

  const hmr = new HMRClient(options);
  hmr.connect(runtime);

  runtime.hmr = hmr;
  return runtime;
}

export { HMRClient, createHMRRuntime };
