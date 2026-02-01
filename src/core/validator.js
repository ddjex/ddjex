/**
 * ddjex Validator
 * Runtime JSON Schema validation with structured errors
 */

const VALID_TARGETS = ['dom', 'server', 'cli'];
const VALID_TYPES = ['string', 'number', 'boolean', 'null', 'array', 'object'];
const VALID_MUTATION_OPS = ['set', 'add', 'subtract', 'multiply', 'divide', 'push', 'pop', 'shift', 'unshift', 'merge', 'toggle', 'filter', 'map'];

// Security: Size limits to prevent DoS attacks
const LIMITS = {
  MAX_STATE_KEYS: 1000,
  MAX_COMPUTED_KEYS: 500,
  MAX_ACTIONS: 500,
  MAX_EFFECTS: 500,
  MAX_COMPONENTS: 200,
  MAX_CONTEXTS: 100,
  MAX_CHILDREN_PER_NODE: 1000,
  MAX_NESTING_DEPTH: 50
};

class ValidationError {
  constructor(code, message, path, suggestions = []) {
    this.error = true;
    this.code = code;
    this.message = message;
    this.path = path;
    this.suggestions = suggestions;
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      location: { path: this.path },
      suggestions: this.suggestions
    };
  }
}

class Validator {
  constructor() {
    this.errors = [];
    this.definedStates = new Set();
    this.definedComputed = new Set();
    this.definedActions = new Set();
    this.definedComponents = new Set();
    this.definedContexts = new Set();
  }

  validate(program) {
    this.errors = [];
    this.definedStates.clear();
    this.definedComputed.clear();
    this.definedActions.clear();
    this.definedComponents.clear();
    this.definedContexts.clear();

    // Phase 1: Structure validation
    this.validateStructure(program);

    // Phase 2: Collect definitions
    this.collectDefinitions(program);

    // Phase 3: Reference validation
    this.validateReferences(program);

    return {
      valid: this.errors.length === 0,
      errors: this.errors.map(e => e.toJSON())
    };
  }

  validateStructure(program, path = '$') {
    // Required fields
    if (!program.$ddjex) {
      this.errors.push(new ValidationError(
        'MISSING_VERSION',
        'Missing $ddjex version field',
        path,
        [{ action: 'add_field', field: '$ddjex', value: '0.1.0' }]
      ));
    } else if (!/^\d+\.\d+\.\d+$/.test(program.$ddjex)) {
      this.errors.push(new ValidationError(
        'INVALID_VERSION',
        `Invalid version format: ${program.$ddjex}`,
        `${path}.$ddjex`,
        [{ action: 'fix_format', expected: 'X.Y.Z' }]
      ));
    }

    if (!program.id) {
      this.errors.push(new ValidationError(
        'MISSING_ID',
        'Missing program id',
        path,
        [{ action: 'add_field', field: 'id', value: 'my_app' }]
      ));
    } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(program.id)) {
      this.errors.push(new ValidationError(
        'INVALID_ID',
        `Invalid id format: ${program.id}`,
        `${path}.id`,
        [{ action: 'fix_format', expected: 'alphanumeric with underscores, starting with letter' }]
      ));
    }

    if (!program.target) {
      this.errors.push(new ValidationError(
        'MISSING_TARGET',
        'Missing target field',
        path,
        [{ action: 'add_field', field: 'target', options: VALID_TARGETS }]
      ));
    } else if (!VALID_TARGETS.includes(program.target)) {
      this.errors.push(new ValidationError(
        'INVALID_TARGET',
        `Invalid target: ${program.target}`,
        `${path}.target`,
        [{ action: 'use_valid_target', options: VALID_TARGETS }]
      ));
    }

    // Security: Size limit checks to prevent DoS
    if (program.contexts && Object.keys(program.contexts).length > LIMITS.MAX_CONTEXTS) {
      this.errors.push(new ValidationError(
        'TOO_MANY_CONTEXTS',
        `Too many context definitions (max ${LIMITS.MAX_CONTEXTS})`,
        `${path}.contexts`
      ));
    }

    if (program.state && Object.keys(program.state).length > LIMITS.MAX_STATE_KEYS) {
      this.errors.push(new ValidationError(
        'TOO_MANY_STATES',
        `Too many state definitions (max ${LIMITS.MAX_STATE_KEYS})`,
        `${path}.state`
      ));
    }

    if (program.computed && Object.keys(program.computed).length > LIMITS.MAX_COMPUTED_KEYS) {
      this.errors.push(new ValidationError(
        'TOO_MANY_COMPUTED',
        `Too many computed definitions (max ${LIMITS.MAX_COMPUTED_KEYS})`,
        `${path}.computed`
      ));
    }

    if (program.actions && Object.keys(program.actions).length > LIMITS.MAX_ACTIONS) {
      this.errors.push(new ValidationError(
        'TOO_MANY_ACTIONS',
        `Too many action definitions (max ${LIMITS.MAX_ACTIONS})`,
        `${path}.actions`
      ));
    }

    if (program.effects && program.effects.length > LIMITS.MAX_EFFECTS) {
      this.errors.push(new ValidationError(
        'TOO_MANY_EFFECTS',
        `Too many effects (max ${LIMITS.MAX_EFFECTS})`,
        `${path}.effects`
      ));
    }

    if (program.components && Object.keys(program.components).length > LIMITS.MAX_COMPONENTS) {
      this.errors.push(new ValidationError(
        'TOO_MANY_COMPONENTS',
        `Too many component definitions (max ${LIMITS.MAX_COMPONENTS})`,
        `${path}.components`
      ));
    }

    // Validate context definitions
    if (program.contexts) {
      this.validateContextDefinitions(program.contexts, `${path}.contexts`);
    }

    // Validate state definitions
    if (program.state) {
      this.validateStateDefinitions(program.state, `${path}.state`);
    }

    // Validate computed definitions
    if (program.computed) {
      this.validateComputedDefinitions(program.computed, `${path}.computed`);
    }

    // Validate action definitions
    if (program.actions) {
      this.validateActionDefinitions(program.actions, `${path}.actions`);
    }

    // Validate effects
    if (program.effects) {
      this.validateEffectDefinitions(program.effects, `${path}.effects`);
    }

    // Validate components
    if (program.components) {
      this.validateComponentDefinitions(program.components, `${path}.components`);
    }

    // Validate root (for DOM)
    if (program.target === 'dom' && program.root) {
      this.validateNode(program.root, `${path}.root`);
    }

    // Validate routes (for server)
    if (program.target === 'server' && program.routes) {
      this.validateRoutes(program.routes, `${path}.routes`);
    }

    // Validate commands (for CLI)
    if (program.target === 'cli' && program.commands) {
      this.validateCommands(program.commands, `${path}.commands`);
    }

    // Validate tests (self-testing)
    if (program.tests) {
      this.validateTests(program.tests, `${path}.tests`);
    }
  }

  validateContextDefinitions(contexts, path) {
    for (const [name, def] of Object.entries(contexts)) {
      const contextPath = `${path}.${name}`;

      if (!def.type) {
        this.errors.push(new ValidationError(
          'MISSING_CONTEXT_TYPE',
          `Context '${name}' is missing type`,
          contextPath,
          [{ action: 'add_field', field: 'type', options: VALID_TYPES }]
        ));
      } else if (!VALID_TYPES.includes(def.type) && !this.isUnionType(def.type)) {
        this.errors.push(new ValidationError(
          'INVALID_CONTEXT_TYPE',
          `Invalid type '${def.type}' for context '${name}'`,
          `${contextPath}.type`,
          [{ action: 'use_valid_type', options: VALID_TYPES }]
        ));
      }

      if (!('initial' in def)) {
        this.errors.push(new ValidationError(
          'MISSING_CONTEXT_INITIAL',
          `Context '${name}' is missing initial value`,
          contextPath,
          [{ action: 'add_field', field: 'initial' }]
        ));
      }
    }
  }

  validateStateDefinitions(states, path) {
    for (const [name, def] of Object.entries(states)) {
      const statePath = `${path}.${name}`;

      if (!def.type) {
        this.errors.push(new ValidationError(
          'MISSING_STATE_TYPE',
          `State '${name}' is missing type`,
          statePath,
          [{ action: 'add_field', field: 'type', options: VALID_TYPES }]
        ));
      } else if (!VALID_TYPES.includes(def.type) && !this.isUnionType(def.type)) {
        this.errors.push(new ValidationError(
          'INVALID_STATE_TYPE',
          `Invalid type '${def.type}' for state '${name}'`,
          `${statePath}.type`,
          [{ action: 'use_valid_type', options: VALID_TYPES }]
        ));
      }

      if (!('initial' in def)) {
        this.errors.push(new ValidationError(
          'MISSING_INITIAL_VALUE',
          `State '${name}' is missing initial value`,
          statePath,
          [{ action: 'add_field', field: 'initial' }]
        ));
      }
    }
  }

  validateComputedDefinitions(computed, path) {
    for (const [name, def] of Object.entries(computed)) {
      const computedPath = `${path}.${name}`;

      if (!def.deps || !Array.isArray(def.deps) || def.deps.length === 0) {
        this.errors.push(new ValidationError(
          'MISSING_COMPUTED_DEPS',
          `Computed '${name}' must have deps array`,
          computedPath,
          [{ action: 'add_field', field: 'deps', value: [] }]
        ));
      }

      if (!def.fn) {
        this.errors.push(new ValidationError(
          'MISSING_COMPUTED_FN',
          `Computed '${name}' must have fn`,
          computedPath,
          [{ action: 'add_field', field: 'fn' }]
        ));
      } else {
        this.validateExpression(def.fn, `${computedPath}.fn`);
      }
    }
  }

  validateActionDefinitions(actions, path) {
    for (const [name, def] of Object.entries(actions)) {
      const actionPath = `${path}.${name}`;

      if (!def.mutations || !Array.isArray(def.mutations) || def.mutations.length === 0) {
        this.errors.push(new ValidationError(
          'MISSING_ACTION_MUTATIONS',
          `Action '${name}' must have mutations array`,
          actionPath,
          [{ action: 'add_field', field: 'mutations', value: [] }]
        ));
      } else {
        def.mutations.forEach((mutation, i) => {
          this.validateMutation(mutation, `${actionPath}.mutations[${i}]`, def.params || []);
        });
      }
    }
  }

  validateMutation(mutation, path, params) {
    if (!mutation.target) {
      this.errors.push(new ValidationError(
        'MISSING_MUTATION_TARGET',
        'Mutation is missing target',
        path,
        [{ action: 'add_field', field: 'target' }]
      ));
    }

    if (!mutation.op) {
      this.errors.push(new ValidationError(
        'MISSING_MUTATION_OP',
        'Mutation is missing op',
        path,
        [{ action: 'add_field', field: 'op', options: VALID_MUTATION_OPS }]
      ));
    } else if (!VALID_MUTATION_OPS.includes(mutation.op)) {
      this.errors.push(new ValidationError(
        'INVALID_MUTATION_OP',
        `Invalid mutation op: ${mutation.op}`,
        `${path}.op`,
        [{ action: 'use_valid_op', options: VALID_MUTATION_OPS }]
      ));
    }

    if (mutation.value !== undefined) {
      this.validateExpression(mutation.value, `${path}.value`, params);
    }
  }

  validateEffectDefinitions(effects, path) {
    effects.forEach((effect, i) => {
      const effectPath = `${path}[${i}]`;

      if (!effect.id) {
        this.errors.push(new ValidationError(
          'MISSING_EFFECT_ID',
          'Effect is missing id',
          effectPath,
          [{ action: 'add_field', field: 'id' }]
        ));
      }

      if (!effect.watch || !Array.isArray(effect.watch) || effect.watch.length === 0) {
        this.errors.push(new ValidationError(
          'MISSING_EFFECT_WATCH',
          'Effect must have watch array',
          effectPath,
          [{ action: 'add_field', field: 'watch', value: [] }]
        ));
      }

      if (!effect.do) {
        this.errors.push(new ValidationError(
          'MISSING_EFFECT_DO',
          'Effect must have do operation',
          effectPath,
          [{ action: 'add_field', field: 'do' }]
        ));
      } else {
        this.validateExpression(effect.do, `${effectPath}.do`);
      }
    });
  }

  validateComponentDefinitions(components, path) {
    for (const [name, def] of Object.entries(components)) {
      const componentPath = `${path}.${name}`;

      if (!def.render) {
        this.errors.push(new ValidationError(
          'MISSING_COMPONENT_RENDER',
          `Component '${name}' must have render`,
          componentPath,
          [{ action: 'add_field', field: 'render' }]
        ));
      } else {
        this.validateNode(def.render, `${componentPath}.render`);
      }
    }
  }

  validateExpression(expr, path, params = []) {
    if (expr === null || typeof expr !== 'object') {
      return; // Literal values are always valid
    }

    if (Array.isArray(expr)) {
      expr.forEach((item, i) => this.validateExpression(item, `${path}[${i}]`, params));
      return;
    }

    if ('ref' in expr) {
      // Will be validated in reference phase
      return;
    }

    if ('context' in expr) {
      // Will be validated in reference phase
      return;
    }

    if ('param' in expr) {
      if (!params.includes(expr.param)) {
        this.errors.push(new ValidationError(
          'UNDEFINED_PARAM',
          `Parameter '${expr.param}' is not defined`,
          path,
          [{ action: 'add_param', name: expr.param }]
        ));
      }
      return;
    }

    if ('op' in expr) {
      // Operation - validate args
      if (expr.args) {
        expr.args.forEach((arg, i) => this.validateExpression(arg, `${path}.args[${i}]`, params));
      }
      return;
    }

    // Object literal
    for (const [key, value] of Object.entries(expr)) {
      this.validateExpression(value, `${path}.${key}`, params);
    }
  }

  validateNode(node, path, depth = 0) {
    // Security: Check nesting depth
    if (depth > LIMITS.MAX_NESTING_DEPTH) {
      this.errors.push(new ValidationError(
        'MAX_NESTING_DEPTH_EXCEEDED',
        `Node nesting too deep (max ${LIMITS.MAX_NESTING_DEPTH})`,
        path
      ));
      return;
    }

    if (!node || typeof node !== 'object') {
      this.errors.push(new ValidationError(
        'INVALID_NODE',
        'Node must be an object',
        path
      ));
      return;
    }

    // Text node
    if ('text' in node) return;

    // Binding node
    if ('bind' in node) return;

    // Conditional node
    if ('if' in node && 'then' in node) {
      this.validateExpression(node.if, `${path}.if`);
      this.validateNode(node.then, `${path}.then`, depth + 1);
      if (node.else) this.validateNode(node.else, `${path}.else`, depth + 1);
      return;
    }

    // Component reference
    if ('component' in node) return;

    // Context provider node
    if ('provide' in node) {
      if (!node.provide.context) {
        this.errors.push(new ValidationError(
          'MISSING_PROVIDER_CONTEXT',
          'Provider is missing context',
          `${path}.provide`
        ));
      }
      if (!node.provide.value) {
        this.errors.push(new ValidationError(
          'MISSING_PROVIDER_VALUE',
          'Provider is missing value',
          `${path}.provide`
        ));
      }
      if (!node.provide.children || node.provide.children.length === 0) {
        this.errors.push(new ValidationError(
          'MISSING_PROVIDER_CHILDREN',
          'Provider must have children',
          `${path}.provide`
        ));
      } else {
        node.provide.children.forEach((child, i) =>
          this.validateNode(child, `${path}.provide.children[${i}]`, depth + 1)
        );
      }
      return;
    }

    // Portal node
    if ('portal' in node) {
      if (!node.portal.target) {
        this.errors.push(new ValidationError(
          'MISSING_PORTAL_TARGET',
          'Portal is missing target',
          `${path}.portal`
        ));
      }
      if (!node.portal.children || node.portal.children.length === 0) {
        this.errors.push(new ValidationError(
          'MISSING_PORTAL_CHILDREN',
          'Portal must have children',
          `${path}.portal`
        ));
      } else {
        node.portal.children.forEach((child, i) =>
          this.validateNode(child, `${path}.portal.children[${i}]`, depth + 1)
        );
      }
      return;
    }

    // Fragment node
    if ('fragment' in node) {
      if (!Array.isArray(node.fragment) || node.fragment.length === 0) {
        this.errors.push(new ValidationError(
          'INVALID_FRAGMENT',
          'Fragment must be a non-empty array',
          `${path}.fragment`
        ));
      } else {
        node.fragment.forEach((child, i) =>
          this.validateNode(child, `${path}.fragment[${i}]`, depth + 1)
        );
      }
      return;
    }

    // Error boundary node
    if ('errorBoundary' in node) {
      if (!node.errorBoundary.children || node.errorBoundary.children.length === 0) {
        this.errors.push(new ValidationError(
          'MISSING_ERROR_BOUNDARY_CHILDREN',
          'Error boundary must have children',
          `${path}.errorBoundary`
        ));
      } else {
        node.errorBoundary.children.forEach((child, i) =>
          this.validateNode(child, `${path}.errorBoundary.children[${i}]`, depth + 1)
        );
      }
      if (!node.errorBoundary.fallback) {
        this.errors.push(new ValidationError(
          'MISSING_ERROR_BOUNDARY_FALLBACK',
          'Error boundary must have fallback',
          `${path}.errorBoundary`
        ));
      } else {
        this.validateNode(node.errorBoundary.fallback, `${path}.errorBoundary.fallback`, depth + 1);
      }
      return;
    }

    // Element node
    if ('type' in node) {
      if (node.props) {
        for (const [key, value] of Object.entries(node.props)) {
          this.validateExpression(value, `${path}.props.${key}`);
        }
      }

      if (node.events) {
        for (const [event, handler] of Object.entries(node.events)) {
          if (!handler.action) {
            this.errors.push(new ValidationError(
              'MISSING_EVENT_ACTION',
              `Event '${event}' handler must have action`,
              `${path}.events.${event}`
            ));
          }
        }
      }

      if (node.children) {
        node.children.forEach((child, i) => this.validateNode(child, `${path}.children[${i}]`, depth + 1));
      }
      return;
    }

    this.errors.push(new ValidationError(
      'UNKNOWN_NODE_TYPE',
      'Unknown node type',
      path,
      [{ action: 'use_valid_node', options: ['text', 'bind', 'if/then', 'component', 'element with type'] }]
    ));
  }

  validateRoutes(routes, path) {
    routes.forEach((route, i) => {
      const routePath = `${path}[${i}]`;

      if (!route.method) {
        this.errors.push(new ValidationError(
          'MISSING_ROUTE_METHOD',
          'Route is missing method',
          routePath
        ));
      }

      if (!route.path) {
        this.errors.push(new ValidationError(
          'MISSING_ROUTE_PATH',
          'Route is missing path',
          routePath
        ));
      }
    });
  }

  validateCommands(commands, path) {
    commands.forEach((cmd, i) => {
      const cmdPath = `${path}[${i}]`;

      if (!cmd.name) {
        this.errors.push(new ValidationError(
          'MISSING_COMMAND_NAME',
          'Command is missing name',
          cmdPath
        ));
      }

      if (!cmd.handler) {
        this.errors.push(new ValidationError(
          'MISSING_COMMAND_HANDLER',
          'Command is missing handler',
          cmdPath
        ));
      }
    });
  }

  validateTests(tests, path) {
    if (!Array.isArray(tests)) {
      this.errors.push(new ValidationError(
        'INVALID_TESTS',
        'tests must be an array',
        path
      ));
      return;
    }

    const testIds = new Set();

    tests.forEach((test, i) => {
      const testPath = `${path}[${i}]`;

      // Validate required id
      if (!test.id) {
        this.errors.push(new ValidationError(
          'MISSING_TEST_ID',
          'Test is missing id',
          testPath,
          [{ action: 'add_field', field: 'id' }]
        ));
      } else {
        if (testIds.has(test.id)) {
          this.errors.push(new ValidationError(
            'DUPLICATE_TEST_ID',
            `Duplicate test id: ${test.id}`,
            testPath
          ));
        }
        testIds.add(test.id);
      }

      // Validate required steps
      if (!test.steps || !Array.isArray(test.steps) || test.steps.length === 0) {
        this.errors.push(new ValidationError(
          'MISSING_TEST_STEPS',
          'Test must have at least one step',
          testPath,
          [{ action: 'add_field', field: 'steps', value: [] }]
        ));
      } else {
        test.steps.forEach((step, j) => {
          this.validateTestStep(step, `${testPath}.steps[${j}]`);
        });
      }

      // Validate setup (if present)
      if (test.setup && typeof test.setup === 'object') {
        for (const key of Object.keys(test.setup)) {
          // Setup keys will be validated in reference phase
        }
      }

      // Validate timeout (if present)
      if (test.timeout !== undefined && typeof test.timeout !== 'number') {
        this.errors.push(new ValidationError(
          'INVALID_TEST_TIMEOUT',
          'Test timeout must be a number',
          `${testPath}.timeout`
        ));
      }
    });
  }

  validateTestStep(step, path) {
    const stepTypes = ['assert', 'dispatch', 'wait', 'setState'];
    const foundTypes = stepTypes.filter(t => t in step);

    if (foundTypes.length === 0) {
      this.errors.push(new ValidationError(
        'INVALID_TEST_STEP',
        'Test step must be assert, dispatch, wait, or setState',
        path,
        [{ action: 'add_step_type', options: stepTypes }]
      ));
      return;
    }

    if (foundTypes.length > 1) {
      this.errors.push(new ValidationError(
        'AMBIGUOUS_TEST_STEP',
        'Test step can only have one type',
        path
      ));
      return;
    }

    // Validate assert step
    if ('assert' in step) {
      this.validateTestAssertion(step.assert, `${path}.assert`);
    }

    // Validate dispatch step
    if ('dispatch' in step) {
      if (typeof step.dispatch !== 'string') {
        this.errors.push(new ValidationError(
          'INVALID_DISPATCH_ACTION',
          'dispatch must be an action name (string)',
          `${path}.dispatch`
        ));
      }
      // Action existence validated in reference phase
    }

    // Validate wait step
    if ('wait' in step && typeof step.wait !== 'number') {
      this.errors.push(new ValidationError(
        'INVALID_WAIT_VALUE',
        'wait must be a number (milliseconds)',
        `${path}.wait`
      ));
    }

    // Validate setState step
    if ('setState' in step) {
      if (typeof step.setState !== 'object' || step.setState === null) {
        this.errors.push(new ValidationError(
          'INVALID_SETSTATE_VALUE',
          'setState must be an object',
          `${path}.setState`
        ));
      }
      // State keys validated in reference phase
    }
  }

  validateTestAssertion(assertion, path) {
    if (!assertion || typeof assertion !== 'object') {
      this.errors.push(new ValidationError(
        'INVALID_ASSERTION',
        'Assertion must be an object',
        path
      ));
      return;
    }

    const valueKeys = ['ref', 'context', 'value'];
    const foundValueKeys = valueKeys.filter(k => k in assertion);

    if (foundValueKeys.length === 0) {
      this.errors.push(new ValidationError(
        'MISSING_ASSERTION_TARGET',
        'Assertion must specify ref, context, or value',
        path,
        [{ action: 'add_field', options: valueKeys }]
      ));
    }

    // Validate assertion operators exist
    const assertionOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains',
                          'length', 'matches', 'type', 'deepEquals', 'truthy', 'falsy'];
    const foundOps = assertionOps.filter(op => op in assertion);

    if (foundOps.length === 0) {
      this.errors.push(new ValidationError(
        'MISSING_ASSERTION_OP',
        'Assertion must specify an operation (eq, neq, gt, etc.)',
        path,
        [{ action: 'add_assertion_op', options: assertionOps }]
      ));
    }

    // Validate type assertion value
    if ('type' in assertion) {
      const validTypes = ['string', 'number', 'boolean', 'array', 'object', 'null', 'undefined'];
      if (!validTypes.includes(assertion.type)) {
        this.errors.push(new ValidationError(
          'INVALID_TYPE_ASSERTION',
          `Invalid type: ${assertion.type}`,
          `${path}.type`,
          [{ action: 'use_valid_type', options: validTypes }]
        ));
      }
    }

    // Ref validation happens in reference phase
  }

  collectDefinitions(program) {
    if (program.contexts) {
      Object.keys(program.contexts).forEach(name => this.definedContexts.add(name));
    }
    if (program.state) {
      Object.keys(program.state).forEach(name => this.definedStates.add(name));
    }
    if (program.computed) {
      Object.keys(program.computed).forEach(name => this.definedComputed.add(name));
    }
    if (program.actions) {
      Object.keys(program.actions).forEach(name => this.definedActions.add(name));
    }
    if (program.components) {
      Object.keys(program.components).forEach(name => this.definedComponents.add(name));
    }
  }

  validateReferences(program) {
    // Validate computed deps
    if (program.computed) {
      for (const [name, def] of Object.entries(program.computed)) {
        if (def.deps) {
          def.deps.forEach(dep => {
            if (!this.definedStates.has(dep) && !this.definedComputed.has(dep)) {
              this.errors.push(new ValidationError(
                'UNDEFINED_DEPENDENCY',
                `Computed '${name}' depends on undefined '${dep}'`,
                `$.computed.${name}.deps`,
                [{ action: 'define_state', name: dep }]
              ));
            }
          });
        }
      }
    }

    // Validate effect watches
    if (program.effects) {
      program.effects.forEach((effect, i) => {
        if (effect.watch) {
          effect.watch.forEach(watch => {
            if (!this.definedStates.has(watch) && !this.definedComputed.has(watch)) {
              this.errors.push(new ValidationError(
                'UNDEFINED_WATCH',
                `Effect '${effect.id}' watches undefined '${watch}'`,
                `$.effects[${i}].watch`,
                [{ action: 'define_state', name: watch }]
              ));
            }
          });
        }
      });
    }

    // Validate action mutation targets
    if (program.actions) {
      for (const [name, def] of Object.entries(program.actions)) {
        if (def.mutations) {
          def.mutations.forEach((mutation, i) => {
            if (mutation.target && !this.definedStates.has(mutation.target)) {
              this.errors.push(new ValidationError(
                'UNDEFINED_MUTATION_TARGET',
                `Action '${name}' mutates undefined state '${mutation.target}'`,
                `$.actions.${name}.mutations[${i}].target`,
                [{ action: 'define_state', name: mutation.target }]
              ));
            }
          });
        }
      }
    }

    // Validate test references
    if (program.tests) {
      program.tests.forEach((test, i) => {
        const testPath = `$.tests[${i}]`;

        // Validate setup references
        if (test.setup) {
          for (const key of Object.keys(test.setup)) {
            if (!this.definedStates.has(key)) {
              this.errors.push(new ValidationError(
                'UNDEFINED_SETUP_STATE',
                `Test setup references undefined state: ${key}`,
                `${testPath}.setup.${key}`,
                [{ action: 'define_state', name: key }]
              ));
            }
          }
        }

        // Validate step references
        if (test.steps) {
          test.steps.forEach((step, j) => {
            const stepPath = `${testPath}.steps[${j}]`;

            // Validate dispatch action
            if ('dispatch' in step && !this.definedActions.has(step.dispatch)) {
              this.errors.push(new ValidationError(
                'UNDEFINED_TEST_ACTION',
                `Test dispatches undefined action: ${step.dispatch}`,
                `${stepPath}.dispatch`,
                [{ action: 'define_action', name: step.dispatch }]
              ));
            }

            // Validate setState targets
            if ('setState' in step && step.setState) {
              for (const key of Object.keys(step.setState)) {
                if (!this.definedStates.has(key)) {
                  this.errors.push(new ValidationError(
                    'UNDEFINED_SETSTATE_TARGET',
                    `Test setState targets undefined state: ${key}`,
                    `${stepPath}.setState.${key}`,
                    [{ action: 'define_state', name: key }]
                  ));
                }
              }
            }

            // Validate assertion refs
            if ('assert' in step && step.assert) {
              if ('ref' in step.assert) {
                const refName = step.assert.ref.split('.')[0];
                if (!this.definedStates.has(refName) && !this.definedComputed.has(refName)) {
                  this.errors.push(new ValidationError(
                    'UNDEFINED_ASSERTION_REF',
                    `Test assertion references undefined: ${step.assert.ref}`,
                    `${stepPath}.assert.ref`,
                    [{ action: 'define_state', name: refName }]
                  ));
                }
              }

              if ('context' in step.assert) {
                const contextName = step.assert.context.split('.')[0];
                if (!this.definedContexts.has(contextName)) {
                  this.errors.push(new ValidationError(
                    'UNDEFINED_ASSERTION_CONTEXT',
                    `Test assertion references undefined context: ${contextName}`,
                    `${stepPath}.assert.context`,
                    [{ action: 'define_context', name: contextName }]
                  ));
                }
              }
            }
          });
        }
      });
    }

    // Validate refs in expressions (recursive)
    this.validateRefsInObject(program, '$');
  }

  validateRefsInObject(obj, path) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => this.validateRefsInObject(item, `${path}[${i}]`));
      return;
    }

    if ('ref' in obj) {
      const refName = obj.ref.split('.')[0]; // Handle nested refs like "todo.text"
      if (!this.definedStates.has(refName) && !this.definedComputed.has(refName)) {
        // Check if it's a loop variable (handled at runtime)
        // Skip validation for common loop variables
        if (!['item', 'index', 'todo', 'i', 'user', '_'].includes(refName)) {
          this.errors.push(new ValidationError(
            'UNDEFINED_REF',
            `Reference to undefined '${obj.ref}'`,
            path,
            [{ action: 'define_state', name: refName }]
          ));
        }
      }
      return;
    }

    if ('context' in obj) {
      const contextName = obj.context.split('.')[0]; // Handle nested like "theme.mode"
      if (!this.definedContexts.has(contextName)) {
        this.errors.push(new ValidationError(
          'UNDEFINED_CONTEXT',
          `Reference to undefined context '${contextName}'`,
          path,
          [{ action: 'define_context', name: contextName }]
        ));
      }
      return;
    }

    if ('action' in obj) {
      if (!this.definedActions.has(obj.action)) {
        this.errors.push(new ValidationError(
          'UNDEFINED_ACTION',
          `Reference to undefined action '${obj.action}'`,
          path,
          [{ action: 'define_action', name: obj.action }]
        ));
      }
      return;
    }

    if ('component' in obj) {
      if (!this.definedComponents.has(obj.component)) {
        this.errors.push(new ValidationError(
          'UNDEFINED_COMPONENT',
          `Reference to undefined component '${obj.component}'`,
          path,
          [{ action: 'define_component', name: obj.component }]
        ));
      }
      return;
    }

    if ('provide' in obj && obj.provide.context) {
      if (!this.definedContexts.has(obj.provide.context)) {
        this.errors.push(new ValidationError(
          'UNDEFINED_PROVIDER_CONTEXT',
          `Provider references undefined context '${obj.provide.context}'`,
          `${path}.provide.context`,
          [{ action: 'define_context', name: obj.provide.context }]
        ));
      }
    }

    for (const [key, value] of Object.entries(obj)) {
      this.validateRefsInObject(value, `${path}.${key}`);
    }
  }

  isUnionType(type) {
    return typeof type === 'object' && 'union' in type;
  }
}

/**
 * Validate an ddjex program
 * @param {Object} program - The program to validate
 * @returns {Object} Validation result with errors
 */
function validate(program) {
  const validator = new Validator();
  return validator.validate(program);
}

export { Validator, validate, ValidationError };
