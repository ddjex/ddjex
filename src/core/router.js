/**
 * ddjex Router
 * Client-side routing with history API support
 */

// Security: Maximum path length to prevent ReDoS
const MAX_PATH_LENGTH = 500;

// Security: Maximum route parameters to limit complexity
const MAX_PATH_PARAMS = 20;

class RouterManager {
  constructor(config = {}) {
    this.mode = config.mode || 'history';
    this.base = config.base || '/';
    this.routes = [];
    this.currentRoute = null;
    this.subscribers = new Set();
    this.guards = [];
    this.notFound = config.notFound || null;

    // Event listener tracking for cleanup
    this._boundHandleRouteChange = null;
    this._eventType = null;

    // Navigation lock to prevent race conditions
    this._navigating = false;
    this._pendingNavigation = null;

    // Normalize base path
    if (!this.base.startsWith('/')) this.base = '/' + this.base;
    if (!this.base.endsWith('/')) this.base = this.base + '/';
    if (this.base === '//') this.base = '/';
  }

  /**
   * Register routes
   */
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

      // Process nested routes
      if (route.children) {
        this.addRoutes(route.children, fullPath);
      }
    }
  }

  /**
   * Convert path pattern to regex
   */
  pathToRegex(path) {
    // Security: Validate path length to prevent ReDoS
    if (path.length > MAX_PATH_LENGTH) {
      throw { error: true, code: 'PATH_TOO_LONG', message: `Path exceeds max length (${MAX_PATH_LENGTH})` };
    }

    // Security: Limit number of parameters
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

  /**
   * Extract parameter names from path
   */
  extractParamNames(path) {
    const matches = path.match(/:([^/]+)/g) || [];
    return matches.map(m => m.slice(1));
  }

  /**
   * Normalize path
   */
  normalizePath(path) {
    // Remove duplicate slashes
    path = path.replace(/\/+/g, '/');
    // Remove trailing slash (except for root)
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    // Ensure leading slash
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    return path;
  }

  /**
   * Match a path to a route
   */
  match(path) {
    path = this.normalizePath(path);

    for (const route of this.routes) {
      const match = path.match(route.pattern);
      if (match) {
        // Extract params
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

  /**
   * Parse query string
   */
  parseQuery(search) {
    const query = {};
    if (!search || search === '?') return query;

    const params = new URLSearchParams(search);
    for (const [key, value] of params) {
      query[key] = value;
    }
    return query;
  }

  /**
   * Build query string
   */
  buildQuery(query) {
    if (!query || Object.keys(query).length === 0) return '';
    const params = new URLSearchParams(query);
    return '?' + params.toString();
  }

  /**
   * Get current path
   */
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

  /**
   * Navigate to a path
   * Uses a lock to prevent race conditions from rapid navigation calls
   */
  async navigate(to, options = {}) {
    // If already navigating, queue this navigation and abort the current one
    if (this._navigating) {
      this._pendingNavigation = { to, options };
      return false;
    }

    this._navigating = true;

    try {
      return await this._doNavigate(to, options);
    } finally {
      this._navigating = false;

      // Process any pending navigation
      if (this._pendingNavigation) {
        const { to: pendingTo, options: pendingOptions } = this._pendingNavigation;
        this._pendingNavigation = null;
        // Use setTimeout to avoid stack overflow from recursive calls
        setTimeout(() => this.navigate(pendingTo, pendingOptions), 0);
      }
    }
  }

  /**
   * Internal navigation implementation
   */
  async _doNavigate(to, options = {}) {
    let path, query, hash;

    if (typeof to === 'string') {
      // Parse path string
      const [pathPart, queryPart] = to.split('?');
      const [pathOnly, hashPart] = pathPart.split('#');
      path = this.normalizePath(pathOnly);
      query = queryPart ? this.parseQuery('?' + queryPart) : {};
      hash = hashPart || '';
    } else if (typeof to === 'object') {
      // Handle route object
      if (to.name) {
        const route = this.routes.find(r => r.name === to.name);
        if (!route) {
          console.error(`Route not found: ${to.name}`);
          return false;
        }
        path = this.buildPath(route.path, to.params || {});
      } else {
        path = this.normalizePath(to.path || '/');
      }
      query = to.query || {};
      hash = to.hash || '';
    } else {
      return false;
    }

    // Match the route
    const matched = this.match(path);

    if (!matched) {
      // No route found - show not found
      this.currentRoute = {
        path,
        params: {},
        query,
        hash,
        matched: [],
        meta: {},
        notFound: true
      };
      this.notify();
      return true;
    }

    // Handle redirect
    if (matched.route.redirect) {
      return this.navigate(matched.route.redirect, { replace: true });
    }

    // Run guards
    const canNavigate = await this.runGuards(matched);
    if (!canNavigate) {
      return false;
    }

    // Update URL
    const fullPath = path + this.buildQuery(query) + (hash ? '#' + hash : '');

    if (this.mode === 'hash') {
      if (options.replace) {
        window.location.replace('#' + fullPath);
      } else {
        window.location.hash = fullPath;
      }
    } else {
      const url = (this.base === '/' ? '' : this.base.slice(0, -1)) + fullPath;
      if (options.replace) {
        window.history.replaceState({}, '', url);
      } else {
        window.history.pushState({}, '', url);
      }
    }

    // Update current route
    this.currentRoute = {
      ...matched,
      query,
      hash
    };

    this.notify();
    return true;
  }

  /**
   * Build path with params
   */
  buildPath(pattern, params) {
    let path = pattern;
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, encodeURIComponent(value));
    }
    return path;
  }

  /**
   * Run route guards
   */
  async runGuards(to) {
    const from = this.currentRoute;

    // Global guards
    for (const guard of this.guards) {
      const result = await guard(to, from);
      if (result === false) return false;
      if (typeof result === 'string') {
        this.navigate(result, { replace: true });
        return false;
      }
    }

    // Route-specific guard
    if (to.route.guard) {
      // Guard is an expression that should return true/false/path
      // Will be resolved by the runtime
      return true; // Handled at render time
    }

    return true;
  }

  /**
   * Add a global guard
   */
  beforeEach(guard) {
    this.guards.push(guard);
    return () => {
      const index = this.guards.indexOf(guard);
      if (index > -1) this.guards.splice(index, 1);
    };
  }

  /**
   * Go back in history
   */
  back() {
    window.history.back();
  }

  /**
   * Go forward in history
   */
  forward() {
    window.history.forward();
  }

  /**
   * Go to specific history position
   */
  go(delta) {
    window.history.go(delta);
  }

  /**
   * Subscribe to route changes
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Notify subscribers of route change
   */
  notify() {
    for (const callback of this.subscribers) {
      callback(this.currentRoute);
    }
  }

  /**
   * Initialize router and start listening
   */
  async init() {
    // Handle initial route
    const path = this.getCurrentPath();
    const matched = this.match(path);

    if (matched) {
      if (matched.route.redirect) {
        this.navigate(matched.route.redirect, { replace: true });
        return;
      }

      // Security: Run guards on initial load
      const canNavigate = await this.runGuards(matched);
      if (!canNavigate) {
        // Guards prevented navigation - set not found or handle appropriately
        this.currentRoute = {
          path,
          params: {},
          query: this.parseQuery(window.location.search),
          hash: window.location.hash.slice(1),
          matched: [],
          meta: {},
          guardBlocked: true
        };
      } else {
        this.currentRoute = {
          ...matched,
          query: this.parseQuery(window.location.search),
          hash: window.location.hash.slice(1)
        };
      }
    } else {
      this.currentRoute = {
        path,
        params: {},
        query: this.parseQuery(window.location.search),
        hash: window.location.hash.slice(1),
        matched: [],
        meta: {},
        notFound: true
      };
    }

    // Listen for history changes
    this._boundHandleRouteChange = () => this.handleRouteChange();
    if (this.mode === 'hash') {
      this._eventType = 'hashchange';
      window.addEventListener('hashchange', this._boundHandleRouteChange);
    } else {
      this._eventType = 'popstate';
      window.addEventListener('popstate', this._boundHandleRouteChange);
    }

    this.notify();
  }

  /**
   * Handle route change from browser navigation
   */
  handleRouteChange() {
    const path = this.getCurrentPath();
    const matched = this.match(path);

    if (matched) {
      if (matched.route.redirect) {
        this.navigate(matched.route.redirect, { replace: true });
        return;
      }
      this.currentRoute = {
        ...matched,
        query: this.parseQuery(window.location.search),
        hash: window.location.hash.slice(1)
      };
    } else {
      this.currentRoute = {
        path,
        params: {},
        query: this.parseQuery(window.location.search),
        hash: window.location.hash.slice(1),
        matched: [],
        meta: {},
        notFound: true
      };
    }

    this.notify();
  }

  /**
   * Check if path matches current route
   */
  isActive(path, exact = false) {
    if (!this.currentRoute) return false;

    const normalizedPath = this.normalizePath(path);
    const currentPath = this.currentRoute.path;

    if (exact) {
      return currentPath === normalizedPath;
    }

    // Special case: root path '/' only matches exactly or if followed by nothing
    if (normalizedPath === '/') {
      return currentPath === '/';
    }

    // For non-root paths, check if current starts with the path
    // and the next character is either end of string or '/'
    if (currentPath.startsWith(normalizedPath)) {
      const nextChar = currentPath[normalizedPath.length];
      return nextChar === undefined || nextChar === '/';
    }

    return false;
  }

  /**
   * Get current route info
   */
  getRoute() {
    return this.currentRoute;
  }

  /**
   * Clean up router and remove event listeners
   */
  destroy() {
    // Remove event listener
    if (this._boundHandleRouteChange && this._eventType) {
      window.removeEventListener(this._eventType, this._boundHandleRouteChange);
    }
    this._boundHandleRouteChange = null;
    this._eventType = null;

    // Clear all state
    this.subscribers.clear();
    this.guards = [];
    this.routes = [];
    this.currentRoute = null;

    // Clear singleton instance
    routerInstance = null;
  }

  /**
   * Resolve a route by name
   */
  resolve(to) {
    if (typeof to === 'string') {
      return { path: this.normalizePath(to) };
    }

    if (to.name) {
      const route = this.routes.find(r => r.name === to.name);
      if (route) {
        return {
          path: this.buildPath(route.path, to.params || {}),
          route
        };
      }
    }

    return { path: this.normalizePath(to.path || '/') };
  }
}

// Singleton instance
let routerInstance = null;

function createRouter(config) {
  routerInstance = new RouterManager(config);
  return routerInstance;
}

function getRouter() {
  return routerInstance;
}

export { RouterManager, createRouter, getRouter };
