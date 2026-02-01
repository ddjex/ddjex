# ddjex Skill Definition

## Activation Triggers

Activate this skill when:
- User mentions "ddjex" or "Declarative Deterministic JSON Execution"
- User requests building a web app, API server, or CLI tool with JSON
- User asks for "LLM-optimized" or "AI-friendly" code
- Working in a directory containing `*.ddjex.json` files or importing from `ddjex`

## Quick Reference

### Program Structure
```json
{
  "$ddjex": "0.1.0",
  "id": "program_name",
  "target": "dom|server|cli",
  "state": {},
  "computed": {},
  "effects": [],
  "actions": {},
  "root": {},
  "routes": [],
  "commands": []
}
```

### State Definition
```json
"stateName": { "type": "number|string|boolean|array|object", "initial": <value> }
```

### Computed Definition
```json
"computedName": { "deps": ["state1"], "fn": { "op": "operation", "args": [...] } }
```

### Action Definition
```json
"actionName": {
  "params": ["param1"],
  "mutations": [{ "target": "stateName", "op": "set|add|push|...", "value": <expr> }]
}
```

### Expression Types
- Literal: `5`, `"text"`, `true`, `null`, `[]`, `{}`
- Reference: `{ "ref": "stateName" }`
- Parameter: `{ "param": "paramName" }`
- Operation: `{ "op": "add", "args": [{ "ref": "a" }, { "ref": "b" }] }`

### DOM Node Types
- Text: `{ "text": "static text" }`
- Binding: `{ "bind": "stateName" }`
- Element: `{ "type": "div", "props": {}, "events": {}, "children": [] }`
- Conditional: `{ "if": <expr>, "then": <node>, "else": <node> }`
- Loop: element with `"each": { "items": "arrayState", "as": "item" }`

### Common Operations
| Category | Operations |
|----------|------------|
| Math | add, subtract, multiply, divide, modulo |
| Compare | eq, neq, gt, gte, lt, lte, and, or, not |
| Array | length, push, pop, map, filter, find, includes |
| Object | get, set, keys, values, merge |
| String | concat, split, join, trim, toUpperCase, toLowerCase |
| Control | if, switch, pipe |

### Event Handlers
```json
"events": { "click": { "action": "actionName", "args": [<expr>] } }
```

## Generation Rules

1. **Always output valid JSON** - no comments, no trailing commas
2. **Use explicit references** - `{ "ref": "x" }` not just `"x"`
3. **Declare all state upfront** - no implicit state creation
4. **One action per mutation type** - keep actions atomic
5. **Use computed for derived values** - don't duplicate logic
6. **Test JSON validity** before outputting

## Example Generation Prompt

When asked "Create a counter app with ddjex":

```json
{
  "$ddjex": "0.1.0",
  "id": "counter",
  "target": "dom",
  "state": {
    "count": { "type": "number", "initial": 0 }
  },
  "actions": {
    "increment": { "mutations": [{ "target": "count", "op": "add", "value": 1 }] },
    "decrement": { "mutations": [{ "target": "count", "op": "subtract", "value": 1 }] }
  },
  "root": {
    "type": "div",
    "children": [
      { "type": "button", "events": { "click": { "action": "decrement" } }, "children": [{ "text": "-" }] },
      { "type": "span", "children": [{ "bind": "count" }] },
      { "type": "button", "events": { "click": { "action": "increment" } }, "children": [{ "text": "+" }] }
    ]
  }
}
```

## Validation Checklist

Before outputting ddjex code, verify:
- [ ] `$ddjex` version is present
- [ ] `id` is valid identifier
- [ ] `target` matches intended platform
- [ ] All `ref` values point to defined state/computed
- [ ] All `action` calls reference defined actions
- [ ] All `param` values are in action's `params` array
- [ ] JSON is syntactically valid
