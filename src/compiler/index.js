/**
 * ddjex Compiler
 * Compiles ddjex JSON programs to optimized JavaScript
 *
 * Input: ddjex JSON program
 * Output: Standalone JavaScript that runs without runtime
 */

import { compileExpression } from './expression.js';
import { compileNode } from './dom.js';
import { compileActions } from './actions.js';

class Compiler {
  constructor(program, options = {}) {
    this.program = program;
    this.options = {
      minify: false,
      target: 'browser', // 'browser' | 'node' | 'module'
      ...options
    };
    this.stateIds = new Set();
    this.computedIds = new Set();
    this.actionIds = new Set();
  }

  compile() {
    this.analyze();

    const chunks = [];

    // Header
    chunks.push(this.compileHeader());

    // State
    chunks.push(this.compileState());

    // Computed
    chunks.push(this.compileComputed());

    // Actions
    chunks.push(this.compileActions());

    // Effects
    chunks.push(this.compileEffects());

    // DOM (if applicable)
    if (this.program.target === 'dom' && this.program.root) {
      chunks.push(this.compileDOM());
    }

    // Mount
    chunks.push(this.compileMount());

    // Footer
    chunks.push(this.compileFooter());

    let code = chunks.filter(Boolean).join('\n\n');

    if (this.options.minify) {
      code = this.minify(code);
    }

    return code;
  }

  analyze() {
    // Collect all identifiers
    if (this.program.state) {
      Object.keys(this.program.state).forEach(id => this.stateIds.add(id));
    }
    if (this.program.computed) {
      Object.keys(this.program.computed).forEach(id => this.computedIds.add(id));
    }
    if (this.program.actions) {
      Object.keys(this.program.actions).forEach(id => this.actionIds.add(id));
    }
  }

  compileHeader() {
    if (this.options.target === 'module') {
      return `// ddjex Compiled: ${this.program.id}\n// Generated: ${new Date().toISOString()}`;
    }
    return `(function() {
"use strict";
// ddjex Compiled: ${this.program.id}`;
  }

  compileFooter() {
    if (this.options.target === 'module') {
      return `export { state, dispatch, mount };`;
    }
    return `})();`;
  }

  compileState() {
    if (!this.program.state) return '';

    const lines = ['// State'];
    lines.push('const state = {');

    for (const [id, def] of Object.entries(this.program.state)) {
      const initial = JSON.stringify(def.initial);
      lines.push(`  ${id}: ${initial},`);
    }

    lines.push('};');
    lines.push('');
    lines.push('const subscribers = {};');

    for (const id of this.stateIds) {
      lines.push(`subscribers.${id} = new Set();`);
    }

    lines.push('');
    lines.push(`function get(id) {
  if (id in computed) return computed[id]();
  return state[id];
}`);

    lines.push('');
    lines.push(`function set(id, value) {
  if (state[id] === value) return;
  state[id] = value;
  notify(id);
}`);

    lines.push('');
    lines.push(`function notify(id) {
  subscribers[id]?.forEach(fn => fn());
  // Notify dependent computed
  for (const [compId, deps] of Object.entries(computedDeps)) {
    if (deps.includes(id)) {
      subscribers[compId]?.forEach(fn => fn());
    }
  }
}`);

    lines.push('');
    lines.push(`function subscribe(id, fn) {
  if (!subscribers[id]) subscribers[id] = new Set();
  subscribers[id].add(fn);
  return () => subscribers[id].delete(fn);
}`);

    return lines.join('\n');
  }

  compileComputed() {
    if (!this.program.computed) return 'const computed = {};\nconst computedDeps = {};';

    const lines = ['// Computed'];
    lines.push('const computedDeps = {');

    for (const [id, def] of Object.entries(this.program.computed)) {
      lines.push(`  ${id}: ${JSON.stringify(def.deps)},`);
    }

    lines.push('};');
    lines.push('');
    lines.push('const computed = {');

    for (const [id, def] of Object.entries(this.program.computed)) {
      const fnBody = compileExpression(def.fn, this);
      lines.push(`  ${id}: () => ${fnBody},`);
    }

    lines.push('};');

    // Initialize subscriber sets for computed
    lines.push('');
    for (const id of this.computedIds) {
      lines.push(`subscribers.${id} = new Set();`);
    }

    return lines.join('\n');
  }

  compileActions() {
    if (!this.program.actions) return '// No actions';

    const lines = ['// Actions'];
    lines.push('const actions = {};');
    lines.push('');

    for (const [id, def] of Object.entries(this.program.actions)) {
      const params = def.params || [];
      const paramList = params.join(', ');

      lines.push(`actions.${id} = function(${paramList}) {`);

      for (const mut of def.mutations) {
        const valueExpr = mut.value !== undefined
          ? compileExpression(mut.value, this, params)
          : 'undefined';

        if (mut.op === 'set') {
          lines.push(`  set("${mut.target}", ${valueExpr});`);
        } else if (mut.op === 'add') {
          lines.push(`  set("${mut.target}", get("${mut.target}") + ${valueExpr});`);
        } else if (mut.op === 'subtract') {
          lines.push(`  set("${mut.target}", get("${mut.target}") - ${valueExpr});`);
        } else if (mut.op === 'multiply') {
          lines.push(`  set("${mut.target}", get("${mut.target}") * ${valueExpr});`);
        } else if (mut.op === 'toggle') {
          lines.push(`  set("${mut.target}", !get("${mut.target}"));`);
        } else if (mut.op === 'push') {
          lines.push(`  set("${mut.target}", [...get("${mut.target}"), ${valueExpr}]);`);
        } else if (mut.op === 'pop') {
          lines.push(`  set("${mut.target}", get("${mut.target}").slice(0, -1));`);
        } else if (mut.op === 'merge') {
          lines.push(`  set("${mut.target}", { ...get("${mut.target}"), ...${valueExpr} });`);
        } else if (mut.op === 'filter') {
          const filterFn = compileFilterMapExpression(mut.value, this, params);
          lines.push(`  set("${mut.target}", get("${mut.target}").filter(${filterFn}));`);
        } else if (mut.op === 'map') {
          const mapFn = compileFilterMapExpression(mut.value, this, params);
          lines.push(`  set("${mut.target}", get("${mut.target}").map(${mapFn}));`);
        }
      }

      lines.push('};');
      lines.push('');
    }

    lines.push(`function dispatch(action, ...args) {
  if (actions[action]) actions[action](...args);
  else console.error('Unknown action:', action);
}`);

    return lines.join('\n');
  }

  compileEffects() {
    if (!this.program.effects || this.program.effects.length === 0) {
      return '// No effects';
    }

    const lines = ['// Effects'];

    for (const effect of this.program.effects) {
      const fnBody = compileExpression(effect.do, this);
      lines.push(`function effect_${effect.id}() { ${fnBody}; }`);
      lines.push(`effect_${effect.id}();`);

      for (const watchId of effect.watch) {
        lines.push(`subscribe("${watchId}", effect_${effect.id});`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  compileDOM() {
    const lines = ['// DOM'];
    lines.push(compileNode(this.program.root, this, 'root'));
    return lines.join('\n');
  }

  compileMount() {
    if (this.program.target !== 'dom') return '';

    return `// Mount
function mount(container) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  el.innerHTML = '';
  el.appendChild(render_root());
}

document.addEventListener('DOMContentLoaded', () => mount('#app'));`;
  }

  minify(code) {
    return code
      .replace(/\/\/.*$/gm, '')
      .replace(/\n\s*\n/g, '\n')
      .replace(/^\s+/gm, '')
      .replace(/\s+$/gm, '')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}

function compileFilterMapExpression(expr, compiler, params) {
  // Generate (item, index) => expression
  const body = compileExpression(expr, compiler, [...params, 'item', 'index']);
  return `(item, index) => ${body}`;
}

export function compile(program, options) {
  const compiler = new Compiler(program, options);
  return compiler.compile();
}

export { Compiler };
