/**
 * ddjex SSR Target
 * Renders ddjex programs to HTML strings for server-side rendering
 */

import { Target } from '../core/runtime.js';

class SSRTarget extends Target {
  constructor(options = {}) {
    super();
    this.options = {
      pretty: false,
      indent: '  ',
      ...options
    };
    this.depth = 0;
  }

  mount(runtime) {
    this.runtime = runtime;
    const rootNode = runtime.program.root;
    if (rootNode) {
      return this.renderNode(rootNode, {});
    }
    return '';
  }

  unmount() {
    // No-op for SSR
    return this;
  }

  renderNode(node, scope) {
    // Text node
    if ('text' in node) {
      return this.escapeHtml(node.text);
    }

    // Binding node
    if ('bind' in node) {
      return this.renderBinding(node, scope);
    }

    // Conditional node
    if ('if' in node && 'then' in node) {
      return this.renderConditional(node, scope);
    }

    // Error boundary node
    if ('errorBoundary' in node) {
      return this.renderErrorBoundary(node.errorBoundary, scope);
    }

    // Component reference
    if ('component' in node) {
      return this.renderComponent(node, scope);
    }

    // Context provider
    if ('provide' in node) {
      return this.renderContextProvider(node.provide, scope);
    }

    // Element node
    if ('type' in node) {
      return this.renderElement(node, scope);
    }

    return '';
  }

  renderContextProvider(provider, scope) {
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

    // Render children with provider scope
    let html = '';
    for (const child of children) {
      html += this.renderNode(child, providerScope);
    }
    return html;
  }

  renderBinding(node, scope) {
    const path = node.bind.split('.');
    let value;

    // Check scope first
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
    else if (this.runtime.contextManager?.contexts?.has(path[0])) {
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

    return this.escapeHtml(String(value ?? ''));
  }

  renderConditional(node, scope) {
    const condition = this.runtime.resolve(node.if);
    const template = condition ? node.then : node.else;

    if (template) {
      return this.renderNode(template, scope);
    }
    return '';
  }

  renderErrorBoundary(boundary, scope) {
    try {
      let html = '';
      for (const child of boundary.children) {
        html += this.renderNode(child, scope);
      }
      return html;
    } catch (error) {
      // Render fallback on error
      const errorScope = {
        ...scope,
        error: {
          message: error.message || String(error),
          code: error.code || 'RENDER_ERROR'
        }
      };
      return this.renderNode(boundary.fallback, errorScope);
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

    return this.renderNode(componentDef.render, { ...scope, ...props });
  }

  renderElement(node, scope) {
    const tag = node.type;
    const selfClosing = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag);

    // Build attributes
    let attrs = '';

    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        const resolved = this.runtime.resolve(value, scope);
        if (resolved == null) continue;

        let attrName = key;
        let attrValue = resolved;

        // Handle special attributes
        if (key === 'className') {
          attrName = 'class';
        } else if (key === 'htmlFor') {
          attrName = 'for';
        }

        // Handle boolean attributes
        if (typeof attrValue === 'boolean') {
          if (attrValue) {
            attrs += ` ${attrName}`;
          }
          continue;
        }

        // Handle style object
        if (key === 'style' && typeof attrValue === 'object') {
          attrValue = Object.entries(attrValue)
            .map(([k, v]) => `${this.camelToKebab(k)}: ${v}`)
            .join('; ');
        }

        attrs += ` ${attrName}="${this.escapeAttr(String(attrValue))}"`;
      }
    }

    // Add data-ddjex-hydrate for interactive elements
    if (node.events && Object.keys(node.events).length > 0) {
      attrs += ` data-ddjex-hydrate`;
    }

    // Self-closing tags
    if (selfClosing) {
      return `<${tag}${attrs} />`;
    }

    // Conditional rendering on element
    if (node.if) {
      const condition = this.runtime.resolve(node.if);
      if (!condition) {
        return `<!-- if:false -->`;
      }
    }

    // Open tag
    let html = `<${tag}${attrs}>`;

    // Handle loop
    if (node.each) {
      const { items: itemsRef, as: itemName, index: indexName } = node.each;
      const items = this.runtime.stateManager.get(itemsRef) || [];

      items.forEach((item, index) => {
        const itemScope = {
          ...scope,
          [itemName]: item
        };
        if (indexName) {
          itemScope[indexName] = index;
        }

        for (const child of node.children || []) {
          html += this.renderNode(child, itemScope);
        }
      });
    } else if (node.children) {
      // Regular children
      for (const child of node.children) {
        html += this.renderNode(child, scope);
      }
    }

    // Close tag
    html += `</${tag}>`;

    return html;
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  escapeAttr(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  camelToKebab(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }
}

/**
 * Render an ddjex program to HTML string
 */
async function renderToString(program, options = {}) {
  const { Runtime } = await import('../core/runtime.js');
  const target = new SSRTarget(options);
  const runtime = new Runtime(program, target);
  runtime.initialize();
  return target.mount(runtime);
}

/**
 * Render full HTML document
 */
async function renderToDocument(program, options = {}) {
  const html = await renderToString(program, options);
  const state = {};

  // Serialize initial state for hydration
  const { Runtime } = await import('../core/runtime.js');
  const target = new SSRTarget(options);
  const runtime = new Runtime(program, target);
  runtime.initialize();

  if (program.state) {
    for (const id of Object.keys(program.state)) {
      state[id] = runtime.stateManager.get(id);
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${program.id}</title>
</head>
<body>
  <div id="app">${html}</div>
  <script>
    window.__DDJEX_STATE__ = ${JSON.stringify(state)};
    window.__DDJEX_PROGRAM__ = ${JSON.stringify(program)};
  </script>
</body>
</html>`;
}

export { SSRTarget, renderToString, renderToDocument };
