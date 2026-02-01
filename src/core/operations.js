/**
 * ddjex Operations
 * All available operations for expressions
 */

import { logger } from './logger.js';

// Security: Keys that can be used for prototype pollution attacks
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

// Security: Maximum regex pattern length to prevent ReDoS
const MAX_REGEX_LENGTH = 500;

// Security: Patterns that can cause catastrophic backtracking
const DANGEROUS_REGEX_PATTERNS = /(\+\+|\*\*|\?\?|\{\d+,\d*\}\{)/;

// Security: Maximum string length to prevent memory exhaustion
const MAX_STRING_LENGTH = 1000000; // 1MB of characters

// Security: Dangerous URL protocols that can execute code
const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'file:'];

/**
 * Create a RegExp safely, returning null if the pattern is dangerous
 * @param {string} pattern - The regex pattern
 * @returns {RegExp|null} - The RegExp or null if unsafe
 */
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

/**
 * Validate URL is safe (not javascript:, data:, or other dangerous protocols)
 * @param {string} url - The URL to validate
 * @returns {Object|null} - Error object if invalid, null if valid
 */
function validateUrl(url) {
  if (typeof url !== 'string') {
    return { error: true, code: 'INVALID_URL', message: 'URL must be a string' };
  }
  const normalized = url.trim().toLowerCase();
  for (const protocol of DANGEROUS_PROTOCOLS) {
    if (normalized.startsWith(protocol)) {
      return { error: true, code: 'DANGEROUS_URL', message: `URL protocol '${protocol}' is not allowed` };
    }
  }
  return null;
}

const Operations = {
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
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  abs: (a) => Math.abs(a),
  round: (a) => Math.round(a),
  floor: (a) => Math.floor(a),
  ceil: (a) => Math.ceil(a),
  pow: (a, b) => Math.pow(a, b),

  // Comparison
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  and: (...args) => args.every(Boolean),
  or: (...args) => args.some(Boolean),
  not: (a) => !a,

  // Array
  length: (arr) => arr?.length ?? 0,
  push: (arr, item) => [...arr, item],
  pop: (arr) => arr.slice(0, -1),
  shift: (arr) => arr.slice(1),
  unshift: (arr, item) => [item, ...arr],
  map: (arr, fn) => arr.map(fn),
  filter: (arr, fn) => arr.filter(fn),
  find: (arr, fn) => arr.find(fn),
  findIndex: (arr, fn) => arr.findIndex(fn),
  includes: (arr, item) => arr?.includes(item) ?? false,
  indexOf: (arr, item) => arr?.indexOf(item) ?? -1,
  slice: (arr, start, end) => arr?.slice(start, end) ?? [],
  concat: (...arrs) => [].concat(...arrs.filter(Boolean)),
  reverse: (arr) => arr ? [...arr].reverse() : [],
  sort: (arr, fn) => arr ? [...arr].sort(fn) : [],
  first: (arr) => arr?.[0],
  last: (arr) => arr?.[arr?.length - 1],
  at: (arr, index) => arr?.[index],
  flatten: (arr) => arr.flat(),
  unique: (arr) => [...new Set(arr)],
  forEach: (arr, fn) => arr.forEach(fn),
  reduce: (arr, fn, initial) => arr.reduce(fn, initial),
  some: (arr, fn) => arr.some(fn),
  every: (arr, fn) => arr.every(fn),

  // Object (with prototype pollution protection)
  get: (obj, key) => {
    if (DANGEROUS_KEYS.includes(key)) return undefined;
    return obj?.[key];
  },
  set: (obj, key, value) => {
    if (DANGEROUS_KEYS.includes(key)) return obj;
    return { ...obj, [key]: value };
  },
  keys: (obj) => Object.keys(obj ?? {}),
  values: (obj) => Object.values(obj ?? {}),
  entries: (obj) => Object.entries(obj ?? {}),
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
  pick: (obj, keys) => keys.reduce((acc, k) => {
    if (DANGEROUS_KEYS.includes(k)) return acc;
    return k in obj ? { ...acc, [k]: obj[k] } : acc;
  }, {}),
  omit: (obj, keys) => Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k) && !DANGEROUS_KEYS.includes(k))
  ),
  has: (obj, key) => key in (obj ?? {}),

  // String (with null safety)
  concat: (...strs) => strs.filter(s => s != null).join(''),
  split: (str, sep) => str?.split(sep) ?? [],
  join: (arr, sep) => arr?.join(sep) ?? '',
  trim: (str) => str?.trim() ?? '',
  toUpperCase: (str) => str?.toUpperCase() ?? '',
  toLowerCase: (str) => str?.toLowerCase() ?? '',
  startsWith: (str, prefix) => str?.startsWith(prefix) ?? false,
  endsWith: (str, suffix) => str?.endsWith(suffix) ?? false,
  replace: (str, search, replace) => str?.replace(search, replace) ?? '',
  replaceAll: (str, search, replace) => str?.replaceAll(search, replace) ?? '',
  substring: (str, start, end) => str?.substring(start, end) ?? '',
  padStart: (str, len, char) => {
    if (len > MAX_STRING_LENGTH) {
      return { error: true, code: 'STRING_TOO_LONG', message: `Target length ${len} exceeds max (${MAX_STRING_LENGTH})` };
    }
    return str?.padStart(len, char) ?? '';
  },
  padEnd: (str, len, char) => {
    if (len > MAX_STRING_LENGTH) {
      return { error: true, code: 'STRING_TOO_LONG', message: `Target length ${len} exceeds max (${MAX_STRING_LENGTH})` };
    }
    return str?.padEnd(len, char) ?? '';
  },
  repeat: (str, count) => {
    if (!str) return '';
    const resultLength = str.length * Math.max(0, count);
    if (resultLength > MAX_STRING_LENGTH) {
      return { error: true, code: 'STRING_TOO_LONG', message: `Result would exceed max length (${MAX_STRING_LENGTH})` };
    }
    return str.repeat(Math.max(0, count));
  },
  match: (str, regex) => {
    const re = safeRegex(regex);
    if (!re) return null;
    return str?.match(re) ?? null;
  },
  regex: (pattern) => safeRegex(pattern),

  // Type conversion
  toString: (val) => String(val),
  toNumber: (val) => Number(val),
  toBoolean: (val) => Boolean(val),
  parseInt: (val, radix) => parseInt(val, radix ?? 10),
  parseFloat: (val) => parseFloat(val),
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

  // Control flow
  if: (condition, then, else_) => condition ? then : else_,
  switch: (value, cases, default_) => cases[value] ?? default_,
  pipe: (...fns) => fns.reduce((acc, fn) => fn(acc)),
  identity: (x) => x,
  always: (x) => () => x,

  // Date/Time
  now: () => Date.now(),
  date: (ts) => new Date(ts),
  timestamp: (date) => date?.getTime?.() ?? 0,

  // IO (implemented by targets)
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),

  // Utility
  isNull: (val) => val === null,
  isUndefined: (val) => val === undefined,
  isNullish: (val) => val == null,
  isDefined: (val) => val != null,
  isArray: (val) => Array.isArray(val),
  isObject: (val) => val !== null && typeof val === 'object' && !Array.isArray(val),
  isString: (val) => typeof val === 'string',
  isNumber: (val) => typeof val === 'number',
  isBoolean: (val) => typeof val === 'boolean',
  typeof: (val) => typeof val,
  coalesce: (...vals) => vals.find(v => v != null),
  default: (val, def) => val ?? def,

  // Comparison helpers
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),

  // Math utilities
  random: () => Math.random(),
  randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  clamp: (val, min, max) => Math.min(Math.max(val, min), max),

  // UUID
  uuid: () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,

  // Date formatting
  formatDate: (ts, format) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return format
      .replace('YYYY', d.getFullYear())
      .replace('MM', pad(d.getMonth() + 1))
      .replace('DD', pad(d.getDate()))
      .replace('HH', pad(d.getHours()))
      .replace('mm', pad(d.getMinutes()))
      .replace('ss', pad(d.getSeconds()));
  },
  parseDate: (str) => new Date(str).getTime(),
  dateAdd: (ts, amount, unit) => {
    const d = new Date(ts);
    switch (unit) {
      case 'days': d.setDate(d.getDate() + amount); break;
      case 'hours': d.setHours(d.getHours() + amount); break;
      case 'minutes': d.setMinutes(d.getMinutes() + amount); break;
      case 'seconds': d.setSeconds(d.getSeconds() + amount); break;
      case 'months': d.setMonth(d.getMonth() + amount); break;
      case 'years': d.setFullYear(d.getFullYear() + amount); break;
    }
    return d.getTime();
  },
  dateDiff: (ts1, ts2, unit) => {
    const diff = ts2 - ts1;
    switch (unit) {
      case 'days': return Math.floor(diff / 86400000);
      case 'hours': return Math.floor(diff / 3600000);
      case 'minutes': return Math.floor(diff / 60000);
      case 'seconds': return Math.floor(diff / 1000);
      default: return diff;
    }
  },

  // Form Validation
  isEmail: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  isUrl: (value) => { if (!value) return true; try { new URL(value); return true; } catch { return false; } },
  isNumeric: (value) => !value || !isNaN(Number(value)),
  isInteger: (value) => !value || Number.isInteger(Number(value)),
  isAlpha: (value) => !value || /^[a-zA-Z]+$/.test(value),
  isAlphanumeric: (value) => !value || /^[a-zA-Z0-9]+$/.test(value),
  isEmpty: (value) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0),
  isNotEmpty: (value) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0),
  matchesPattern: (value, pattern) => {
    if (!value) return true;
    const re = safeRegex(pattern);
    if (!re) return false;
    return re.test(value);
  },
  hasMinLength: (value, min) => (value?.length ?? 0) >= min,
  hasMaxLength: (value, max) => (value?.length ?? 0) <= max,
  isInRange: (value, min, max) => value >= min && value <= max,
  areEqual: (a, b) => a === b,

  // Validate field - returns { valid, error }
  validateField: (value, rules) => {
    for (const rule of (Array.isArray(rules) ? rules : [rules])) {
      const type = rule.type || rule;
      const msg = rule.message;

      switch (type) {
        case 'required':
          if (value === null || value === undefined || value === '') {
            return { valid: false, error: msg || 'Required' };
          }
          break;
        case 'email':
          if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return { valid: false, error: msg || 'Invalid email' };
          }
          break;
        case 'minLength':
          if ((value?.length ?? 0) < (rule.value || 0)) {
            return { valid: false, error: msg || `Min length: ${rule.value}` };
          }
          break;
        case 'maxLength':
          if ((value?.length ?? 0) > (rule.value || Infinity)) {
            return { valid: false, error: msg || `Max length: ${rule.value}` };
          }
          break;
        case 'min':
          if (Number(value) < (rule.value ?? -Infinity)) {
            return { valid: false, error: msg || `Min: ${rule.value}` };
          }
          break;
        case 'max':
          if (Number(value) > (rule.value ?? Infinity)) {
            return { valid: false, error: msg || `Max: ${rule.value}` };
          }
          break;
        case 'pattern':
          if (value) {
            const re = safeRegex(rule.value);
            if (!re || !re.test(value)) {
              return { valid: false, error: msg || 'Invalid format' };
            }
          }
          break;
        case 'numeric':
          if (value && isNaN(Number(value))) {
            return { valid: false, error: msg || 'Must be numeric' };
          }
          break;
      }
    }
    return { valid: true, error: null };
  },

  // Check if field is valid
  isFieldValid: (value, rules) => {
    const result = Operations.validateField(value, rules);
    return result.valid;
  },

  // Get field error
  getFieldError: (value, rules) => {
    const result = Operations.validateField(value, rules);
    return result.error;
  },

  // Ref operations (implemented by DOM target - stubs here)
  // These will be overridden by the runtime when refs are available
  refFocus: (refId) => { /* implemented by target */ },
  refBlur: (refId) => { /* implemented by target */ },
  refScrollIntoView: (refId, options) => { /* implemented by target */ },
  refGetBoundingRect: (refId) => { /* implemented by target */ return { x: 0, y: 0, width: 0, height: 0 }; },
  refGetValue: (refId) => { /* implemented by target */ return ''; },
  refSetValue: (refId, value) => { /* implemented by target */ },
  refGetAttribute: (refId, attr) => { /* implemented by target */ return null; },
  refSetAttribute: (refId, attr, value) => { /* implemented by target */ },
  refAddClass: (refId, className) => { /* implemented by target */ },
  refRemoveClass: (refId, className) => { /* implemented by target */ },
  refToggleClass: (refId, className) => { /* implemented by target */ },

  // Animation utilities
  lerp: (start, end, t) => start + (end - start) * t,
  inverseLerp: (start, end, value) => (value - start) / (end - start),
  remap: (value, inStart, inEnd, outStart, outEnd) => {
    const t = (value - inStart) / (inEnd - inStart);
    return outStart + (outEnd - outStart) * t;
  },

  // Easing functions
  easeLinear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOutBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  easeInElastic: (t) => t === 0 ? 0 : t === 1 ? 1
    : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)),
  easeOutElastic: (t) => t === 0 ? 0 : t === 1 ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,

  // Spring physics helpers
  springValue: (current, target, velocity, stiffness = 100, damping = 10, mass = 1, dt = 0.016) => {
    const displacement = current - target;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * velocity;
    const acceleration = (springForce + dampingForce) / mass;
    const newVelocity = velocity + acceleration * dt;
    const newValue = current + newVelocity * dt;
    return { value: newValue, velocity: newVelocity };
  },

  // Animation style helpers
  translateX: (value) => `translateX(${value}px)`,
  translateY: (value) => `translateY(${value}px)`,
  translate: (x, y) => `translate(${x}px, ${y}px)`,
  scale: (value) => `scale(${value})`,
  rotate: (deg) => `rotate(${deg}deg)`,
  opacity: (value) => Math.max(0, Math.min(1, value)),

  // Assertion operations (for self-testing)
  assert: (condition, message) => {
    if (!condition) {
      throw { error: true, code: 'ASSERTION_FAILED', message: message || 'Assertion failed' };
    }
    return true;
  },

  assertEq: (actual, expected, message) => {
    if (actual !== expected) {
      throw {
        error: true,
        code: 'ASSERTION_EQ_FAILED',
        message: message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        expected,
        actual
      };
    }
    return true;
  },

  assertNeq: (actual, notExpected, message) => {
    if (actual === notExpected) {
      throw {
        error: true,
        code: 'ASSERTION_NEQ_FAILED',
        message: message || `Expected value to not equal ${JSON.stringify(notExpected)}`,
        notExpected,
        actual
      };
    }
    return true;
  },

  assertDeepEq: (actual, expected, message) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw {
        error: true,
        code: 'ASSERTION_DEEP_EQ_FAILED',
        message: message || 'Deep equality assertion failed',
        expected,
        actual
      };
    }
    return true;
  },

  assertType: (value, expectedType, message) => {
    const actualType = value === null ? 'null'
      : value === undefined ? 'undefined'
      : Array.isArray(value) ? 'array'
      : typeof value;
    if (actualType !== expectedType) {
      throw {
        error: true,
        code: 'ASSERTION_TYPE_FAILED',
        message: message || `Expected type ${expectedType}, got ${actualType}`,
        expected: expectedType,
        actual: actualType
      };
    }
    return true;
  },

  assertTruthy: (value, message) => {
    if (!value) {
      throw {
        error: true,
        code: 'ASSERTION_TRUTHY_FAILED',
        message: message || `Expected truthy value, got ${JSON.stringify(value)}`,
        actual: value
      };
    }
    return true;
  },

  assertFalsy: (value, message) => {
    if (value) {
      throw {
        error: true,
        code: 'ASSERTION_FALSY_FAILED',
        message: message || `Expected falsy value, got ${JSON.stringify(value)}`,
        actual: value
      };
    }
    return true;
  },

  assertContains: (collection, item, message) => {
    const contains = Array.isArray(collection)
      ? collection.includes(item)
      : typeof collection === 'string'
        ? collection.includes(item)
        : false;
    if (!contains) {
      throw {
        error: true,
        code: 'ASSERTION_CONTAINS_FAILED',
        message: message || `Expected ${JSON.stringify(collection)} to contain ${JSON.stringify(item)}`,
        collection,
        item
      };
    }
    return true;
  },

  assertLength: (value, expectedLength, message) => {
    const actualLength = value?.length ?? 0;
    if (actualLength !== expectedLength) {
      throw {
        error: true,
        code: 'ASSERTION_LENGTH_FAILED',
        message: message || `Expected length ${expectedLength}, got ${actualLength}`,
        expected: expectedLength,
        actual: actualLength
      };
    }
    return true;
  },

  assertMatches: (value, pattern, message) => {
    const regex = safeRegex(pattern);
    if (!regex) {
      throw {
        error: true,
        code: 'INVALID_REGEX_PATTERN',
        message: `Invalid or unsafe regex pattern: ${pattern}`,
        pattern
      };
    }
    if (!regex.test(String(value))) {
      throw {
        error: true,
        code: 'ASSERTION_MATCHES_FAILED',
        message: message || `Expected ${value} to match ${pattern}`,
        pattern,
        actual: value
      };
    }
    return true;
  },

  assertGt: (actual, expected, message) => {
    if (!(actual > expected)) {
      throw {
        error: true,
        code: 'ASSERTION_GT_FAILED',
        message: message || `Expected ${actual} > ${expected}`,
        expected: `> ${expected}`,
        actual
      };
    }
    return true;
  },

  assertGte: (actual, expected, message) => {
    if (!(actual >= expected)) {
      throw {
        error: true,
        code: 'ASSERTION_GTE_FAILED',
        message: message || `Expected ${actual} >= ${expected}`,
        expected: `>= ${expected}`,
        actual
      };
    }
    return true;
  },

  assertLt: (actual, expected, message) => {
    if (!(actual < expected)) {
      throw {
        error: true,
        code: 'ASSERTION_LT_FAILED',
        message: message || `Expected ${actual} < ${expected}`,
        expected: `< ${expected}`,
        actual
      };
    }
    return true;
  },

  assertLte: (actual, expected, message) => {
    if (!(actual <= expected)) {
      throw {
        error: true,
        code: 'ASSERTION_LTE_FAILED',
        message: message || `Expected ${actual} <= ${expected}`,
        expected: `<= ${expected}`,
        actual
      };
    }
    return true;
  },
};

/**
 * Async Operations - return Promises
 * These are handled specially by the runtime
 */
const AsyncOperations = {
  // HTTP
  fetch: async (url, options = {}) => {
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

  fetchText: async (url) => {
    const response = await fetch(url);
    return response.text();
  },

  // Timing
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Navigation (browser only)
  reload: () => {
    if (typeof window === 'undefined') return { error: true, code: 'NOT_AVAILABLE', message: 'Navigation not available' };
    window.location.reload();
    return { success: true };
  },
  navigate: (url) => {
    if (typeof window === 'undefined') return { error: true, code: 'NOT_AVAILABLE', message: 'Navigation not available' };
    const urlError = validateUrl(url);
    if (urlError) return urlError;
    window.location.href = url;
    return { success: true };
  },

  // Parallel execution
  parallel: (...promises) => Promise.all(promises),

  // Race
  race: (...promises) => Promise.race(promises),

  // Timeout wrapper
  timeout: async (promise, ms) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject({ error: true, code: 'TIMEOUT', message: `Operation timed out after ${ms}ms` }), ms)
    );
    return Promise.race([promise, timeoutPromise]);
  },

  // Retry
  retry: async (fn, attempts = 3, delayMs = 1000) => {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        if (i < attempts - 1) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }
    throw lastError;
  },

  // WebSocket operations
  wsConnect: async (id, url, options = {}) => {
    const { getWebSocketManager } = await import('./websocket.js');
    return getWebSocketManager().connect(id, url, options);
  },

  wsSend: async (id, data) => {
    const { getWebSocketManager } = await import('./websocket.js');
    return getWebSocketManager().send(id, data);
  },

  wsDisconnect: async (id) => {
    const { getWebSocketManager } = await import('./websocket.js');
    return getWebSocketManager().disconnect(id);
  },

  wsStatus: async (id) => {
    const { getWebSocketManager } = await import('./websocket.js');
    return getWebSocketManager().status(id);
  },

  // Router operations
  navigate: async (to, options = {}) => {
    const { getRouter } = await import('./router.js');
    const router = getRouter();
    if (router) {
      return router.navigate(to, options);
    }
    logger.warn('Router not configured');
    return false;
  },

  routerBack: async () => {
    const { getRouter } = await import('./router.js');
    const router = getRouter();
    if (router) router.back();
  },

  routerForward: async () => {
    const { getRouter } = await import('./router.js');
    const router = getRouter();
    if (router) router.forward();
  },

  routerGo: async (delta) => {
    const { getRouter } = await import('./router.js');
    const router = getRouter();
    if (router) router.go(delta);
  },

  // Lazy loading operations
  preload: async (src) => {
    const { getLazyManager } = await import('./lazy.js');
    getLazyManager().preload(src);
  },

  lazyLoad: async (src) => {
    const { getLazyManager } = await import('./lazy.js');
    return getLazyManager().load(src);
  },

  isLazyLoaded: async (src) => {
    const { getLazyManager } = await import('./lazy.js');
    return getLazyManager().isLoaded(src);
  },

  // Animation operations
  animate: async (refId, config) => {
    const { getAnimationManager } = await import('./animation.js');
    const manager = getAnimationManager();
    // Note: actual element lookup is done by DOM target
    // This is a placeholder - the DOM target overrides this
    return Promise.resolve();
  },

  animateEnter: async (refId, config) => {
    const { getAnimationManager, getAnimationConfig } = await import('./animation.js');
    // Placeholder - DOM target handles actual animation
    return Promise.resolve();
  },

  animateExit: async (refId, config) => {
    const { getAnimationManager, getAnimationConfig } = await import('./animation.js');
    // Placeholder - DOM target handles actual animation
    return Promise.resolve();
  },

  animateSpring: async (refId, from, to, springConfig) => {
    const { getAnimationManager } = await import('./animation.js');
    // Placeholder - DOM target handles actual animation
    return Promise.resolve();
  },

  cancelAnimation: async (refId) => {
    const { getAnimationManager } = await import('./animation.js');
    const manager = getAnimationManager();
    // Placeholder - DOM target handles actual cancellation
    return Promise.resolve();
  },

  // ============================================
  // Browser API Operations (v0.3.0)
  // ============================================

  // Storage namespace for isolation between apps
  // Set by runtime via setStorageNamespace()
  '_storageNamespace': '',

  // Storage Operations (localStorage/sessionStorage)
  // Keys are prefixed with namespace for isolation
  'storage.get': async (key, storage = 'local') => {
    if (typeof window === 'undefined') return null;
    const store = storage === 'session' ? sessionStorage : localStorage;
    const ns = AsyncOperations['_storageNamespace'];
    const prefixedKey = ns ? `ddjex:${ns}:${key}` : key;
    const value = store.getItem(prefixedKey);
    if (value === null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value; // Return raw string if not JSON
    }
  },

  'storage.set': async (key, value, storage = 'local') => {
    if (typeof window === 'undefined') return { error: true, code: 'NOT_AVAILABLE', message: 'Storage not available' };
    const store = storage === 'session' ? sessionStorage : localStorage;
    const ns = AsyncOperations['_storageNamespace'];
    const prefixedKey = ns ? `ddjex:${ns}:${key}` : key;
    try {
      store.setItem(prefixedKey, typeof value === 'string' ? value : JSON.stringify(value));
      return { success: true };
    } catch (e) {
      return { error: true, code: 'STORAGE_ERROR', message: e.message || 'Storage full or access denied' };
    }
  },

  'storage.remove': async (key, storage = 'local') => {
    if (typeof window === 'undefined') return { error: true, code: 'NOT_AVAILABLE', message: 'Storage not available' };
    const store = storage === 'session' ? sessionStorage : localStorage;
    const ns = AsyncOperations['_storageNamespace'];
    const prefixedKey = ns ? `ddjex:${ns}:${key}` : key;
    store.removeItem(prefixedKey);
    return { success: true };
  },

  'storage.clear': async (storage = 'local') => {
    if (typeof window === 'undefined') return { error: true, code: 'NOT_AVAILABLE', message: 'Storage not available' };
    const store = storage === 'session' ? sessionStorage : localStorage;
    const ns = AsyncOperations['_storageNamespace'];
    if (ns) {
      // Only clear keys with our namespace prefix
      const prefix = `ddjex:${ns}:`;
      const keysToRemove = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(prefix)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => store.removeItem(k));
    } else {
      store.clear();
    }
    return { success: true };
  },

  'storage.keys': async (storage = 'local') => {
    if (typeof window === 'undefined') return [];
    const store = storage === 'session' ? sessionStorage : localStorage;
    const ns = AsyncOperations['_storageNamespace'];
    if (ns) {
      // Only return keys with our namespace prefix, without the prefix
      const prefix = `ddjex:${ns}:`;
      const keys = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(prefix)) {
          keys.push(k.slice(prefix.length));
        }
      }
      return keys;
    }
    return Object.keys(store);
  },

  'storage.has': async (key, storage = 'local') => {
    if (typeof window === 'undefined') return false;
    const store = storage === 'session' ? sessionStorage : localStorage;
    const ns = AsyncOperations['_storageNamespace'];
    const prefixedKey = ns ? `ddjex:${ns}:${key}` : key;
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
    if (typeof window === 'undefined') {
      return { error: true, code: 'NOT_AVAILABLE', message: 'File download not available in this environment' };
    }
    try {
      const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true };
    } catch (e) {
      return { error: true, code: 'DOWNLOAD_FAILED', message: e.message || 'Failed to download file' };
    }
  },

  'file.downloadBlob': async (blob, filename) => {
    if (typeof window === 'undefined') {
      return { error: true, code: 'NOT_AVAILABLE', message: 'File download not available in this environment' };
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true };
    } catch (e) {
      return { error: true, code: 'DOWNLOAD_FAILED', message: e.message || 'Failed to download file' };
    }
  },

  // Clipboard Operations
  'clipboard.writeText': async (text) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return { error: true, code: 'CLIPBOARD_NOT_AVAILABLE', message: 'Clipboard API not available' };
    }
    try {
      await navigator.clipboard.writeText(text);
      return { success: true };
    } catch (e) {
      return { error: true, code: 'CLIPBOARD_WRITE_FAILED', message: e.message || 'Failed to write to clipboard' };
    }
  },

  'clipboard.readText': async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return { error: true, code: 'CLIPBOARD_NOT_AVAILABLE', message: 'Clipboard API not available' };
    }
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      return { error: true, code: 'CLIPBOARD_READ_FAILED', message: e.message || 'Failed to read from clipboard' };
    }
  },

  'clipboard.write': async (data) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return { error: true, code: 'CLIPBOARD_NOT_AVAILABLE', message: 'Clipboard API not available' };
    }
    try {
      const items = [];
      for (const [type, content] of Object.entries(data)) {
        items.push(new ClipboardItem({ [type]: new Blob([content], { type }) }));
      }
      await navigator.clipboard.write(items);
      return { success: true };
    } catch (e) {
      return { error: true, code: 'CLIPBOARD_WRITE_FAILED', message: e.message || 'Failed to write to clipboard' };
    }
  },

  // Notification Operations
  'notification.permission': async () => {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission;
  },

  'notification.request': async () => {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.requestPermission();
  },

  'notification.show': async (title, options = {}) => {
    if (typeof Notification === 'undefined') {
      return { error: true, code: 'NOTIFICATIONS_NOT_AVAILABLE', message: 'Notification API not available' };
    }
    if (Notification.permission !== 'granted') {
      return { error: true, code: 'NOTIFICATION_PERMISSION_DENIED', message: 'Notification permission not granted' };
    }
    try {
      const notification = new Notification(title, options);
      return { success: true, notification };
    } catch (e) {
      return { error: true, code: 'NOTIFICATION_FAILED', message: e.message || 'Failed to show notification' };
    }
  },

  // Geolocation Operations
  'geo.current': async (options = {}) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { error: true, code: 'GEOLOCATION_NOT_AVAILABLE', message: 'Geolocation API not available' };
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp
        }),
        (err) => resolve({ error: true, code: 'GEOLOCATION_ERROR', message: err.message }),
        options
      );
    });
  },

  'geo.watch': async (callback, options = {}) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { error: true, code: 'GEOLOCATION_NOT_AVAILABLE', message: 'Geolocation API not available' };
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => callback({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp
      }),
      (err) => callback({ error: true, code: 'GEOLOCATION_ERROR', message: err.message }),
      options
    );
    return watchId;
  },

  'geo.stop': async (watchId) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { error: true, code: 'GEOLOCATION_NOT_AVAILABLE', message: 'Geolocation not available' };
    }
    navigator.geolocation.clearWatch(watchId);
    return { success: true };
  },

  // Fullscreen Operations
  'fullscreen.enter': async (element) => {
    if (!element && typeof document !== 'undefined') element = document.documentElement;
    if (!element) return { error: true, code: 'NO_ELEMENT', message: 'No element to fullscreen' };
    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
      else if (element.mozRequestFullScreen) await element.mozRequestFullScreen();
      return { success: true };
    } catch (e) {
      return { error: true, code: 'FULLSCREEN_FAILED', message: e.message || 'Failed to enter fullscreen' };
    }
  },

  'fullscreen.exit': async () => {
    if (typeof document === 'undefined') {
      return { error: true, code: 'NOT_AVAILABLE', message: 'Document not available' };
    }
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      else if (document.mozCancelFullScreen) await document.mozCancelFullScreen();
      return { success: true };
    } catch (e) {
      return { error: true, code: 'FULLSCREEN_EXIT_FAILED', message: e.message || 'Failed to exit fullscreen' };
    }
  },

  'fullscreen.toggle': async (element) => {
    if (typeof document === 'undefined') {
      return { error: true, code: 'NOT_AVAILABLE', message: 'Document not available' };
    }
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
    if (isFullscreen) {
      return AsyncOperations['fullscreen.exit']();
    } else {
      return AsyncOperations['fullscreen.enter'](element);
    }
  },

  'fullscreen.isActive': async () => {
    if (typeof document === 'undefined') return false;
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  },

  // Share API (mobile)
  'share': async (data) => {
    if (typeof navigator === 'undefined' || !navigator.share) {
      return { error: true, code: 'SHARE_NOT_AVAILABLE', message: 'Share API not available' };
    }
    try {
      await navigator.share(data);
      return { success: true };
    } catch (e) {
      if (e.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
      return { error: true, code: 'SHARE_FAILED', message: e.message || 'Failed to share' };
    }
  },

  'share.canShare': async (data) => {
    if (typeof navigator === 'undefined' || !navigator.canShare) return false;
    return navigator.canShare(data);
  },

  // Media Operations (audio/video)
  'media.play': async (element) => {
    if (!element) return { error: true, code: 'NO_ELEMENT', message: 'No media element' };
    try {
      await element.play();
      return { success: true };
    } catch (e) {
      return { error: true, code: 'MEDIA_PLAY_FAILED', message: e.message || 'Failed to play media' };
    }
  },

  'media.pause': async (element) => {
    if (!element) return { error: true, code: 'NO_ELEMENT', message: 'No media element' };
    element.pause();
    return { success: true };
  },

  'media.seek': async (element, time) => {
    if (!element) return { error: true, code: 'NO_ELEMENT', message: 'No media element' };
    element.currentTime = time;
    return { success: true };
  },

  'media.volume': async (element, level) => {
    if (!element) return { error: true, code: 'NO_ELEMENT', message: 'No media element' };
    element.volume = Math.max(0, Math.min(1, level));
    return { success: true };
  },

  'media.mute': async (element, muted = true) => {
    if (!element) return { error: true, code: 'NO_ELEMENT', message: 'No media element' };
    element.muted = muted;
    return { success: true };
  },

  'media.getState': async (element) => {
    if (!element) return null;
    return {
      currentTime: element.currentTime,
      duration: element.duration,
      paused: element.paused,
      ended: element.ended,
      volume: element.volume,
      muted: element.muted,
      playbackRate: element.playbackRate
    };
  },

  // Visibility API (for tabs/focus)
  'visibility.isHidden': async () => {
    if (typeof document === 'undefined') return false;
    return document.hidden;
  },

  'visibility.state': async () => {
    if (typeof document === 'undefined') return 'visible';
    return document.visibilityState;
  },

};

// Higher-order operations that need special handling
const HIGHER_ORDER_OPS = ['map', 'filter', 'find', 'some', 'every', 'findIndex'];

// Security: Maximum expression nesting depth to prevent stack overflow
const MAX_EXPRESSION_DEPTH = 100;

function resolveExpression(expr, context, depth = 0) {
  // Security: Prevent excessively deep expressions
  if (depth > MAX_EXPRESSION_DEPTH) {
    throw { error: true, code: 'MAX_DEPTH_EXCEEDED', message: `Expression nesting too deep (max ${MAX_EXPRESSION_DEPTH})` };
  }

  // Literal values
  if (expr === null || typeof expr !== 'object') {
    return expr;
  }

  // Array literal
  if (Array.isArray(expr)) {
    return expr.map(item => resolveExpression(item, context, depth + 1));
  }

  // Reference to state/computed
  if ('ref' in expr) {
    return context.get(expr.ref);
  }

  // Reference to parameter
  if ('param' in expr) {
    return context.params?.[expr.param];
  }

  // Reference to context
  if ('context' in expr) {
    const path = expr.context.split('.');
    let value = context.getContext?.(path[0]);
    for (let i = 1; i < path.length; i++) {
      value = value?.[path[i]];
    }
    return value;
  }

  // Operation
  if ('op' in expr) {
    // Special handling for higher-order array operations
    if (HIGHER_ORDER_OPS.includes(expr.op) && expr.args?.length >= 2) {
      const arr = resolveExpression(expr.args[0], context, depth + 1);
      const predicateExpr = expr.args[1]; // Don't resolve yet - it contains {param: "item"}

      if (!Array.isArray(arr)) {
        return ['find', 'findIndex'].includes(expr.op) ? undefined : [];
      }

      const evalPredicate = (item, index) => {
        const itemContext = {
          get: (id) => id === 'item' ? item : (id === 'index' ? index : context.get(id)),
          params: { ...context.params, item, index }
        };
        return resolveExpression(predicateExpr, itemContext, depth + 1);
      };

      switch (expr.op) {
        case 'map': return arr.map(evalPredicate);
        case 'filter': return arr.filter(evalPredicate);
        case 'find': return arr.find(evalPredicate);
        case 'findIndex': return arr.findIndex(evalPredicate);
        case 'some': return arr.some(evalPredicate);
        case 'every': return arr.every(evalPredicate);
      }
    }

    const op = Operations[expr.op];
    if (!op) {
      throw { error: true, code: 'UNKNOWN_OPERATION', message: `Unknown operation: ${expr.op}` };
    }

    const args = (expr.args || []).map(arg => resolveExpression(arg, context, depth + 1));
    return op(...args);
  }

  // Text node (for DOM)
  if ('text' in expr) {
    return expr.text;
  }

  // Binding node (for DOM)
  if ('bind' in expr) {
    const path = expr.bind.split('.');
    let value = context.get(path[0]);
    for (let i = 1; i < path.length; i++) {
      value = value?.[path[i]];
    }
    return value;
  }

  // Object literal (must check after special cases)
  const result = {};
  for (const [key, value] of Object.entries(expr)) {
    result[key] = resolveExpression(value, context, depth + 1);
  }
  return result;
}

/**
 * Check if an operation is async
 */
function isAsyncOperation(opName) {
  return opName in AsyncOperations;
}

/**
 * Get async operation
 */
function getAsyncOperation(opName) {
  return AsyncOperations[opName];
}

/**
 * Set storage namespace for isolation between apps
 * @param {string} namespace - Program ID or unique namespace
 */
function setStorageNamespace(namespace) {
  AsyncOperations['_storageNamespace'] = namespace || '';
}

export { Operations, AsyncOperations, resolveExpression, isAsyncOperation, getAsyncOperation, safeRegex, validateUrl, setStorageNamespace, MAX_STRING_LENGTH, DANGEROUS_PROTOCOLS };
