/**
 * ddjex Browser Bundle v0.4.0
 * Declarative Deterministic JSON Execution
 * Security: Prototype pollution, ReDoS, depth limits, division by zero,
 *           URL validation, string length limits, WebSocket protocol validation
 */
(function(global) {
  'use strict';

  // ============== State Management ==============

  class StateManager {
    constructor() {
      this.values = new Map();
      this.subscribers = new Map();
      this.computed = new Map();
      this.computedDeps = new Map();
    }

    define(id, initial) {
      this.values.set(id, initial);
      this.subscribers.set(id, new Set());
    }

    defineComputed(id, deps, fn) {
      this.computedDeps.set(id, deps);
      this.computed.set(id, fn);
      this.subscribers.set(id, new Set());
    }

    get(id) {
      if (this.computed.has(id)) {
        return this.computed.get(id)();
      }
      return this.values.get(id);
    }

    set(id, value) {
      if (this.values.get(id) === value) return;
      this.values.set(id, value);
      this.notify(id);
    }

    notify(id) {
      // Notify direct subscribers
      this.subscribers.get(id)?.forEach(fn => fn());

      // Notify computed that depend on this (recursively)
      const notified = new Set([id]);
      const queue = [id];

      while (queue.length > 0) {
        const current = queue.shift();
        for (const [compId, deps] of this.computedDeps) {
          if (deps.includes(current) && !notified.has(compId)) {
            notified.add(compId);
            queue.push(compId);
            this.subscribers.get(compId)?.forEach(fn => fn());
          }
        }
      }
    }

    subscribe(id, fn) {
      this.subscribers.get(id)?.add(fn);
      return () => this.subscribers.get(id)?.delete(fn);
    }

    mutate(id, op, value) {
      const current = this.get(id);
      let next;

      switch (op) {
        case 'set': next = value; break;
        case 'add': next = current + value; break;
        case 'subtract': next = current - value; break;
        case 'multiply': next = current * value; break;
        case 'divide': next = current / value; break;
        case 'toggle': next = !current; break;
        case 'push': next = [...current, value]; break;
        case 'pop': next = current.slice(0, -1); break;
        case 'shift': next = current.slice(1); break;
        case 'unshift': next = [value, ...current]; break;
        case 'merge': next = { ...current, ...value }; break;
        default: next = value;
      }

      this.set(id, next);
    }

    snapshot() {
      const result = {};
      for (const [id, val] of this.values) {
        result[id] = val;
      }
      return result;
    }
  }

  // ============== Constraints ==============

  class ConstraintViolationError extends Error {
    constructor(details) {
      super(details.message);
      this.name = 'ConstraintViolationError';
      this.error = true;
      this.code = 'CONSTRAINT_VIOLATION';
      this.state = details.state;
      this.constraint = details.constraint;
      this.value = details.value;
      this.limit = details.limit;
      this.message = details.message;
      this.action = details.action;
      this.suggestion = details.suggestion;
    }
  }

  class InvariantViolationError extends Error {
    constructor(details) {
      super(details.message);
      this.name = 'InvariantViolationError';
      this.error = true;
      this.code = 'INVARIANT_VIOLATION';
      this.invariant = details.invariant;
      this.message = details.message;
      this.severity = details.severity || 'error';
    }
  }

  function checkConstraint(stateId, value, type, limit, customMsg) {
    const baseError = { state: stateId, constraint: type, value, limit };

    switch (type) {
      case 'min':
        if (typeof value === 'number' && value < limit) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMsg || `${stateId} must be at least ${limit}`
          });
        }
        break;
      case 'max':
        if (typeof value === 'number' && value > limit) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMsg || `${stateId} must be at most ${limit}`
          });
        }
        break;
      case 'minLength':
        if ((typeof value === 'string' || Array.isArray(value)) && value.length < limit) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMsg || `${stateId} must have at least ${limit} items/characters`
          });
        }
        break;
      case 'maxLength':
        if ((typeof value === 'string' || Array.isArray(value)) && value.length > limit) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMsg || `${stateId} must have at most ${limit} items/characters`
          });
        }
        break;
      case 'pattern':
        if (typeof value === 'string' && !new RegExp(limit).test(value)) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMsg || `${stateId} does not match pattern ${limit}`
          });
        }
        break;
      case 'unique':
        if (Array.isArray(value) && limit === true) {
          const seen = new Set();
          for (const item of value) {
            const key = JSON.stringify(item);
            if (seen.has(key)) {
              return new ConstraintViolationError({
                ...baseError,
                message: customMsg || `${stateId} must contain unique items`
              });
            }
            seen.add(key);
          }
        }
        break;
      case 'enum':
        if (Array.isArray(limit) && !limit.includes(value)) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMsg || `${stateId} must be one of: ${limit.join(', ')}`
          });
        }
        break;
      case 'required':
        if (limit === true && (value === null || value === undefined)) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMsg || `${stateId} is required`
          });
        }
        break;
    }
    return null;
  }

  function validateConstraints(stateId, value, constraints) {
    if (!constraints) return null;
    const customMsg = constraints.message;
    for (const [type, limit] of Object.entries(constraints)) {
      if (type === 'message' || type === 'custom') continue;
      const error = checkConstraint(stateId, value, type, limit, customMsg);
      if (error) return error;
    }
    return null;
  }

  function checkInvariant(invariant, resolver) {
    const result = resolver(invariant.check);
    if (result === false) {
      return new InvariantViolationError({
        invariant: invariant.id,
        message: invariant.message,
        severity: invariant.severity || 'error'
      });
    }
    return null;
  }

  // ============== Context Manager ==============

  class ContextManager {
    constructor() {
      this.contexts = new Map();
      this.providerStack = new Map();
    }

    define(id, initial) {
      this.contexts.set(id, initial);
      this.providerStack.set(id, []);
    }

    get(id) {
      const stack = this.providerStack.get(id);
      if (stack && stack.length > 0) {
        return stack[stack.length - 1];
      }
      return this.contexts.get(id);
    }

    set(id, value) {
      this.contexts.set(id, value);
    }

    pushProvider(id, value) {
      const stack = this.providerStack.get(id);
      if (stack) {
        stack.push(value);
      }
    }

    popProvider(id) {
      const stack = this.providerStack.get(id);
      if (stack && stack.length > 0) {
        stack.pop();
      }
    }

    snapshot() {
      const result = {};
      for (const [id] of this.contexts) {
        result[id] = this.get(id);
      }
      return result;
    }
  }

  // ============== Router Manager ==============

  class RouterManager {
    constructor(config = {}) {
      this.mode = config.mode || 'history';
      this.base = config.base || '/';
      this.routes = [];
      this.currentRoute = null;
      this.subscribers = new Set();
      this.guards = [];
      this.notFound = config.notFound || null;

      if (!this.base.startsWith('/')) this.base = '/' + this.base;
      if (!this.base.endsWith('/')) this.base = this.base + '/';
      if (this.base === '//') this.base = '/';
    }

    addRoutes(routes, parentPath = '') {
      for (const route of routes) {
        const fullPath = this.normalizePath(parentPath + route.path);
        const routeRecord = {
          path: fullPath,
          pattern: this.pathToRegex(fullPath),
          paramNames: this.extractParamNames(fullPath),
          name: route.name,
          component: route.component,
          render: route.render,
          redirect: route.redirect,
          guard: route.guard,
          meta: route.meta || {},
          parent: parentPath || null
        };
        this.routes.push(routeRecord);
        if (route.children) {
          this.addRoutes(route.children, fullPath);
        }
      }
    }

    pathToRegex(path) {
      // Security: Validate path length to prevent ReDoS
      const MAX_PATH_LENGTH = 500;
      const MAX_PATH_PARAMS = 20;

      if (path.length > MAX_PATH_LENGTH) {
        throw { error: true, code: 'PATH_TOO_LONG', message: `Path exceeds max length (${MAX_PATH_LENGTH})` };
      }

      const paramCount = (path.match(/:[^/]+/g) || []).length;
      if (paramCount > MAX_PATH_PARAMS) {
        throw { error: true, code: 'TOO_MANY_PARAMS', message: `Path has too many parameters (max ${MAX_PATH_PARAMS})` };
      }

      const pattern = path
        .replace(/\//g, '\\/')
        .replace(/:([^/]+)/g, '([^/]+)')
        .replace(/\*/g, '.*');

      try {
        return new RegExp(`^${pattern}$`);
      } catch (e) {
        throw { error: true, code: 'INVALID_PATH_PATTERN', message: e.message || 'Invalid path pattern' };
      }
    }

    extractParamNames(path) {
      const matches = path.match(/:([^/]+)/g) || [];
      return matches.map(m => m.slice(1));
    }

    normalizePath(path) {
      path = path.replace(/\/+/g, '/');
      if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
      if (!path.startsWith('/')) path = '/' + path;
      return path;
    }

    match(path) {
      path = this.normalizePath(path);
      for (const route of this.routes) {
        const match = path.match(route.pattern);
        if (match) {
          const params = {};
          route.paramNames.forEach((name, i) => {
            params[name] = match[i + 1];
          });
          return {
            route,
            path,
            params,
            query: this.parseQuery(window.location.search),
            hash: window.location.hash.slice(1),
            matched: [route],
            meta: route.meta
          };
        }
      }
      return null;
    }

    parseQuery(search) {
      const query = {};
      if (!search || search === '?') return query;
      const params = new URLSearchParams(search);
      for (const [key, value] of params) query[key] = value;
      return query;
    }

    buildQuery(query) {
      if (!query || Object.keys(query).length === 0) return '';
      return '?' + new URLSearchParams(query).toString();
    }

    getCurrentPath() {
      if (this.mode === 'hash') {
        return window.location.hash.slice(1) || '/';
      }
      let path = window.location.pathname;
      if (this.base !== '/' && path.startsWith(this.base)) {
        path = path.slice(this.base.length - 1);
      }
      return path || '/';
    }

    async navigate(to, options = {}) {
      let path, query, hash;
      if (typeof to === 'string') {
        const [pathPart, queryPart] = to.split('?');
        const [pathOnly, hashPart] = pathPart.split('#');
        path = this.normalizePath(pathOnly);
        query = queryPart ? this.parseQuery('?' + queryPart) : {};
        hash = hashPart || '';
      } else if (typeof to === 'object') {
        if (to.name) {
          const route = this.routes.find(r => r.name === to.name);
          if (!route) { console.error(`Route not found: ${to.name}`); return false; }
          path = this.buildPath(route.path, to.params || {});
        } else {
          path = this.normalizePath(to.path || '/');
        }
        query = to.query || {};
        hash = to.hash || '';
      } else {
        return false;
      }

      const matched = this.match(path);
      if (!matched) {
        this.currentRoute = { path, params: {}, query, hash, matched: [], meta: {}, notFound: true };
        this.notify();
        return true;
      }

      if (matched.route.redirect) {
        return this.navigate(matched.route.redirect, { replace: true });
      }

      const canNavigate = await this.runGuards(matched);
      if (!canNavigate) return false;

      const fullPath = path + this.buildQuery(query) + (hash ? '#' + hash : '');
      if (this.mode === 'hash') {
        if (options.replace) window.location.replace('#' + fullPath);
        else window.location.hash = fullPath;
      } else {
        const url = (this.base === '/' ? '' : this.base.slice(0, -1)) + fullPath;
        if (options.replace) window.history.replaceState({}, '', url);
        else window.history.pushState({}, '', url);
      }

      this.currentRoute = { ...matched, query, hash };
      this.notify();
      return true;
    }

    buildPath(pattern, params) {
      let path = pattern;
      for (const [key, value] of Object.entries(params)) {
        path = path.replace(`:${key}`, encodeURIComponent(value));
      }
      return path;
    }

    async runGuards(to) {
      const from = this.currentRoute;
      for (const guard of this.guards) {
        const result = await guard(to, from);
        if (result === false) return false;
        if (typeof result === 'string') { this.navigate(result, { replace: true }); return false; }
      }
      return true;
    }

    beforeEach(guard) {
      this.guards.push(guard);
      return () => {
        const index = this.guards.indexOf(guard);
        if (index > -1) this.guards.splice(index, 1);
      };
    }

    back() { window.history.back(); }
    forward() { window.history.forward(); }
    go(delta) { window.history.go(delta); }

    subscribe(callback) {
      this.subscribers.add(callback);
      return () => this.subscribers.delete(callback);
    }

    notify() {
      for (const callback of this.subscribers) callback(this.currentRoute);
    }

    init() {
      const path = this.getCurrentPath();
      const matched = this.match(path);
      if (matched) {
        if (matched.route.redirect) { this.navigate(matched.route.redirect, { replace: true }); return; }
        this.currentRoute = { ...matched, query: this.parseQuery(window.location.search), hash: window.location.hash.slice(1) };
      } else {
        this.currentRoute = { path, params: {}, query: this.parseQuery(window.location.search), hash: window.location.hash.slice(1), matched: [], meta: {}, notFound: true };
      }
      if (this.mode === 'hash') window.addEventListener('hashchange', () => this.handleRouteChange());
      else window.addEventListener('popstate', () => this.handleRouteChange());
      this.notify();
    }

    handleRouteChange() {
      const path = this.getCurrentPath();
      const matched = this.match(path);
      if (matched) {
        if (matched.route.redirect) { this.navigate(matched.route.redirect, { replace: true }); return; }
        this.currentRoute = { ...matched, query: this.parseQuery(window.location.search), hash: window.location.hash.slice(1) };
      } else {
        this.currentRoute = { path, params: {}, query: this.parseQuery(window.location.search), hash: window.location.hash.slice(1), matched: [], meta: {}, notFound: true };
      }
      this.notify();
    }

    isActive(path, exact = false) {
      if (!this.currentRoute) return false;
      const normalizedPath = this.normalizePath(path);
      const currentPath = this.currentRoute.path;
      if (exact) return currentPath === normalizedPath;
      if (normalizedPath === '/') return currentPath === '/';
      if (currentPath.startsWith(normalizedPath)) {
        const nextChar = currentPath[normalizedPath.length];
        return nextChar === undefined || nextChar === '/';
      }
      return false;
    }

    getRoute() { return this.currentRoute; }

    resolve(to) {
      if (typeof to === 'string') return { path: this.normalizePath(to) };
      if (to.name) {
        const route = this.routes.find(r => r.name === to.name);
        if (route) return { path: this.buildPath(route.path, to.params || {}), route };
      }
      return { path: this.normalizePath(to.path || '/') };
    }
  }

  // ============== Operations ==============

  // Security: Keys that can be used for prototype pollution attacks
  const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

  // Security: Maximum regex pattern length to prevent ReDoS
  const MAX_REGEX_LENGTH = 500;
  const DANGEROUS_REGEX_PATTERNS = /(\+\+|\*\*|\?\?|\{\d+,\d*\}\{)/;

  // Security: Maximum string length to prevent memory exhaustion
  const MAX_STRING_LENGTH = 1000000;

  // Security: Dangerous URL protocols
  const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'file:'];

  function safeRegex(pattern) {
    if (typeof pattern !== 'string') return null;
    if (pattern.length > MAX_REGEX_LENGTH) return null;
    if (DANGEROUS_REGEX_PATTERNS.test(pattern)) return null;
    try {
      return new RegExp(pattern);
    } catch {
      return null;
    }
  }

  // Security: Validate URL is safe
  function validateUrl(url) {
    if (typeof url !== 'string') {
      return { error: true, code: 'INVALID_URL', message: 'URL must be a string' };
    }
    const normalized = url.trim().toLowerCase();
    for (const protocol of DANGEROUS_PROTOCOLS) {
      if (normalized.startsWith(protocol)) {
        return { error: true, code: 'DANGEROUS_URL', message: `Protocol '${protocol}' not allowed` };
      }
    }
    return null;
  }

  // Security: Maximum expression depth
  const MAX_EXPRESSION_DEPTH = 100;

  const ops = {
    // Math
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => {
      if (b === 0) return { error: true, code: 'DIVISION_BY_ZERO', message: 'Cannot divide by zero' };
      return a / b;
    },
    modulo: (a, b) => {
      if (b === 0) return { error: true, code: 'MODULO_BY_ZERO', message: 'Cannot modulo by zero' };
      return a % b;
    },
    min: (...a) => Math.min(...a),
    max: (...a) => Math.max(...a),
    abs: a => Math.abs(a),
    round: a => Math.round(a),
    floor: a => Math.floor(a),
    ceil: a => Math.ceil(a),

    // Compare
    eq: (a, b) => a === b,
    neq: (a, b) => a !== b,
    gt: (a, b) => a > b,
    gte: (a, b) => a >= b,
    lt: (a, b) => a < b,
    lte: (a, b) => a <= b,
    and: (...a) => a.every(Boolean),
    or: (...a) => a.some(Boolean),
    not: a => !a,

    // Array
    length: a => a?.length ?? 0,
    first: a => a?.[0],
    last: a => a?.[a.length - 1],
    at: (a, i) => a?.[i],
    slice: (a, s, e) => a?.slice(s, e),
    concat: (...a) => {
      // Handle both array concat and string concat
      if (a.length > 0 && typeof a[0] === 'string') return a.join('');
      return [].concat(...a);
    },
    includes: (a, v) => a?.includes(v),
    indexOf: (a, v) => a?.indexOf(v),
    join: (a, s) => a?.join(s ?? ''),
    reverse: a => [...a].reverse(),
    unique: a => [...new Set(a)],
    sort: (arr, field, dir) => {
      if (!arr) return [];
      return [...arr].sort((a, b) => {
        const va = field ? a[field] : a;
        const vb = field ? b[field] : b;
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return dir === 'desc' ? -cmp : cmp;
      });
    },

    // Object (with prototype pollution protection)
    get: (o, k) => {
      if (DANGEROUS_KEYS.includes(k)) return undefined;
      return o?.[k];
    },
    set: (o, k, v) => {
      if (DANGEROUS_KEYS.includes(k)) return o;
      return { ...o, [k]: v };
    },
    keys: o => Object.keys(o ?? {}),
    values: o => Object.values(o ?? {}),
    entries: o => Object.entries(o ?? {}),
    fromEntries: a => Object.fromEntries(a ?? []),
    merge: (...objs) => {
      const result = {};
      for (const obj of objs) {
        if (!obj || typeof obj !== 'object') continue;
        for (const key of Object.keys(obj)) {
          if (!DANGEROUS_KEYS.includes(key)) {
            result[key] = obj[key];
          }
        }
      }
      return result;
    },
    has: (o, k) => k in (o ?? {}),

    // String
    split: (s, d) => s?.split(d),
    trim: s => s?.trim(),
    toUpperCase: s => s?.toUpperCase(),
    toLowerCase: s => s?.toLowerCase(),
    startsWith: (s, p) => s?.startsWith(p),
    endsWith: (s, p) => s?.endsWith(p),
    substring: (s, a, b) => s?.substring(a, b),
    replace: (s, f, t) => s?.replace(f, t),
    replaceAll: (s, f, t) => s?.replaceAll(f, t),
    padStart: (s, len, char) => {
      if (len > MAX_STRING_LENGTH) {
        return { error: true, code: 'STRING_TOO_LONG', message: `Target length ${len} exceeds max (${MAX_STRING_LENGTH})` };
      }
      return String(s ?? '').padStart(len, char ?? ' ');
    },
    padEnd: (s, len, char) => {
      if (len > MAX_STRING_LENGTH) {
        return { error: true, code: 'STRING_TOO_LONG', message: `Target length ${len} exceeds max (${MAX_STRING_LENGTH})` };
      }
      return String(s ?? '').padEnd(len, char ?? ' ');
    },
    repeat: (s, count) => {
      if (!s) return '';
      const resultLength = String(s).length * Math.max(0, count);
      if (resultLength > MAX_STRING_LENGTH) {
        return { error: true, code: 'STRING_TOO_LONG', message: `Result would exceed max length (${MAX_STRING_LENGTH})` };
      }
      return String(s).repeat(Math.max(0, count));
    },
    toJSON: (val) => {
      try {
        return JSON.stringify(val);
      } catch (e) {
        return { error: true, code: 'JSON_STRINGIFY_ERROR', message: e.message || 'Failed to stringify (possible circular reference)' };
      }
    },
    fromJSON: (str) => {
      try {
        return JSON.parse(str);
      } catch (e) {
        return { error: true, code: 'INVALID_JSON', message: e.message };
      }
    },
    pick: (obj, keys) => keys.reduce((acc, k) => {
      if (DANGEROUS_KEYS.includes(k)) return acc;
      return k in obj ? { ...acc, [k]: obj[k] } : acc;
    }, {}),
    omit: (obj, keys) => Object.fromEntries(
      Object.entries(obj).filter(([k]) => !keys.includes(k) && !DANGEROUS_KEYS.includes(k))
    ),

    // Type
    toString: v => String(v),
    toNumber: v => Number(v),
    parseInt: v => parseInt(v, 10),
    parseFloat: v => parseFloat(v),
    isNull: v => v === null,
    isUndefined: v => v === undefined,
    isDefined: v => v != null,
    typeof: v => typeof v,

    // Control
    if: (c, t, e) => c ? t : e,
    switch: (val, cases, def) => cases?.[val] ?? def,
    coalesce: (...v) => v.find(x => x != null),

    // Validation
    isEmail: v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    isUrl: v => { if (!v) return true; try { new URL(v); return true; } catch { return false; } },
    isNumeric: v => !v || !isNaN(Number(v)),
    isEmpty: v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0),
    isNotEmpty: v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
    hasMinLength: (v, min) => (v?.length ?? 0) >= min,
    hasMaxLength: (v, max) => (v?.length ?? 0) <= max,
    matchesPattern: (v, p) => !v || new RegExp(p).test(v),

    // Utility
    now: () => Date.now(),
    uuid: () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    log: (...a) => console.log(...a),

    // Event helpers
    eventValue: null, // Handled specially
    eventChecked: null, // Handled specially
    eventKey: null,

    // Lazy loading operations
    preload: (src) => getLazyManager().preload(src),
    isLazyLoaded: (src) => getLazyManager().isLoaded(src),

    // Animation utilities
    lerp: (start, end, t) => start + (end - start) * t,
    inverseLerp: (start, end, value) => (value - start) / (end - start),
    remap: (value, inStart, inEnd, outStart, outEnd) => {
      const t = (value - inStart) / (inEnd - inStart);
      return outStart + (outEnd - outStart) * t;
    },
    clamp: (val, min, max) => Math.min(Math.max(val, min), max),

    // Easing functions
    easeLinear: t => t,
    easeIn: t => t * t * t,
    easeOut: t => 1 - Math.pow(1 - t, 3),
    easeInOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    easeInQuad: t => t * t,
    easeOutQuad: t => 1 - (1 - t) * (1 - t),
    easeOutBounce: t => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },

    // Spring physics helper
    springValue: (current, target, velocity, stiffness = 100, damping = 10, mass = 1, dt = 0.016) => {
      const displacement = current - target;
      const springForce = -stiffness * displacement;
      const dampingForce = -damping * velocity;
      const acceleration = (springForce + dampingForce) / mass;
      const newVelocity = velocity + acceleration * dt;
      const newValue = current + newVelocity * dt;
      return { value: newValue, velocity: newVelocity };
    },

    // Transform helpers
    translateX: value => `translateX(${value}px)`,
    translateY: value => `translateY(${value}px)`,
    translate: (x, y) => `translate(${x}px, ${y}px)`,
    scale: value => `scale(${value})`,
    rotate: deg => `rotate(${deg}deg)`,
    opacity: value => Math.max(0, Math.min(1, value)),
  };

  // ============== Browser API Operations (v0.4.0) ==============

  // Storage namespace for app isolation (set by runtime)
  let _storageNamespace = '';

  const asyncOps = {
    // Storage Operations (with namespace isolation)
    'storage.get': async (key, storage = 'local') => {
      const store = storage === 'session' ? sessionStorage : localStorage;
      const prefixedKey = _storageNamespace ? `ddjex:${_storageNamespace}:${key}` : key;
      const value = store.getItem(prefixedKey);
      if (value === null) return null;
      try { return JSON.parse(value); } catch { return value; }
    },

    'storage.set': async (key, value, storage = 'local') => {
      const store = storage === 'session' ? sessionStorage : localStorage;
      const prefixedKey = _storageNamespace ? `ddjex:${_storageNamespace}:${key}` : key;
      try {
        store.setItem(prefixedKey, typeof value === 'string' ? value : JSON.stringify(value));
        return { success: true };
      } catch (e) {
        return { error: true, code: 'STORAGE_ERROR', message: e.message || 'Storage error' };
      }
    },

    'storage.remove': async (key, storage = 'local') => {
      const store = storage === 'session' ? sessionStorage : localStorage;
      const prefixedKey = _storageNamespace ? `ddjex:${_storageNamespace}:${key}` : key;
      store.removeItem(prefixedKey);
      return { success: true };
    },

    'storage.clear': async (storage = 'local') => {
      const store = storage === 'session' ? sessionStorage : localStorage;
      if (_storageNamespace) {
        const prefix = `ddjex:${_storageNamespace}:`;
        const keysToRemove = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith(prefix)) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => store.removeItem(k));
      } else {
        store.clear();
      }
      return { success: true };
    },

    'storage.keys': async (storage = 'local') => {
      const store = storage === 'session' ? sessionStorage : localStorage;
      if (_storageNamespace) {
        const prefix = `ddjex:${_storageNamespace}:`;
        const keys = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length));
        }
        return keys;
      }
      return Object.keys(store);
    },

    'storage.has': async (key, storage = 'local') => {
      const store = storage === 'session' ? sessionStorage : localStorage;
      const prefixedKey = _storageNamespace ? `ddjex:${_storageNamespace}:${key}` : key;
      return store.getItem(prefixedKey) !== null;
    },

    // File Operations
    'file.readText': async (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject({ error: true, code: 'FILE_READ_ERROR', message: reader.error?.message || 'Failed to read file' });
        reader.readAsText(file);
      });
    },

    'file.readDataURL': async (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject({ error: true, code: 'FILE_READ_ERROR', message: reader.error?.message || 'Failed to read file' });
        reader.readAsDataURL(file);
      });
    },

    'file.readArrayBuffer': async (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject({ error: true, code: 'FILE_READ_ERROR', message: reader.error?.message || 'Failed to read file' });
        reader.readAsArrayBuffer(file);
      });
    },

    'file.download': async (content, filename, mimeType = 'text/plain') => {
      const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    },

    'file.downloadBlob': async (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    },

    // Clipboard Operations
    'clipboard.writeText': async (text) => {
      if (!navigator.clipboard) return { error: true, code: 'CLIPBOARD_NOT_AVAILABLE', message: 'Clipboard API not available' };
      try { await navigator.clipboard.writeText(text); return true; }
      catch (e) { return { error: true, code: 'CLIPBOARD_WRITE_FAILED', message: e.message || 'Failed to write' }; }
    },

    'clipboard.readText': async () => {
      if (!navigator.clipboard) return { error: true, code: 'CLIPBOARD_NOT_AVAILABLE', message: 'Clipboard API not available' };
      try { return await navigator.clipboard.readText(); }
      catch (e) { return { error: true, code: 'CLIPBOARD_READ_FAILED', message: e.message || 'Failed to read' }; }
    },

    'clipboard.write': async (data) => {
      if (!navigator.clipboard) return { error: true, code: 'CLIPBOARD_NOT_AVAILABLE', message: 'Clipboard API not available' };
      try {
        const items = [];
        for (const [type, content] of Object.entries(data)) {
          items.push(new ClipboardItem({ [type]: new Blob([content], { type }) }));
        }
        await navigator.clipboard.write(items);
        return true;
      } catch (e) { return { error: true, code: 'CLIPBOARD_WRITE_FAILED', message: e.message || 'Failed to write' }; }
    },

    // Notification Operations
    'notification.permission': async () => {
      return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
    },

    'notification.request': async () => {
      return typeof Notification !== 'undefined' ? Notification.requestPermission() : 'denied';
    },

    'notification.show': async (title, options = {}) => {
      if (typeof Notification === 'undefined') return { error: true, code: 'NOTIFICATIONS_NOT_AVAILABLE', message: 'Notification API not available' };
      if (Notification.permission !== 'granted') return { error: true, code: 'NOTIFICATION_PERMISSION_DENIED', message: 'Permission not granted' };
      try { return { shown: true, notification: new Notification(title, options) }; }
      catch (e) { return { error: true, code: 'NOTIFICATION_FAILED', message: e.message || 'Failed' }; }
    },

    // Geolocation Operations
    'geo.current': async (options = {}) => {
      if (!navigator.geolocation) return { error: true, code: 'GEOLOCATION_NOT_AVAILABLE', message: 'Geolocation API not available' };
      return new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, altitude: pos.coords.altitude, heading: pos.coords.heading, speed: pos.coords.speed, timestamp: pos.timestamp }),
          err => resolve({ error: true, code: 'GEOLOCATION_ERROR', message: err.message }),
          options
        );
      });
    },

    'geo.watch': async (callback, options = {}) => {
      if (!navigator.geolocation) return { error: true, code: 'GEOLOCATION_NOT_AVAILABLE', message: 'Geolocation API not available' };
      return navigator.geolocation.watchPosition(
        pos => callback({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp }),
        err => callback({ error: true, code: 'GEOLOCATION_ERROR', message: err.message }),
        options
      );
    },

    'geo.stop': async (watchId) => {
      if (!navigator.geolocation) return false;
      navigator.geolocation.clearWatch(watchId);
      return true;
    },

    // Fullscreen Operations
    'fullscreen.enter': async (element) => {
      element = element || document.documentElement;
      try {
        if (element.requestFullscreen) await element.requestFullscreen();
        else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
        else if (element.mozRequestFullScreen) await element.mozRequestFullScreen();
        return true;
      } catch (e) { return { error: true, code: 'FULLSCREEN_FAILED', message: e.message || 'Failed' }; }
    },

    'fullscreen.exit': async () => {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) await document.mozCancelFullScreen();
        return true;
      } catch (e) { return { error: true, code: 'FULLSCREEN_EXIT_FAILED', message: e.message || 'Failed' }; }
    },

    'fullscreen.toggle': async (element) => {
      const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
      return isFs ? asyncOps['fullscreen.exit']() : asyncOps['fullscreen.enter'](element);
    },

    'fullscreen.isActive': async () => !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement),

    // Share API
    'share': async (data) => {
      if (!navigator.share) return { error: true, code: 'SHARE_NOT_AVAILABLE', message: 'Share API not available' };
      try { await navigator.share(data); return true; }
      catch (e) { return e.name === 'AbortError' ? { cancelled: true } : { error: true, code: 'SHARE_FAILED', message: e.message || 'Failed' }; }
    },

    'share.canShare': async (data) => navigator.canShare ? navigator.canShare(data) : false,

    // Media Operations
    'media.play': async (element) => {
      if (!element) return { error: true, code: 'NO_ELEMENT', message: 'No media element' };
      try { await element.play(); return true; }
      catch (e) { return { error: true, code: 'MEDIA_PLAY_FAILED', message: e.message || 'Failed' }; }
    },

    'media.pause': async (element) => { if (element) element.pause(); return true; },
    'media.seek': async (element, time) => { if (element) element.currentTime = time; return true; },
    'media.volume': async (element, level) => { if (element) element.volume = Math.max(0, Math.min(1, level)); return true; },
    'media.mute': async (element, muted = true) => { if (element) element.muted = muted; return true; },
    'media.getState': async (element) => element ? { currentTime: element.currentTime, duration: element.duration, paused: element.paused, ended: element.ended, volume: element.volume, muted: element.muted, playbackRate: element.playbackRate } : null,

    // Visibility API
    'visibility.isHidden': async () => document.hidden,
    'visibility.state': async () => document.visibilityState,

    // Fetch operation
    'fetch': async (url, options = {}) => {
      const urlError = validateUrl(url);
      if (urlError) return urlError;

      try {
        const response = await fetch(url, {
          method: options.method || 'GET',
          headers: options.headers || {},
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const data = await response.json();
        return { status: response.status, ok: response.ok, data };
      } catch (e) {
        return { error: true, code: 'FETCH_ERROR', message: e.message || 'Fetch failed' };
      }
    },

    // Timing operations
    'delay': (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    // Navigation operations
    'reload': () => {
      window.location.reload();
      return { success: true };
    },
    'navigate': (url) => {
      const urlError = validateUrl(url);
      if (urlError) return urlError;
      window.location.href = url;
      return { success: true };
    },
  };

  // ============== Animation System ==============

  // Animation presets
  const AnimationPresets = {
    fadeIn: { from: { opacity: 0 }, to: { opacity: 1 }, duration: 300, easing: 'ease-out' },
    fadeOut: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 300, easing: 'ease-in' },
    slideInUp: { from: { opacity: 0, transform: 'translateY(20px)' }, to: { opacity: 1, transform: 'translateY(0)' }, duration: 300, easing: 'ease-out' },
    slideOutDown: { from: { opacity: 1, transform: 'translateY(0)' }, to: { opacity: 0, transform: 'translateY(20px)' }, duration: 300, easing: 'ease-in' },
    scaleIn: { from: { opacity: 0, transform: 'scale(0.9)' }, to: { opacity: 1, transform: 'scale(1)' }, duration: 300, easing: 'ease-out' },
    scaleOut: { from: { opacity: 1, transform: 'scale(1)' }, to: { opacity: 0, transform: 'scale(0.9)' }, duration: 300, easing: 'ease-in' },
    springIn: { from: { opacity: 0, transform: 'scale(0.8)' }, to: { opacity: 1, transform: 'scale(1)' }, spring: { stiffness: 100, damping: 10 } },
  };

  // Get animation config (preset name or custom config)
  function getAnimationConfig(config) {
    if (typeof config === 'string' && AnimationPresets[config]) {
      return AnimationPresets[config];
    }
    return config || {};
  }

  // Parse CSS value into number and unit
  function parseValue(value) {
    if (typeof value === 'number') return { value, unit: '' };
    if (typeof value !== 'string') return { value: 0, unit: '' };
    const match = value.match(/^(-?[\d.]+)(.*)$/);
    if (match) return { value: parseFloat(match[1]), unit: match[2] || '' };
    return { value: 0, unit: '' };
  }

  // Get CSS easing string
  function getEasingString(easing) {
    const easingMap = {
      'linear': 'linear',
      'ease': 'ease',
      'ease-in': 'ease-in',
      'ease-out': 'ease-out',
      'ease-in-out': 'ease-in-out',
      'spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
    };
    return easingMap[easing] || easing;
  }

  // Animate element using Web Animations API
  async function animateElement(element, config, type) {
    const { from, to, keyframes, duration = 300, delay = 0, easing = 'ease', fill = 'forwards', iterations = 1, direction = 'normal' } = config;

    let animationKeyframes;

    if (keyframes && keyframes.length > 0) {
      animationKeyframes = keyframes.map(kf => {
        const frame = { ...kf.style };
        if (kf.offset !== undefined) frame.offset = kf.offset;
        if (kf.easing) frame.easing = getEasingString(kf.easing);
        return frame;
      });
    } else if (type === 'enter' && from && to) {
      animationKeyframes = [from, to];
    } else if (type === 'exit' && from && to) {
      animationKeyframes = [from, to];
    } else if (to) {
      animationKeyframes = [to];
    } else {
      return;
    }

    const options = { duration, delay, easing: getEasingString(easing), fill, iterations, direction };

    try {
      const animation = element.animate(animationKeyframes, options);
      await animation.finished;
    } catch (e) {
      // Fallback for browsers without Web Animations API
      if (to) {
        Object.assign(element.style, to);
      }
    }
  }

  // Spring-based animation
  async function animateSpring(element, to, springConfig = {}) {
    const { stiffness = 100, damping = 10, mass = 1, precision = 0.01 } = springConfig;

    return new Promise(resolve => {
      const properties = Object.keys(to);
      const state = {};

      // Initialize state from current computed styles
      const computed = getComputedStyle(element);
      for (const prop of properties) {
        const fromVal = parseValue(computed[prop] || '0');
        const toVal = parseValue(to[prop]);
        state[prop] = {
          current: fromVal.value,
          target: toVal.value,
          velocity: 0,
          unit: toVal.unit || fromVal.unit || ''
        };
      }

      let lastTime = performance.now();

      const tick = () => {
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        let allDone = true;

        for (const prop of properties) {
          const s = state[prop];
          const displacement = s.current - s.target;
          const springForce = -stiffness * displacement;
          const dampingForce = -damping * s.velocity;
          const acceleration = (springForce + dampingForce) / mass;

          s.velocity += acceleration * dt;
          s.current += s.velocity * dt;

          const done = Math.abs(s.current - s.target) < precision && Math.abs(s.velocity) < precision;
          if (done) {
            s.current = s.target;
            s.velocity = 0;
          } else {
            allDone = false;
          }

          element.style[prop] = `${s.current}${s.unit}`;
        }

        if (allDone) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };

      requestAnimationFrame(tick);
    });
  }

  // ============== Refs Manager ==============

  class RefManager {
    constructor() {
      this.refs = new Map();
    }

    set(id, element) {
      this.refs.set(id, element);
    }

    get(id) {
      return this.refs.get(id);
    }

    clear() {
      this.refs.clear();
    }

    // Ref operations
    focus(id) {
      const el = this.refs.get(id);
      if (el?.focus) el.focus();
    }

    blur(id) {
      const el = this.refs.get(id);
      if (el?.blur) el.blur();
    }

    scrollIntoView(id, options) {
      const el = this.refs.get(id);
      if (el?.scrollIntoView) el.scrollIntoView(options);
    }

    getBoundingRect(id) {
      const el = this.refs.get(id);
      if (!el) return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
    }

    getValue(id) {
      const el = this.refs.get(id);
      return el?.value ?? '';
    }

    setValue(id, value) {
      const el = this.refs.get(id);
      if (el) el.value = value;
    }

    getAttribute(id, attr) {
      const el = this.refs.get(id);
      return el?.getAttribute(attr) ?? null;
    }

    setAttribute(id, attr, value) {
      const el = this.refs.get(id);
      if (el) el.setAttribute(attr, value);
    }

    addClass(id, className) {
      const el = this.refs.get(id);
      if (el?.classList) el.classList.add(className);
    }

    removeClass(id, className) {
      const el = this.refs.get(id);
      if (el?.classList) el.classList.remove(className);
    }

    toggleClass(id, className) {
      const el = this.refs.get(id);
      if (el?.classList) el.classList.toggle(className);
    }
  }

  // ============== Lazy Loading ==============

  const lazyModuleCache = new Map();
  const lazyLoadingPromises = new Map();

  class LazyManager {
    constructor(basePath = '') {
      this.basePath = basePath || window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    }

    resolvePath(src) {
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/')) {
        return src;
      }
      const base = this.basePath.endsWith('/') ? this.basePath : this.basePath + '/';
      return base + src;
    }

    async load(src) {
      const resolvedPath = this.resolvePath(src);

      if (lazyModuleCache.has(resolvedPath)) {
        return lazyModuleCache.get(resolvedPath);
      }

      if (lazyLoadingPromises.has(resolvedPath)) {
        return lazyLoadingPromises.get(resolvedPath);
      }

      const loadPromise = this._fetchAndParse(resolvedPath);
      lazyLoadingPromises.set(resolvedPath, loadPromise);

      try {
        const module = await loadPromise;
        lazyModuleCache.set(resolvedPath, module);
        lazyLoadingPromises.delete(resolvedPath);
        return module;
      } catch (error) {
        lazyLoadingPromises.delete(resolvedPath);
        throw error;
      }
    }

    async _fetchAndParse(url) {
      const response = await fetch(url);
      if (!response.ok) {
        throw { error: true, code: 'LAZY_LOAD_FAILED', message: `Failed to load: ${url}` };
      }
      const text = await response.text();
      const module = JSON.parse(text);
      if (!module.$ddjex) {
        throw { error: true, code: 'INVALID_MODULE', message: `Invalid ddjex module: ${url}` };
      }
      return module;
    }

    preload(src) {
      this.load(src).catch(() => {});
    }

    isLoaded(src) {
      return lazyModuleCache.has(this.resolvePath(src));
    }

    clearCache(src) {
      if (src) {
        lazyModuleCache.delete(this.resolvePath(src));
      } else {
        lazyModuleCache.clear();
      }
    }
  }

  let lazyManagerInstance = null;
  function getLazyManager() {
    if (!lazyManagerInstance) {
      lazyManagerInstance = new LazyManager();
    }
    return lazyManagerInstance;
  }

  async function loadLazyComponent(container, lazyConfig, ctx, runtime) {
    try {
      const lazyManager = getLazyManager();
      const module = await lazyManager.load(lazyConfig.src);

      // Get the component definition
      let componentDef;
      if (lazyConfig.component && module.components && module.components[lazyConfig.component]) {
        componentDef = module.components[lazyConfig.component];
      } else if (module.root) {
        componentDef = { render: module.root };
      } else if (module.components) {
        const firstComponent = Object.keys(module.components)[0];
        if (firstComponent) {
          componentDef = module.components[firstComponent];
        }
      }

      if (!componentDef) {
        throw { error: true, code: 'COMPONENT_NOT_FOUND', message: `Component not found in module` };
      }

      // Initialize module state
      if (module.state) {
        for (const [id, def] of Object.entries(module.state)) {
          if (!ctx.state.values.has(id)) {
            ctx.state.define(id, def.initial);
          }
        }
      }

      // Initialize module computed
      if (module.computed) {
        for (const [id, def] of Object.entries(module.computed)) {
          if (!ctx.state.computed.has(id)) {
            ctx.state.defineComputed(id, def.deps, () => {
              return resolve(def.fn, ctx);
            });
          }
        }
      }

      // Register module actions
      if (module.actions) {
        for (const [id, def] of Object.entries(module.actions)) {
          if (!runtime.actions[id]) {
            runtime.actions[id] = def;
          }
        }
      }

      // Register module components
      if (module.components) {
        if (!runtime.program.components) {
          runtime.program.components = {};
        }
        for (const [id, def] of Object.entries(module.components)) {
          if (!runtime.program.components[id]) {
            runtime.program.components[id] = def;
          }
        }
      }

      // Resolve props
      const props = {};
      if (lazyConfig.props) {
        for (const [key, value] of Object.entries(lazyConfig.props)) {
          props[key] = resolve(value, ctx);
        }
      }

      // Apply defaults
      if (componentDef.props) {
        for (const [key, def] of Object.entries(componentDef.props)) {
          if (!(key in props) && 'default' in def) {
            props[key] = def.default;
          }
        }
      }

      const componentCtx = { ...ctx, scope: { ...ctx.scope, ...props } };

      // Clear and render the loaded component
      container.innerHTML = '';
      container.setAttribute('data-lazy', 'loaded');
      const element = renderNode(componentDef.render, componentCtx, runtime);
      container.appendChild(element);

      // Handle lifecycle hooks
      if (componentDef.onMount) {
        requestAnimationFrame(() => {
          try {
            resolve(componentDef.onMount, componentCtx);
          } catch (e) {
            console.error('Lazy component onMount error:', e);
          }
        });
      }

      if (componentDef.onUnmount) {
        container._ddjexCleanup = () => {
          try {
            resolve(componentDef.onUnmount, componentCtx);
          } catch (e) {
            console.error('Lazy component onUnmount error:', e);
          }
        };
      }
    } catch (error) {
      console.error('Failed to load lazy component:', error);
      container.innerHTML = '';
      container.setAttribute('data-lazy', 'error');

      if (lazyConfig.errorFallback) {
        const errorScope = {
          ...ctx.scope,
          error: { message: error.message || String(error), code: error.code || 'LOAD_ERROR' }
        };
        const errorCtx = { ...ctx, scope: errorScope };
        const errorElement = renderNode(lazyConfig.errorFallback, errorCtx, runtime);
        container.appendChild(errorElement);
      } else {
        container.textContent = 'Failed to load component';
      }
    }
  }

  // ============== Expression Resolver ==============

  function resolve(expr, ctx, depth = 0) {
    // Security: Prevent excessively deep expressions
    if (depth > MAX_EXPRESSION_DEPTH) {
      throw { error: true, code: 'MAX_DEPTH_EXCEEDED', message: `Expression nesting too deep (max ${MAX_EXPRESSION_DEPTH})` };
    }

    if (expr === null || expr === undefined) return expr;
    if (typeof expr !== 'object') return expr;
    if (Array.isArray(expr)) return expr.map(e => resolve(e, ctx, depth + 1));

    // Reference
    if ('ref' in expr) {
      const path = expr.ref.split('.');
      // Check scope first, then scope.__contexts__, then context manager, then state
      let val = ctx.scope[path[0]];
      if (val === undefined && ctx.scope?.__contexts__) {
        val = ctx.scope.__contexts__[path[0]];
      }
      if (val === undefined && ctx.context) {
        val = ctx.context.get(path[0]);
      }
      if (val === undefined) {
        val = ctx.state.get(path[0]);
      }
      for (let i = 1; i < path.length; i++) val = val?.[path[i]];
      return val;
    }

    // Parameter
    if ('param' in expr) {
      return ctx.params?.[expr.param];
    }

    // Context reference
    if ('context' in expr) {
      const path = expr.context.split('.');
      // Check scope.__contexts__ first (for providers)
      let val = ctx.scope?.__contexts__?.[path[0]] ?? ctx.context?.get(path[0]);
      for (let i = 1; i < path.length; i++) val = val?.[path[i]];
      return val;
    }

    // Text node - only if 'text' is the only key (or text + key for keyed lists)
    const exprKeys = Object.keys(expr);
    if ('text' in expr && exprKeys.length === 1) return expr.text;
    if ('text' in expr && exprKeys.length === 2 && 'key' in expr) return expr.text;

    // Bind
    if ('bind' in expr) {
      const path = expr.bind.split('.');
      // Check scope first, then scope.__contexts__, then context manager, then state
      let val = ctx.scope[path[0]];
      if (val === undefined && ctx.scope?.__contexts__) {
        val = ctx.scope.__contexts__[path[0]];
      }
      if (val === undefined && ctx.context) {
        val = ctx.context.get(path[0]);
      }
      if (val === undefined) {
        val = ctx.state.get(path[0]);
      }
      for (let i = 1; i < path.length; i++) val = val?.[path[i]];
      return val;
    }

    // Operation
    if ('op' in expr) {
      const opName = expr.op;
      const args = expr.args || [];

      // Higher-order array operations
      if (['map', 'filter', 'find', 'some', 'every', 'findIndex'].includes(opName)) {
        const arr = resolve(args[0], ctx, depth + 1);
        if (!Array.isArray(arr)) return opName === 'find' ? undefined : [];

        const predicate = args[1];
        const evalItem = (item, index) => {
          const itemCtx = {
            ...ctx,
            scope: { ...ctx.scope, item, index, $item: item, $index: index },
            params: { ...ctx.params, item, index, $item: item, $index: index }
          };
          return resolve(predicate, itemCtx, depth + 1);
        };

        switch (opName) {
          case 'map': return arr.map(evalItem);
          case 'filter': return arr.filter(evalItem);
          case 'find': return arr.find(evalItem);
          case 'findIndex': return arr.findIndex(evalItem);
          case 'some': return arr.some(evalItem);
          case 'every': return arr.every(evalItem);
        }
      }

      // Check for async operations (Browser APIs)
      if (asyncOps[opName]) {
        const resolvedArgs = args.map(a => resolve(a, ctx, depth + 1));
        return asyncOps[opName](...resolvedArgs);
      }

      // Regular operations
      const fn = ops[opName];
      if (!fn) throw new Error(`Unknown op: ${opName}`);
      const resolvedArgs = args.map(a => resolve(a, ctx, depth + 1));
      return fn(...resolvedArgs);
    }

    // Object literal
    const result = {};
    for (const [k, v] of Object.entries(expr)) {
      result[k] = resolve(v, ctx, depth + 1);
    }
    return result;
  }

  // ============== DOM Renderer ==============

  function subscribeToRefs(expr, ctx, callback) {
    const refs = extractRefs(expr);
    refs.forEach(ref => {
      ctx.state.subscribe(ref, callback);
      // Also subscribe to computed that depend on this ref
      for (const [compId, deps] of ctx.state.computedDeps) {
        if (deps.includes(ref)) {
          ctx.state.subscribe(compId, callback);
        }
      }
    });
    // Subscribe to computed refs directly
    for (const [compId] of ctx.state.computedDeps) {
      if (refs.includes(compId)) {
        ctx.state.subscribe(compId, callback);
      }
    }
  }

  function renderNode(node, ctx, runtime) {
    // Null/undefined
    if (node === null || node === undefined) {
      return document.createTextNode('');
    }

    // Primitives
    if (typeof node !== 'object') {
      return document.createTextNode(String(node));
    }

    // Text
    if ('text' in node) {
      return document.createTextNode(node.text);
    }

    // Operation as child - resolve and render as text
    if ('op' in node && !('type' in node) && !('if' in node)) {
      const textNode = document.createTextNode('');
      const update = () => {
        const val = resolve(node, ctx);
        textNode.textContent = val ?? '';
      };
      update();
      subscribeToRefs(node, ctx, update);
      return textNode;
    }

    // Binding
    if ('bind' in node) {
      const textNode = document.createTextNode('');
      const path = node.bind.split('.');

      const update = () => {
        // Check scope first, then scope.__contexts__, then context manager, then state
        let val = ctx.scope[path[0]];
        if (val === undefined && ctx.scope?.__contexts__) {
          val = ctx.scope.__contexts__[path[0]];
        }
        if (val === undefined && ctx.context) {
          val = ctx.context.get(path[0]);
        }
        if (val === undefined) {
          val = ctx.state.get(path[0]);
        }
        for (let i = 1; i < path.length; i++) val = val?.[path[i]];
        textNode.textContent = val ?? '';
      };

      update();

      // Subscribe to changes if it's a state ref (not in scope or context provider)
      const inScope = path[0] in ctx.scope || (ctx.scope?.__contexts__ && path[0] in ctx.scope.__contexts__);
      if (!inScope) {
        ctx.state.subscribe(path[0], update);
        // Also subscribe to computed that might affect this
        for (const [compId, deps] of ctx.state.computedDeps) {
          if (path[0] === compId || deps.includes(path[0])) {
            ctx.state.subscribe(compId, update);
          }
        }
      }

      return textNode;
    }

    // Conditional
    if ('if' in node && 'then' in node) {
      const container = document.createElement('span');
      let current = null;

      const update = () => {
        const cond = resolve(node.if, ctx);
        const template = cond ? node.then : node.else;

        if (current) {
          container.removeChild(current);
          current = null;
        }

        if (template) {
          current = renderNode(template, ctx, runtime);
          container.appendChild(current);
        }
      };

      update();

      // Subscribe to refs in condition
      const refs = extractRefs(node.if);
      refs.forEach(ref => ctx.state.subscribe(ref, update));

      return container;
    }

    // Portal - render children into a different container
    if ('portal' in node) {
      const target = document.querySelector(node.portal.target);
      if (!target) {
        console.warn(`Portal target not found: ${node.portal.target}`);
        return document.createComment(`portal:${node.portal.target}`);
      }

      // Create a marker in the original location
      const marker = document.createComment(`portal:${node.portal.target}`);

      // Render children into the target
      const portalElements = [];
      for (const child of node.portal.children) {
        const childEl = renderNode(child, ctx, runtime);
        target.appendChild(childEl);
        portalElements.push(childEl);
      }

      // Store cleanup function on marker
      marker._ddjexPortalCleanup = () => {
        portalElements.forEach(el => {
          if (el.parentNode === target) {
            target.removeChild(el);
          }
        });
      };

      return marker;
    }

    // Fragment - render multiple children without wrapper
    if ('fragment' in node) {
      const fragment = document.createDocumentFragment();
      for (const child of node.fragment) {
        fragment.appendChild(renderNode(child, ctx, runtime));
      }
      return fragment;
    }

    // Context Provider - provide context value to children
    if ('provide' in node) {
      const { context: contextId, value, children } = node.provide;
      const resolvedValue = resolve(value, ctx);

      // Create new scope with context override
      const providerScope = {
        ...ctx.scope,
        __contexts__: {
          ...(ctx.scope?.__contexts__ || {}),
          [contextId]: resolvedValue
        }
      };

      const providerCtx = { ...ctx, scope: providerScope };

      // Render children with provider context
      const fragment = document.createDocumentFragment();
      for (const child of children) {
        fragment.appendChild(renderNode(child, providerCtx, runtime));
      }
      return fragment;
    }

    // Router Outlet - renders the matched route component
    if ('routerOutlet' in node) {
      const container = document.createElement('div');
      container.setAttribute('data-router-outlet', node.routerOutlet.name || 'default');

      if (!runtime.router) {
        console.warn('Router outlet used without router configuration');
        return container;
      }

      let currentElement = null;

      const renderRoute = () => {
        const route = runtime.router.getRoute();
        if (!route) return;

        // Clear current
        if (currentElement) {
          container.removeChild(currentElement);
          currentElement = null;
        }

        // Handle not found
        if (route.notFound) {
          const notFoundContent = runtime.router.notFound;
          if (notFoundContent) {
            currentElement = renderNode(notFoundContent, ctx, runtime);
          } else {
            currentElement = document.createTextNode('Page not found');
          }
          container.appendChild(currentElement);
          return;
        }

        // Render matched route
        if (route.matched && route.matched.length > 0) {
          const matchedRoute = route.matched[0];
          const routeScope = {
            ...ctx.scope,
            $route: {
              path: route.path,
              params: route.params,
              query: route.query,
              hash: route.hash,
              meta: route.meta
            }
          };
          const routeCtx = { ...ctx, scope: routeScope };

          if (matchedRoute.render) {
            currentElement = renderNode(matchedRoute.render, routeCtx, runtime);
          } else if (matchedRoute.lazy) {
            // Lazy-loaded route component
            currentElement = renderNode({ lazy: matchedRoute.lazy }, routeCtx, runtime);
          } else if (matchedRoute.component && runtime.program.components) {
            const componentDef = runtime.program.components[matchedRoute.component];
            if (componentDef) {
              currentElement = renderNode(componentDef.render, routeCtx, runtime);
            }
          }

          if (currentElement) {
            container.appendChild(currentElement);
          }
        }
      };

      renderRoute();
      runtime.router.subscribe(renderRoute);
      return container;
    }

    // Lazy component - dynamically load and render
    if ('lazy' in node) {
      const container = document.createElement('div');
      container.setAttribute('data-lazy', 'loading');

      // Render fallback
      if (node.lazy.fallback) {
        const fallback = renderNode(node.lazy.fallback, ctx, runtime);
        container.appendChild(fallback);
      } else {
        container.textContent = 'Loading...';
      }

      // Load the module asynchronously
      loadLazyComponent(container, node.lazy, ctx, runtime);

      return container;
    }

    // Transition - enter/exit animations
    if ('transition' in node) {
      const transition = node.transition;
      const container = document.createElement('div');
      container.setAttribute('data-transition', 'container');

      let currentElement = null;
      let currentShow = false;

      const enterConfig = getAnimationConfig(transition.enter || {});
      const exitConfig = getAnimationConfig(transition.exit || {});

      const update = async () => {
        const shouldShow = resolve(transition.show, ctx);

        if (shouldShow === currentShow) return;

        if (shouldShow && !currentShow) {
          // Enter animation
          const fragment = document.createDocumentFragment();
          for (const child of transition.children) {
            fragment.appendChild(renderNode(child, ctx, runtime));
          }

          currentElement = document.createElement('div');
          currentElement.setAttribute('data-transition', 'content');
          currentElement.appendChild(fragment);
          container.appendChild(currentElement);

          // Run enter animation
          if (enterConfig && Object.keys(enterConfig).length > 0) {
            await animateElement(currentElement, enterConfig, 'enter');
          }
        } else if (!shouldShow && currentShow) {
          // Exit animation
          if (currentElement) {
            if (exitConfig && Object.keys(exitConfig).length > 0) {
              await animateElement(currentElement, exitConfig, 'exit');
            }
            if (currentElement.parentNode) {
              currentElement.parentNode.removeChild(currentElement);
            }
            currentElement = null;
          }
        }

        currentShow = shouldShow;
      };

      update();

      // Subscribe to show condition changes
      const refs = extractRefs(transition.show);
      refs.forEach(ref => ctx.state.subscribe(ref, update));

      return container;
    }

    // Animated - value-based animations
    if ('animated' in node) {
      const animated = node.animated;
      const container = document.createElement('div');
      container.setAttribute('data-animated', 'container');

      const config = getAnimationConfig(animated.config || {});
      let lastValue = undefined;

      // Render children
      for (const child of animated.children) {
        container.appendChild(renderNode(child, ctx, runtime));
      }

      const update = async () => {
        const currentValue = resolve(animated.value, ctx);
        if (currentValue === lastValue) return;
        lastValue = currentValue;

        if (animated.style) {
          const styleObj = {};
          const animCtx = { ...ctx, scope: { ...ctx.scope, $value: currentValue } };
          for (const [prop, expr] of Object.entries(animated.style)) {
            styleObj[prop] = resolve(expr, animCtx);
          }

          if (config.spring) {
            await animateSpring(container, styleObj, config.spring);
          } else {
            await animateElement(container, { ...config, to: styleObj }, 'to');
          }
        }
      };

      update();

      const refs = extractRefs(animated.value);
      refs.forEach(ref => ctx.state.subscribe(ref, update));

      return container;
    }

    // TransitionGroup - list enter/exit animations
    if ('transitionGroup' in node) {
      const group = node.transitionGroup;
      const container = document.createElement('div');
      container.setAttribute('data-transition-group', 'container');

      const enterConfig = getAnimationConfig(group.enter || {});
      const exitConfig = getAnimationConfig(group.exit || {});
      const { items: itemsRef, as: itemName, key: keyExpr } = group;
      const elementMap = new Map();
      let lastKeys = [];

      const getKey = (item, index) => {
        if (keyExpr) {
          const itemCtx = { ...ctx, scope: { ...ctx.scope, [itemName]: item, $index: index } };
          return String(resolve(keyExpr, itemCtx));
        }
        return String(index);
      };

      const updateGroup = async () => {
        const items = ctx.state.get(itemsRef) || [];
        const currentKeys = items.map((item, i) => getKey(item, i));

        const addedKeys = currentKeys.filter(k => !lastKeys.includes(k));
        const removedKeys = lastKeys.filter(k => !currentKeys.includes(k));

        // Remove exiting elements
        const exitPromises = [];
        for (const key of removedKeys) {
          const element = elementMap.get(key);
          if (element) {
            if (exitConfig && Object.keys(exitConfig).length > 0) {
              exitPromises.push(
                animateElement(element, exitConfig, 'exit').then(() => {
                  if (element.parentNode) {
                    element.parentNode.removeChild(element);
                  }
                  elementMap.delete(key);
                })
              );
            } else {
              if (element.parentNode) {
                element.parentNode.removeChild(element);
              }
              elementMap.delete(key);
            }
          }
        }

        await Promise.all(exitPromises);

        // Reorder and add new elements
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const key = currentKeys[i];
          const itemCtx = { ...ctx, scope: { ...ctx.scope, [itemName]: item, $index: i } };

          if (addedKeys.includes(key)) {
            const wrapper = document.createElement('div');
            wrapper.setAttribute('data-transition-item', key);

            for (const child of group.children) {
              wrapper.appendChild(renderNode(child, itemCtx, runtime));
            }

            elementMap.set(key, wrapper);
            fragment.appendChild(wrapper);

            if (enterConfig && Object.keys(enterConfig).length > 0) {
              Object.assign(wrapper.style, enterConfig.from || { opacity: '0' });
            }
          } else {
            const element = elementMap.get(key);
            if (element) {
              fragment.appendChild(element);
            }
          }
        }

        container.innerHTML = '';
        container.appendChild(fragment);

        // Run enter animations
        for (const key of addedKeys) {
          const element = elementMap.get(key);
          if (element && enterConfig && Object.keys(enterConfig).length > 0) {
            animateElement(element, enterConfig, 'enter');
          }
        }

        lastKeys = currentKeys;
      };

      updateGroup();
      ctx.state.subscribe(itemsRef, updateGroup);

      return container;
    }

    // Router Link - navigation link with active state
    if ('routerLink' in node) {
      const link = node.routerLink;
      const anchor = document.createElement('a');

      const updateHref = () => {
        const to = resolve(link.to, ctx);
        const resolved = runtime.router.resolve(to);
        anchor.href = resolved.path;
      };

      const updateActiveClass = () => {
        if (!runtime.router) return;
        const to = resolve(link.to, ctx);
        const resolved = runtime.router.resolve(to);
        const isExactActive = runtime.router.isActive(resolved.path, true);
        const isActive = runtime.router.isActive(resolved.path, false);
        const exactActiveClass = link.exactActiveClass || 'exact-active';
        const activeClass = link.activeClass || 'active';
        anchor.classList.toggle(exactActiveClass, isExactActive);
        anchor.classList.toggle(activeClass, isActive && !isExactActive);
      };

      updateHref();
      updateActiveClass();

      // Render children
      for (const child of link.children || []) {
        anchor.appendChild(renderNode(child, ctx, runtime));
      }

      // Handle click
      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        const to = resolve(link.to, ctx);
        runtime.router.navigate(to);
      });

      // Subscribe to route changes
      if (runtime.router) {
        runtime.router.subscribe(updateActiveClass);
      }

      // Subscribe to refs in 'to' for dynamic links
      const refs = extractRefs(link.to);
      refs.forEach(ref => ctx.state.subscribe(ref, () => {
        updateHref();
        updateActiveClass();
      }));

      return anchor;
    }

    // Element
    if ('type' in node) {
      const el = document.createElement(node.type);

      // Capture ref if specified (check both node.ref and node.props.ref)
      const refId = node.ref || (node.props && node.props.ref);
      if (refId && runtime.refs) {
        runtime.refs.set(refId, el);
      }

      // Props (reactive)
      if (node.props) {
        for (const [key, val] of Object.entries(node.props)) {
          const applyProp = () => {
            const resolved = resolve(val, ctx);
            if (key === 'className' || key === 'class') {
              el.className = resolved ?? '';
            } else if (key === 'style' && typeof resolved === 'object') {
              Object.assign(el.style, resolved);
            } else if (key === 'checked') {
              el.checked = !!resolved;
            } else if (key === 'disabled') {
              el.disabled = !!resolved;
            } else if (key === 'selected') {
              el.selected = !!resolved;
            } else if (key === 'value') {
              el.value = resolved ?? '';
            } else if (resolved != null) {
              el.setAttribute(key, resolved);
            } else {
              el.removeAttribute(key);
            }
          };
          applyProp();
          // Subscribe to refs in this prop value
          if (typeof val === 'object' && val !== null) {
            subscribeToRefs(val, ctx, applyProp);
          }
        }
      }

      // Events
      if (node.events) {
        for (const [event, handler] of Object.entries(node.events)) {
          el.addEventListener(event, (e) => {
            // Prevent default for form submit
            if (handler.preventDefault || (event === 'submit')) {
              e.preventDefault();
            }
            // Skip keydown unless Enter
            if (event === 'keydown' && e.key !== 'Enter') return;

            const args = (handler.args || []).map(arg => {
              if (arg?.op === 'eventValue') return e.target.value;
              if (arg?.op === 'eventChecked') return e.target.checked;
              if (arg?.op === 'eventKey') return e.key;
              return resolve(arg, ctx);
            });

            runtime.dispatch(handler.action, ...args);
          });
        }
      }

      // Loop with optional keyed diffing
      if (node.each) {
        const { items: itemsRef, as: itemName, index: indexName, key: keyExpr } = node.each;
        let currentEls = [];
        const elementsByKey = new Map();

        // Get key for an item
        const getKey = (item, index) => {
          if (keyExpr) {
            const itemScope = { ...ctx.scope, [itemName]: item, $index: index };
            if (indexName) itemScope[indexName] = index;
            return String(resolve(keyExpr, { ...ctx, scope: itemScope }));
          }
          return String(index);
        };

        const updateLoop = () => {
          // Resolve itemsRef - can be string state name, dot notation, or expression
          let arr;
          if (typeof itemsRef === 'string' && !itemsRef.includes('.')) {
            arr = ctx.state.get(itemsRef) || [];
          } else {
            const expr = typeof itemsRef === 'string' ? { ref: itemsRef } : itemsRef;
            arr = resolve(expr, ctx) || [];
          }

          // If no key expression, use optimized index-based updates
          if (!keyExpr) {
            const childCount = (node.children || []).length || 1;
            const oldLen = currentEls.length / childCount;
            const newLen = arr.length;

            // Fast path: append-only (array grew, no items removed)
            if (newLen > oldLen) {
              for (let i = oldLen; i < newLen; i++) {
                const item = arr[i];
                const itemScope = { ...ctx.scope, [itemName]: item };
                if (indexName) itemScope[indexName] = i;
                const itemCtx = { ...ctx, scope: itemScope };

                (node.children || []).forEach(child => {
                  const childEl = renderNode(child, itemCtx, runtime);
                  el.appendChild(childEl);
                  currentEls.push(childEl);
                });
              }
              return;
            }

            // Slow path: items removed or replaced - full re-render
            currentEls.forEach(child => {
              if (child.parentNode === el) el.removeChild(child);
            });
            currentEls = [];

            arr.forEach((item, index) => {
              const itemScope = { ...ctx.scope, [itemName]: item };
              if (indexName) itemScope[indexName] = index;
              const itemCtx = { ...ctx, scope: itemScope };

              (node.children || []).forEach(child => {
                const childEl = renderNode(child, itemCtx, runtime);
                el.appendChild(childEl);
                currentEls.push(childEl);
              });
            });
            return;
          }

          // Keyed diffing
          const newKeys = arr.map((item, i) => getKey(item, i));
          const oldKeysList = [...elementsByKey.keys()];

          // FAST PATH: Append-only (most common case for lists)
          // Check if old keys are a prefix of new keys (nothing removed, items added at end)
          const isAppendOnly = oldKeysList.length <= newKeys.length &&
            oldKeysList.every((k, i) => k === newKeys[i]);

          if (isAppendOnly && newKeys.length > oldKeysList.length) {
            // Just append new items - O(n) where n = new items only
            for (let i = oldKeysList.length; i < arr.length; i++) {
              const item = arr[i];
              const key = newKeys[i];
              const itemScope = { ...ctx.scope, [itemName]: item };
              if (indexName) itemScope[indexName] = i;
              const itemCtx = { ...ctx, scope: itemScope };

              const elements = [];
              (node.children || []).forEach(child => {
                const childEl = renderNode(child, itemCtx, runtime);
                el.appendChild(childEl);
                elements.push(childEl);
                currentEls.push(childEl);
              });
              elementsByKey.set(key, elements);
            }
            return;
          }

          // SLOW PATH: Full diff for removals/reordering
          // Remove elements with keys no longer present
          const newKeysSet = new Set(newKeys);
          for (const key of oldKeysList) {
            if (!newKeysSet.has(key)) {
              const elements = elementsByKey.get(key);
              if (elements) {
                for (const elem of elements) {
                  if (elem.parentNode === el) el.removeChild(elem);
                }
                elementsByKey.delete(key);
              }
            }
          }

          // Build new element list in correct order
          const newElementList = [];
          let lastInsertedElement = null;

          arr.forEach((item, index) => {
            const key = newKeys[index];
            const itemScope = { ...ctx.scope, [itemName]: item };
            if (indexName) itemScope[indexName] = index;
            const itemCtx = { ...ctx, scope: itemScope };

            let elements = elementsByKey.get(key);

            if (elements) {
              // Reuse existing elements - move to correct position
              for (const elem of elements) {
                if (lastInsertedElement) {
                  const nextSibling = lastInsertedElement.nextSibling;
                  if (nextSibling !== elem) {
                    el.insertBefore(elem, nextSibling);
                  }
                } else {
                  if (el.firstChild !== elem) {
                    el.insertBefore(elem, el.firstChild);
                  }
                }
                lastInsertedElement = elem;
                newElementList.push(elem);
              }
            } else {
              // Create new elements
              elements = [];
              (node.children || []).forEach(child => {
                const childEl = renderNode(child, itemCtx, runtime);

                if (lastInsertedElement) {
                  const nextSibling = lastInsertedElement.nextSibling;
                  el.insertBefore(childEl, nextSibling);
                } else {
                  el.insertBefore(childEl, el.firstChild);
                }

                lastInsertedElement = childEl;
                elements.push(childEl);
                newElementList.push(childEl);
              });
              elementsByKey.set(key, elements);
            }
          });

          currentEls = newElementList;
        };

        updateLoop();
        // Subscribe to the items ref
        ctx.state.subscribe(itemsRef, updateLoop);
        // If it's a computed, also subscribe to its dependencies
        const deps = ctx.state.computedDeps.get(itemsRef);
        if (deps) {
          deps.forEach(dep => ctx.state.subscribe(dep, updateLoop));
        }

        return el;
      }

      // Children
      if (node.children) {
        node.children.forEach(child => {
          el.appendChild(renderNode(child, ctx, runtime));
        });
      }

      return el;
    }

    return document.createTextNode('');
  }

  function extractRefs(expr) {
    const refs = [];
    const extract = (e) => {
      if (!e || typeof e !== 'object') return;
      if ('ref' in e) refs.push(e.ref.split('.')[0]);
      if ('bind' in e) refs.push(e.bind.split('.')[0]);
      if ('op' in e && e.args) e.args.forEach(extract);
      if (Array.isArray(e)) e.forEach(extract);
      // Also check object values
      if (!Array.isArray(e) && typeof e === 'object') {
        Object.values(e).forEach(extract);
      }
    };
    extract(expr);
    return refs;
  }

  // ============== Runtime ==============

  class Runtime {
    constructor(program) {
      this.program = program;
      this.state = new StateManager();
      this.context = new ContextManager();
      this.router = null;
      this.actions = new Map();
      this.refs = new RefManager();
      this.mountEffects = [];
      this.effectCleanups = new Map();
      this.constraints = new Map();  // stateId -> constraints
      this.invariants = [];
      this.setupRefOps();
    }

    setupRefOps() {
      // Wire ref operations to the refs manager
      const refs = this.refs;
      ops.refFocus = (id) => refs.focus(id);
      ops.refBlur = (id) => refs.blur(id);
      ops.refScrollIntoView = (id, options) => refs.scrollIntoView(id, options);
      ops.refGetBoundingRect = (id) => refs.getBoundingRect(id);
      ops.refGetValue = (id) => refs.getValue(id);
      ops.refSetValue = (id, value) => refs.setValue(id, value);
      ops.refGetAttribute = (id, attr) => refs.getAttribute(id, attr);
      ops.refSetAttribute = (id, attr, value) => refs.setAttribute(id, attr, value);
      ops.refAddClass = (id, className) => refs.addClass(id, className);
      ops.refRemoveClass = (id, className) => refs.removeClass(id, className);
      ops.refToggleClass = (id, className) => refs.toggleClass(id, className);
    }

    init() {
      // Contexts
      if (this.program.contexts) {
        for (const [id, def] of Object.entries(this.program.contexts)) {
          this.context.define(id, def.initial);
        }
      }

      // State
      if (this.program.state) {
        for (const [id, def] of Object.entries(this.program.state)) {
          this.state.define(id, def.initial);
          if (def.constraints) {
            this.constraints.set(id, def.constraints);
          }
        }
      }

      // Invariants
      if (this.program.invariants) {
        this.invariants = this.program.invariants;
      }

      // Computed
      if (this.program.computed) {
        for (const [id, def] of Object.entries(this.program.computed)) {
          const fn = () => resolve(def.fn, { state: this.state, scope: {}, params: {} });
          this.state.defineComputed(id, def.deps, fn);
        }
      }

      // Actions
      if (this.program.actions) {
        for (const [id, def] of Object.entries(this.program.actions)) {
          this.actions.set(id, def);
        }
      }

      // Effects
      if (this.program.effects) {
        for (const effect of this.program.effects) {
          this.initEffect(effect);
        }
      }

      // Router
      if (this.program.router) {
        this.initRouter();
      }

      return this;
    }

    initRouter() {
      const config = this.program.router;
      this.router = new RouterManager({
        mode: config.mode || 'history',
        base: config.base || '/',
        notFound: config.notFound
      });
      this.router.addRoutes(config.routes);

      // Create $route state for reactive bindings
      this.state.define('$route', {
        path: '/',
        params: {},
        query: {},
        hash: '',
        meta: {},
        matched: []
      });

      // Subscribe to route changes
      this.router.subscribe((route) => {
        if (route) {
          this.state.set('$route', {
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

    /**
     * Execute an effect's "do" property - handles both { action: 'X' } and { op: 'X' }
     */
    executeEffectDo(effectDo, ctx) {
      if (!effectDo) return;

      // Handle action dispatch
      if ('action' in effectDo) {
        const args = effectDo.args ? effectDo.args.map(arg => resolve(arg, ctx)) : [];
        this.dispatch(effectDo.action, ...args);
        return;
      }

      // Handle operation
      return resolve(effectDo, ctx);
    }

    initEffect(effect) {
      const trigger = effect.trigger || 'watch';
      const hasAsyncHooks = effect.onStart || effect.onSuccess || effect.onError || effect.cleanup;

      // Interval effect
      if (trigger === 'interval') {
        this.mountEffects.push(() => {
          const intervalId = setInterval(() => {
            this.executeEffectDo(effect.do, { state: this.state, scope: {}, params: {} });
          }, effect.interval);
          this.effectCleanups.set(effect.id, () => clearInterval(intervalId));
        });
        return;
      }

      // Timeout effect
      if (trigger === 'timeout') {
        const startTimeout = () => {
          const cleanup = this.effectCleanups.get(effect.id);
          if (cleanup) cleanup();
          const timeoutId = setTimeout(() => {
            this.executeEffectDo(effect.do, { state: this.state, scope: {}, params: {} });
          }, effect.timeout);
          this.effectCleanups.set(effect.id, () => clearTimeout(timeoutId));
        };
        if (effect.watch) {
          effect.watch.forEach(w => this.state.subscribe(w, startTimeout));
        }
        this.mountEffects.push(startTimeout);
        return;
      }

      // Mount effect (async)
      if (trigger === 'mount') {
        this.mountEffects.push(() => this.runAsyncEffect(effect));
        return;
      }

      // Watch effect
      if (hasAsyncHooks || effect.debounce || effect.throttle) {
        // Async watch effect with debounce/throttle
        let debounceTimer = null;
        let throttleTimer = null;
        let lastThrottleTime = 0;
        let abortController = null;

        const run = () => {
          // Handle debounce
          if (effect.debounce) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              this.runAsyncEffect(effect, abortController);
            }, effect.debounce);
            return;
          }

          // Handle throttle
          if (effect.throttle) {
            const now = Date.now();
            const timeSince = now - lastThrottleTime;
            if (timeSince < effect.throttle) {
              if (!throttleTimer) {
                throttleTimer = setTimeout(() => {
                  throttleTimer = null;
                  lastThrottleTime = Date.now();
                  this.runAsyncEffect(effect, abortController);
                }, effect.throttle - timeSince);
              }
              return;
            }
            lastThrottleTime = now;
          }

          this.runAsyncEffect(effect, abortController);
        };

        if (effect.watch) {
          effect.watch.forEach(w => this.state.subscribe(w, run));
        }
        run(); // Initial run
      } else {
        // Simple sync watch effect
        const run = () => this.executeEffectDo(effect.do, { state: this.state, scope: {}, params: {} });
        run(); // Initial run
        if (effect.watch) {
          effect.watch.forEach(w => this.state.subscribe(w, run));
        }
      }
    }

    async runAsyncEffect(effect) {
      const ctx = { state: this.state, scope: {}, params: {} };

      try {
        // Execute main operation - may return null, value, or promise
        const doResult = this.executeEffectDo(effect.do, ctx);

        // If do returned null/undefined synchronously, treat as no-op - skip all callbacks
        if (doResult === null || doResult === undefined) {
          return;
        }

        // We have actual work to do - call onStart
        if (effect.onStart) {
          this.executeEffectDo(effect.onStart, ctx);
        }

        // Await if it's a promise
        const result = await doResult;

        // onSuccess
        if (effect.onSuccess) {
          this.executeEffectDo(effect.onSuccess, { ...ctx, params: { result } });
        }
      } catch (error) {
        // onError
        if (effect.onError) {
          this.executeEffectDo(effect.onError, { ...ctx, params: { error: { message: error.message, name: error.name } } });
        } else {
          console.error(`Effect ${effect.id} error:`, error);
        }
      }
    }

    dispatch(actionId, ...args) {
      const action = this.actions.get(actionId);
      if (!action) {
        console.error(`Unknown action: ${actionId}`);
        return;
      }

      const params = {};
      (action.params || []).forEach((name, i) => params[name] = args[i]);

      for (const mut of action.mutations) {
        let value = mut.value !== undefined
          ? resolve(mut.value, { state: this.state, scope: {}, params })
          : undefined;

        // Handle map/filter mutations
        if (mut.op === 'map' || mut.op === 'filter') {
          const arr = this.state.get(mut.target);
          const result = arr[mut.op]((item, index) => {
            return resolve(mut.value, { state: this.state, scope: { item, index, $item: item, $index: index }, params: { ...params, item, index, $item: item, $index: index } });
          });
          this.validateAndSet(mut.target, result, actionId);
        } else {
          const current = this.state.get(mut.target);
          let next;
          switch (mut.op) {
            case 'set': next = value; break;
            case 'add': next = current + value; break;
            case 'subtract': next = current - value; break;
            case 'multiply': next = current * value; break;
            case 'divide': next = current / value; break;
            case 'toggle': next = !current; break;
            case 'push': next = [...current, value]; break;
            case 'pop': next = current.slice(0, -1); break;
            case 'shift': next = current.slice(1); break;
            case 'unshift': next = [value, ...current]; break;
            case 'merge': next = { ...current, ...value }; break;
            default: next = value;
          }
          this.validateAndSet(mut.target, next, actionId);
        }
      }
    }

    validateAndSet(stateId, value, actionId) {
      // Check constraints
      const constraints = this.constraints.get(stateId);
      if (constraints) {
        const error = validateConstraints(stateId, value, constraints);
        if (error) {
          error.action = actionId;
          throw error;
        }
      }

      // Set the value
      this.state.set(stateId, value);

      // Check invariants
      for (const inv of this.invariants) {
        const resolver = (expr) => resolve(expr, { state: this.state, scope: {}, params: {} });
        const error = checkInvariant(inv, resolver);
        if (error) {
          if (error.severity === 'warning') {
            console.warn(`Invariant warning: ${error.message}`);
          } else {
            throw error;
          }
        }
      }
    }

    mount(container) {
      const el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el) throw new Error(`Container not found: ${container}`);

      if (this.program.root) {
        const ctx = { state: this.state, context: this.context, router: this.router, scope: {}, params: {} };
        el.innerHTML = '';
        el.appendChild(renderNode(this.program.root, ctx, this));
      }

      // Initialize router after DOM is ready
      if (this.router) {
        this.router.init();
      }

      // Run mount effects
      for (const effect of this.mountEffects) {
        effect();
      }

      return this;
    }

    unmount() {
      // Run all cleanups
      for (const cleanup of this.effectCleanups.values()) {
        cleanup();
      }
      this.effectCleanups.clear();
    }

    getState() {
      return this.state.snapshot();
    }

    /**
     * Hydrate server-rendered HTML
     * Attaches event listeners and reactive bindings to existing DOM
     */
    hydrate(container) {
      const el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el) throw new Error(`Container not found: ${container}`);

      this.container = el;

      // Restore state from window if available
      if (typeof window !== 'undefined' && window.__DDJEX_STATE__) {
        for (const [id, value] of Object.entries(window.__DDJEX_STATE__)) {
          if (this.state.values.has(id)) {
            this.state.set(id, value);
          }
        }
      }

      // Hydrate the existing DOM
      if (this.program.root && el.firstElementChild) {
        const ctx = { state: this.state, context: this.context, router: this.router, scope: {}, params: {} };
        this.hydrateNode(this.program.root, el.firstElementChild, ctx);
      }

      // Initialize router after hydration
      if (this.router) {
        this.router.init();
      }

      // Run mount effects
      for (const effect of this.mountEffects) {
        effect();
      }

      return this;
    }

    hydrateNode(node, element, ctx) {
      if (!element) return;

      // Text node
      if ('text' in node) {
        return;
      }

      // Binding node
      if ('bind' in node) {
        this.hydrateBinding(node, element, ctx);
        return;
      }

      // Conditional node
      if ('if' in node && 'then' in node) {
        this.hydrateConditional(node, element, ctx);
        return;
      }

      // Element node
      if ('type' in node) {
        this.hydrateElement(node, element, ctx);
      }
    }

    hydrateBinding(node, element, ctx) {
      const path = node.bind.split('.');
      const base = path[0];

      // Skip if in scope (loop variable)
      if (base in ctx.scope) return;

      const update = () => {
        let value = ctx.state.get(base);
        for (let i = 1; i < path.length; i++) {
          value = value?.[path[i]];
        }
        element.textContent = String(value ?? '');
      };

      // Subscribe to state changes
      ctx.state.subscribe(base, update);

      // Also subscribe to computed that might affect this
      for (const [compId, deps] of ctx.state.computedDeps) {
        if (base === compId || deps.includes(base)) {
          ctx.state.subscribe(compId, update);
        }
      }
    }

    hydrateElement(node, element, ctx) {
      // Register ref if present
      if (node.props?.ref) {
        this.refs.set(node.props.ref, element);
      }

      // Attach event listeners
      if (node.events) {
        for (const [eventName, handler] of Object.entries(node.events)) {
          element.addEventListener(eventName, (event) => {
            this.handleHydratedEvent(handler, event, ctx);
          });
        }
      }

      // Setup reactive property bindings
      if (node.props) {
        for (const [key, value] of Object.entries(node.props)) {
          if (this.containsRef(value)) {
            this.setupHydratedPropBinding(element, key, value, ctx);
          }
        }
      }

      // Handle loop
      if (node.each) {
        this.hydrateLoop(node, element, ctx);
        return;
      }

      // Hydrate children
      if (node.children) {
        let childIndex = 0;
        for (const child of node.children) {
          let domChild = element.childNodes[childIndex];
          // Skip text nodes when looking for element children
          while (domChild && domChild.nodeType === 3 && 'type' in child) {
            childIndex++;
            domChild = element.childNodes[childIndex];
          }

          // Handle binding nodes - create text node if needed
          if ('bind' in child) {
            if (!domChild || domChild.nodeType !== 3) {
              // Create a text node for the binding
              const textNode = document.createTextNode('');
              if (domChild) {
                element.insertBefore(textNode, domChild);
              } else {
                element.appendChild(textNode);
              }
              domChild = textNode;
            }
            this.hydrateBinding(child, domChild, ctx);
            childIndex++;
            continue;
          }

          if (domChild) {
            this.hydrateNode(child, domChild, ctx);
          }
          childIndex++;
        }
      }
    }

    hydrateLoop(node, element, ctx) {
      const { items: itemsRef, as: itemName, index: indexName } = node.each;
      const items = ctx.state.get(itemsRef) || [];

      // Hydrate existing children
      let childIndex = 0;
      items.forEach((item, index) => {
        const itemScope = { ...ctx.scope, [itemName]: item };
        if (indexName) itemScope[indexName] = index;
        const itemCtx = { ...ctx, scope: itemScope };

        for (const child of node.children || []) {
          const domChild = element.children[childIndex];
          if (domChild) {
            this.hydrateNode(child, domChild, itemCtx);
          }
          childIndex++;
        }
      });

      // Subscribe to array changes for re-render
      ctx.state.subscribe(itemsRef, () => {
        const newItems = ctx.state.get(itemsRef) || [];
        element.innerHTML = '';
        newItems.forEach((item, index) => {
          const itemScope = { ...ctx.scope, [itemName]: item };
          if (indexName) itemScope[indexName] = index;
          const itemCtx = { ...ctx, scope: itemScope };
          for (const child of node.children || []) {
            element.appendChild(renderNode(child, itemCtx, this));
          }
        });
      });
    }

    hydrateConditional(node, element, ctx) {
      let currentElement = element;
      const refs = extractRefs(node.if);

      const update = () => {
        const cond = resolve(node.if, ctx);
        const template = cond ? node.then : node.else;
        const parent = currentElement.parentNode;
        if (parent) {
          const newElement = template ? renderNode(template, ctx, this) : document.createComment('if:false');
          parent.replaceChild(newElement, currentElement);
          currentElement = newElement;
        }
      };

      refs.forEach(ref => ctx.state.subscribe(ref, update));
    }

    handleHydratedEvent(handler, event, ctx) {
      if (handler.preventDefault) event.preventDefault();
      if (handler.stopPropagation) event.stopPropagation();

      if (handler.action) {
        const args = (handler.args || []).map(arg => {
          if (arg && typeof arg === 'object' && 'op' in arg) {
            if (arg.op === 'eventValue') return event.target?.value;
            if (arg.op === 'eventChecked') return event.target?.checked;
            return resolve(arg, ctx);
          }
          return arg;
        });
        this.dispatch(handler.action, ...args);
      } else if ('op' in handler) {
        resolve(handler, { ...ctx, params: { $event: event } });
      }
    }

    containsRef(value) {
      if (!value || typeof value !== 'object') return false;
      if ('ref' in value) return true;
      if ('op' in value && value.args) {
        return value.args.some(arg => this.containsRef(arg));
      }
      return false;
    }

    setupHydratedPropBinding(element, key, value, ctx) {
      const refs = extractRefs(value);
      const update = () => {
        const resolved = resolve(value, ctx);
        if (key === 'className') {
          element.className = resolved || '';
        } else if (key === 'style' && typeof resolved === 'object') {
          Object.assign(element.style, resolved);
        } else if (key.startsWith('data-')) {
          element.setAttribute(key, resolved);
        } else {
          element[key] = resolved;
        }
      };

      refs.forEach(ref => ctx.state.subscribe(ref, update));
    }
  }

  // ============== Self-Testing Framework ==============

  class AssertionError {
    constructor(code, message, path, expected, actual, stepIndex) {
      this.error = true;
      this.code = code;
      this.message = message;
      this.path = path;
      this.expected = expected;
      this.actual = actual;
      this.stepIndex = stepIndex;
    }

    toJSON() {
      return {
        error: true,
        code: this.code,
        message: this.message,
        location: { path: this.path, stepIndex: this.stepIndex },
        expected: this.expected,
        actual: this.actual
      };
    }
  }

  class TestTarget {
    mount(runtime) { return this; }
    unmount(runtime) { return this; }
  }

  class TestRunner {
    constructor(program, options = {}) {
      this.program = program;
      this.options = {
        timeout: options.timeout || 5000,
        verbose: options.verbose || false,
        stopOnFailure: options.stopOnFailure || false,
        filter: options.filter || null,
        ...options
      };
    }

    async run() {
      const tests = this.program.tests || [];
      if (tests.length === 0) {
        return { passed: 0, failed: 0, skipped: 0, total: 0, results: [] };
      }

      let testsToRun = this.options.filter
        ? tests.filter(t => new RegExp(this.options.filter, 'i').test(t.id) || (t.name && new RegExp(this.options.filter, 'i').test(t.name)))
        : tests;

      const onlyTests = testsToRun.filter(t => t.only);
      if (onlyTests.length > 0) testsToRun = onlyTests;

      const results = { passed: 0, failed: 0, skipped: 0, total: tests.length, results: [] };

      for (const test of testsToRun) {
        if (test.skip) {
          results.skipped++;
          results.results.push({ id: test.id, name: test.name || test.id, status: 'skipped', duration: 0 });
          continue;
        }

        const testResult = await this.runTest(test);
        results.results.push(testResult);
        testResult.status === 'passed' ? results.passed++ : results.failed++;
        if (testResult.status === 'failed' && this.options.stopOnFailure) break;
      }

      return results;
    }

    async runTest(test) {
      const startTime = Date.now();
      const result = { id: test.id, name: test.name || test.id, status: 'passed', duration: 0, errors: [], stepResults: [] };

      // Create isolated runtime
      const programCopy = { ...this.program };
      delete programCopy.tests;

      if (test.setup && programCopy.state) {
        programCopy.state = { ...programCopy.state };
        for (const [key, value] of Object.entries(test.setup)) {
          if (programCopy.state[key]) {
            programCopy.state[key] = { ...programCopy.state[key], initial: value };
          }
        }
      }

      const runtime = new Runtime(programCopy);
      runtime.init();

      try {
        await this.withTimeout(this.executeSteps(runtime, test.steps, result), test.timeout || this.options.timeout, test.id);
      } catch (error) {
        result.status = 'failed';
        result.errors.push(error.toJSON ? error.toJSON() : { error: true, code: 'UNEXPECTED_ERROR', message: error.message });
      }

      result.duration = Date.now() - startTime;
      return result;
    }

    async executeSteps(runtime, steps, result) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepResult = { index: i, type: null, passed: true };

        try {
          if ('assert' in step) {
            stepResult.type = 'assert';
            this.executeAssertion(runtime, step.assert, i, step.message);
          } else if ('dispatch' in step) {
            stepResult.type = 'dispatch';
            const args = step.args ? step.args.map(arg => resolve(arg, { state: runtime.state, scope: {}, params: {} })) : [];
            runtime.dispatch(step.dispatch, ...args);
          } else if ('wait' in step) {
            stepResult.type = 'wait';
            await new Promise(r => setTimeout(r, step.wait));
          } else if ('setState' in step) {
            stepResult.type = 'setState';
            for (const [key, value] of Object.entries(step.setState)) {
              const resolved = resolve(value, { state: runtime.state, scope: {}, params: {} });
              runtime.state.set(key, resolved);
            }
          }
        } catch (error) {
          stepResult.passed = false;
          stepResult.error = error.toJSON ? error.toJSON() : { error: true, code: 'STEP_ERROR', message: error.message, stepIndex: i };
          result.status = 'failed';
          result.errors.push(stepResult.error);
          if (this.options.stopOnFailure) break;
        }

        result.stepResults.push(stepResult);
      }
    }

    executeAssertion(runtime, assertion, stepIndex, message) {
      let actual;
      if ('ref' in assertion) {
        actual = runtime.state.get(assertion.ref);
      } else if ('context' in assertion) {
        actual = runtime.context.get(assertion.context);
      } else if ('value' in assertion) {
        actual = resolve(assertion.value, { state: runtime.state, scope: {}, params: {} });
      } else {
        throw new AssertionError('INVALID_ASSERTION', 'Assertion must have ref, context, or value', `$.tests[*].steps[${stepIndex}].assert`, null, null, stepIndex);
      }

      const path = `$.tests[*].steps[${stepIndex}].assert`;

      if ('eq' in assertion) {
        const expected = typeof assertion.eq === 'object' && assertion.eq !== null
          ? resolve(assertion.eq, { state: runtime.state, scope: {}, params: {} })
          : assertion.eq;
        if (actual !== expected) {
          throw new AssertionError('ASSERTION_EQ_FAILED', message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, path, expected, actual, stepIndex);
        }
      }

      if ('neq' in assertion) {
        const notExpected = typeof assertion.neq === 'object' && assertion.neq !== null
          ? resolve(assertion.neq, { state: runtime.state, scope: {}, params: {} })
          : assertion.neq;
        if (actual === notExpected) {
          throw new AssertionError('ASSERTION_NEQ_FAILED', message || `Expected value to not equal ${JSON.stringify(notExpected)}`, path, `not ${JSON.stringify(notExpected)}`, actual, stepIndex);
        }
      }

      if ('gt' in assertion && !(actual > assertion.gt)) {
        throw new AssertionError('ASSERTION_GT_FAILED', message || `Expected ${actual} > ${assertion.gt}`, path, `> ${assertion.gt}`, actual, stepIndex);
      }

      if ('gte' in assertion && !(actual >= assertion.gte)) {
        throw new AssertionError('ASSERTION_GTE_FAILED', message || `Expected ${actual} >= ${assertion.gte}`, path, `>= ${assertion.gte}`, actual, stepIndex);
      }

      if ('lt' in assertion && !(actual < assertion.lt)) {
        throw new AssertionError('ASSERTION_LT_FAILED', message || `Expected ${actual} < ${assertion.lt}`, path, `< ${assertion.lt}`, actual, stepIndex);
      }

      if ('lte' in assertion && !(actual <= assertion.lte)) {
        throw new AssertionError('ASSERTION_LTE_FAILED', message || `Expected ${actual} <= ${assertion.lte}`, path, `<= ${assertion.lte}`, actual, stepIndex);
      }

      if ('contains' in assertion) {
        const expected = typeof assertion.contains === 'object' && assertion.contains !== null
          ? resolve(assertion.contains, { state: runtime.state, scope: {}, params: {} })
          : assertion.contains;
        const contains = Array.isArray(actual) ? actual.includes(expected) : typeof actual === 'string' ? actual.includes(expected) : false;
        if (!contains) {
          throw new AssertionError('ASSERTION_CONTAINS_FAILED', message || `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`, path, `contains ${JSON.stringify(expected)}`, actual, stepIndex);
        }
      }

      if ('length' in assertion) {
        const actualLength = actual?.length ?? 0;
        if (actualLength !== assertion.length) {
          throw new AssertionError('ASSERTION_LENGTH_FAILED', message || `Expected length ${assertion.length}, got ${actualLength}`, path, assertion.length, actualLength, stepIndex);
        }
      }

      if ('matches' in assertion) {
        if (!new RegExp(assertion.matches).test(String(actual))) {
          throw new AssertionError('ASSERTION_MATCHES_FAILED', message || `Expected ${actual} to match ${assertion.matches}`, path, `matches ${assertion.matches}`, actual, stepIndex);
        }
      }

      if ('type' in assertion) {
        const actualType = actual === null ? 'null' : actual === undefined ? 'undefined' : Array.isArray(actual) ? 'array' : typeof actual;
        if (actualType !== assertion.type) {
          throw new AssertionError('ASSERTION_TYPE_FAILED', message || `Expected type ${assertion.type}, got ${actualType}`, path, assertion.type, actualType, stepIndex);
        }
      }

      if ('deepEquals' in assertion) {
        const expected = typeof assertion.deepEquals === 'object' && assertion.deepEquals !== null
          ? resolve(assertion.deepEquals, { state: runtime.state, scope: {}, params: {} })
          : assertion.deepEquals;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new AssertionError('ASSERTION_DEEP_EQUALS_FAILED', message || 'Deep equality failed', path, expected, actual, stepIndex);
        }
      }

      if ('truthy' in assertion && assertion.truthy && !actual) {
        throw new AssertionError('ASSERTION_TRUTHY_FAILED', message || `Expected truthy value, got ${JSON.stringify(actual)}`, path, 'truthy', actual, stepIndex);
      }

      if ('falsy' in assertion && assertion.falsy && actual) {
        throw new AssertionError('ASSERTION_FALSY_FAILED', message || `Expected falsy value, got ${JSON.stringify(actual)}`, path, 'falsy', actual, stepIndex);
      }
    }

    async withTimeout(promise, ms, testId) {
      const timeout = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new AssertionError('TEST_TIMEOUT', `Test ${testId} timed out after ${ms}ms`, '$.tests', `completes within ${ms}ms`, 'timeout', -1));
        }, ms);
      });
      return Promise.race([promise, timeout]);
    }
  }

  async function runTests(program, options = {}) {
    const runner = new TestRunner(program, options);
    return runner.run();
  }

  // ============== Public API ==============

  function run(program, options = {}) {
    // Set storage namespace for app isolation
    _storageNamespace = program.id || '';

    const runtime = new Runtime(program);
    runtime.init();

    if (options.hydrate) {
      runtime.hydrate(options.container || '#app');
    } else {
      runtime.mount(options.container || '#app');
    }

    return runtime;
  }

  function createApp(program) {
    return new Runtime(program).init();
  }

  global.DDJEX = {
    run,
    createApp,
    Runtime,
    StateManager,
    TestRunner,
    runTests,
    AssertionError,
    ConstraintViolationError,
    InvariantViolationError,
    validateConstraints,
    checkInvariant,
    ops,
    resolve,
    version: '0.4.0'
  };

})(typeof window !== 'undefined' ? window : global);
