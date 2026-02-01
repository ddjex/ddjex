/**
 * ddjex State Management
 * Fine-grained reactive state with dependency tracking
 */

import { ConstraintManager } from './constraints.js';
import { StateError, ContextError, MutationError } from './errors.js';
import { logger } from './logger.js';

// Security: Maximum scheduler flush iterations to prevent infinite loops
const MAX_FLUSH_ITERATIONS = 100;

// Security: Minimum interval for effects (60fps)
const MIN_INTERVAL_MS = 16;

class ReactiveNode {
  constructor(id, initial) {
    this.id = id;
    this.value = initial;
    this.subscribers = new Set();
    this.dependencies = new Set();
  }

  get() {
    if (ReactiveContext.current) {
      ReactiveContext.current.dependencies.add(this);
      this.subscribers.add(ReactiveContext.current);
    }
    return this.value;
  }

  set(newValue) {
    if (this.value === newValue) return false;
    this.previousValue = this.value;
    this.value = newValue;
    this.notify();
    return true;
  }

  notify() {
    Scheduler.batch(() => {
      for (const sub of this.subscribers) {
        Scheduler.schedule(sub);
      }
    });
  }

  subscribe(node) {
    this.subscribers.add(node);
    // Return unsubscribe function for easier cleanup
    return () => this.subscribers.delete(node);
  }

  unsubscribe(node) {
    this.subscribers.delete(node);
  }
}

class ComputedNode extends ReactiveNode {
  constructor(id, fn, deps) {
    super(id, undefined);
    this.fn = fn;
    this.depIds = deps;
    this.dirty = true;
  }

  get() {
    if (this.dirty) {
      this.recompute();
    }
    return super.get();
  }

  recompute() {
    const prev = ReactiveContext.current;
    ReactiveContext.current = this;

    // Clear old dependencies
    for (const dep of this.dependencies) {
      dep.unsubscribe(this);
    }
    this.dependencies.clear();

    // Compute new value
    this.value = this.fn();
    this.dirty = false;

    ReactiveContext.current = prev;
  }

  invalidate() {
    if (!this.dirty) {
      this.dirty = true;
      this.notify();
    }
  }
}

class EffectNode {
  constructor(id, fn, watch) {
    this.id = id;
    this.fn = fn;
    this.watchIds = watch;
    this.dependencies = new Set();
    this.disposed = false;
  }

  run() {
    if (this.disposed) return;
    this.fn();
  }

  dispose() {
    this.disposed = true;
    for (const dep of this.dependencies) {
      dep.unsubscribe(this);
    }
    this.dependencies.clear();
  }
}

class AsyncEffectNode {
  constructor(id, config, resolver, dispatcher) {
    this.id = id;
    this.config = config;
    this.resolver = resolver;
    this.dispatcher = dispatcher;
    this.dependencies = new Set();
    this.disposed = false;
    this.abortController = null;
    this.cleanupFn = null;
    this.debounceTimer = null;
    this.throttleTimer = null;
    this.lastThrottleTime = 0;
  }

  async run() {
    if (this.disposed) return;

    // Handle debounce
    if (this.config.debounce) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.executeAsync();
      }, this.config.debounce);
      return;
    }

    // Handle throttle
    if (this.config.throttle) {
      const now = Date.now();
      const timeSince = now - this.lastThrottleTime;
      if (timeSince < this.config.throttle) {
        if (!this.throttleTimer) {
          this.throttleTimer = setTimeout(() => {
            this.throttleTimer = null;
            this.lastThrottleTime = Date.now();
            this.executeAsync();
          }, this.config.throttle - timeSince);
        }
        return;
      }
      this.lastThrottleTime = now;
    }

    await this.executeAsync();
  }

  async executeAsync() {
    if (this.disposed) return;

    // Abort previous in-flight request
    if (this.abortController) {
      this.abortController.abort();
    }

    // Run cleanup from previous execution
    if (this.cleanupFn) {
      try {
        this.cleanupFn();
      } catch (e) {
        logger.error(`Effect ${this.id} cleanup error:`, e);
      }
      this.cleanupFn = null;
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      // Execute the main operation - may return null, value, or promise
      const doResult = this.resolver(this.config.do, { signal });

      // If do returned null/undefined synchronously, treat as no-op - skip all callbacks
      if (doResult === null || doResult === undefined) {
        return;
      }

      // We have actual work to do - call onStart
      if (this.config.onStart) {
        this.resolver(this.config.onStart, {});
      }

      // Await if it's a promise
      const result = await doResult;

      // Check if aborted during execution
      if (signal.aborted || this.disposed) return;

      // Execute onSuccess if defined
      if (this.config.onSuccess) {
        this.resolver(this.config.onSuccess, { result });
      }

      // Store cleanup function if defined
      if (this.config.cleanup) {
        this.cleanupFn = () => this.resolver(this.config.cleanup, { result });
      }
    } catch (error) {
      // Ignore abort errors
      if (error.name === 'AbortError' || signal.aborted || this.disposed) return;

      // Execute onError if defined
      if (this.config.onError) {
        this.resolver(this.config.onError, { error: { message: error.message, name: error.name } });
      } else {
        logger.error(`Effect ${this.id} error:`, error);
      }
    }
  }

  dispose() {
    this.disposed = true;

    // Clear timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    // Abort in-flight request
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Run cleanup
    if (this.cleanupFn) {
      try {
        this.cleanupFn();
      } catch (e) {
        logger.error(`Effect ${this.id} cleanup error:`, e);
      }
      this.cleanupFn = null;
    }

    // Unsubscribe from dependencies
    for (const dep of this.dependencies) {
      dep.unsubscribe(this);
    }
    this.dependencies.clear();
  }
}

class IntervalEffectNode {
  constructor(id, fn, interval) {
    this.id = id;
    this.fn = fn;
    this.interval = interval;
    this.intervalId = null;
    this.disposed = false;
    this.dependencies = new Set();
  }

  start() {
    if (this.disposed || this.intervalId) return;
    // Enforce minimum interval to prevent browser freeze
    const safeInterval = Math.max(this.interval, MIN_INTERVAL_MS);
    this.intervalId = setInterval(() => {
      if (!this.disposed) {
        this.fn();
      }
    }, safeInterval);
  }

  run() {
    // For compatibility with scheduler
    if (!this.intervalId) {
      this.start();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const dep of this.dependencies) {
      dep.unsubscribe(this);
    }
    this.dependencies.clear();
  }
}

class TimeoutEffectNode {
  constructor(id, fn, timeout) {
    this.id = id;
    this.fn = fn;
    this.timeout = timeout;
    this.timeoutId = null;
    this.disposed = false;
    this.dependencies = new Set();
  }

  start() {
    if (this.disposed) return;
    // Clear existing timeout if retriggered
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      if (!this.disposed) {
        this.fn();
        this.timeoutId = null;
      }
    }, this.timeout);
  }

  run() {
    this.start();
  }

  dispose() {
    this.disposed = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    for (const dep of this.dependencies) {
      dep.unsubscribe(this);
    }
    this.dependencies.clear();
  }
}

const ReactiveContext = {
  current: null
};

const Scheduler = {
  queue: new Set(),
  flushing: false,
  batchDepth: 0,

  schedule(node) {
    this.queue.add(node);
    if (!this.flushing && this.batchDepth === 0) {
      this.flush();
    }
  },

  batch(fn) {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        this.flush();
      }
    }
  },

  flush() {
    if (this.flushing) return;
    this.flushing = true;

    let iterations = 0;

    // Sort by dependency order (computed before effects)
    const isEffectLike = (n) => n instanceof EffectNode || n instanceof AsyncEffectNode ||
                                n instanceof IntervalEffectNode || n instanceof TimeoutEffectNode;

    while (this.queue.size > 0 && iterations < MAX_FLUSH_ITERATIONS) {
      iterations++;

      const sorted = [...this.queue].sort((a, b) => {
        if (a instanceof ComputedNode && isEffectLike(b)) return -1;
        if (isEffectLike(a) && b instanceof ComputedNode) return 1;
        return 0;
      });

      this.queue.clear();

      for (const node of sorted) {
        if (node instanceof ComputedNode) {
          node.invalidate();
        } else if (isEffectLike(node)) {
          node.run();
        }
      }
    }

    if (iterations >= MAX_FLUSH_ITERATIONS) {
      logger.error('Possible infinite loop in reactive updates - scheduler stopped after', MAX_FLUSH_ITERATIONS, 'iterations');
      this.queue.clear();
    }

    this.flushing = false;
  }
};

class StateManager {
  constructor() {
    this.states = new Map();
    this.computed = new Map();
    this.effects = new Map();
    this.constraintManager = new ConstraintManager();
    this.invariants = [];
    this.currentAction = null;
  }

  /**
   * Set the operation resolver for custom constraints
   */
  setOpResolver(resolver) {
    this.constraintManager.setOpResolver(resolver);
    this.constraintManager.setStateGetter(() => this.getSnapshot());
  }

  /**
   * Register program-level invariants
   */
  registerInvariants(invariants) {
    this.invariants = invariants || [];
    this.constraintManager.registerInvariants(invariants);
  }

  defineState(id, definition) {
    const node = new ReactiveNode(id, definition.initial);
    this.states.set(id, node);

    // Register constraints if defined
    if (definition.constraints) {
      this.constraintManager.registerConstraints(id, definition.constraints);
    }

    return node;
  }

  defineComputed(id, definition, resolver) {
    const fn = () => resolver(definition.fn);
    const node = new ComputedNode(id, fn, definition.deps);

    // Subscribe to dependencies
    for (const depId of definition.deps) {
      const dep = this.states.get(depId) || this.computed.get(depId);
      if (dep) {
        dep.subscribe(node);
        node.dependencies.add(dep);
      }
    }

    this.computed.set(id, node);
    return node;
  }

  defineEffect(id, definition, resolver, dispatcher) {
    const trigger = definition.trigger || 'watch';

    // Interval effect
    if (trigger === 'interval') {
      return this.defineIntervalEffect(id, definition, resolver);
    }

    // Timeout effect
    if (trigger === 'timeout') {
      return this.defineTimeoutEffect(id, definition, resolver);
    }

    // Mount effect (async, runs once on mount)
    if (trigger === 'mount') {
      return this.defineAsyncEffect(id, definition, resolver, dispatcher, false);
    }

    // Watch effect - check if it has async lifecycle hooks
    const hasAsyncHooks = definition.onStart || definition.onSuccess || definition.onError ||
                          definition.cleanup || definition.debounce || definition.throttle;

    if (hasAsyncHooks) {
      return this.defineAsyncEffect(id, definition, resolver, dispatcher, true);
    }

    // Standard sync watch effect
    const fn = () => resolver(definition.do);
    const node = new EffectNode(id, fn, definition.watch || []);

    // Subscribe to watched states
    if (definition.watch) {
      for (const watchId of definition.watch) {
        const dep = this.states.get(watchId) || this.computed.get(watchId);
        if (dep) {
          dep.subscribe(node);
          node.dependencies.add(dep);
        }
      }
    }

    this.effects.set(id, node);

    // Run effect immediately
    node.run();

    return node;
  }

  defineAsyncEffect(id, definition, resolver, dispatcher, runOnWatch) {
    const node = new AsyncEffectNode(id, definition, resolver, dispatcher);

    // Subscribe to watched states if runOnWatch is true
    if (runOnWatch && definition.watch) {
      for (const watchId of definition.watch) {
        const dep = this.states.get(watchId) || this.computed.get(watchId);
        if (dep) {
          dep.subscribe(node);
          node.dependencies.add(dep);
        }
      }
    }

    this.effects.set(id, node);

    // For mount trigger, don't run immediately - let DOM target handle it
    // For watch trigger, run immediately if runOnWatch
    if (runOnWatch) {
      node.run();
    }

    return node;
  }

  defineIntervalEffect(id, definition, resolver) {
    const fn = () => resolver(definition.do);
    const node = new IntervalEffectNode(id, fn, definition.interval);

    this.effects.set(id, node);

    // Don't start immediately - let DOM target handle it on mount
    return node;
  }

  defineTimeoutEffect(id, definition, resolver) {
    const fn = () => resolver(definition.do);
    const node = new TimeoutEffectNode(id, fn, definition.timeout);

    // Subscribe to watched states if any (retriggers timeout)
    if (definition.watch) {
      for (const watchId of definition.watch) {
        const dep = this.states.get(watchId) || this.computed.get(watchId);
        if (dep) {
          dep.subscribe(node);
          node.dependencies.add(dep);
        }
      }
    }

    this.effects.set(id, node);

    // Don't start immediately - let DOM target handle it on mount
    return node;
  }

  get(id) {
    const state = this.states.get(id);
    if (state) return state.get();

    const computed = this.computed.get(id);
    if (computed) return computed.get();

    return undefined;
  }

  set(id, value, skipConstraints = false) {
    const state = this.states.get(id);
    if (!state) {
      throw new StateError('STATE_UNDEFINED', `State '${id}' is not defined`, id);
    }

    // Validate constraints before setting
    if (!skipConstraints) {
      const error = this.constraintManager.validateState(id, value, this.currentAction);
      if (error) {
        throw error;
      }
    }

    const changed = state.set(value);

    // Check invariants after mutation
    if (changed && !skipConstraints) {
      const violations = this.constraintManager.validateAllInvariants();
      if (violations.length > 0) {
        // Find first error-level violation
        const errorViolation = violations.find(v => v.severity === 'error');
        if (errorViolation) {
          // Rollback the change
          state.value = state.previousValue !== undefined ? state.previousValue : state.value;
          throw errorViolation;
        }
        // Log warnings
        for (const v of violations.filter(v => v.severity === 'warning')) {
          logger.warn(`Invariant warning: ${v.message}`);
        }
      }
    }

    return changed;
  }

  mutate(id, op, value, actionName = null) {
    const current = this.get(id);
    let newValue;

    // Track current action for constraint error messages
    const prevAction = this.currentAction;
    if (actionName) {
      this.currentAction = actionName;
    }

    switch (op) {
      case 'set':
        newValue = value;
        break;
      case 'add':
        newValue = current + value;
        break;
      case 'subtract':
        newValue = current - value;
        break;
      case 'multiply':
        newValue = current * value;
        break;
      case 'divide':
        newValue = current / value;
        break;
      case 'toggle':
        newValue = !current;
        break;
      case 'push':
        newValue = [...current, value];
        break;
      case 'pop':
        newValue = current.slice(0, -1);
        break;
      case 'shift':
        newValue = current.slice(1);
        break;
      case 'unshift':
        newValue = [value, ...current];
        break;
      case 'merge':
        newValue = { ...current, ...value };
        break;
      case 'filter':
        newValue = current.filter(value);
        break;
      case 'map':
        newValue = current.map(value);
        break;
      default:
        throw new MutationError('INVALID_MUTATION_OP', `Unknown mutation operation: ${op}`, { operation: op, state: id });
    }

    try {
      return this.set(id, newValue);
    } finally {
      this.currentAction = prevAction;
    }
  }

  batch(fn) {
    Scheduler.batch(fn);
  }

  getSnapshot() {
    const snapshot = {};
    for (const [id, node] of this.states) {
      snapshot[id] = node.value;
    }
    return snapshot;
  }

  dispose() {
    for (const effect of this.effects.values()) {
      effect.dispose();
    }
    this.states.clear();
    this.computed.clear();
    this.effects.clear();
  }
}

/**
 * Context Manager
 * Manages context values with provider scoping
 */
class ContextManager {
  constructor() {
    this.contexts = new Map();
    this.providerStack = new Map(); // contextId -> [value stack]
  }

  /**
   * Define a context with initial value
   */
  defineContext(id, definition) {
    const node = new ReactiveNode(id, definition.initial);
    this.contexts.set(id, node);
    this.providerStack.set(id, []);
    return node;
  }

  /**
   * Get context value (respects provider stack)
   */
  get(id) {
    const stack = this.providerStack.get(id);
    if (stack && stack.length > 0) {
      return stack[stack.length - 1];
    }
    const context = this.contexts.get(id);
    return context ? context.get() : undefined;
  }

  /**
   * Set context value at root level
   */
  set(id, value) {
    const context = this.contexts.get(id);
    if (!context) {
      throw new ContextError('CONTEXT_UNDEFINED', `Context '${id}' is not defined`, id);
    }
    return context.set(value);
  }

  /**
   * Push a provider value onto the stack
   */
  pushProvider(id, value) {
    const stack = this.providerStack.get(id);
    if (!stack) {
      throw new ContextError('CONTEXT_UNDEFINED', `Context '${id}' is not defined`, id);
    }
    stack.push(value);
  }

  /**
   * Pop a provider value from the stack
   */
  popProvider(id) {
    const stack = this.providerStack.get(id);
    if (stack && stack.length > 0) {
      stack.pop();
    }
  }

  /**
   * Subscribe to context changes
   */
  subscribe(id, node) {
    const context = this.contexts.get(id);
    if (context) {
      context.subscribe(node);
    }
  }

  /**
   * Get all context values
   */
  getSnapshot() {
    const snapshot = {};
    for (const [id] of this.contexts) {
      snapshot[id] = this.get(id);
    }
    return snapshot;
  }

  /**
   * Cleanup
   */
  dispose() {
    this.contexts.clear();
    this.providerStack.clear();
  }
}

export {
  StateManager,
  ContextManager,
  ReactiveNode,
  ComputedNode,
  EffectNode,
  AsyncEffectNode,
  IntervalEffectNode,
  TimeoutEffectNode,
  Scheduler,
  ConstraintManager
};
