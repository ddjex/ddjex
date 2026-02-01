# ddjex

**Declarative Deterministic JSON Execution** - A JavaScript runtime optimized for LLM code generation.

## What is ddjex?

ddjex is a reactive runtime where all code is JSON. No custom syntax, no DSL, no JSX - just pure JSON that any LLM can generate reliably.

### Design Principles

- **JSON-Only**: All code is valid JSON
- **One-Way**: Exactly one pattern per concept
- **Explicit**: Zero magic, everything declared
- **Minimal**: 6 primitives, everything composes
- **Predictable**: Deterministic execution

### The 6 Primitives

| Primitive | Purpose | Reactive |
|-----------|---------|----------|
| `value` | Immutable data | No |
| `state` | Mutable data with subscriptions | Yes |
| `computed` | Derived from state/computed | Yes |
| `effect` | Side effects on state change | Yes |
| `action` | Batch state mutations | No |
| `component` | UI/Service composition unit | Yes |

## Installation

```bash
npm install ddjex
```

## Quick Start

### Browser

```html
<div id="app"></div>
<script src="https://unpkg.com/ddjex/dist/ddjex.browser.min.js"></script>
<script>
const program = {
  "$ddjex": "0.4.0",
  "id": "counter",
  "target": "dom",
  "state": {
    "count": { "type": "number", "initial": 0 }
  },
  "actions": {
    "increment": {
      "mutations": [{ "target": "count", "op": "add", "value": 1 }]
    }
  },
  "root": {
    "type": "div",
    "children": [
      { "type": "button",
        "events": { "click": { "action": "increment" } },
        "children": [{ "text": "Count: " }, { "bind": "count" }]
      }
    ]
  }
};

DDJEX.run(program, { container: '#app' });
</script>
```

### Node.js (Server)

```javascript
import { createRuntime } from 'ddjex/server';

const program = {
  "$ddjex": "0.4.0",
  "id": "api",
  "target": "server",
  "state": {
    "items": { "type": "array", "initial": [] }
  },
  "routes": [
    { "method": "GET", "path": "/items", "handler": { "ref": "items" } },
    { "method": "POST", "path": "/items", "action": "addItem" }
  ],
  "actions": {
    "addItem": {
      "params": ["body"],
      "mutations": [{ "target": "items", "op": "push", "value": { "param": "body" } }]
    }
  }
};

const runtime = createRuntime(program);
runtime.listen(3000);
```

## Program Structure

Every ddjex program is a JSON object:

```json
{
  "$ddjex": "0.4.0",
  "id": "program-id",
  "target": "dom | server | cli",
  "state": { },
  "computed": { },
  "effects": [ ],
  "actions": { },
  "root": { }
}
```

## Features

- **Reactive State**: Fine-grained reactivity with automatic dependency tracking
- **80+ Operations**: Math, array, object, string, control flow, async
- **Multiple Targets**: DOM (browser), Server (HTTP), CLI
- **Router**: Client-side routing with guards, params, nested routes
- **Animations**: Enter/exit transitions, spring physics
- **Self-Testing**: Inline tests in JSON, 12 assertion operators
- **Constraints**: State validation (min, max, pattern, unique)
- **WebSocket**: Real-time communication
- **SSR**: Server-side rendering with hydration
- **HMR**: Hot module replacement for development

## Documentation

- [JSON Schema Specification](./spec/schema.json)
- [Example Programs](./spec/examples/)
- [Pattern Library](./spec/examples/patterns/) - 52 patterns

## Targets

### DOM (Browser)
```json
{ "target": "dom", "root": { "type": "div", ... } }
```

### Server (HTTP)
```json
{ "target": "server", "routes": [...] }
```

### CLI
```json
{ "target": "cli", "commands": [...] }
```

## Development

```bash
# Run tests
npm test

# Development server with HMR
npm run dev
```

## License

MIT
