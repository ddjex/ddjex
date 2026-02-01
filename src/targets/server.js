/**
 * ddjex Server Target
 * HTTP server with routing
 */

import { Target } from '../core/runtime.js';

class ServerTarget extends Target {
  constructor(options = {}) {
    super();
    this.port = options.port || 3000;
    this.server = null;
  }

  mount(runtime) {
    this.runtime = runtime;
    this.routes = this.buildRoutes(runtime.program.routes || []);

    // Dynamic import for Node.js http module
    return import('http').then(({ createServer }) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, () => {
        console.log(`ddjex Server running on port ${this.port}`);
      });
      return this;
    });
  }

  unmount(runtime) {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.server = null;
          resolve(this);
        });
      });
    }
    return this;
  }

  buildRoutes(routeDefs) {
    return routeDefs.map(route => ({
      method: route.method,
      pattern: this.parsePattern(route.path),
      params: route.params || [],
      handler: route.handler,
      response: route.response
    }));
  }

  parsePattern(path) {
    const parts = path.split('/').filter(Boolean);
    const pattern = {
      parts: [],
      params: []
    };

    for (const part of parts) {
      if (part.startsWith(':')) {
        pattern.parts.push({ type: 'param', name: part.slice(1) });
        pattern.params.push(part.slice(1));
      } else {
        pattern.parts.push({ type: 'static', value: part });
      }
    }

    return pattern;
  }

  matchRoute(method, path) {
    const pathParts = path.split('/').filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.pattern.parts.length !== pathParts.length) continue;

      const params = {};
      let match = true;

      for (let i = 0; i < route.pattern.parts.length; i++) {
        const part = route.pattern.parts[i];
        if (part.type === 'static') {
          if (part.value !== pathParts[i]) {
            match = false;
            break;
          }
        } else if (part.type === 'param') {
          params[part.name] = pathParts[i];
        }
      }

      if (match) {
        return { route, params };
      }
    }

    return null;
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`);
    const path = url.pathname;
    const method = req.method;

    // Match route
    const match = this.matchRoute(method, path);

    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    const { route, params } = match;

    try {
      // Parse body for POST/PUT/PATCH
      let body = null;
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        body = await this.parseBody(req);
      }

      // Create execution context
      const context = {
        params,
        body,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        locals: {}
      };

      // Execute handler steps
      for (const step of route.handler) {
        await this.executeStep(step, context);
      }

      // Build response
      const response = this.resolveWithContext(route.response, context);
      const status = response.status || 200;
      const responseBody = response.body;

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody) + '\n');

    } catch (error) {
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: true,
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Internal server error'
      }));
    }
  }

  async parseBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch (e) {
          reject({ status: 400, code: 'INVALID_JSON', message: 'Invalid JSON body' });
        }
      });
      req.on('error', reject);
    });
  }

  async executeStep(step, context) {
    const { op, args, as } = step;

    let result;

    switch (op) {
      case 'action':
        const [actionId, ...actionArgs] = args.map(arg => this.resolveExpr(arg, context));
        this.runtime.dispatch(actionId, ...actionArgs);
        break;

      case 'find':
        const [arr, predicate] = args;
        const resolvedArr = this.resolveExpr(arr, context);
        if (Array.isArray(resolvedArr)) {
          result = resolvedArr.find((item, index) =>
            this.resolveExpr(predicate, { ...context, item, index })
          );
        }
        break;

      case 'validate':
        const [data, schema] = args;
        const resolvedData = this.resolveExpr(data, context);
        result = this.validate(resolvedData, schema);
        break;

      default:
        result = this.resolveExpr(step, context);
    }

    if (as) {
      context[as] = result;
      context.locals = context.locals || {};
      context.locals[as] = result;
    }

    return result;
  }

  resolveWithContext(expr, context) {
    // Custom resolver that supports server context (body, params, locals, etc.)
    return this.resolveExpr(expr, context);
  }

  resolveExpr(expr, ctx) {
    if (expr === null || expr === undefined) return expr;
    if (typeof expr !== 'object') return expr;
    if (Array.isArray(expr)) return expr.map(e => this.resolveExpr(e, ctx));

    // Reference to state
    if ('ref' in expr) {
      const name = expr.ref;
      // Check context first (locals like 'user', 'item')
      if (name in ctx) return ctx[name];
      if (ctx.locals && name in ctx.locals) return ctx.locals[name];
      // Then check state
      return this.runtime.stateManager.get(name);
    }

    // Parameter (from URL params or loop context)
    if ('param' in expr) {
      const name = expr.param;
      // Check direct context first (for loop variables like 'item')
      if (name in ctx) return ctx[name];
      // Then URL params
      return ctx.params?.[name];
    }

    // Operation
    if ('op' in expr) {
      return this.executeOp(expr.op, expr.args || [], ctx);
    }

    // Object literal
    const result = {};
    for (const [k, v] of Object.entries(expr)) {
      result[k] = this.resolveExpr(v, ctx);
    }
    return result;
  }

  executeOp(op, args, ctx) {
    // Higher-order ops
    if (['find', 'filter', 'map', 'some', 'every'].includes(op)) {
      const arr = this.resolveExpr(args[0], ctx);
      if (!Array.isArray(arr)) return op === 'find' ? undefined : [];

      const predicate = args[1];
      const evalItem = (item, index) => {
        const itemCtx = { ...ctx, item, index };
        return this.resolveExpr(predicate, itemCtx);
      };

      switch (op) {
        case 'find': return arr.find(evalItem);
        case 'filter': return arr.filter(evalItem);
        case 'map': return arr.map(evalItem);
        case 'some': return arr.some(evalItem);
        case 'every': return arr.every(evalItem);
      }
    }

    const resolvedArgs = args.map(a => this.resolveExpr(a, ctx));

    // Built-in ops
    const ops = {
      // Math
      add: (a, b) => a + b,
      subtract: (a, b) => a - b,
      multiply: (a, b) => a * b,
      divide: (a, b) => a / b,
      modulo: (a, b) => a % b,

      // Compare
      eq: (a, b) => a === b,
      neq: (a, b) => a !== b,
      gt: (a, b) => a > b,
      gte: (a, b) => a >= b,
      lt: (a, b) => a < b,
      lte: (a, b) => a <= b,
      and: (...a) => a.every(Boolean),
      or: (...a) => a.some(Boolean),
      not: (a) => !a,

      // Array
      length: (a) => a?.length ?? 0,
      first: (a) => a?.[0],
      last: (a) => a?.[a.length - 1],
      slice: (a, s, e) => a?.slice(s, e),
      includes: (a, v) => a?.includes(v),
      concat: (...a) => [].concat(...a),

      // Object
      get: (o, k) => o?.[k],
      set: (o, k, v) => ({ ...o, [k]: v }),
      keys: (o) => Object.keys(o ?? {}),
      merge: (...o) => Object.assign({}, ...o),

      // String
      toLowerCase: (s) => s?.toLowerCase(),
      toUpperCase: (s) => s?.toUpperCase(),
      trim: (s) => s?.trim(),
      split: (s, d) => s?.split(d),

      // Type
      parseInt: (v) => parseInt(v, 10),
      toString: (v) => String(v),

      // Control
      if: (c, t, e) => c ? t : e,
      coalesce: (...v) => v.find(x => x != null),

      // Util
      now: () => Date.now(),
      log: (...a) => { console.log(...a); return a[0]; },
    };

    if (ops[op]) {
      return ops[op](...resolvedArgs);
    }

    console.warn(`Unknown op: ${op}`);
    return undefined;
  }

  validate(data, schema) {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data?.[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push({ field, code: 'REQUIRED', message: `${field} is required` });
        continue;
      }

      if (value !== undefined && value !== null) {
        if (rules.type && typeof value !== rules.type) {
          errors.push({ field, code: 'INVALID_TYPE', message: `${field} must be ${rules.type}` });
        }

        if (rules.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push({ field, code: 'INVALID_FORMAT', message: `${field} must be a valid email` });
        }
      }
    }

    if (errors.length > 0) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Validation failed', errors };
    }

    return data;
  }
}

export { ServerTarget };
