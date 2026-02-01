/**
 * ddjex Expression Compiler
 * Compiles ddjex expressions to JavaScript expressions
 */

// Map ddjex ops to JS
const OP_MAP = {
  // Math
  add: (a, b) => `(${a} + ${b})`,
  subtract: (a, b) => `(${a} - ${b})`,
  multiply: (a, b) => `(${a} * ${b})`,
  divide: (a, b) => `(${a} / ${b})`,
  modulo: (a, b) => `(${a} % ${b})`,
  min: (...args) => `Math.min(${args.join(', ')})`,
  max: (...args) => `Math.max(${args.join(', ')})`,
  abs: (a) => `Math.abs(${a})`,
  round: (a) => `Math.round(${a})`,
  floor: (a) => `Math.floor(${a})`,
  ceil: (a) => `Math.ceil(${a})`,

  // Compare
  eq: (a, b) => `(${a} === ${b})`,
  neq: (a, b) => `(${a} !== ${b})`,
  gt: (a, b) => `(${a} > ${b})`,
  gte: (a, b) => `(${a} >= ${b})`,
  lt: (a, b) => `(${a} < ${b})`,
  lte: (a, b) => `(${a} <= ${b})`,
  and: (...args) => `(${args.join(' && ')})`,
  or: (...args) => `(${args.join(' || ')})`,
  not: (a) => `(!${a})`,

  // Array
  length: (a) => `(${a}?.length ?? 0)`,
  first: (a) => `${a}?.[0]`,
  last: (a) => `${a}?.[${a}.length - 1]`,
  at: (a, i) => `${a}?.[${i}]`,
  slice: (a, s, e) => e ? `${a}?.slice(${s}, ${e})` : `${a}?.slice(${s})`,
  concat: (...args) => `[].concat(${args.join(', ')})`,
  includes: (a, v) => `${a}?.includes(${v})`,
  indexOf: (a, v) => `${a}?.indexOf(${v})`,
  join: (a, s) => `${a}?.join(${s})`,
  reverse: (a) => `[...${a}].reverse()`,
  unique: (a) => `[...new Set(${a})]`,

  // Object
  get: (o, k) => `${o}?.[${k}]`,
  set: (o, k, v) => `({ ...${o}, [${k}]: ${v} })`,
  keys: (o) => `Object.keys(${o} ?? {})`,
  values: (o) => `Object.values(${o} ?? {})`,
  merge: (...args) => `Object.assign({}, ${args.join(', ')})`,
  has: (o, k) => `(${k} in (${o} ?? {}))`,

  // String
  split: (s, d) => `${s}?.split(${d})`,
  trim: (s) => `${s}?.trim()`,
  toUpperCase: (s) => `${s}?.toUpperCase()`,
  toLowerCase: (s) => `${s}?.toLowerCase()`,
  startsWith: (s, p) => `${s}?.startsWith(${p})`,
  endsWith: (s, p) => `${s}?.endsWith(${p})`,
  substring: (s, a, b) => b ? `${s}?.substring(${a}, ${b})` : `${s}?.substring(${a})`,
  replace: (s, f, t) => `${s}?.replace(${f}, ${t})`,
  replaceAll: (s, f, t) => `${s}?.replaceAll(${f}, ${t})`,

  // Type
  toString: (v) => `String(${v})`,
  toNumber: (v) => `Number(${v})`,
  parseInt: (v) => `parseInt(${v}, 10)`,
  parseFloat: (v) => `parseFloat(${v})`,
  isNull: (v) => `(${v} === null)`,
  isUndefined: (v) => `(${v} === undefined)`,
  isDefined: (v) => `(${v} != null)`,
  typeof: (v) => `typeof ${v}`,

  // Control
  if: (c, t, e) => `(${c} ? ${t} : ${e})`,
  coalesce: (...args) => args.join(' ?? '),
  // switch handled specially below

  // Utility
  now: () => `Date.now()`,
  uuid: () => `(crypto.randomUUID?.() ?? Date.now().toString(36))`,
  log: (...args) => `console.log(${args.join(', ')})`,
};

// Higher-order ops that need special handling
const HIGHER_ORDER_OPS = ['map', 'filter', 'find', 'some', 'every', 'findIndex'];

export function compileExpression(expr, compiler, localVars = []) {
  // Null/undefined
  if (expr === null) return 'null';
  if (expr === undefined) return 'undefined';

  // Primitives
  if (typeof expr === 'string') return JSON.stringify(expr);
  if (typeof expr === 'number') return String(expr);
  if (typeof expr === 'boolean') return String(expr);

  // Array
  if (Array.isArray(expr)) {
    const items = expr.map(e => compileExpression(e, compiler, localVars));
    return `[${items.join(', ')}]`;
  }

  // Reference to state/computed
  if ('ref' in expr) {
    const path = expr.ref.split('.');
    const base = path[0];

    // Check if it's a local variable (like loop item)
    if (localVars.includes(base)) {
      if (path.length === 1) return base;
      return `${base}${path.slice(1).map(p => `?.["${p}"]`).join('')}`;
    }

    // It's a state/computed reference
    if (path.length === 1) {
      return `get("${base}")`;
    }
    return `get("${base}")${path.slice(1).map(p => `?.["${p}"]`).join('')}`;
  }

  // Parameter reference
  if ('param' in expr) {
    return expr.param;
  }

  // Text literal (only when text is a string, not an object/expression)
  if ('text' in expr && typeof expr.text === 'string') {
    return JSON.stringify(expr.text);
  }

  // Bind (same as ref for compilation)
  if ('bind' in expr) {
    const path = expr.bind.split('.');
    const base = path[0];

    if (localVars.includes(base)) {
      if (path.length === 1) return base;
      return `${base}${path.slice(1).map(p => `?.["${p}"]`).join('')}`;
    }

    if (path.length === 1) {
      return `get("${base}")`;
    }
    return `get("${base}")${path.slice(1).map(p => `?.["${p}"]`).join('')}`;
  }

  // Operation
  if ('op' in expr) {
    const opName = expr.op;
    const args = expr.args || [];

    // Switch operation - special handling
    if (opName === 'switch') {
      const switchValue = compileExpression(args[0], compiler, localVars);
      const cases = args[1];

      // Build nested ternary: val === "a" ? resultA : val === "b" ? resultB : default
      const caseEntries = Object.entries(cases);
      let result = 'undefined';

      for (let i = caseEntries.length - 1; i >= 0; i--) {
        const [key, value] = caseEntries[i];
        const compiledValue = compileExpression(value, compiler, localVars);
        if (i === caseEntries.length - 1 && key === 'default') {
          result = compiledValue;
        } else {
          result = `(${switchValue} === ${JSON.stringify(key)} ? ${compiledValue} : ${result})`;
        }
      }

      return result;
    }

    // Higher-order array ops
    if (HIGHER_ORDER_OPS.includes(opName)) {
      const arrExpr = compileExpression(args[0], compiler, localVars);
      const predicate = args[1];

      // Compile predicate as arrow function
      const predicateBody = compileExpression(predicate, compiler, [...localVars, 'item', 'index']);

      return `${arrExpr}?.${opName}((item, index) => ${predicateBody})`;
    }

    // Regular operation
    const opFn = OP_MAP[opName];
    if (!opFn) {
      console.warn(`Unknown op: ${opName}`);
      return 'undefined';
    }

    const compiledArgs = args.map(a => compileExpression(a, compiler, localVars));
    return opFn(...compiledArgs);
  }

  // Object literal
  const entries = Object.entries(expr).map(([k, v]) => {
    const compiledValue = compileExpression(v, compiler, localVars);
    return `${JSON.stringify(k)}: ${compiledValue}`;
  });
  return `{ ${entries.join(', ')} }`;
}
