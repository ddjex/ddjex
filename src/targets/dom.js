/**
 * ddjex DOM Target
 * Fine-grained DOM updates without virtual DOM
 */

import { Target } from '../core/runtime.js';
import { getAnimationManager, getAnimationConfig } from '../core/animation.js';

class DOMTarget extends Target {
  constructor(container) {
    super();
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    this.bindings = new Map();
    this.eventListeners = new Map();
    this.subscriptions = new WeakMap(); // Track subscriptions per element for cleanup
    this.isHydrating = false;
    this.animationManager = getAnimationManager();
  }

  /**
   * Track a subscription for an element so it can be cleaned up later
   * @param {Element} element - The DOM element
   * @param {Object} state - The state/computed node
   * @param {Object} subscriber - The subscriber object { run, dependencies }
   */
  trackSubscription(element, state, subscriber) {
    if (!this.subscriptions.has(element)) {
      this.subscriptions.set(element, []);
    }
    this.subscriptions.get(element).push({ state, subscriber });
  }

  /**
   * Clean up all subscriptions for an element and its children
   */
  cleanupSubscriptions(element) {
    // Clean up this element's subscriptions
    const subs = this.subscriptions.get(element);
    if (subs) {
      for (const { state, subscriber } of subs) {
        if (state && typeof state.unsubscribe === 'function') {
          state.unsubscribe(subscriber);
        }
      }
      this.subscriptions.delete(element);
    }

    // Recursively clean up children
    if (element.children) {
      for (const child of element.children) {
        this.cleanupSubscriptions(child);
      }
    }
  }

  /**
   * Resolve items from itemsRef - handles string state names, dot notation, and expressions
   */
  resolveItems(itemsRef, scope = {}) {
    if (typeof itemsRef === 'string' && !itemsRef.includes('.')) {
      // Simple state name
      return this.runtime.stateManager.get(itemsRef) || [];
    }
    // Dot notation or expression - use runtime resolver
    const expr = typeof itemsRef === 'string' ? { ref: itemsRef } : itemsRef;
    return this.runtime.resolve(expr, { scope }) || [];
  }

  mount(runtime) {
    this.runtime = runtime;
    const rootNode = runtime.program.root;
    if (rootNode) {
      const element = this.renderNode(rootNode, {});
      this.container.appendChild(element);
    }
    return this;
  }

  /**
   * Hydrate server-rendered HTML
   * Attaches event listeners and reactive bindings to existing DOM
   */
  hydrate(runtime) {
    this.runtime = runtime;
    this.isHydrating = true;

    // Restore state from window if available
    if (typeof window !== 'undefined' && window.__DDJEX_STATE__) {
      for (const [id, value] of Object.entries(window.__DDJEX_STATE__)) {
        if (runtime.stateManager.states.has(id)) {
          runtime.stateManager.set(id, value);
        }
      }
    }

    const rootNode = runtime.program.root;
    if (rootNode && this.container.firstElementChild) {
      this.hydrateNode(rootNode, this.container.firstElementChild, {});
    }

    this.isHydrating = false;
    return this;
  }

  hydrateNode(node, element, scope) {
    if (!element) return;

    // Binding node - setup reactive binding
    if ('bind' in node) {
      this.hydrateBinding(node, element, scope);
      return;
    }

    // Conditional node
    if ('if' in node && 'then' in node) {
      this.hydrateConditional(node, element, scope);
      return;
    }

    // Component reference
    if ('component' in node) {
      this.hydrateComponent(node, element, scope);
      return;
    }

    // Element node
    if ('type' in node) {
      this.hydrateElement(node, element, scope);
    }
  }

  hydrateBinding(node, element, scope) {
    const path = node.bind.split('.');
    const base = path[0];

    if (!(base in scope)) {
      const state = this.runtime.stateManager.states.get(base) ||
                    this.runtime.stateManager.computed.get(base);
      if (state) {
        const update = () => {
          let value = this.runtime.stateManager.get(base);
          for (let i = 1; i < path.length; i++) {
            value = value?.[path[i]];
          }
          element.textContent = String(value ?? '');
        };
        state.subscribe({ run: update, dependencies: new Set() });
      }
    }
  }

  hydrateElement(node, element, scope) {
    // Attach event listeners
    if (node.events) {
      const listeners = {};
      for (const [eventName, handler] of Object.entries(node.events)) {
        const listener = (event) => this.handleEvent(handler, event, scope);
        element.addEventListener(eventName, listener);
        listeners[eventName] = listener;
      }
      this.eventListeners.set(element, listeners);
    }

    // Setup reactive property bindings
    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        if (this.containsRef(value)) {
          this.setupPropertyBinding(element, key, value, scope);
        }
      }
    }

    // Handle loop
    if (node.each) {
      this.hydrateLoop(node, element, scope);
      return;
    }

    // Hydrate children
    if (node.children) {
      let childIndex = 0;
      for (const child of node.children) {
        // Skip text nodes in DOM for element children
        let domChild = element.childNodes[childIndex];
        while (domChild && domChild.nodeType === 3 && 'type' in child) {
          childIndex++;
          domChild = element.childNodes[childIndex];
        }
        if (domChild) {
          this.hydrateNode(child, domChild, scope);
        }
        childIndex++;
      }
    }
  }

  hydrateLoop(node, element, scope) {
    const { items: itemsRef, as: itemName, index: indexName } = node.each;
    const items = this.resolveItems(itemsRef, scope) || [];

    let childIndex = 0;
    items.forEach((item, index) => {
      const itemScope = { ...scope, [itemName]: item };
      if (indexName) itemScope[indexName] = index;

      for (const child of node.children || []) {
        const domChild = element.children[childIndex];
        if (domChild) {
          this.hydrateNode(child, domChild, itemScope);
        }
        childIndex++;
      }
    });

    // Subscribe to array changes for re-render
    const state = this.runtime.stateManager.states.get(itemsRef);
    if (state) {
      state.subscribe({
        run: () => {
          // On change, re-render the loop (hydration complete, use normal rendering)
          const items = this.resolveItems(itemsRef, scope) || [];
          element.innerHTML = '';
          items.forEach((item, index) => {
            const itemScope = { ...scope, [itemName]: item };
            if (indexName) itemScope[indexName] = index;
            for (const child of node.children || []) {
              element.appendChild(this.renderNode(child, itemScope));
            }
          });
        },
        dependencies: new Set()
      });
    }
  }

  hydrateConditional(node, element, scope) {
    // Setup reactive conditional
    const refs = this.extractRefs(node.if);
    for (const ref of refs) {
      const state = this.runtime.stateManager.states.get(ref) ||
                    this.runtime.stateManager.computed.get(ref);
      if (state) {
        state.subscribe({
          run: () => {
            const condition = this.runtime.resolve(node.if);
            const template = condition ? node.then : node.else;
            const parent = element.parentNode;
            if (parent) {
              const newElement = template ? this.renderNode(template, scope) : document.createComment('if:false');
              parent.replaceChild(newElement, element);
              element = newElement;
            }
          },
          dependencies: new Set()
        });
      }
    }
  }

  hydrateComponent(node, element, scope) {
    const componentDef = this.runtime.components.get(node.component);
    if (!componentDef) return;

    const props = {};
    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        props[key] = this.runtime.resolve(value, scope);
      }
    }
    if (componentDef.props) {
      for (const [key, def] of Object.entries(componentDef.props)) {
        if (!(key in props) && 'default' in def) {
          props[key] = def.default;
        }
      }
    }

    this.hydrateNode(componentDef.render, element, { ...scope, ...props });
  }

  unmount(runtime) {
    // Call cleanup functions for components with onUnmount
    this.callCleanupFunctions(this.container);

    // Clean up all subscriptions
    this.cleanupSubscriptions(this.container);

    // Remove all event listeners
    for (const [element, listeners] of this.eventListeners) {
      for (const [event, handler] of Object.entries(listeners)) {
        element.removeEventListener(event, handler);
      }
    }
    this.eventListeners.clear();
    this.bindings.clear();
    this.container.innerHTML = '';
    return this;
  }

  callCleanupFunctions(element) {
    // Recursively call cleanup functions
    if (element._ddjexCleanup) {
      element._ddjexCleanup();
    }
    if (element.children) {
      for (const child of element.children) {
        this.callCleanupFunctions(child);
      }
    }
  }

  renderNode(node, scope) {
    // Text node
    if ('text' in node) {
      return document.createTextNode(node.text);
    }

    // Binding node
    if ('bind' in node) {
      return this.createBinding(node, scope);
    }

    // Conditional node
    if ('if' in node && 'then' in node) {
      return this.createConditional(node, scope);
    }

    // Error boundary node
    if ('errorBoundary' in node) {
      return this.createErrorBoundary(node.errorBoundary, scope);
    }

    // Component reference
    if ('component' in node) {
      return this.renderComponent(node, scope);
    }

    // Context provider
    if ('provide' in node) {
      return this.createContextProvider(node.provide, scope);
    }

    // Router outlet
    if ('routerOutlet' in node) {
      return this.createRouterOutlet(node.routerOutlet, scope);
    }

    // Router link
    if ('routerLink' in node) {
      return this.createRouterLink(node.routerLink, scope);
    }

    // Portal node
    if ('portal' in node) {
      return this.createPortal(node.portal, scope);
    }

    // Fragment node
    if ('fragment' in node) {
      return this.createFragment(node.fragment, scope);
    }

    // Lazy component node
    if ('lazy' in node) {
      return this.createLazyComponent(node.lazy, scope);
    }

    // Transition node (enter/exit animations)
    if ('transition' in node) {
      return this.createTransition(node.transition, scope);
    }

    // Animated node (value-based animations)
    if ('animated' in node) {
      return this.createAnimated(node.animated, scope);
    }

    // Transition group node (list animations)
    if ('transitionGroup' in node) {
      return this.createTransitionGroup(node.transitionGroup, scope);
    }

    // Element node
    if ('type' in node) {
      return this.createElement(node, scope);
    }

    throw { error: true, code: 'INVALID_NODE', message: 'Unknown node type', node };
  }

  createRouterOutlet(outlet, scope) {
    const container = document.createElement('div');
    container.setAttribute('data-router-outlet', outlet.name || 'default');

    if (!this.runtime.router) {
      console.warn('Router outlet used without router configuration');
      return container;
    }

    let currentElement = null;

    const render = () => {
      const route = this.runtime.router.getRoute();
      if (!route) return;

      // Clear current content
      if (currentElement) {
        container.removeChild(currentElement);
        currentElement = null;
      }

      // Handle not found
      if (route.notFound) {
        const notFoundContent = this.runtime.router.notFound;
        if (notFoundContent) {
          currentElement = this.renderNode(notFoundContent, scope);
        } else {
          currentElement = document.createTextNode('Page not found');
        }
        container.appendChild(currentElement);
        return;
      }

      // Find route to render
      if (route.matched && route.matched.length > 0) {
        const matchedRoute = route.matched[0];

        // Create scope with route params
        const routeScope = {
          ...scope,
          $route: {
            path: route.path,
            params: route.params,
            query: route.query,
            hash: route.hash,
            meta: route.meta
          }
        };

        if (matchedRoute.render) {
          currentElement = this.renderNode(matchedRoute.render, routeScope);
        } else if (matchedRoute.lazy) {
          // Lazy-loaded route component
          const lazyNode = { lazy: matchedRoute.lazy };
          currentElement = this.renderNode(lazyNode, routeScope);
        } else if (matchedRoute.component) {
          const componentNode = { component: matchedRoute.component };
          currentElement = this.renderComponent(componentNode, routeScope);
        }

        if (currentElement) {
          container.appendChild(currentElement);
        }
      }
    };

    // Initial render
    render();

    // Subscribe to route changes
    this.runtime.router.subscribe(render);

    return container;
  }

  createRouterLink(link, scope) {
    const anchor = document.createElement('a');

    const updateHref = () => {
      const to = this.runtime.resolve(link.to, scope);
      const resolved = this.runtime.router.resolve(to);
      anchor.href = resolved.path;
    };

    const updateActiveClass = () => {
      if (!this.runtime.router) return;

      const to = this.runtime.resolve(link.to, scope);
      const resolved = this.runtime.router.resolve(to);
      const isExactActive = this.runtime.router.isActive(resolved.path, true);
      const isActive = this.runtime.router.isActive(resolved.path, false);

      const exactActiveClass = link.exactActiveClass || 'exact-active';
      const activeClass = link.activeClass || 'active';

      anchor.classList.toggle(exactActiveClass, isExactActive);
      anchor.classList.toggle(activeClass, isActive && !isExactActive);
    };

    updateHref();
    updateActiveClass();

    // Render children
    for (const child of link.children || []) {
      anchor.appendChild(this.renderNode(child, scope));
    }

    // Handle click
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const to = this.runtime.resolve(link.to, scope);
      this.runtime.router.navigate(to);
    });

    // Subscribe to route changes for active state
    if (this.runtime.router) {
      this.runtime.router.subscribe(updateActiveClass);
    }

    // Subscribe to refs in 'to' for dynamic links
    const refs = this.extractRefs(link.to);
    for (const ref of refs) {
      const state = this.runtime.stateManager.states.get(ref) ||
                    this.runtime.stateManager.computed.get(ref);
      if (state) {
        state.subscribe({
          run: () => {
            updateHref();
            updateActiveClass();
          },
          dependencies: new Set()
        });
      }
    }

    return anchor;
  }

  createContextProvider(provider, scope) {
    const { context: contextId, value, children } = provider;
    const resolvedValue = this.runtime.resolve(value, scope);

    // Create new scope with context override
    const providerScope = {
      ...scope,
      __contexts__: {
        ...(scope.__contexts__ || {}),
        [contextId]: resolvedValue
      }
    };

    // Create container
    const container = document.createDocumentFragment();

    // Render children with provider scope
    for (const child of children) {
      container.appendChild(this.renderNode(child, providerScope));
    }

    return container;
  }

  createElement(node, scope) {
    const element = document.createElement(node.type);

    // Props
    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        this.setProperty(element, key, value, scope);
      }
    }

    // Events
    if (node.events) {
      const listeners = {};
      for (const [eventName, handler] of Object.entries(node.events)) {
        const listener = (event) => this.handleEvent(handler, event, scope);
        element.addEventListener(eventName, listener);
        listeners[eventName] = listener;
      }
      this.eventListeners.set(element, listeners);
    }

    // Conditional rendering
    if (node.if) {
      const condition = this.runtime.resolve(node.if);
      if (!condition) {
        const placeholder = document.createComment('if:false');
        this.setupConditionalBinding(placeholder, node, scope);
        return placeholder;
      }
    }

    // Loop rendering
    if (node.each) {
      return this.createLoop(element, node, scope);
    }

    // Children
    if (node.children) {
      for (const child of node.children) {
        const childElement = this.renderNode(child, scope);
        element.appendChild(childElement);
      }
    }

    return element;
  }

  setProperty(element, key, value, scope) {
    const resolved = this.runtime.resolve(value);

    if (key === 'className') {
      element.className = resolved;
    } else if (key === 'style' && typeof resolved === 'object') {
      Object.assign(element.style, resolved);
    } else if (key.startsWith('data-')) {
      element.setAttribute(key, resolved);
    } else if (key === 'checked' || key === 'disabled' || key === 'selected') {
      element[key] = resolved;
    } else if (key === 'value') {
      element.value = resolved;
    } else {
      element.setAttribute(key, resolved);
    }

    // Setup reactive binding if value contains refs
    if (this.containsRef(value)) {
      this.setupPropertyBinding(element, key, value, scope);
    }
  }

  containsRef(expr) {
    if (!expr || typeof expr !== 'object') return false;
    if ('ref' in expr) return true;
    if ('op' in expr && expr.args) {
      return expr.args.some(arg => this.containsRef(arg));
    }
    return false;
  }

  setupPropertyBinding(element, key, value, scope) {
    // Extract refs and subscribe to them
    const refs = this.extractRefs(value);
    for (const ref of refs) {
      const state = this.runtime.stateManager.states.get(ref) ||
                    this.runtime.stateManager.computed.get(ref);
      if (state) {
        state.subscribe({
          run: () => this.setProperty(element, key, value, scope),
          dependencies: new Set()
        });
      }
    }
  }

  extractRefs(expr) {
    const refs = [];
    const extract = (e) => {
      if (!e || typeof e !== 'object') return;
      if ('ref' in e) refs.push(e.ref);
      if ('op' in e && e.args) e.args.forEach(extract);
    };
    extract(expr);
    return refs;
  }

  createBinding(node, scope) {
    const path = node.bind.split('.');
    const textNode = document.createTextNode('');

    const update = () => {
      let value;
      // Check scope first (includes component props and loop variables)
      if (path[0] in scope) {
        value = scope[path[0]];
        for (let i = 1; i < path.length; i++) {
          value = value?.[path[i]];
        }
      }
      // Check context providers in scope
      else if (scope.__contexts__ && path[0] in scope.__contexts__) {
        value = scope.__contexts__[path[0]];
        for (let i = 1; i < path.length; i++) {
          value = value?.[path[i]];
        }
      }
      // Check context manager (global contexts)
      else if (this.runtime.contextManager.contexts.has(path[0])) {
        value = this.runtime.contextManager.get(path[0]);
        for (let i = 1; i < path.length; i++) {
          value = value?.[path[i]];
        }
      }
      // Check state manager
      else {
        value = this.runtime.stateManager.get(path[0]);
        for (let i = 1; i < path.length; i++) {
          value = value?.[path[i]];
        }
      }

      if (node.format) {
        value = this.runtime.resolve(node.format, { value });
      }

      textNode.textContent = String(value ?? '');
    };

    // Initial render
    update();

    // Subscribe to changes if it's a state reference
    if (!(path[0] in scope) && !(scope.__contexts__ && path[0] in scope.__contexts__)) {
      const state = this.runtime.stateManager.states.get(path[0]) ||
                    this.runtime.stateManager.computed.get(path[0]);
      if (state) {
        state.subscribe({
          run: update,
          dependencies: new Set()
        });
      }

      // Subscribe to context changes
      const context = this.runtime.contextManager.contexts.get(path[0]);
      if (context) {
        context.subscribe({
          run: update,
          dependencies: new Set()
        });
      }
    }

    return textNode;
  }

  createConditional(node, scope) {
    const container = document.createDocumentFragment();
    const startMarker = document.createComment('if:start');
    const endMarker = document.createComment('if:end');

    container.appendChild(startMarker);
    container.appendChild(endMarker);

    let currentElement = null;

    const update = () => {
      const condition = this.runtime.resolve(node.if);
      const template = condition ? node.then : node.else;

      // Remove current element and clean up its subscriptions
      if (currentElement && currentElement.parentNode) {
        this.cleanupSubscriptions(currentElement);
        currentElement.parentNode.removeChild(currentElement);
      }

      // Render new element
      if (template) {
        currentElement = this.renderNode(template, scope);
        endMarker.parentNode.insertBefore(currentElement, endMarker);
      } else {
        currentElement = null;
      }
    };

    // Initial render
    update();

    // Subscribe to refs in condition
    const refs = this.extractRefs(node.if);
    for (const ref of refs) {
      const state = this.runtime.stateManager.states.get(ref) ||
                    this.runtime.stateManager.computed.get(ref);
      if (state) {
        const subscriber = { run: update, dependencies: new Set() };
        state.subscribe(subscriber);
        this.trackSubscription(startMarker, state, subscriber);
      }
    }

    return container;
  }

  createErrorBoundary(boundary, scope) {
    const container = document.createElement('div');
    container.setAttribute('data-error-boundary', boundary.id || 'anonymous');

    let hasError = false;
    let errorInfo = null;

    const renderContent = () => {
      container.innerHTML = '';

      if (hasError) {
        // Render fallback
        try {
          const fallbackScope = { ...scope, error: errorInfo };
          const fallbackElement = this.renderNode(boundary.fallback, fallbackScope);
          container.appendChild(fallbackElement);
        } catch (fallbackError) {
          // If fallback also fails, show minimal error
          container.textContent = 'Error rendering fallback';
          console.error('Error boundary fallback failed:', fallbackError);
        }
      } else {
        // Render children
        try {
          for (const child of boundary.children) {
            const element = this.renderNode(child, scope);
            container.appendChild(element);
          }
        } catch (error) {
          hasError = true;
          errorInfo = {
            message: error.message || String(error),
            code: error.code || 'RENDER_ERROR'
          };

          // Execute onError if provided
          if (boundary.onError) {
            try {
              this.runtime.resolve(boundary.onError, { error: errorInfo });
            } catch (e) {
              console.error('Error boundary onError failed:', e);
            }
          }

          // Re-render with fallback
          renderContent();
        }
      }
    };

    renderContent();
    return container;
  }

  createLoop(containerTemplate, node, scope) {
    const container = document.createElement(containerTemplate.type);

    // Copy props from template
    if (containerTemplate.props) {
      for (const [key, value] of Object.entries(containerTemplate.props)) {
        this.setProperty(container, key, value, scope);
      }
    }

    const { items: itemsRef, as: itemName, index: indexName, key: keyExpr } = node.each;

    // Track elements by key for efficient diffing
    const elementsByKey = new Map();
    let currentElements = [];

    // Get key for an item
    const getKey = (item, index) => {
      if (keyExpr) {
        const itemScope = { ...scope, [itemName]: item, $index: index };
        if (indexName) itemScope[indexName] = index;
        return String(this.runtime.resolve(keyExpr, itemScope));
      }
      // Fallback to index if no key expression
      return String(index);
    };

    const update = () => {
      const items = this.resolveItems(itemsRef, scope) || [];

      // If no key expression, use simple re-render (original behavior)
      if (!keyExpr) {
        for (const el of currentElements) {
          container.removeChild(el);
        }
        currentElements = [];

        items.forEach((item, index) => {
          const itemScope = { ...scope, [itemName]: item };
          if (indexName) itemScope[indexName] = index;

          for (const child of node.children) {
            const element = this.renderNode(child, itemScope);
            container.appendChild(element);
            currentElements.push(element);
          }
        });
        return;
      }

      // Keyed diffing algorithm
      const newKeys = items.map((item, i) => getKey(item, i));
      const oldKeys = [...elementsByKey.keys()];

      // Find keys to remove
      const keysToRemove = oldKeys.filter(k => !newKeys.includes(k));
      for (const key of keysToRemove) {
        const elements = elementsByKey.get(key);
        if (elements) {
          for (const el of elements) {
            // Clean up subscriptions before removing
            this.cleanupSubscriptions(el);
            if (el.parentNode === container) {
              container.removeChild(el);
            }
          }
          elementsByKey.delete(key);
        }
      }

      // Build new element list in correct order
      const newElementList = [];
      let lastInsertedElement = null;

      items.forEach((item, index) => {
        const key = newKeys[index];
        const itemScope = { ...scope, [itemName]: item };
        if (indexName) itemScope[indexName] = index;

        let elements = elementsByKey.get(key);

        if (elements) {
          // Reuse existing elements - move them to correct position
          for (const el of elements) {
            if (lastInsertedElement) {
              // Insert after last element
              const nextSibling = lastInsertedElement.nextSibling;
              if (nextSibling !== el) {
                container.insertBefore(el, nextSibling);
              }
            } else {
              // Insert at beginning
              if (container.firstChild !== el) {
                container.insertBefore(el, container.firstChild);
              }
            }
            lastInsertedElement = el;
            newElementList.push(el);
          }
        } else {
          // Create new elements
          elements = [];
          for (const child of node.children) {
            const element = this.renderNode(child, itemScope);

            if (lastInsertedElement) {
              const nextSibling = lastInsertedElement.nextSibling;
              container.insertBefore(element, nextSibling);
            } else {
              container.insertBefore(element, container.firstChild);
            }

            lastInsertedElement = element;
            elements.push(element);
            newElementList.push(element);
          }
          elementsByKey.set(key, elements);
        }
      });

      currentElements = newElementList;
    };

    // Initial render
    update();

    // Subscribe to array changes
    const state = this.runtime.stateManager.states.get(itemsRef);
    if (state) {
      const subscriber = { run: update, dependencies: new Set() };
      state.subscribe(subscriber);
      this.trackSubscription(container, state, subscriber);
    }

    return container;
  }

  handleEvent(handler, event, scope) {
    if (handler.action) {
      const args = (handler.args || []).map(arg => {
        // Special handling for event values
        if (arg && typeof arg === 'object' && arg.op === 'eventValue') {
          return event.target.value;
        }
        if (arg && typeof arg === 'object' && arg.op === 'eventKey') {
          return event.key;
        }
        return this.runtime.resolve(arg, scope);
      });

      // For keyboard events, only trigger on Enter by default
      if (event.type === 'keydown' && event.key !== 'Enter') {
        return;
      }

      this.runtime.dispatch(handler.action, ...args);
    }
  }

  renderComponent(node, scope) {
    const componentDef = this.runtime.components.get(node.component);
    if (!componentDef) {
      throw { error: true, code: 'COMPONENT_UNDEFINED', message: `Component '${node.component}' is not defined` };
    }

    // Resolve props
    const props = {};
    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        props[key] = this.runtime.resolve(value, scope);
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

    const componentScope = { ...scope, ...props };

    // Render component with props in scope
    const element = this.renderNode(componentDef.render, componentScope);

    // Execute onMount lifecycle hook
    if (componentDef.onMount) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        try {
          this.runtime.resolve(componentDef.onMount, componentScope);
        } catch (e) {
          console.error(`Component ${node.component} onMount error:`, e);
        }
      });
    }

    // Setup onUnmount cleanup
    if (componentDef.onUnmount) {
      // Store cleanup function on element
      element._ddjexCleanup = () => {
        try {
          this.runtime.resolve(componentDef.onUnmount, componentScope);
        } catch (e) {
          console.error(`Component ${node.component} onUnmount error:`, e);
        }
      };
    }

    // Setup onUpdate - subscribe to props dependencies
    if (componentDef.onUpdate) {
      const propsRefs = node.props ? Object.values(node.props).flatMap(v => this.extractRefs(v)) : [];
      for (const ref of propsRefs) {
        const state = this.runtime.stateManager.states.get(ref) ||
                      this.runtime.stateManager.computed.get(ref);
        if (state) {
          state.subscribe({
            run: () => {
              try {
                this.runtime.resolve(componentDef.onUpdate, componentScope);
              } catch (e) {
                console.error(`Component ${node.component} onUpdate error:`, e);
              }
            },
            dependencies: new Set()
          });
        }
      }
    }

    return element;
  }

  setupConditionalBinding(placeholder, node, scope) {
    const refs = this.extractRefs(node.if);
    for (const ref of refs) {
      const state = this.runtime.stateManager.states.get(ref) ||
                    this.runtime.stateManager.computed.get(ref);
      if (state) {
        state.subscribe({
          run: () => {
            const condition = this.runtime.resolve(node.if);
            if (condition && placeholder.parentNode) {
              const element = this.createElement(node, scope);
              placeholder.parentNode.replaceChild(element, placeholder);
            }
          },
          dependencies: new Set()
        });
      }
    }
  }

  createPortal(portal, scope) {
    const { target, children } = portal;
    const targetElement = document.querySelector(target);

    if (!targetElement) {
      console.warn(`Portal target '${target}' not found`);
      return document.createComment(`portal:${target}:not-found`);
    }

    // Render children into the target element
    const fragment = document.createDocumentFragment();
    for (const child of children) {
      fragment.appendChild(this.renderNode(child, scope));
    }
    targetElement.appendChild(fragment);

    // Return a placeholder comment in the original location
    return document.createComment(`portal:${target}`);
  }

  createFragment(children, scope) {
    const fragment = document.createDocumentFragment();
    for (const child of children) {
      fragment.appendChild(this.renderNode(child, scope));
    }
    return fragment;
  }

  createLazyComponent(lazyConfig, scope) {
    const container = document.createElement('div');
    container.setAttribute('data-lazy', 'loading');

    // Render fallback initially
    if (lazyConfig.fallback) {
      const fallbackElement = this.renderNode(lazyConfig.fallback, scope);
      container.appendChild(fallbackElement);
    } else {
      container.textContent = 'Loading...';
    }

    // Start loading the module
    this.loadLazyComponent(container, lazyConfig, scope);

    return container;
  }

  async loadLazyComponent(container, lazyConfig, scope) {
    try {
      // Dynamic import of lazy manager
      const { getLazyManager } = await import('../core/lazy.js');
      const lazyManager = getLazyManager();

      // Configure base path if not already set
      if (!lazyManager.basePath && typeof window !== 'undefined') {
        const currentScript = document.currentScript;
        if (currentScript) {
          const scriptUrl = new URL(currentScript.src);
          lazyManager.basePath = scriptUrl.href.substring(0, scriptUrl.href.lastIndexOf('/'));
        } else {
          // Use document base URL
          lazyManager.basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        }
      }

      // Load the module
      const module = await lazyManager.load(lazyConfig.src);

      // Get the component
      let componentDef;
      if (lazyConfig.component && module.components && module.components[lazyConfig.component]) {
        componentDef = module.components[lazyConfig.component];
      } else if (module.root) {
        // Use root as the component
        componentDef = { render: module.root };
      } else if (module.components) {
        // Use the first component
        const firstComponent = Object.keys(module.components)[0];
        if (firstComponent) {
          componentDef = module.components[firstComponent];
        }
      }

      if (!componentDef) {
        throw {
          error: true,
          code: 'COMPONENT_NOT_FOUND',
          message: `Component '${lazyConfig.component || 'default'}' not found in module '${module.id}'`
        };
      }

      // Initialize module state if present
      if (module.state) {
        for (const [id, def] of Object.entries(module.state)) {
          if (!this.runtime.stateManager.states.has(id)) {
            this.runtime.stateManager.defineState(id, def);
          }
        }
      }

      // Initialize module computed if present
      if (module.computed) {
        for (const [id, def] of Object.entries(module.computed)) {
          if (!this.runtime.stateManager.computed.has(id)) {
            this.runtime.stateManager.defineComputed(id, def, (expr) => this.runtime.resolve(expr));
          }
        }
      }

      // Initialize module actions if present
      if (module.actions) {
        for (const [id, def] of Object.entries(module.actions)) {
          if (!this.runtime.actions.has(id)) {
            this.runtime.actions.set(id, def);
          }
        }
      }

      // Register module components if present
      if (module.components) {
        for (const [id, def] of Object.entries(module.components)) {
          if (!this.runtime.components.has(id)) {
            this.runtime.components.set(id, def);
          }
        }
      }

      // Resolve props
      const props = {};
      if (lazyConfig.props) {
        for (const [key, value] of Object.entries(lazyConfig.props)) {
          props[key] = this.runtime.resolve(value, scope);
        }
      }

      // Apply defaults from component definition
      if (componentDef.props) {
        for (const [key, def] of Object.entries(componentDef.props)) {
          if (!(key in props) && 'default' in def) {
            props[key] = def.default;
          }
        }
      }

      const componentScope = { ...scope, ...props };

      // Clear container and render the component
      container.innerHTML = '';
      container.setAttribute('data-lazy', 'loaded');

      const element = this.renderNode(componentDef.render, componentScope);
      container.appendChild(element);

      // Execute onMount lifecycle hook
      if (componentDef.onMount) {
        requestAnimationFrame(() => {
          try {
            this.runtime.resolve(componentDef.onMount, componentScope);
          } catch (e) {
            console.error('Lazy component onMount error:', e);
          }
        });
      }

      // Setup onUnmount cleanup
      if (componentDef.onUnmount) {
        container._ddjexCleanup = () => {
          try {
            this.runtime.resolve(componentDef.onUnmount, componentScope);
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
          ...scope,
          error: {
            message: error.message || String(error),
            code: error.code || 'LOAD_ERROR'
          }
        };
        const errorElement = this.renderNode(lazyConfig.errorFallback, errorScope);
        container.appendChild(errorElement);
      } else {
        container.textContent = 'Failed to load component';
      }
    }
  }

  /**
   * Create transition node - handles enter/exit animations
   */
  createTransition(transition, scope) {
    const container = document.createElement('div');
    container.setAttribute('data-transition', 'container');

    let currentElement = null;
    let currentShow = false;

    const enterConfig = getAnimationConfig(transition.enter || {});
    const exitConfig = getAnimationConfig(transition.exit || {});
    const mode = transition.mode || 'simultaneous';

    const update = async () => {
      const shouldShow = this.runtime.resolve(transition.show, scope);

      if (shouldShow === currentShow) return;

      if (shouldShow && !currentShow) {
        // Enter animation
        if (transition.onEnterStart) {
          try {
            this.runtime.resolve(transition.onEnterStart, scope);
          } catch (e) {
            console.error('Transition onEnterStart error:', e);
          }
        }

        // Create and render children
        const fragment = document.createDocumentFragment();
        for (const child of transition.children) {
          fragment.appendChild(this.renderNode(child, scope));
        }

        // Create wrapper for animation
        currentElement = document.createElement('div');
        currentElement.setAttribute('data-transition', 'content');
        currentElement.appendChild(fragment);
        container.appendChild(currentElement);

        // Run enter animation
        if (enterConfig && Object.keys(enterConfig).length > 0) {
          await this.animationManager.enter(currentElement, enterConfig);
        }

        if (transition.onEnterEnd) {
          try {
            this.runtime.resolve(transition.onEnterEnd, scope);
          } catch (e) {
            console.error('Transition onEnterEnd error:', e);
          }
        }
      } else if (!shouldShow && currentShow) {
        // Exit animation
        if (transition.onExitStart) {
          try {
            this.runtime.resolve(transition.onExitStart, scope);
          } catch (e) {
            console.error('Transition onExitStart error:', e);
          }
        }

        if (currentElement) {
          // Run exit animation
          if (exitConfig && Object.keys(exitConfig).length > 0) {
            await this.animationManager.exit(currentElement, exitConfig);
          }

          // Remove element
          if (currentElement.parentNode) {
            currentElement.parentNode.removeChild(currentElement);
          }
          currentElement = null;
        }

        if (transition.onExitEnd) {
          try {
            this.runtime.resolve(transition.onExitEnd, scope);
          } catch (e) {
            console.error('Transition onExitEnd error:', e);
          }
        }
      }

      currentShow = shouldShow;
    };

    // Initial render
    update();

    // Subscribe to show condition changes
    const refs = this.extractRefs(transition.show);
    for (const ref of refs) {
      const state = this.runtime.stateManager.states.get(ref) ||
                    this.runtime.stateManager.computed.get(ref);
      if (state) {
        state.subscribe({
          run: update,
          dependencies: new Set()
        });
      }
    }

    return container;
  }

  /**
   * Create animated node - animates based on value changes
   */
  createAnimated(animated, scope) {
    const container = document.createElement('div');
    container.setAttribute('data-animated', 'container');

    const config = getAnimationConfig(animated.config || {});
    let lastValue = undefined;

    // Render children
    for (const child of animated.children) {
      container.appendChild(this.renderNode(child, scope));
    }

    const update = async () => {
      const currentValue = this.runtime.resolve(animated.value, scope);

      if (currentValue === lastValue) return;
      lastValue = currentValue;

      // Apply style based on value
      if (animated.style) {
        const styleObj = {};
        for (const [prop, expr] of Object.entries(animated.style)) {
          const resolvedValue = this.runtime.resolve(expr, { ...scope, $value: currentValue });
          styleObj[prop] = resolvedValue;
        }

        // Callback onStart
        if (animated.onStart) {
          try {
            this.runtime.resolve(animated.onStart, { ...scope, $value: currentValue });
          } catch (e) {
            console.error('Animated onStart error:', e);
          }
        }

        // Animate to new style
        if (config.spring) {
          await this.animationManager.springAnimate(container, {
            to: styleObj,
            spring: config.spring
          });
        } else {
          const animation = this.animationManager.createAnimation(container, {
            ...config,
            to: styleObj
          });
          if (animation) {
            await animation.finished;
          }
        }

        // Callback onComplete
        if (animated.onComplete) {
          try {
            this.runtime.resolve(animated.onComplete, { ...scope, $value: currentValue });
          } catch (e) {
            console.error('Animated onComplete error:', e);
          }
        }
      }
    };

    // Initial update
    update();

    // Subscribe to value changes
    const refs = this.extractRefs(animated.value);
    for (const ref of refs) {
      const state = this.runtime.stateManager.states.get(ref) ||
                    this.runtime.stateManager.computed.get(ref);
      if (state) {
        state.subscribe({
          run: update,
          dependencies: new Set()
        });
      }
    }

    return container;
  }

  /**
   * Create transition group - handles list enter/exit/move animations
   */
  createTransitionGroup(group, scope) {
    const container = document.createElement('div');
    container.setAttribute('data-transition-group', 'container');

    const enterConfig = getAnimationConfig(group.enter || {});
    const exitConfig = getAnimationConfig(group.exit || {});
    const moveConfig = getAnimationConfig(group.move || {});

    const { items: itemsRef, as: itemName, key: keyExpr } = group;
    const elementMap = new Map(); // key -> element
    let lastKeys = [];

    const getKey = (item, index) => {
      if (keyExpr) {
        const itemScope = { ...scope, [itemName]: item, $index: index };
        return String(this.runtime.resolve(keyExpr, itemScope));
      }
      return String(index);
    };

    const update = async () => {
      const items = this.resolveItems(itemsRef, scope) || [];
      const currentKeys = items.map((item, i) => getKey(item, i));

      // Determine added, removed, and moved keys
      const addedKeys = currentKeys.filter(k => !lastKeys.includes(k));
      const removedKeys = lastKeys.filter(k => !currentKeys.includes(k));
      const persistedKeys = currentKeys.filter(k => lastKeys.includes(k));

      // Remove exiting elements with animation
      const exitPromises = [];
      for (const key of removedKeys) {
        const element = elementMap.get(key);
        if (element) {
          if (exitConfig && Object.keys(exitConfig).length > 0) {
            exitPromises.push(
              this.animationManager.exit(element, exitConfig).then(() => {
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

      // Wait for all exits to complete
      await Promise.all(exitPromises);

      // Reorder persisted elements and add new elements
      const fragment = document.createDocumentFragment();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = currentKeys[i];
        const itemScope = { ...scope, [itemName]: item, $index: i };

        if (addedKeys.includes(key)) {
          // Create new element
          const wrapper = document.createElement('div');
          wrapper.setAttribute('data-transition-item', key);

          for (const child of group.children) {
            wrapper.appendChild(this.renderNode(child, itemScope));
          }

          elementMap.set(key, wrapper);
          fragment.appendChild(wrapper);

          // Enter animation (after adding to DOM)
          if (enterConfig && Object.keys(enterConfig).length > 0) {
            // Set initial state
            Object.assign(wrapper.style, enterConfig.from || { opacity: '0' });
          }
        } else {
          // Move existing element
          const element = elementMap.get(key);
          if (element) {
            fragment.appendChild(element);
          }
        }
      }

      // Clear and re-append
      container.innerHTML = '';
      container.appendChild(fragment);

      // Run enter animations for new elements
      for (const key of addedKeys) {
        const element = elementMap.get(key);
        if (element && enterConfig && Object.keys(enterConfig).length > 0) {
          this.animationManager.enter(element, enterConfig);
        }
      }

      lastKeys = currentKeys;
    };

    // Initial render
    update();

    // Subscribe to items changes
    const state = this.runtime.stateManager.states.get(itemsRef);
    if (state) {
      state.subscribe({
        run: update,
        dependencies: new Set()
      });
    }

    return container;
  }
}

export { DOMTarget };
