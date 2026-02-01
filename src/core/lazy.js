/**
 * ddjex Lazy Loading
 * Handles dynamic loading of components from external files
 */

// Global cache for loaded modules
const moduleCache = new Map();
const loadingPromises = new Map();

/**
 * LazyManager - Handles lazy loading of ddjex modules
 */
class LazyManager {
  constructor(options = {}) {
    this.basePath = options.basePath || '';
    this.fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  }

  /**
   * Resolve a relative path to an absolute URL
   */
  resolvePath(src) {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    if (src.startsWith('/')) {
      return src;
    }
    // Relative path - prepend base path
    const base = this.basePath.endsWith('/') ? this.basePath : this.basePath + '/';
    return base + src;
  }

  /**
   * Load a module from the given source
   * Returns cached version if already loaded
   */
  async load(src) {
    const resolvedPath = this.resolvePath(src);

    // Return cached module
    if (moduleCache.has(resolvedPath)) {
      return moduleCache.get(resolvedPath);
    }

    // Return in-progress loading promise if exists
    if (loadingPromises.has(resolvedPath)) {
      return loadingPromises.get(resolvedPath);
    }

    // Start loading
    const loadPromise = this._fetchAndParse(resolvedPath);
    loadingPromises.set(resolvedPath, loadPromise);

    try {
      const module = await loadPromise;
      moduleCache.set(resolvedPath, module);
      loadingPromises.delete(resolvedPath);
      return module;
    } catch (error) {
      loadingPromises.delete(resolvedPath);
      throw error;
    }
  }

  /**
   * Preload a module without waiting
   */
  preload(src) {
    this.load(src).catch(() => {
      // Silently fail preload - actual load will fail later with proper error handling
    });
  }

  /**
   * Check if a module is already loaded
   */
  isLoaded(src) {
    const resolvedPath = this.resolvePath(src);
    return moduleCache.has(resolvedPath);
  }

  /**
   * Check if a module is currently loading
   */
  isLoading(src) {
    const resolvedPath = this.resolvePath(src);
    return loadingPromises.has(resolvedPath);
  }

  /**
   * Clear the cache for a specific module or all modules
   */
  clearCache(src) {
    if (src) {
      const resolvedPath = this.resolvePath(src);
      moduleCache.delete(resolvedPath);
    } else {
      moduleCache.clear();
    }
  }

  /**
   * Internal: Fetch and parse the module
   */
  async _fetchAndParse(url) {
    if (!this.fetchFn) {
      throw new Error('No fetch function available for lazy loading');
    }

    const response = await this.fetchFn(url);

    if (!response.ok) {
      throw {
        error: true,
        code: 'LAZY_LOAD_FAILED',
        message: `Failed to load module: ${url}`,
        status: response.status,
        statusText: response.statusText
      };
    }

    const text = await response.text();

    try {
      const module = JSON.parse(text);

      // Validate it's an ddjex module
      if (!module.$ddjex) {
        throw {
          error: true,
          code: 'INVALID_MODULE',
          message: `Invalid ddjex module: ${url} - missing $ddjex version`
        };
      }

      return module;
    } catch (e) {
      if (e.code) {
        throw e; // Re-throw ddjex errors
      }
      throw {
        error: true,
        code: 'PARSE_ERROR',
        message: `Failed to parse module: ${url}`,
        cause: e.message
      };
    }
  }

  /**
   * Extract a component from a loaded module
   */
  getComponent(module, componentName) {
    if (!module.components || !module.components[componentName]) {
      // If no component name specified, try to use the root
      if (!componentName && module.root) {
        return { type: 'root', definition: module };
      }
      throw {
        error: true,
        code: 'COMPONENT_NOT_FOUND',
        message: `Component '${componentName}' not found in module '${module.id}'`
      };
    }
    return {
      type: 'component',
      definition: module.components[componentName],
      module: module
    };
  }
}

// Singleton instance
let lazyManagerInstance = null;

/**
 * Get the global LazyManager instance
 */
function getLazyManager() {
  if (!lazyManagerInstance) {
    lazyManagerInstance = new LazyManager();
  }
  return lazyManagerInstance;
}

/**
 * Configure the LazyManager
 */
function configureLazyManager(options) {
  lazyManagerInstance = new LazyManager(options);
  return lazyManagerInstance;
}

/**
 * LazyLoader - Handles the loading state machine for a lazy component
 */
class LazyLoader {
  constructor(config, lazyManager) {
    this.config = config;
    this.lazyManager = lazyManager || getLazyManager();
    this.state = 'idle'; // idle, loading, loaded, error
    this.module = null;
    this.component = null;
    this.error = null;
    this.listeners = new Set();
  }

  /**
   * Get the current state
   */
  getState() {
    return {
      state: this.state,
      module: this.module,
      component: this.component,
      error: this.error
    };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners
   */
  notify() {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  /**
   * Start loading the component
   */
  async load() {
    if (this.state === 'loading') {
      return; // Already loading
    }

    if (this.state === 'loaded') {
      return; // Already loaded
    }

    this.state = 'loading';
    this.notify();

    try {
      this.module = await this.lazyManager.load(this.config.src);

      // Get the component from the module
      const componentName = this.config.component;
      if (componentName) {
        this.component = this.lazyManager.getComponent(this.module, componentName);
      } else {
        // Use the root of the loaded module
        this.component = { type: 'root', definition: this.module };
      }

      this.state = 'loaded';
      this.notify();
    } catch (error) {
      this.error = error;
      this.state = 'error';
      this.notify();
      throw error;
    }
  }

  /**
   * Reset to idle state
   */
  reset() {
    this.state = 'idle';
    this.module = null;
    this.component = null;
    this.error = null;
    this.notify();
  }
}

export {
  LazyManager,
  LazyLoader,
  getLazyManager,
  configureLazyManager
};
