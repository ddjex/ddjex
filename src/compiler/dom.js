/**
 * ddjex DOM Compiler
 * Compiles ddjex nodes to JavaScript DOM creation functions
 */

import { compileExpression } from './expression.js';

let nodeCounter = 0;

export function compileNode(node, compiler, name = null) {
  const fnName = name || `node_${nodeCounter++}`;
  const lines = [];

  lines.push(`function render_${fnName}(scope = {}) {`);

  const bodyLines = compileNodeBody(node, compiler, 'scope', []);
  lines.push(...bodyLines.map(l => '  ' + l));

  lines.push('}');

  return lines.join('\n');
}

function compileNodeBody(node, compiler, scopeVar, localVars = []) {
  const lines = [];

  // Text node
  if ('text' in node) {
    lines.push(`return document.createTextNode(${JSON.stringify(node.text)});`);
    return lines;
  }

  // Binding node
  if ('bind' in node) {
    const path = node.bind.split('.');
    const base = path[0];

    // Check if it's a local variable
    if (localVars.includes(base)) {
      let valExpr = base;
      for (let i = 1; i < path.length; i++) {
        valExpr += `?.["${path[i]}"]`;
      }
      lines.push(`return document.createTextNode(${valExpr} ?? '');`);
      return lines;
    }

    // State/computed reference - need reactive binding
    lines.push(`const textNode = document.createTextNode('');`);
    lines.push(`const update_${base} = () => {`);

    let valExpr = `get("${base}")`;
    for (let i = 1; i < path.length; i++) {
      valExpr += `?.["${path[i]}"]`;
    }
    lines.push(`  textNode.textContent = ${valExpr} ?? '';`);

    lines.push(`};`);
    lines.push(`update_${base}();`);
    lines.push(`subscribe("${base}", update_${base});`);
    lines.push(`return textNode;`);

    return lines;
  }

  // Conditional node
  if ('if' in node && 'then' in node) {
    const condExpr = compileExpression(node.if, compiler, localVars);

    lines.push(`const container = document.createElement('span');`);
    lines.push(`let current = null;`);
    lines.push(``);
    lines.push(`const updateCond = () => {`);
    lines.push(`  const cond = ${condExpr.replace(/get\("/g, `(${scopeVar}["`)?.replace(/"\)/g, `"] !== undefined ? ${scopeVar}["`) || condExpr};`);

    // Actually, simpler approach - just use the expression
    lines.length -= 1; // Remove last line
    lines.push(`  const cond = ${condExpr};`);
    lines.push(`  const template = cond ? 'then' : 'else';`);
    lines.push(`  if (current) { container.removeChild(current); current = null; }`);

    const thenBody = compileNodeInline(node.then, compiler, scopeVar, localVars);
    lines.push(`  if (cond && ${node.then ? 'true' : 'false'}) { current = ${thenBody}; container.appendChild(current); }`);

    if (node.else) {
      const elseBody = compileNodeInline(node.else, compiler, scopeVar, localVars);
      lines.push(`  else if (!cond && ${node.else ? 'true' : 'false'}) { current = ${elseBody}; container.appendChild(current); }`);
    }

    lines.push(`};`);
    lines.push(`updateCond();`);

    // Subscribe to refs in condition (exclude local vars)
    const refs = extractRefs(node.if).filter(r => !localVars.includes(r));
    for (const ref of refs) {
      lines.push(`subscribe("${ref}", updateCond);`);
    }

    lines.push(`return container;`);
    return lines;
  }

  // Error boundary node
  if ('errorBoundary' in node) {
    const boundary = node.errorBoundary;
    const boundaryId = boundary.id || 'anonymous';

    lines.push(`const container = document.createElement('div');`);
    lines.push(`container.setAttribute('data-error-boundary', ${JSON.stringify(boundaryId)});`);
    lines.push(`let hasError = false;`);
    lines.push(`let errorInfo = null;`);
    lines.push(``);
    lines.push(`const renderBoundaryContent = () => {`);
    lines.push(`  container.innerHTML = '';`);
    lines.push(`  if (hasError) {`);

    // Compile fallback
    const fallbackExpr = compileNodeInline(boundary.fallback, compiler, scopeVar, [...localVars, 'error']);
    lines.push(`    const error = errorInfo;`);
    lines.push(`    try {`);
    lines.push(`      container.appendChild(${fallbackExpr});`);
    lines.push(`    } catch (e) {`);
    lines.push(`      container.textContent = 'Error rendering fallback';`);
    lines.push(`    }`);
    lines.push(`  } else {`);
    lines.push(`    try {`);

    // Compile children
    for (const child of boundary.children) {
      const childExpr = compileNodeInline(child, compiler, scopeVar, localVars);
      lines.push(`      container.appendChild(${childExpr});`);
    }

    lines.push(`    } catch (e) {`);
    lines.push(`      hasError = true;`);
    lines.push(`      errorInfo = { message: e.message || String(e), code: e.code || 'RENDER_ERROR' };`);
    lines.push(`      renderBoundaryContent();`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`};`);
    lines.push(`renderBoundaryContent();`);
    lines.push(`return container;`);

    return lines;
  }

  // Element node
  if ('type' in node) {
    lines.push(`const el = document.createElement("${node.type}");`);

    // Props
    if (node.props) {
      for (const [key, val] of Object.entries(node.props)) {
        const valExpr = compileExpression(val, compiler, localVars);

        if (key === 'className' || key === 'class') {
          lines.push(`el.className = ${valExpr} ?? '';`);
        } else if (key === 'value') {
          lines.push(`el.value = ${valExpr} ?? '';`);
        } else if (key === 'checked' || key === 'disabled' || key === 'selected') {
          lines.push(`el.${key} = !!${valExpr};`);
        } else if (key === 'style') {
          lines.push(`Object.assign(el.style, ${valExpr} ?? {});`);
        } else {
          lines.push(`if (${valExpr} != null) el.setAttribute("${key}", ${valExpr});`);
        }
      }
    }

    // Events
    if (node.events) {
      for (const [event, handler] of Object.entries(node.events)) {
        const actionName = handler.action;
        const args = handler.args || [];

        lines.push(`el.addEventListener("${event}", (e) => {`);

        if (event === 'keydown') {
          lines.push(`  if (e.key !== 'Enter') return;`);
        }

        const argExprs = args.map(arg => {
          if (arg?.op === 'eventValue') return 'e.target.value';
          if (arg?.op === 'eventKey') return 'e.key';
          // Use compileExpression with localVars for proper scoping
          return compileExpression(arg, compiler, localVars);
        });

        lines.push(`  dispatch("${actionName}"${argExprs.length ? ', ' + argExprs.join(', ') : ''});`);
        lines.push(`});`);
      }
    }

    // Loop
    if (node.each) {
      const { items: itemsRef, as: itemName, index: indexName } = node.each;
      const loopVars = [itemName, indexName || 'i'];
      const childLocalVars = [...localVars, ...loopVars];

      lines.push(`let loopEls = [];`);
      lines.push(`const updateLoop = () => {`);
      lines.push(`  const arr = get("${itemsRef}") || [];`);
      lines.push(`  loopEls.forEach(child => el.removeChild(child));`);
      lines.push(`  loopEls = [];`);
      lines.push(`  arr.forEach((${itemName}, ${indexName || 'i'}) => {`);

      if (node.children) {
        for (const child of node.children) {
          const childExpr = compileNodeInline(child, compiler, scopeVar, childLocalVars);
          lines.push(`    const childEl = ${childExpr};`);
          lines.push(`    el.appendChild(childEl);`);
          lines.push(`    loopEls.push(childEl);`);
        }
      }

      lines.push(`  });`);
      lines.push(`};`);
      lines.push(`updateLoop();`);
      lines.push(`subscribe("${itemsRef}", updateLoop);`);
    } else if (node.children) {
      // Regular children
      for (const child of node.children) {
        const childExpr = compileNodeInline(child, compiler, scopeVar, localVars);
        lines.push(`el.appendChild(${childExpr});`);
      }
    }

    lines.push(`return el;`);
    return lines;
  }

  // Fallback
  lines.push(`return document.createTextNode('');`);
  return lines;
}

function compileNodeInline(node, compiler, scopeVar, localVars = []) {
  // For inline use, create an IIFE

  // Simple text
  if ('text' in node) {
    return `document.createTextNode(${JSON.stringify(node.text)})`;
  }

  // Simple bind
  if ('bind' in node) {
    const path = node.bind.split('.');
    const base = path[0];

    // Check if it's a local variable (like loop item)
    if (localVars.includes(base)) {
      let valExpr = base;
      for (let i = 1; i < path.length; i++) {
        valExpr += `?.["${path[i]}"]`;
      }
      return `document.createTextNode(${valExpr} ?? '')`;
    }

    // It's a state/computed reference - need reactive binding
    let valExpr = `get("${base}")`;
    for (let i = 1; i < path.length; i++) {
      valExpr += `?.["${path[i]}"]`;
    }

    return `(function() {
      const tn = document.createTextNode('');
      const upd = () => { tn.textContent = ${valExpr} ?? ''; };
      upd();
      subscribe("${base}", upd);
      return tn;
    })()`;
  }

  // Everything else - use full compilation
  const body = compileNodeBody(node, compiler, scopeVar, localVars);
  return `(function() {\n${body.map(l => '  ' + l).join('\n')}\n})()`;
}

function extractRefs(expr) {
  const refs = new Set();

  function extract(e) {
    if (!e || typeof e !== 'object') return;
    if ('ref' in e) refs.add(e.ref.split('.')[0]);
    if ('op' in e && e.args) e.args.forEach(extract);
    if (Array.isArray(e)) e.forEach(extract);
  }

  extract(expr);
  return [...refs];
}
