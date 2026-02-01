/**
 * DDJEX Test Runner
 * Runs spec conformance tests
 */

import { createApp, Runtime } from '../src/index.js';
import {
  StateManager,
  ContextManager,
  EffectNode,
  AsyncEffectNode,
  IntervalEffectNode,
  TimeoutEffectNode,
  Scheduler
} from '../src/core/state.js';
import { validate } from '../src/core/validator.js';
import { Operations, AsyncOperations } from '../src/core/operations.js';
import { WebSocketManager } from '../src/core/websocket.js';
import {
  Validators,
  validateValue,
  validateForm,
  createFormState,
  ValidationOperations
} from '../src/core/form-validation.js';
import { RouterManager } from '../src/core/router.js';
import { TestRunner, runTests as runSelfTests, AssertionError } from '../src/core/test-runner.js';
import { HMRClient } from '../src/dev/hmr.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class TestTarget {
  mount(runtime) { return this; }
  unmount(runtime) { return this; }
}

async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  console.log('DDJEX Test Runner\n================\n');

  // Run unit tests
  await runUnitTests(results);

  // Run spec conformance tests
  await runSpecTests(results);

  // Summary
  console.log('\n================');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);

  if (results.failed > 0) {
    console.log('\nFailures:');
    for (const error of results.errors) {
      console.log(`  - ${error.test}: ${error.message}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

async function runUnitTests(results) {
  console.log('Unit Tests\n----------');

  // Test: State management
  test('State: basic get/set', () => {
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 0 });
    assert(sm.get('count') === 0, 'Initial value should be 0');
    sm.set('count', 5);
    assert(sm.get('count') === 5, 'Value should be 5 after set');
  }, results);

  // Test: Mutations
  test('State: mutations', () => {
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 10 });
    sm.mutate('count', 'add', 5);
    assert(sm.get('count') === 15, 'add should work');
    sm.mutate('count', 'subtract', 3);
    assert(sm.get('count') === 12, 'subtract should work');
    sm.mutate('count', 'multiply', 2);
    assert(sm.get('count') === 24, 'multiply should work');
  }, results);

  // Test: Array mutations
  test('State: array mutations', () => {
    const sm = new StateManager();
    sm.defineState('items', { type: 'array', initial: [] });
    sm.mutate('items', 'push', 'a');
    assert(sm.get('items').length === 1, 'push should add item');
    sm.mutate('items', 'push', 'b');
    assert(sm.get('items').length === 2, 'push should add second item');
    assert(sm.get('items')[0] === 'a', 'first item should be a');
  }, results);

  // Test: Runtime validation
  test('Runtime: validation', () => {
    const valid = Runtime.validate({ $ddjex: '0.1.0', id: 'test', target: 'dom' });
    assert(valid.valid === true, 'Valid program should pass');

    const invalid = Runtime.validate({ id: 'test' });
    assert(invalid.valid === false, 'Missing $ddjex should fail');
    assert(invalid.errors.some(e => e.code === 'MISSING_VERSION'), 'Should have MISSING_VERSION error');
  }, results);

  // Test: Action dispatch
  test('Runtime: action dispatch', () => {
    const program = {
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      state: {
        count: { type: 'number', initial: 0 }
      },
      actions: {
        increment: {
          mutations: [{ target: 'count', op: 'add', value: 1 }]
        },
        add: {
          params: ['amount'],
          mutations: [{ target: 'count', op: 'add', value: { param: 'amount' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    assert(runtime.getState().count === 0, 'Initial count should be 0');
    runtime.dispatch('increment');
    assert(runtime.getState().count === 1, 'Count should be 1 after increment');
    runtime.dispatch('add', 5);
    assert(runtime.getState().count === 6, 'Count should be 6 after add(5)');
  }, results);

  // Test: Computed values
  test('Runtime: computed values', () => {
    const program = {
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      state: {
        count: { type: 'number', initial: 5 }
      },
      computed: {
        doubled: {
          deps: ['count'],
          fn: { op: 'multiply', args: [{ ref: 'count' }, 2] }
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    assert(runtime.stateManager.get('doubled') === 10, 'Doubled should be 10');
  }, results);

  // Test: Validator
  test('Validator: valid program passes', () => {
    const result = validate({ $ddjex: '0.1.0', id: 'test', target: 'dom' });
    assert(result.valid === true, 'Valid program should pass');
  }, results);

  test('Validator: missing fields detected', () => {
    const result = validate({ id: 'test' });
    assert(result.valid === false, 'Missing $ddjex should fail');
    assert(result.errors.some(e => e.code === 'MISSING_VERSION'), 'Should have MISSING_VERSION error');
    assert(result.errors.some(e => e.code === 'MISSING_TARGET'), 'Should have MISSING_TARGET error');
  }, results);

  test('Validator: invalid target detected', () => {
    const result = validate({ $ddjex: '0.1.0', id: 'test', target: 'invalid' });
    assert(result.valid === false, 'Invalid target should fail');
    assert(result.errors.some(e => e.code === 'INVALID_TARGET'), 'Should have INVALID_TARGET error');
  }, results);

  test('Validator: state validation', () => {
    const result = validate({
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      state: {
        count: { type: 'number' } // missing initial
      }
    });
    assert(result.valid === false, 'Missing initial should fail');
    assert(result.errors.some(e => e.code === 'MISSING_INITIAL_VALUE'), 'Should have MISSING_INITIAL_VALUE error');
  }, results);

  // Test: Operations
  test('Operations: math operations', () => {
    assert(Operations.add(2, 3) === 5, 'add should work');
    assert(Operations.multiply(4, 5) === 20, 'multiply should work');
    assert(Operations.modulo(10, 3) === 1, 'modulo should work');
  }, results);

  test('Operations: array operations', () => {
    assert(Operations.length([1, 2, 3]) === 3, 'length should work');
    assert(Operations.first([1, 2, 3]) === 1, 'first should work');
    assert(Operations.last([1, 2, 3]) === 3, 'last should work');
    assert(Operations.includes([1, 2, 3], 2) === true, 'includes should work');
  }, results);

  test('Operations: string operations', () => {
    assert(Operations.toUpperCase('hello') === 'HELLO', 'toUpperCase should work');
    assert(Operations.trim('  hello  ') === 'hello', 'trim should work');
  }, results);

  test('Operations: date operations', () => {
    const now = Operations.now();
    assert(typeof now === 'number', 'now should return number');
    assert(now > 0, 'now should be positive');
  }, results);

  test('Operations: uuid generation', () => {
    const id = Operations.uuid();
    assert(typeof id === 'string', 'uuid should return string');
    assert(id.length > 0, 'uuid should not be empty');
  }, results);

  // Test: Async operations exist
  test('AsyncOperations: fetch exists', () => {
    assert(typeof AsyncOperations.fetch === 'function', 'fetch should exist');
    assert(typeof AsyncOperations.delay === 'function', 'delay should exist');
    assert(typeof AsyncOperations.parallel === 'function', 'parallel should exist');
  }, results);

  // Test: SSR rendering
  await testAsync('SSR: renderToString', async () => {
    const { renderToString } = await import('../src/targets/ssr.js');
    const program = {
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      state: {
        name: { type: 'string', initial: 'World' }
      },
      root: {
        type: 'div',
        children: [
          { text: 'Hello, ' },
          { bind: 'name' },
          { text: '!' }
        ]
      }
    };

    const html = await renderToString(program);
    assert(html.includes('Hello,'), 'Should contain Hello');
    assert(html.includes('World'), 'Should contain state value');
    assert(html.includes('<div>'), 'Should be wrapped in div');
  }, results);

  // ===== EFFECTS TESTS (v0.1.0) =====

  test('Effects: basic watch effect runs on state change', () => {
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 0 });

    let effectRuns = 0;
    const resolver = (expr) => { effectRuns++; };

    sm.defineEffect('logCount', {
      watch: ['count'],
      do: { op: 'log', args: [{ ref: 'count' }] }
    }, resolver, () => {});

    // Effect runs once on define
    assert(effectRuns === 1, 'Effect should run on define');

    // Change state
    sm.set('count', 5);
    assert(effectRuns === 2, 'Effect should run on state change');

    sm.set('count', 10);
    assert(effectRuns === 3, 'Effect should run again on state change');
  }, results);

  test('Effects: effect does not run when state is same value', () => {
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 5 });

    let effectRuns = 0;
    sm.defineEffect('noChange', {
      watch: ['count'],
      do: { op: 'log', args: [] }
    }, () => { effectRuns++; }, () => {});

    assert(effectRuns === 1, 'Effect runs once on define');

    sm.set('count', 5); // Same value
    assert(effectRuns === 1, 'Effect should not run for same value');
  }, results);

  test('Effects: effect watches multiple states', () => {
    const sm = new StateManager();
    sm.defineState('a', { type: 'number', initial: 0 });
    sm.defineState('b', { type: 'number', initial: 0 });

    let effectRuns = 0;
    sm.defineEffect('multi', {
      watch: ['a', 'b'],
      do: { op: 'log', args: [] }
    }, () => { effectRuns++; }, () => {});

    assert(effectRuns === 1, 'Effect runs once on define');

    sm.set('a', 1);
    assert(effectRuns === 2, 'Effect runs on a change');

    sm.set('b', 1);
    assert(effectRuns === 3, 'Effect runs on b change');
  }, results);

  test('Effects: disposed effect does not run', () => {
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 0 });

    let effectRuns = 0;
    const node = sm.defineEffect('disposed', {
      watch: ['count'],
      do: { op: 'log', args: [] }
    }, () => { effectRuns++; }, () => {});

    assert(effectRuns === 1, 'Effect runs once');
    node.dispose();

    sm.set('count', 10);
    assert(effectRuns === 1, 'Disposed effect should not run');
  }, results);

  // ===== ASYNC EFFECTS TESTS (v0.2.0) =====

  await testAsync('AsyncEffects: executes with lifecycle hooks', async () => {
    let onStartCalled = false;
    let onSuccessCalled = false;
    let doResult = null;

    const resolver = (expr, params) => {
      if (expr === 'onStart') onStartCalled = true;
      if (expr === 'onSuccess') onSuccessCalled = true;
      if (expr === 'do') {
        doResult = 'done';
        return Promise.resolve('result');
      }
    };

    const node = new AsyncEffectNode('test', {
      onStart: 'onStart',
      do: 'do',
      onSuccess: 'onSuccess'
    }, resolver, () => {});

    await node.run();

    // Wait for async execution
    await new Promise(r => setTimeout(r, 10));

    assert(onStartCalled === true, 'onStart should be called');
    assert(doResult === 'done', 'do should be executed');
    assert(onSuccessCalled === true, 'onSuccess should be called');
  }, results);

  await testAsync('AsyncEffects: calls onError on failure', async () => {
    let onErrorCalled = false;
    let errorData = null;

    const resolver = (expr, params) => {
      if (expr === 'do') {
        return Promise.reject(new Error('Test error'));
      }
      if (expr === 'onError') {
        onErrorCalled = true;
        errorData = params.error;
      }
    };

    const node = new AsyncEffectNode('test', {
      do: 'do',
      onError: 'onError'
    }, resolver, () => {});

    await node.run();
    await new Promise(r => setTimeout(r, 10));

    assert(onErrorCalled === true, 'onError should be called');
    assert(errorData && errorData.message === 'Test error', 'Error message should be passed');
  }, results);

  await testAsync('AsyncEffects: cleanup runs on dispose', async () => {
    let cleanupRan = false;

    const resolver = (expr, params) => {
      if (expr === 'do') return Promise.resolve('result');
      if (expr === 'cleanup') cleanupRan = true;
    };

    const node = new AsyncEffectNode('test', {
      do: 'do',
      cleanup: 'cleanup'
    }, resolver, () => {});

    await node.run();
    await new Promise(r => setTimeout(r, 10));

    node.dispose();
    assert(cleanupRan === true, 'Cleanup should run on dispose');
  }, results);

  await testAsync('AsyncEffects: debounce delays execution', async () => {
    let executionCount = 0;

    const resolver = (expr) => {
      if (expr === 'do') executionCount++;
    };

    const node = new AsyncEffectNode('test', {
      do: 'do',
      debounce: 50
    }, resolver, () => {});

    // Rapid fire calls
    node.run();
    node.run();
    node.run();

    assert(executionCount === 0, 'Should not execute immediately with debounce');

    await new Promise(r => setTimeout(r, 70));
    assert(executionCount === 1, 'Should execute once after debounce period');

    node.dispose();
  }, results);

  await testAsync('AsyncEffects: throttle limits execution rate', async () => {
    let executionCount = 0;

    const resolver = (expr) => {
      if (expr === 'do') executionCount++;
    };

    const node = new AsyncEffectNode('test', {
      do: 'do',
      throttle: 50
    }, resolver, () => {});

    // First call executes immediately
    await node.run();
    assert(executionCount === 1, 'First call should execute');

    // Rapid calls within throttle period
    node.run();
    node.run();
    await new Promise(r => setTimeout(r, 20));
    assert(executionCount === 1, 'Throttled calls should not execute yet');

    await new Promise(r => setTimeout(r, 50));
    assert(executionCount === 2, 'Throttled call should execute after period');

    node.dispose();
  }, results);

  // ===== TIMER EFFECTS TESTS (v0.2.0) =====

  await testAsync('IntervalEffect: executes repeatedly', async () => {
    let count = 0;
    const fn = () => { count++; };
    const node = new IntervalEffectNode('test', fn, 30);

    node.start();
    await new Promise(r => setTimeout(r, 100));
    node.dispose();

    assert(count >= 2, `Interval should run multiple times, got ${count}`);
  }, results);

  await testAsync('IntervalEffect: stops on dispose', async () => {
    let count = 0;
    const fn = () => { count++; };
    const node = new IntervalEffectNode('test', fn, 20);

    node.start();
    await new Promise(r => setTimeout(r, 50));
    const countAtDispose = count;
    node.dispose();

    await new Promise(r => setTimeout(r, 50));
    assert(count === countAtDispose, 'Interval should stop after dispose');
  }, results);

  await testAsync('TimeoutEffect: executes once after delay', async () => {
    let executed = false;
    const fn = () => { executed = true; };
    const node = new TimeoutEffectNode('test', fn, 30);

    node.start();
    assert(executed === false, 'Should not execute immediately');

    await new Promise(r => setTimeout(r, 50));
    assert(executed === true, 'Should execute after timeout');

    node.dispose();
  }, results);

  await testAsync('TimeoutEffect: can be cancelled before execution', async () => {
    let executed = false;
    const fn = () => { executed = true; };
    const node = new TimeoutEffectNode('test', fn, 50);

    node.start();
    await new Promise(r => setTimeout(r, 20));
    node.dispose();

    await new Promise(r => setTimeout(r, 50));
    assert(executed === false, 'Cancelled timeout should not execute');
  }, results);

  // ===== WEBSOCKET TESTS (v0.1.0) =====

  test('WebSocketManager: event registration and emission', () => {
    const wsm = new WebSocketManager();
    let receivedData = null;

    // Register handler
    const unsubscribe = wsm.on('test', 'message', (data) => {
      receivedData = data;
    });

    // Emit event
    wsm.emit('test', 'message', { text: 'hello' });

    assert(receivedData !== null, 'Handler should receive data');
    assert(receivedData.text === 'hello', 'Data should be correct');

    // Unsubscribe
    unsubscribe();
    receivedData = null;
    wsm.emit('test', 'message', { text: 'world' });
    assert(receivedData === null, 'Unsubscribed handler should not receive');
  }, results);

  test('WebSocketManager: wildcard event handlers', () => {
    const wsm = new WebSocketManager();
    let events = [];

    wsm.on('test', '*', (data) => {
      events.push(data);
    });

    wsm.emit('test', 'open', { id: 'test' });
    wsm.emit('test', 'message', { data: 'hi' });
    wsm.emit('test', 'close', { code: 1000 });

    assert(events.length === 3, 'Wildcard handler should receive all events');
    assert(events[0].event === 'open', 'First event should be open');
    assert(events[1].event === 'message', 'Second event should be message');
    assert(events[2].event === 'close', 'Third event should be close');
  }, results);

  test('WebSocketManager: status returns not_found for unknown', () => {
    const wsm = new WebSocketManager();
    const status = wsm.status('nonexistent');
    assert(status.status === 'not_found', 'Unknown connection should return not_found');
  }, results);

  test('WebSocketManager: send returns error when not connected', () => {
    const wsm = new WebSocketManager();
    const result = wsm.send('test', { data: 'hello' });
    assert(result.error === true, 'Send should return error');
    assert(result.code === 'WS_NOT_CONNECTED', 'Should have correct error code');
  }, results);

  test('WebSocketManager: disconnect returns error for unknown', () => {
    const wsm = new WebSocketManager();
    const result = wsm.disconnect('nonexistent');
    assert(result.error === true, 'Disconnect should return error');
    assert(result.code === 'WS_NOT_FOUND', 'Should have correct error code');
  }, results);

  // ===== FORM VALIDATION TESTS (v0.1.0) =====

  test('FormValidation: isEmail', () => {
    assert(ValidationOperations.isEmail('test@example.com') === true, 'Valid email');
    assert(ValidationOperations.isEmail('user.name@domain.org') === true, 'Valid email with dot');
    assert(ValidationOperations.isEmail('invalid') === false, 'Invalid email');
    assert(ValidationOperations.isEmail('no@tld') === false, 'No TLD');
  }, results);

  test('FormValidation: isNumeric', () => {
    assert(ValidationOperations.isNumeric('123') === true, 'Integer');
    assert(ValidationOperations.isNumeric('45.67') === true, 'Decimal');
    assert(ValidationOperations.isNumeric('-89') === true, 'Negative');
    assert(ValidationOperations.isNumeric('abc') === false, 'Letters');
    assert(ValidationOperations.isNumeric('12a34') === false, 'Mixed');
  }, results);

  test('FormValidation: isUrl', () => {
    assert(ValidationOperations.isUrl('https://example.com') === true, 'HTTPS URL');
    assert(ValidationOperations.isUrl('http://test.org/path') === true, 'HTTP with path');
    assert(ValidationOperations.isUrl('example.com') === false, 'Missing protocol');
  }, results);

  test('FormValidation: Validators minLength and maxLength', () => {
    assert(Validators.minLength('hello', { min: 3 }).valid === true, 'Above min');
    assert(Validators.minLength('hi', { min: 3 }).valid === false, 'Below min');
    assert(Validators.maxLength('hi', { max: 5 }).valid === true, 'Below max');
    assert(Validators.maxLength('hello world', { max: 5 }).valid === false, 'Above max');
  }, results);

  test('FormValidation: Validators required', () => {
    assert(Validators.required('text').valid === true, 'Has value');
    assert(Validators.required('').valid === false, 'Empty string');
    assert(Validators.required(null).valid === false, 'Null');
    assert(Validators.required(undefined).valid === false, 'Undefined');
  }, results);

  test('FormValidation: Validators pattern', () => {
    assert(Validators.pattern('abc123', { pattern: '^[a-z]+[0-9]+$' }).valid === true, 'Matches');
    assert(Validators.pattern('123abc', { pattern: '^[a-z]+[0-9]+$' }).valid === false, 'No match');
  }, results);

  test('FormValidation: validateValue with multiple rules', () => {
    const rules = [
      { type: 'required' },
      { type: 'minLength', min: 5 }
    ];

    const valid = validateValue('hello', rules);
    assert(valid.valid === true, 'Passes all rules');

    const invalid = validateValue('hi', rules);
    assert(invalid.valid === false, 'Fails minLength');
    assert(invalid.errors.length > 0, 'Has errors');
  }, results);

  test('FormValidation: validateForm', () => {
    const schema = {
      email: [{ type: 'required' }, { type: 'email' }],
      name: [{ type: 'required' }, { type: 'minLength', min: 2 }]
    };

    const validResult = validateForm(
      { email: 'test@example.com', name: 'John' },
      schema
    );
    assert(validResult.valid === true, 'Valid form passes');

    const invalidResult = validateForm(
      { email: 'invalid', name: 'J' },
      schema
    );
    assert(invalidResult.valid === false, 'Invalid form fails');
    assert('email' in invalidResult.errors, 'Has email error');
    assert('name' in invalidResult.errors, 'Has name error');
  }, results);

  test('FormValidation: createFormState', () => {
    const formState = createFormState(
      { email: '', name: '' },
      { email: [{ type: 'email' }] }
    );

    let state = formState.getState();
    assert(state.values.email === '', 'Initial values set');

    formState.setValue('email', 'test@example.com');
    state = formState.getState();
    assert(state.values.email === 'test@example.com', 'Value updated');
    assert(state.dirty.email === true, 'Field marked dirty');

    formState.setTouched('email');
    state = formState.getState();
    assert(state.touched.email === true, 'Field marked touched');

    formState.reset();
    state = formState.getState();
    assert(state.values.email === '', 'Reset to initial values');
    assert(Object.keys(state.touched).length === 0, 'Touched cleared');
  }, results);

  // ===== STATE MANAGER EDGE CASES =====

  test('StateManager: batch updates notify once', () => {
    const sm = new StateManager();
    sm.defineState('a', { type: 'number', initial: 0 });
    sm.defineState('b', { type: 'number', initial: 0 });

    let effectRuns = 0;
    sm.defineEffect('batched', {
      watch: ['a', 'b'],
      do: { op: 'log', args: [] }
    }, () => { effectRuns++; }, () => {});

    const initialRuns = effectRuns;

    sm.batch(() => {
      sm.set('a', 1);
      sm.set('b', 2);
    });

    // Batch should combine updates
    assert(effectRuns === initialRuns + 1, `Effect should run once for batch, got ${effectRuns - initialRuns} runs`);
  }, results);

  test('StateManager: toggle mutation', () => {
    const sm = new StateManager();
    sm.defineState('flag', { type: 'boolean', initial: false });

    sm.mutate('flag', 'toggle');
    assert(sm.get('flag') === true, 'Toggle false to true');

    sm.mutate('flag', 'toggle');
    assert(sm.get('flag') === false, 'Toggle true to false');
  }, results);

  test('StateManager: array shift/unshift mutations', () => {
    const sm = new StateManager();
    sm.defineState('items', { type: 'array', initial: ['b', 'c'] });

    sm.mutate('items', 'unshift', 'a');
    assert(sm.get('items')[0] === 'a', 'unshift adds to front');
    assert(sm.get('items').length === 3, 'Length is 3');

    sm.mutate('items', 'shift');
    assert(sm.get('items')[0] === 'b', 'shift removes from front');
    assert(sm.get('items').length === 2, 'Length is 2');
  }, results);

  test('StateManager: object merge mutation', () => {
    const sm = new StateManager();
    sm.defineState('user', { type: 'object', initial: { name: 'John' } });

    sm.mutate('user', 'merge', { age: 30 });
    const user = sm.get('user');
    assert(user.name === 'John', 'Keeps existing property');
    assert(user.age === 30, 'Adds new property');
  }, results);

  test('StateManager: computed chain propagation', () => {
    const sm = new StateManager();
    sm.defineState('base', { type: 'number', initial: 2 });

    let resolveCount = 0;
    const resolver = (expr) => {
      resolveCount++;
      if (expr.ref === 'base') return sm.get('base');
      if (expr.op === 'multiply') {
        return resolver(expr.args[0]) * expr.args[1];
      }
    };

    sm.defineComputed('doubled', {
      deps: ['base'],
      fn: { op: 'multiply', args: [{ ref: 'base' }, 2] }
    }, resolver);

    sm.defineComputed('quadrupled', {
      deps: ['doubled'],
      fn: { op: 'multiply', args: [{ ref: 'doubled' }, 2] }
    }, (expr) => {
      if (expr.ref === 'doubled') return sm.get('doubled');
      if (expr.op === 'multiply') {
        return sm.get('doubled') * expr.args[1];
      }
    });

    assert(sm.get('doubled') === 4, 'Doubled is 4');
    assert(sm.get('quadrupled') === 8, 'Quadrupled is 8');

    sm.set('base', 3);
    assert(sm.get('doubled') === 6, 'Doubled updates to 6');
    assert(sm.get('quadrupled') === 12, 'Quadrupled updates to 12');
  }, results);

  test('StateManager: throws on undefined state set', () => {
    const sm = new StateManager();
    let threw = false;
    try {
      sm.set('nonexistent', 5);
    } catch (e) {
      threw = true;
      assert(e.code === 'STATE_UNDEFINED', 'Should have correct error code');
    }
    assert(threw, 'Should throw on undefined state');
  }, results);

  test('StateManager: throws on invalid mutation op', () => {
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 0 });

    let threw = false;
    try {
      sm.mutate('count', 'invalid_op', 5);
    } catch (e) {
      threw = true;
      assert(e.code === 'INVALID_MUTATION_OP', 'Should have correct error code');
    }
    assert(threw, 'Should throw on invalid mutation');
  }, results);

  test('StateManager: getSnapshot returns all state', () => {
    const sm = new StateManager();
    sm.defineState('a', { type: 'number', initial: 1 });
    sm.defineState('b', { type: 'string', initial: 'hello' });

    const snapshot = sm.getSnapshot();
    assert(snapshot.a === 1, 'Snapshot has a');
    assert(snapshot.b === 'hello', 'Snapshot has b');
  }, results);

  test('StateManager: dispose clears all', () => {
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 0 });
    sm.defineComputed('doubled', {
      deps: ['count'],
      fn: { op: 'multiply', args: [{ ref: 'count' }, 2] }
    }, () => sm.get('count') * 2);

    sm.dispose();

    assert(sm.states.size === 0, 'States cleared');
    assert(sm.computed.size === 0, 'Computed cleared');
    assert(sm.effects.size === 0, 'Effects cleared');
  }, results);

  // ===== CONTEXT MANAGER TESTS (v0.2.0) =====

  test('ContextManager: define and get context', () => {
    const cm = new ContextManager();
    cm.defineContext('theme', { type: 'object', initial: { mode: 'light' } });

    const theme = cm.get('theme');
    assert(theme.mode === 'light', 'Should get initial value');
  }, results);

  test('ContextManager: set context value', () => {
    const cm = new ContextManager();
    cm.defineContext('theme', { type: 'object', initial: { mode: 'light' } });

    cm.set('theme', { mode: 'dark' });
    assert(cm.get('theme').mode === 'dark', 'Should update value');
  }, results);

  test('ContextManager: throws on set undefined context', () => {
    const cm = new ContextManager();
    let threw = false;
    try {
      cm.set('unknown', 'value');
    } catch (e) {
      threw = true;
      assert(e.code === 'CONTEXT_UNDEFINED', 'Should have correct error code');
    }
    assert(threw, 'Should throw for undefined context');
  }, results);

  test('ContextManager: provider stack', () => {
    const cm = new ContextManager();
    cm.defineContext('theme', { type: 'object', initial: { mode: 'light' } });

    assert(cm.get('theme').mode === 'light', 'Initial value');

    cm.pushProvider('theme', { mode: 'dark' });
    assert(cm.get('theme').mode === 'dark', 'Provider value takes precedence');

    cm.pushProvider('theme', { mode: 'custom' });
    assert(cm.get('theme').mode === 'custom', 'Nested provider takes precedence');

    cm.popProvider('theme');
    assert(cm.get('theme').mode === 'dark', 'Back to first provider');

    cm.popProvider('theme');
    assert(cm.get('theme').mode === 'light', 'Back to initial');
  }, results);

  test('ContextManager: getSnapshot', () => {
    const cm = new ContextManager();
    cm.defineContext('theme', { type: 'object', initial: { mode: 'light' } });
    cm.defineContext('user', { type: 'object', initial: null, nullable: true });

    const snapshot = cm.getSnapshot();
    assert(snapshot.theme.mode === 'light', 'Has theme');
    assert(snapshot.user === null, 'Has user');
  }, results);

  test('ContextManager: dispose', () => {
    const cm = new ContextManager();
    cm.defineContext('theme', { type: 'object', initial: { mode: 'light' } });
    cm.pushProvider('theme', { mode: 'dark' });

    cm.dispose();

    assert(cm.contexts.size === 0, 'Contexts cleared');
    assert(cm.providerStack.size === 0, 'Provider stack cleared');
  }, results);

  test('Context: runtime initialization', () => {
    const program = {
      $ddjex: '0.2.0',
      id: 'test',
      target: 'dom',
      contexts: {
        theme: { type: 'object', initial: { mode: 'light', primary: '#0066cc' } }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    assert(runtime.contextManager.get('theme').mode === 'light', 'Context initialized');
  }, results);

  test('Context: resolve context expression', () => {
    const program = {
      $ddjex: '0.2.0',
      id: 'test',
      target: 'dom',
      contexts: {
        theme: { type: 'object', initial: { mode: 'light', primary: '#0066cc' } }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    const result = runtime.resolve({ context: 'theme.mode' });
    assert(result === 'light', 'Should resolve context expression');
  }, results);

  test('Validator: validates context definitions', () => {
    const result = validate({
      $ddjex: '0.2.0',
      id: 'test',
      target: 'dom',
      contexts: {
        theme: { type: 'object', initial: { mode: 'light' } }
      }
    });
    assert(result.valid === true, 'Valid context definition should pass');
  }, results);

  test('Validator: detects missing context initial', () => {
    const result = validate({
      $ddjex: '0.2.0',
      id: 'test',
      target: 'dom',
      contexts: {
        theme: { type: 'object' } // missing initial
      }
    });
    assert(result.valid === false, 'Missing initial should fail');
    assert(result.errors.some(e => e.code === 'MISSING_CONTEXT_INITIAL'), 'Should have correct error');
  }, results);

  // ===== ROUTER TESTS (v0.2.0) =====

  // Mock window for router tests in Node.js
  const mockWindow = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {}, back: () => {}, forward: () => {}, go: () => {} },
    addEventListener: () => {}
  };
  if (typeof window === 'undefined') {
    global.window = mockWindow;
  }

  test('Router: basic route matching', () => {
    const router = new RouterManager();
    router.addRoutes([
      { path: '/', name: 'home' },
      { path: '/about', name: 'about' },
      { path: '/users', name: 'users' }
    ]);

    const homeMatch = router.match('/');
    assert(homeMatch !== null, 'Should match home');
    assert(homeMatch.route.name === 'home', 'Should be home route');

    const aboutMatch = router.match('/about');
    assert(aboutMatch !== null, 'Should match about');
    assert(aboutMatch.route.name === 'about', 'Should be about route');

    const noMatch = router.match('/nonexistent');
    assert(noMatch === null, 'Should not match unknown path');
  }, results);

  test('Router: path parameter extraction', () => {
    const router = new RouterManager();
    router.addRoutes([
      { path: '/users/:id', name: 'user' },
      { path: '/posts/:postId/comments/:commentId', name: 'comment' }
    ]);

    const userMatch = router.match('/users/123');
    assert(userMatch !== null, 'Should match user path');
    assert(userMatch.params.id === '123', 'Should extract id param');

    const commentMatch = router.match('/posts/456/comments/789');
    assert(commentMatch !== null, 'Should match comment path');
    assert(commentMatch.params.postId === '456', 'Should extract postId');
    assert(commentMatch.params.commentId === '789', 'Should extract commentId');
  }, results);

  test('Router: nested routes', () => {
    const router = new RouterManager();
    router.addRoutes([
      {
        path: '/admin',
        name: 'admin',
        children: [
          { path: '/users', name: 'adminUsers' },
          { path: '/settings', name: 'adminSettings' }
        ]
      }
    ]);

    const adminMatch = router.match('/admin');
    assert(adminMatch !== null, 'Should match admin');
    assert(adminMatch.route.name === 'admin', 'Should be admin route');

    const usersMatch = router.match('/admin/users');
    assert(usersMatch !== null, 'Should match admin users');
    assert(usersMatch.route.name === 'adminUsers', 'Should be adminUsers route');
  }, results);

  test('Router: path normalization', () => {
    const router = new RouterManager();

    assert(router.normalizePath('') === '/', 'Empty string becomes /');
    assert(router.normalizePath('users') === '/users', 'Adds leading slash');
    assert(router.normalizePath('/users/') === '/users', 'Removes trailing slash');
    assert(router.normalizePath('//users//posts//') === '/users/posts', 'Removes duplicate slashes');
  }, results);

  test('Router: buildPath with params', () => {
    const router = new RouterManager();

    const path1 = router.buildPath('/users/:id', { id: '123' });
    assert(path1 === '/users/123', 'Should replace param');

    const path2 = router.buildPath('/posts/:postId/comments/:commentId', {
      postId: 'abc',
      commentId: 'xyz'
    });
    assert(path2 === '/posts/abc/comments/xyz', 'Should replace multiple params');
  }, results);

  test('Router: resolve route by name', () => {
    const router = new RouterManager();
    router.addRoutes([
      { path: '/users/:id', name: 'user' }
    ]);

    const resolved = router.resolve({ name: 'user', params: { id: '42' } });
    assert(resolved.path === '/users/42', 'Should resolve named route with params');
  }, results);

  test('Router: isActive check', () => {
    const router = new RouterManager();
    router.addRoutes([
      { path: '/', name: 'home' },
      { path: '/users', name: 'users' },
      { path: '/users/:id', name: 'user' }
    ]);

    // Manually set current route for testing
    router.currentRoute = { path: '/users/123', params: { id: '123' } };

    assert(router.isActive('/users', false) === true, 'Should be active (non-exact)');
    assert(router.isActive('/users', true) === false, 'Should not be exact active');
    assert(router.isActive('/users/123', true) === true, 'Should be exact active');
    assert(router.isActive('/', false) === false, 'Home should not be active');
  }, results);

  test('Router: query string parsing', () => {
    const router = new RouterManager();

    const query1 = router.parseQuery('?foo=bar&baz=qux');
    assert(query1.foo === 'bar', 'Should parse foo');
    assert(query1.baz === 'qux', 'Should parse baz');

    const query2 = router.parseQuery('');
    assert(Object.keys(query2).length === 0, 'Empty string returns empty object');
  }, results);

  test('Router: query string building', () => {
    const router = new RouterManager();

    const query1 = router.buildQuery({ foo: 'bar', baz: 'qux' });
    assert(query1.includes('foo=bar'), 'Should include foo');
    assert(query1.includes('baz=qux'), 'Should include baz');
    assert(query1.startsWith('?'), 'Should start with ?');

    const query2 = router.buildQuery({});
    assert(query2 === '', 'Empty object returns empty string');
  }, results);

  test('Router: subscribe and notify', () => {
    const router = new RouterManager();
    let notifyCount = 0;
    let lastRoute = null;

    router.subscribe((route) => {
      notifyCount++;
      lastRoute = route;
    });

    router.currentRoute = { path: '/test' };
    router.notify();

    assert(notifyCount === 1, 'Should notify subscriber');
    assert(lastRoute.path === '/test', 'Should receive route');
  }, results);

  test('Router: guard registration', () => {
    const router = new RouterManager();
    let guardCalled = false;

    const unsubscribe = router.beforeEach((to, from) => {
      guardCalled = true;
      return true;
    });

    assert(router.guards.length === 1, 'Guard should be registered');

    unsubscribe();
    assert(router.guards.length === 0, 'Guard should be removed');
  }, results);

  test('Validator: validates router configuration', () => {
    const result = validate({
      $ddjex: '0.2.0',
      id: 'test',
      target: 'dom',
      router: {
        routes: [
          { path: '/', name: 'home' },
          { path: '/about', name: 'about' }
        ]
      }
    });
    assert(result.valid === true, 'Valid router config should pass');
  }, results);

  // ===== SSR ADDITIONAL TESTS =====

  await testAsync('SSR: conditional rendering', async () => {
    const { renderToString } = await import('../src/targets/ssr.js');
    const program = {
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      state: {
        show: { type: 'boolean', initial: true }
      },
      root: {
        if: { ref: 'show' },
        then: { type: 'div', children: [{ text: 'Visible' }] },
        else: { type: 'span', children: [{ text: 'Hidden' }] }
      }
    };

    const html = await renderToString(program);
    assert(html.includes('Visible'), 'Should render then branch');
    assert(!html.includes('Hidden'), 'Should not render else branch');
  }, results);

  await testAsync('SSR: loop rendering', async () => {
    const { renderToString } = await import('../src/targets/ssr.js');
    const program = {
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      state: {
        items: { type: 'array', initial: ['a', 'b', 'c'] }
      },
      root: {
        type: 'ul',
        each: { items: 'items', as: 'item' },
        children: [
          { type: 'li', children: [{ bind: 'item' }] }
        ]
      }
    };

    const html = await renderToString(program);
    assert(html.includes('<li>a</li>'), 'Should render first item');
    assert(html.includes('<li>b</li>'), 'Should render second item');
    assert(html.includes('<li>c</li>'), 'Should render third item');
  }, results);

  await testAsync('SSR: component rendering', async () => {
    const { renderToString } = await import('../src/targets/ssr.js');
    const program = {
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      components: {
        Greeting: {
          props: {
            name: { type: 'string', default: 'World' }
          },
          render: {
            type: 'span',
            children: [{ text: 'Hello, ' }, { bind: 'name' }]
          }
        }
      },
      root: {
        type: 'div',
        children: [
          { component: 'Greeting', props: { name: 'Test' } }
        ]
      }
    };

    const html = await renderToString(program);
    assert(html.includes('Hello, Test'), 'Should render component with props');
  }, results);

  await testAsync('SSR: escapes HTML in text', async () => {
    const { renderToString } = await import('../src/targets/ssr.js');
    const program = {
      $ddjex: '0.1.0',
      id: 'test',
      target: 'dom',
      state: {
        html: { type: 'string', initial: '<script>alert("xss")</script>' }
      },
      root: {
        type: 'div',
        children: [{ bind: 'html' }]
      }
    };

    const html = await renderToString(program);
    assert(!html.includes('<script>'), 'Should escape script tag');
    assert(html.includes('&lt;script&gt;'), 'Should use HTML entities');
  }, results);

  // ===== LAZY LOADING TESTS =====

  await testAsync('LazyManager: basic loading', async () => {
    const { LazyManager } = await import('../src/core/lazy.js');

    // Create a mock fetch
    const mockModule = {
      $ddjex: '0.2.0',
      id: 'test_module',
      target: 'dom',
      components: {
        TestComponent: {
          render: { type: 'div', children: [{ text: 'Lazy loaded!' }] }
        }
      }
    };

    const mockFetch = async (url) => ({
      ok: true,
      text: async () => JSON.stringify(mockModule)
    });

    const manager = new LazyManager({ fetch: mockFetch });
    const module = await manager.load('/test.ddjex.json');

    assert(module.$ddjex === '0.2.0', 'Module version loaded');
    assert(module.id === 'test_module', 'Module id loaded');
    assert(module.components.TestComponent !== undefined, 'Component exists');
  }, results);

  await testAsync('LazyManager: caching', async () => {
    const { LazyManager } = await import('../src/core/lazy.js');

    let fetchCount = 0;
    const mockFetch = async (url) => {
      fetchCount++;
      return {
        ok: true,
        text: async () => JSON.stringify({ $ddjex: '0.2.0', id: 'cached' })
      };
    };

    const manager = new LazyManager({ fetch: mockFetch });

    await manager.load('/cached.json');
    assert(fetchCount === 1, 'First load fetches');

    await manager.load('/cached.json');
    assert(fetchCount === 1, 'Second load uses cache');

    manager.clearCache('/cached.json');
    await manager.load('/cached.json');
    assert(fetchCount === 2, 'After clear, fetches again');
  }, results);

  await testAsync('LazyManager: error handling', async () => {
    const { LazyManager } = await import('../src/core/lazy.js');

    const mockFetch = async (url) => ({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    const manager = new LazyManager({ fetch: mockFetch });

    let errorThrown = false;
    try {
      await manager.load('/notfound.json');
    } catch (e) {
      errorThrown = true;
      assert(e.code === 'LAZY_LOAD_FAILED', 'Error code set');
    }
    assert(errorThrown, 'Error was thrown');
  }, results);

  await testAsync('LazyManager: getComponent', async () => {
    const { LazyManager } = await import('../src/core/lazy.js');

    const mockModule = {
      $ddjex: '0.2.0',
      id: 'test',
      components: {
        Header: { render: { type: 'header' } },
        Footer: { render: { type: 'footer' } }
      },
      root: { type: 'div' }
    };

    const manager = new LazyManager();

    const header = manager.getComponent(mockModule, 'Header');
    assert(header.type === 'component', 'Returns component type');
    assert(header.definition.render.type === 'header', 'Has correct definition');

    const root = manager.getComponent(mockModule, null);
    assert(root.type === 'root', 'Returns root when no component specified');

    let errorThrown = false;
    try {
      manager.getComponent(mockModule, 'NonExistent');
    } catch (e) {
      errorThrown = true;
      assert(e.code === 'COMPONENT_NOT_FOUND', 'Throws for missing component');
    }
    assert(errorThrown, 'Error thrown for missing component');
  }, results);

  await testAsync('LazyManager: preload', async () => {
    const { LazyManager } = await import('../src/core/lazy.js');

    let fetched = false;
    const mockFetch = async (url) => {
      fetched = true;
      return {
        ok: true,
        text: async () => JSON.stringify({ $ddjex: '0.2.0', id: 'preloaded' })
      };
    };

    const manager = new LazyManager({ fetch: mockFetch });

    // Preload starts loading
    manager.preload('/preload.json');
    // Give it time to start
    await new Promise(r => setTimeout(r, 10));
    assert(fetched, 'Preload initiates fetch');
  }, results);

  await testAsync('LazyManager: isLoaded/isLoading', async () => {
    const { LazyManager } = await import('../src/core/lazy.js');

    let resolveLoad;
    const mockFetch = async (url) => {
      await new Promise(r => { resolveLoad = r; });
      return {
        ok: true,
        text: async () => JSON.stringify({ $ddjex: '0.2.0', id: 'check' })
      };
    };

    const manager = new LazyManager({ fetch: mockFetch });

    assert(manager.isLoaded('/check.json') === false, 'Not loaded initially');
    assert(manager.isLoading('/check.json') === false, 'Not loading initially');

    const loadPromise = manager.load('/check.json');
    assert(manager.isLoading('/check.json') === true, 'Loading during fetch');
    assert(manager.isLoaded('/check.json') === false, 'Not loaded during fetch');

    resolveLoad();
    await loadPromise;
    assert(manager.isLoading('/check.json') === false, 'Not loading after complete');
    assert(manager.isLoaded('/check.json') === true, 'Loaded after complete');
  }, results);

  await testAsync('LazyLoader: state machine', async () => {
    const { LazyManager, LazyLoader } = await import('../src/core/lazy.js');

    const mockFetch = async (url) => ({
      ok: true,
      text: async () => JSON.stringify({
        $ddjex: '0.2.0',
        id: 'test',
        components: {
          Test: { render: { type: 'div' } }
        }
      })
    });

    const manager = new LazyManager({ fetch: mockFetch });
    const loader = new LazyLoader({ src: '/test.json', component: 'Test' }, manager);

    const states = [];
    loader.subscribe((state) => states.push(state.state));

    assert(loader.getState().state === 'idle', 'Initial state is idle');

    await loader.load();

    assert(loader.getState().state === 'loaded', 'Final state is loaded');
    assert(loader.getState().component !== null, 'Component loaded');
    assert(states.includes('loading'), 'Went through loading state');
    assert(states.includes('loaded'), 'Ended in loaded state');
  }, results);

  // Animation tests
  console.log('\nAnimation Tests\n---------------');

  await testAsync('Animation: Spring physics', async () => {
    const { Spring } = await import('../src/core/animation.js');

    const spring = new Spring({ stiffness: 100, damping: 10, mass: 1 });

    // Test spring step
    const result = spring.step(0, 100, 0, 0.016);
    assert(typeof result.value === 'number', 'Spring returns value');
    assert(typeof result.velocity === 'number', 'Spring returns velocity');
    assert(typeof result.done === 'boolean', 'Spring returns done flag');
    assert(result.value > 0, 'Spring value moves toward target');
    assert(result.velocity > 0, 'Spring velocity is positive toward target');
    assert(result.done === false, 'Spring not done on first step');
  }, results);

  await testAsync('Animation: Easings', async () => {
    const { Easings } = await import('../src/core/animation.js');

    // Test easing functions exist
    assert(typeof Easings.linear === 'function', 'Linear easing exists');
    assert(typeof Easings.ease === 'function', 'Ease easing exists');
    assert(typeof Easings['ease-in'] === 'function', 'Ease-in easing exists');
    assert(typeof Easings['ease-out'] === 'function', 'Ease-out easing exists');
    assert(typeof Easings['ease-in-out'] === 'function', 'Ease-in-out easing exists');

    // Test easing boundaries
    assert(Easings.linear(0) === 0, 'Linear at 0 is 0');
    assert(Easings.linear(1) === 1, 'Linear at 1 is 1');
    assert(Easings.linear(0.5) === 0.5, 'Linear at 0.5 is 0.5');

    assert(Easings.ease(0) === 0, 'Ease at 0 is 0');
    assert(Easings.ease(1) === 1, 'Ease at 1 is 1');

    assert(Easings['ease-in'](0) === 0, 'Ease-in at 0 is 0');
    assert(Easings['ease-in'](1) === 1, 'Ease-in at 1 is 1');
  }, results);

  await testAsync('Animation: AnimationController', async () => {
    const { AnimationController } = await import('../src/core/animation.js');

    const controller = new AnimationController();
    assert(controller !== null, 'AnimationController created');
    assert(typeof controller.createAnimation === 'function', 'createAnimation method exists');
    assert(typeof controller.enter === 'function', 'enter method exists');
    assert(typeof controller.exit === 'function', 'exit method exists');
    assert(typeof controller.springAnimate === 'function', 'springAnimate method exists');
    assert(typeof controller.interpolate === 'function', 'interpolate method exists');
    assert(typeof controller.parseValue === 'function', 'parseValue method exists');

    // Test parseValue
    const parsed1 = controller.parseValue('100px');
    assert(parsed1.value === 100, 'Parses px value');
    assert(parsed1.unit === 'px', 'Parses px unit');

    const parsed2 = controller.parseValue(50);
    assert(parsed2.value === 50, 'Parses number value');
    assert(parsed2.unit === '', 'Number has empty unit');

    const parsed3 = controller.parseValue('50%');
    assert(parsed3.value === 50, 'Parses percent value');
    assert(parsed3.unit === '%', 'Parses percent unit');

    // Test interpolate
    const interp1 = controller.interpolate(0, 100, 0.5, 'linear');
    assert(interp1 === 50, 'Interpolate at 0.5 is 50');

    const interp2 = controller.interpolate(0, 100, 0, 'linear');
    assert(interp2 === 0, 'Interpolate at 0 is 0');

    const interp3 = controller.interpolate(0, 100, 1, 'linear');
    assert(interp3 === 100, 'Interpolate at 1 is 100');

    controller.dispose();
  }, results);

  await testAsync('Animation: Presets', async () => {
    const { AnimationPresets } = await import('../src/core/animation.js');

    // Test preset existence
    assert(AnimationPresets.fadeIn !== undefined, 'fadeIn preset exists');
    assert(AnimationPresets.fadeOut !== undefined, 'fadeOut preset exists');
    assert(AnimationPresets.slideInUp !== undefined, 'slideInUp preset exists');
    assert(AnimationPresets.slideOutDown !== undefined, 'slideOutDown preset exists');
    assert(AnimationPresets.scaleIn !== undefined, 'scaleIn preset exists');
    assert(AnimationPresets.scaleOut !== undefined, 'scaleOut preset exists');
    assert(AnimationPresets.bounceIn !== undefined, 'bounceIn preset exists');
    assert(AnimationPresets.springIn !== undefined, 'springIn preset exists');

    // Test preset structure
    assert(AnimationPresets.fadeIn.from !== undefined, 'fadeIn has from');
    assert(AnimationPresets.fadeIn.to !== undefined, 'fadeIn has to');
    assert(AnimationPresets.fadeIn.duration !== undefined, 'fadeIn has duration');
  }, results);

  await testAsync('Animation: getAnimationConfig', async () => {
    const { getAnimationConfig, AnimationPresets } = await import('../src/core/animation.js');

    // Test preset lookup
    const fadeIn = getAnimationConfig('fadeIn');
    assert(fadeIn.from !== undefined, 'getAnimationConfig returns preset');
    assert(fadeIn.from.opacity === 0, 'fadeIn starts at opacity 0');

    // Test custom config passthrough
    const custom = { duration: 500, easing: 'ease' };
    const result = getAnimationConfig(custom);
    assert(result.duration === 500, 'Custom config passes through');
    assert(result.easing === 'ease', 'Custom easing passes through');

    // Test undefined config
    const empty = getAnimationConfig(undefined);
    assert(typeof empty === 'object', 'Returns empty object for undefined');
  }, results);

  test('Animation: Operations - lerp', () => {
    assert(Operations.lerp(0, 100, 0) === 0, 'lerp at 0');
    assert(Operations.lerp(0, 100, 1) === 100, 'lerp at 1');
    assert(Operations.lerp(0, 100, 0.5) === 50, 'lerp at 0.5');
    assert(Operations.lerp(50, 150, 0.5) === 100, 'lerp with offset');
  }, results);

  test('Animation: Operations - inverseLerp', () => {
    assert(Operations.inverseLerp(0, 100, 0) === 0, 'inverseLerp at start');
    assert(Operations.inverseLerp(0, 100, 100) === 1, 'inverseLerp at end');
    assert(Operations.inverseLerp(0, 100, 50) === 0.5, 'inverseLerp at middle');
  }, results);

  test('Animation: Operations - remap', () => {
    assert(Operations.remap(5, 0, 10, 0, 100) === 50, 'remap 5 from 0-10 to 0-100');
    assert(Operations.remap(0, 0, 10, 0, 100) === 0, 'remap 0');
    assert(Operations.remap(10, 0, 10, 0, 100) === 100, 'remap 10');
  }, results);

  test('Animation: Operations - easing functions', () => {
    // Test easeLinear
    assert(Operations.easeLinear(0.5) === 0.5, 'easeLinear at 0.5');

    // Test easeIn
    assert(Operations.easeIn(0) === 0, 'easeIn at 0');
    assert(Operations.easeIn(1) === 1, 'easeIn at 1');
    assert(Operations.easeIn(0.5) < 0.5, 'easeIn slow at start');

    // Test easeOut
    assert(Operations.easeOut(0) === 0, 'easeOut at 0');
    assert(Operations.easeOut(1) === 1, 'easeOut at 1');
    assert(Operations.easeOut(0.5) > 0.5, 'easeOut fast at start');

    // Test easeInOut
    assert(Operations.easeInOut(0) === 0, 'easeInOut at 0');
    assert(Operations.easeInOut(1) === 1, 'easeInOut at 1');
    assert(Operations.easeInOut(0.5) === 0.5, 'easeInOut at 0.5');
  }, results);

  test('Animation: Operations - springValue', () => {
    const result = Operations.springValue(0, 100, 0, 100, 10, 1, 0.016);
    assert(typeof result.value === 'number', 'springValue returns value');
    assert(typeof result.velocity === 'number', 'springValue returns velocity');
    assert(result.value > 0, 'springValue moves toward target');
  }, results);

  test('Animation: Operations - transform helpers', () => {
    assert(Operations.translateX(10) === 'translateX(10px)', 'translateX');
    assert(Operations.translateY(20) === 'translateY(20px)', 'translateY');
    assert(Operations.translate(10, 20) === 'translate(10px, 20px)', 'translate');
    assert(Operations.scale(1.5) === 'scale(1.5)', 'scale');
    assert(Operations.rotate(45) === 'rotate(45deg)', 'rotate');
    assert(Operations.opacity(0.5) === 0.5, 'opacity in range');
    assert(Operations.opacity(1.5) === 1, 'opacity clamped max');
    assert(Operations.opacity(-0.5) === 0, 'opacity clamped min');
  }, results);

  // Keyed List tests
  console.log('\nKeyed List Tests\n----------------');

  test('Keys: loop with key expression validates', () => {
    const program = {
      $ddjex: '0.2.0',
      id: 'keyed_list_test',
      target: 'dom',
      state: {
        items: { type: 'array', initial: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] }
      },
      root: {
        type: 'ul',
        each: {
          items: 'items',
          as: 'item',
          key: { op: 'get', args: [{ ref: 'item' }, 'id'] }
        },
        children: [{ type: 'li', children: [{ bind: 'item.name' }] }]
      }
    };

    const validation = Runtime.validate(program);
    assert(validation.valid === true, 'Program with keyed loop should be valid');
  }, results);

  test('Keys: loop without key validates (backwards compatible)', () => {
    const program = {
      $ddjex: '0.2.0',
      id: 'unkeyed_list_test',
      target: 'dom',
      state: {
        items: { type: 'array', initial: ['a', 'b', 'c'] }
      },
      root: {
        type: 'ul',
        each: { items: 'items', as: 'item' },
        children: [{ type: 'li', children: [{ bind: 'item' }] }]
      }
    };

    const validation = Runtime.validate(program);
    assert(validation.valid === true, 'Program without key should be valid');
  }, results);

  test('Keys: runtime initializes with keyed loop', () => {
    const program = {
      $ddjex: '0.2.0',
      id: 'keyed_init_test',
      target: 'dom',
      state: {
        items: { type: 'array', initial: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }] }
      },
      actions: {
        addItem: {
          params: ['item'],
          mutations: [{ target: 'items', op: 'push', value: { param: 'item' } }]
        },
        removeItem: {
          params: ['index'],
          mutations: [{ target: 'items', op: 'set', value: { op: 'slice', args: [{ ref: 'items' }, 0, { param: 'index' }] } }]
        }
      },
      root: {
        type: 'div',
        each: {
          items: 'items',
          as: 'item',
          index: 'i',
          key: { op: 'get', args: [{ ref: 'item' }, 'id'] }
        },
        children: [{ type: 'span', children: [{ bind: 'item.text' }] }]
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    assert(runtime.stateManager.get('items').length === 2, 'Initial items count');
    runtime.dispatch('addItem', { id: 3, text: 'three' });
    assert(runtime.stateManager.get('items').length === 3, 'Items after add');
  }, results);

  test('Keys: key can be simple ref expression', () => {
    const program = {
      $ddjex: '0.2.0',
      id: 'simple_key_test',
      target: 'dom',
      state: {
        items: { type: 'array', initial: ['a', 'b', 'c'] }
      },
      root: {
        type: 'ul',
        each: {
          items: 'items',
          as: 'item',
          key: { ref: 'item' }
        },
        children: [{ type: 'li', children: [{ bind: 'item' }] }]
      }
    };

    const validation = Runtime.validate(program);
    assert(validation.valid === true, 'Simple ref as key should be valid');
  }, results);

  // Self-Testing Framework tests
  console.log('\nSelf-Testing Framework\n----------------------');

  await testAsync('TestRunner: runs passing tests', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test_runner_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      actions: {
        increment: { mutations: [{ target: 'count', op: 'add', value: 1 }] }
      },
      tests: [
        {
          id: 'test_initial',
          name: 'Initial state',
          steps: [{ assert: { ref: 'count', eq: 0 } }]
        },
        {
          id: 'test_increment',
          name: 'Increment works',
          steps: [
            { dispatch: 'increment' },
            { assert: { ref: 'count', eq: 1 } }
          ]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.passed === 2, `Expected 2 passed, got ${result.passed}`);
    assert(result.failed === 0, `Expected 0 failed, got ${result.failed}`);
    assert(result.total === 2, `Expected 2 total, got ${result.total}`);
  }, results);

  await testAsync('TestRunner: detects failing tests', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'failing_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      tests: [
        {
          id: 'test_fail',
          name: 'This should fail',
          steps: [{ assert: { ref: 'count', eq: 999 } }]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.passed === 0, 'Expected 0 passed');
    assert(result.failed === 1, 'Expected 1 failed');
    assert(result.results[0].errors.length > 0, 'Should have error details');
    assert(result.results[0].errors[0].code === 'ASSERTION_EQ_FAILED', 'Should have EQ_FAILED code');
  }, results);

  await testAsync('TestRunner: handles skip flag', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'skip_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      tests: [
        {
          id: 'test_skipped',
          name: 'This is skipped',
          skip: true,
          steps: [{ assert: { ref: 'count', eq: 999 } }]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.skipped === 1, 'Expected 1 skipped');
    assert(result.passed === 0, 'Expected 0 passed');
    assert(result.failed === 0, 'Expected 0 failed');
  }, results);

  await testAsync('TestRunner: handles setup state overrides', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'setup_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      tests: [
        {
          id: 'test_setup',
          name: 'Setup overrides initial',
          setup: { count: 100 },
          steps: [{ assert: { ref: 'count', eq: 100 } }]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.passed === 1, 'Test with setup should pass');
  }, results);

  await testAsync('TestRunner: handles dispatch with args', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'dispatch_args_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      actions: {
        addAmount: {
          params: ['amount'],
          mutations: [{ target: 'count', op: 'add', value: { param: 'amount' } }]
        }
      },
      tests: [
        {
          id: 'test_dispatch_args',
          name: 'Dispatch with args works',
          steps: [
            { dispatch: 'addAmount', args: [5] },
            { assert: { ref: 'count', eq: 5 } },
            { dispatch: 'addAmount', args: [3] },
            { assert: { ref: 'count', eq: 8 } }
          ]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.passed === 1, 'Dispatch with args test should pass');
  }, results);

  await testAsync('TestRunner: handles setState step', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'setstate_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      computed: {
        doubled: { deps: ['count'], fn: { op: 'multiply', args: [{ ref: 'count' }, 2] } }
      },
      tests: [
        {
          id: 'test_setstate',
          name: 'setState updates computed',
          steps: [
            { setState: { count: 10 } },
            { assert: { ref: 'count', eq: 10 } },
            { assert: { ref: 'doubled', eq: 20 } }
          ]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.passed === 1, 'setState test should pass');
  }, results);

  await testAsync('TestRunner: all assertion operators work', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'assertions_test',
      target: 'dom',
      state: {
        num: { type: 'number', initial: 5 },
        str: { type: 'string', initial: 'hello world' },
        arr: { type: 'array', initial: ['a', 'b', 'c'] }
      },
      tests: [
        {
          id: 'test_assertions',
          name: 'All assertion operators',
          steps: [
            { assert: { ref: 'num', eq: 5 } },
            { assert: { ref: 'num', neq: 10 } },
            { assert: { ref: 'num', gt: 4 } },
            { assert: { ref: 'num', gte: 5 } },
            { assert: { ref: 'num', lt: 6 } },
            { assert: { ref: 'num', lte: 5 } },
            { assert: { ref: 'num', type: 'number' } },
            { assert: { ref: 'str', type: 'string' } },
            { assert: { ref: 'arr', type: 'array' } },
            { assert: { ref: 'str', contains: 'world' } },
            { assert: { ref: 'arr', contains: 'b' } },
            { assert: { ref: 'arr', length: 3 } },
            { assert: { ref: 'str', matches: '^hello' } }
          ]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.passed === 1, `All assertions should pass, got: ${JSON.stringify(result.results[0].errors)}`);
  }, results);

  await testAsync('TestRunner: truthy/falsy assertions', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'truthy_test',
      target: 'dom',
      state: {
        truthy: { type: 'number', initial: 1 },
        falsy: { type: 'number', initial: 0 }
      },
      tests: [
        {
          id: 'test_truthy_falsy',
          steps: [
            { assert: { ref: 'truthy', truthy: true } },
            { assert: { ref: 'falsy', falsy: true } }
          ]
        }
      ]
    };

    const result = await runSelfTests(program);
    assert(result.passed === 1, 'Truthy/falsy test should pass');
  }, results);

  await testAsync('TestRunner: error includes expected/actual', async () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'error_detail_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 5 } },
      tests: [
        {
          id: 'test_error_detail',
          steps: [{ assert: { ref: 'count', eq: 10 } }]
        }
      ]
    };

    const result = await runSelfTests(program);
    const error = result.results[0].errors[0];
    assert(error.expected === 10, 'Error should have expected value');
    assert(error.actual === 5, 'Error should have actual value');
    assert(error.code === 'ASSERTION_EQ_FAILED', 'Error should have code');
  }, results);

  test('TestRunner: validates test structure', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'validation_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      tests: [
        {
          id: 'test_valid',
          steps: [{ assert: { ref: 'count', eq: 0 } }]
        }
      ]
    };

    const validation = validate(program);
    assert(validation.valid === true, 'Valid test should pass validation');
  }, results);

  test('TestRunner: validation catches missing test id', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'missing_id_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      tests: [
        {
          steps: [{ assert: { ref: 'count', eq: 0 } }]
        }
      ]
    };

    const validation = validate(program);
    assert(validation.valid === false, 'Missing test id should fail validation');
    assert(validation.errors.some(e => e.code === 'MISSING_TEST_ID'), 'Should have MISSING_TEST_ID error');
  }, results);

  test('TestRunner: validation catches missing assertion target', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'missing_target_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      tests: [
        {
          id: 'test_missing_target',
          steps: [{ assert: { eq: 0 } }]
        }
      ]
    };

    const validation = validate(program);
    assert(validation.valid === false, 'Missing assertion target should fail');
    assert(validation.errors.some(e => e.code === 'MISSING_ASSERTION_TARGET'), 'Should have MISSING_ASSERTION_TARGET error');
  }, results);

  test('TestRunner: validation catches undefined action in dispatch', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'undefined_action_test',
      target: 'dom',
      state: { count: { type: 'number', initial: 0 } },
      tests: [
        {
          id: 'test_undefined_action',
          steps: [{ dispatch: 'nonExistentAction' }]
        }
      ]
    };

    const validation = validate(program);
    assert(validation.valid === false, 'Undefined action should fail validation');
    assert(validation.errors.some(e => e.code === 'UNDEFINED_TEST_ACTION'), 'Should have UNDEFINED_TEST_ACTION error');
  }, results);

  test('Assertion operations: assertEq', () => {
    assert(Operations.assertEq(5, 5) === true, 'Equal values should pass');
    let threw = false;
    try { Operations.assertEq(5, 10); } catch { threw = true; }
    assert(threw, 'Unequal values should throw');
  }, results);

  test('Assertion operations: assertType', () => {
    assert(Operations.assertType(5, 'number') === true, 'Number type check');
    assert(Operations.assertType('hello', 'string') === true, 'String type check');
    assert(Operations.assertType([1,2], 'array') === true, 'Array type check');
    assert(Operations.assertType({}, 'object') === true, 'Object type check');
    assert(Operations.assertType(null, 'null') === true, 'Null type check');
  }, results);

  test('Assertion operations: assertContains', () => {
    assert(Operations.assertContains([1,2,3], 2) === true, 'Array contains');
    assert(Operations.assertContains('hello', 'ell') === true, 'String contains');
    let threw = false;
    try { Operations.assertContains([1,2,3], 5); } catch { threw = true; }
    assert(threw, 'Not contains should throw');
  }, results);

  test('Assertion operations: assertLength', () => {
    assert(Operations.assertLength([1,2,3], 3) === true, 'Array length');
    assert(Operations.assertLength('hello', 5) === true, 'String length');
    let threw = false;
    try { Operations.assertLength([1,2], 5); } catch { threw = true; }
    assert(threw, 'Wrong length should throw');
  }, results);

  // Constraints tests
  console.log('\nConstraints\n-----------');

  test('Constraints: min constraint violation', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        balance: {
          type: 'number',
          initial: 100,
          constraints: { min: 0, message: 'Balance cannot be negative' }
        }
      },
      actions: {
        withdraw: {
          params: ['amount'],
          mutations: [{ target: 'balance', op: 'subtract', value: { param: 'amount' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    // Valid withdrawal
    runtime.dispatch('withdraw', 50);
    assert(runtime.getState().balance === 50, 'Balance should be 50');

    // Invalid withdrawal - should throw
    let threw = false;
    let error = null;
    try {
      runtime.dispatch('withdraw', 100);
    } catch (e) {
      threw = true;
      error = e;
    }
    assert(threw, 'Negative balance should throw');
    assert(error.code === 'CONSTRAINT_VIOLATION', 'Error code should be CONSTRAINT_VIOLATION');
    assert(error.constraint === 'min', 'Constraint should be min');
    assert(error.message === 'Balance cannot be negative', 'Should use custom message');
  }, results);

  test('Constraints: max constraint violation', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        score: {
          type: 'number',
          initial: 0,
          constraints: { max: 100 }
        }
      },
      actions: {
        addPoints: {
          params: ['points'],
          mutations: [{ target: 'score', op: 'add', value: { param: 'points' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    runtime.dispatch('addPoints', 50);
    assert(runtime.getState().score === 50, 'Score should be 50');

    let threw = false;
    try {
      runtime.dispatch('addPoints', 60);
    } catch (e) {
      threw = true;
      assert(e.constraint === 'max', 'Constraint should be max');
    }
    assert(threw, 'Over max should throw');
  }, results);

  test('Constraints: minLength constraint', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        password: {
          type: 'string',
          initial: '',
          constraints: { minLength: 8 }
        }
      },
      actions: {
        setPassword: {
          params: ['pwd'],
          mutations: [{ target: 'password', op: 'set', value: { param: 'pwd' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    let threw = false;
    try {
      runtime.dispatch('setPassword', 'short');
    } catch (e) {
      threw = true;
      assert(e.constraint === 'minLength', 'Constraint should be minLength');
    }
    assert(threw, 'Short password should throw');

    // Valid password
    runtime.dispatch('setPassword', 'longenough');
    assert(runtime.getState().password === 'longenough', 'Password should be set');
  }, results);

  test('Constraints: maxLength constraint', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        items: {
          type: 'array',
          initial: [],
          constraints: { maxLength: 3 }
        }
      },
      actions: {
        addItem: {
          params: ['item'],
          mutations: [{ target: 'items', op: 'push', value: { param: 'item' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    runtime.dispatch('addItem', 'a');
    runtime.dispatch('addItem', 'b');
    runtime.dispatch('addItem', 'c');
    assert(runtime.getState().items.length === 3, 'Should have 3 items');

    let threw = false;
    try {
      runtime.dispatch('addItem', 'd');
    } catch (e) {
      threw = true;
      assert(e.constraint === 'maxLength', 'Constraint should be maxLength');
    }
    assert(threw, 'Fourth item should throw');
  }, results);

  test('Constraints: pattern constraint', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        email: {
          type: 'string',
          initial: '',
          constraints: { pattern: '^[^@]+@[^@]+\\.[^@]+$' }
        }
      },
      actions: {
        setEmail: {
          params: ['email'],
          mutations: [{ target: 'email', op: 'set', value: { param: 'email' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    let threw = false;
    try {
      runtime.dispatch('setEmail', 'notanemail');
    } catch (e) {
      threw = true;
      assert(e.constraint === 'pattern', 'Constraint should be pattern');
    }
    assert(threw, 'Invalid email should throw');

    // Valid email
    runtime.dispatch('setEmail', 'test@example.com');
    assert(runtime.getState().email === 'test@example.com', 'Email should be set');
  }, results);

  test('Constraints: unique constraint', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        tags: {
          type: 'array',
          initial: [],
          constraints: { unique: true }
        }
      },
      actions: {
        addTag: {
          params: ['tag'],
          mutations: [{ target: 'tags', op: 'push', value: { param: 'tag' } }]
        },
        setTags: {
          params: ['tags'],
          mutations: [{ target: 'tags', op: 'set', value: { param: 'tags' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    runtime.dispatch('addTag', 'js');
    runtime.dispatch('addTag', 'ts');
    assert(runtime.getState().tags.length === 2, 'Should have 2 tags');

    let threw = false;
    try {
      runtime.dispatch('setTags', ['js', 'ts', 'js']);
    } catch (e) {
      threw = true;
      assert(e.constraint === 'unique', 'Constraint should be unique');
    }
    assert(threw, 'Duplicate tag should throw');
  }, results);

  test('Constraints: enum constraint', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        status: {
          type: 'string',
          initial: 'pending',
          constraints: { enum: ['pending', 'active', 'completed'] }
        }
      },
      actions: {
        setStatus: {
          params: ['status'],
          mutations: [{ target: 'status', op: 'set', value: { param: 'status' } }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    runtime.dispatch('setStatus', 'active');
    assert(runtime.getState().status === 'active', 'Status should be active');

    let threw = false;
    try {
      runtime.dispatch('setStatus', 'invalid');
    } catch (e) {
      threw = true;
      assert(e.constraint === 'enum', 'Constraint should be enum');
    }
    assert(threw, 'Invalid enum value should throw');
  }, results);

  test('Constraints: required constraint', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        name: {
          type: 'string',
          initial: 'test',
          constraints: { required: true }
        }
      },
      actions: {
        clearName: {
          mutations: [{ target: 'name', op: 'set', value: null }]
        }
      }
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    let threw = false;
    try {
      runtime.dispatch('clearName');
    } catch (e) {
      threw = true;
      assert(e.constraint === 'required', 'Constraint should be required');
    }
    assert(threw, 'Null value should throw for required');
  }, results);

  // Invariants tests
  console.log('\nInvariants\n----------');

  test('Invariants: simple invariant passes', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        count: { type: 'number', initial: 0 },
        max: { type: 'number', initial: 10 }
      },
      actions: {
        increment: {
          mutations: [{ target: 'count', op: 'add', value: 1 }]
        }
      },
      invariants: [
        {
          id: 'count_within_max',
          check: { op: 'lte', args: [{ ref: 'count' }, { ref: 'max' }] },
          message: 'Count must not exceed max'
        }
      ]
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    // Should pass
    for (let i = 0; i < 5; i++) {
      runtime.dispatch('increment');
    }
    assert(runtime.getState().count === 5, 'Count should be 5');
  }, results);

  test('Invariants: invariant violation throws', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        count: { type: 'number', initial: 9 },
        max: { type: 'number', initial: 10 }
      },
      actions: {
        increment: {
          mutations: [{ target: 'count', op: 'add', value: 1 }]
        },
        incrementBy: {
          params: ['amount'],
          mutations: [{ target: 'count', op: 'add', value: { param: 'amount' } }]
        }
      },
      invariants: [
        {
          id: 'count_within_max',
          check: { op: 'lte', args: [{ ref: 'count' }, { ref: 'max' }] },
          message: 'Count must not exceed max'
        }
      ]
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    // First increment OK (9 -> 10)
    runtime.dispatch('increment');
    assert(runtime.getState().count === 10, 'Count should be 10');

    // Second increment violates invariant
    let threw = false;
    try {
      runtime.dispatch('increment');
    } catch (e) {
      threw = true;
      assert(e.code === 'INVARIANT_VIOLATION', 'Error code should be INVARIANT_VIOLATION');
      assert(e.invariant === 'count_within_max', 'Should identify the invariant');
      assert(e.message === 'Count must not exceed max', 'Should have correct message');
    }
    assert(threw, 'Invariant violation should throw');
  }, results);

  test('Invariants: warning severity does not throw', () => {
    const program = {
      $ddjex: '0.3.0',
      id: 'test',
      target: 'dom',
      state: {
        count: { type: 'number', initial: 0 }
      },
      actions: {
        increment: {
          mutations: [{ target: 'count', op: 'add', value: 1 }]
        }
      },
      invariants: [
        {
          id: 'count_low',
          check: { op: 'lt', args: [{ ref: 'count' }, 3] },
          message: 'Count getting high',
          severity: 'warning'
        }
      ]
    };

    const runtime = new Runtime(program, new TestTarget());
    runtime.initialize();

    // Should not throw even when violated (warning only)
    for (let i = 0; i < 5; i++) {
      runtime.dispatch('increment');
    }
    assert(runtime.getState().count === 5, 'Count should be 5');
  }, results);

  // ==========================================
  // HMR (Hot Module Replacement) Tests
  // ==========================================

  test('HMR: canPreserveValue - string type', () => {
    const client = new HMRClient();
    assert(client.canPreserveValue('hello', 'string') === true, 'string matches string');
    assert(client.canPreserveValue(123, 'string') === false, 'number does not match string');
    assert(client.canPreserveValue(null, 'string') === true, 'null can be preserved');
  }, results);

  test('HMR: canPreserveValue - number type', () => {
    const client = new HMRClient();
    assert(client.canPreserveValue(42, 'number') === true, 'number matches number');
    assert(client.canPreserveValue('42', 'number') === false, 'string does not match number');
    assert(client.canPreserveValue(0, 'number') === true, 'zero is valid number');
  }, results);

  test('HMR: canPreserveValue - boolean type', () => {
    const client = new HMRClient();
    assert(client.canPreserveValue(true, 'boolean') === true, 'true matches boolean');
    assert(client.canPreserveValue(false, 'boolean') === true, 'false matches boolean');
    assert(client.canPreserveValue(1, 'boolean') === false, 'number does not match boolean');
  }, results);

  test('HMR: canPreserveValue - array type', () => {
    const client = new HMRClient();
    assert(client.canPreserveValue([1, 2, 3], 'array') === true, 'array matches array');
    assert(client.canPreserveValue([], 'array') === true, 'empty array matches array');
    assert(client.canPreserveValue({}, 'array') === false, 'object does not match array');
  }, results);

  test('HMR: canPreserveValue - object type', () => {
    const client = new HMRClient();
    assert(client.canPreserveValue({ a: 1 }, 'object') === true, 'object matches object');
    assert(client.canPreserveValue({}, 'object') === true, 'empty object matches object');
    assert(client.canPreserveValue([1, 2], 'object') === false, 'array does not match object');
  }, results);

  test('HMR: handleMessage - update type', () => {
    const client = new HMRClient();
    let appliedUpdate = null;
    client.applyUpdate = (update) => { appliedUpdate = update; };

    client.handleMessage({ type: 'update', payload: { state: { count: { type: 'number', initial: 5 } } } });

    assert(appliedUpdate !== null, 'applyUpdate should be called');
    assert(appliedUpdate.state.count.initial === 5, 'payload should be passed');
  }, results);

  test('HMR: handleMessage - error type', () => {
    const client = new HMRClient();
    let emittedError = null;
    client.emit = (event, data) => { if (event === 'error') emittedError = data; };

    client.handleMessage({ type: 'error', payload: { message: 'test error' } });

    assert(emittedError !== null, 'error should be emitted');
    assert(emittedError.message === 'test error', 'error message should match');
  }, results);

  test('HMR: handleMessage - unknown type', () => {
    const client = new HMRClient();
    // Should not throw
    client.handleMessage({ type: 'unknown-type', payload: {} });
  }, results);

  test('HMR: event handling on/emit', () => {
    const client = new HMRClient();
    let received = null;

    const unsubscribe = client.on('test-event', (data) => { received = data; });
    client.emit('test-event', { value: 42 });

    assert(received !== null, 'event should be received');
    assert(received.value === 42, 'event data should match');

    // Test unsubscribe
    unsubscribe();
    received = null;
    client.emit('test-event', { value: 100 });
    assert(received === null, 'should not receive after unsubscribe');
  }, results);

  test('HMR: applyUpdate with mock runtime - state update', () => {
    const client = new HMRClient();

    // Create mock runtime with StateManager
    const sm = new StateManager();
    sm.defineState('count', { type: 'number', initial: 0 });
    sm.defineState('name', { type: 'string', initial: '' });

    client.runtime = {
      stateManager: sm,
      getState: () => ({ count: sm.get('count'), name: sm.get('name') }),
      resolve: (expr) => expr
    };

    // Apply update that changes initial value (but type matches, so value preserved)
    client.applyUpdate({
      state: {
        count: { type: 'number', initial: 100 },
        name: { type: 'string', initial: 'test' }
      }
    });

    // Values should be preserved since types match
    assert(sm.get('count') === 0, 'count value preserved');
    assert(sm.get('name') === '', 'name value preserved');
  }, results);

  test('HMR: applyUpdate - state type change resets value', () => {
    const client = new HMRClient();

    const sm = new StateManager();
    sm.defineState('value', { type: 'number', initial: 0 });
    sm.set('value', 42);

    client.runtime = {
      stateManager: sm,
      getState: () => ({ value: sm.get('value') }),
      resolve: (expr) => expr
    };

    // Change type from number to string - should reset
    client.applyUpdate({
      state: {
        value: { type: 'string', initial: 'hello' }
      }
    });

    assert(sm.get('value') === 'hello', 'value should reset to new initial');
  }, results);

  test('HMR: applyUpdate - new state added', () => {
    const client = new HMRClient();

    const sm = new StateManager();
    sm.defineState('existing', { type: 'number', initial: 1 });

    client.runtime = {
      stateManager: sm,
      getState: () => ({ existing: sm.get('existing') }),
      resolve: (expr) => expr
    };

    client.applyUpdate({
      state: {
        existing: { type: 'number', initial: 1 },
        newState: { type: 'string', initial: 'new' }
      }
    });

    assert(sm.states.has('newState'), 'new state should be defined');
  }, results);

  test('HMR: applyUpdate - actions update', () => {
    const client = new HMRClient();

    const actions = new Map();
    actions.set('oldAction', { mutations: [] });

    client.runtime = {
      actions,
      getState: () => ({}),
      resolve: (expr) => expr
    };

    client.applyUpdate({
      actions: {
        newAction: { mutations: [{ target: 'count', op: 'add', value: 1 }] }
      }
    });

    assert(!actions.has('oldAction'), 'old action should be removed');
    assert(actions.has('newAction'), 'new action should be added');
  }, results);

  test('HMR: applyUpdate - components update', () => {
    const client = new HMRClient();

    const components = new Map();
    components.set('OldComponent', { type: 'div' });

    client.runtime = {
      components,
      getState: () => ({}),
      resolve: (expr) => expr
    };

    client.applyUpdate({
      components: {
        NewComponent: { type: 'span', children: [] }
      }
    });

    assert(!components.has('OldComponent'), 'old component should be removed');
    assert(components.has('NewComponent'), 'new component should be added');
  }, results);

  test('HMR: diffPrograms - detects state change', () => {
    // Import DevServer's diffPrograms logic (recreate for testing)
    function diffPrograms(oldProgram, newProgram) {
      const update = {};
      if (JSON.stringify(oldProgram.state) !== JSON.stringify(newProgram.state)) {
        update.state = newProgram.state;
      }
      if (JSON.stringify(oldProgram.computed) !== JSON.stringify(newProgram.computed)) {
        update.computed = newProgram.computed;
      }
      if (JSON.stringify(oldProgram.actions) !== JSON.stringify(newProgram.actions)) {
        update.actions = newProgram.actions;
      }
      if (JSON.stringify(oldProgram.root) !== JSON.stringify(newProgram.root)) {
        update.root = newProgram.root;
      }
      return update;
    }

    const oldProgram = {
      state: { count: { type: 'number', initial: 0 } },
      actions: { inc: { mutations: [] } }
    };

    const newProgram = {
      state: { count: { type: 'number', initial: 10 } },
      actions: { inc: { mutations: [] } }
    };

    const diff = diffPrograms(oldProgram, newProgram);

    assert(diff.state !== undefined, 'state change detected');
    assert(diff.actions === undefined, 'actions unchanged');
  }, results);

  test('HMR: diffPrograms - detects root change', () => {
    function diffPrograms(oldProgram, newProgram) {
      const update = {};
      if (JSON.stringify(oldProgram.root) !== JSON.stringify(newProgram.root)) {
        update.root = newProgram.root;
      }
      return update;
    }

    const oldProgram = { root: { type: 'div', children: [] } };
    const newProgram = { root: { type: 'span', children: [] } };

    const diff = diffPrograms(oldProgram, newProgram);

    assert(diff.root !== undefined, 'root change detected');
    assert(diff.root.type === 'span', 'new root type correct');
  }, results);

  test('HMR: diffPrograms - no changes returns empty', () => {
    function diffPrograms(oldProgram, newProgram) {
      const update = {};
      if (JSON.stringify(oldProgram.state) !== JSON.stringify(newProgram.state)) {
        update.state = newProgram.state;
      }
      if (JSON.stringify(oldProgram.actions) !== JSON.stringify(newProgram.actions)) {
        update.actions = newProgram.actions;
      }
      return update;
    }

    const program = {
      state: { count: { type: 'number', initial: 0 } },
      actions: { inc: { mutations: [] } }
    };

    const diff = diffPrograms(program, program);

    assert(Object.keys(diff).length === 0, 'no changes detected');
  }, results);

  test('HMR: client options defaults', () => {
    const client = new HMRClient();
    assert(client.options.port === 3001, 'default port is 3001');
    assert(client.options.host === 'localhost', 'default host is localhost');
    assert(client.options.reconnectInterval === 1000, 'default reconnect is 1000ms');
  }, results);

  test('HMR: client options override', () => {
    const client = new HMRClient({ port: 4000, host: '0.0.0.0' });
    assert(client.options.port === 4000, 'port overridden');
    assert(client.options.host === '0.0.0.0', 'host overridden');
    assert(client.options.reconnectInterval === 1000, 'reconnect keeps default');
  }, results);

  // ===== SECURITY TESTS (v0.3.2) =====
  console.log('\nSecurity Tests (v0.3.2)\n-----------------------');

  test('Security: modulo by zero returns error', () => {
    const result = Operations.modulo(10, 0);
    assert(result.error === true, 'Should return error');
    assert(result.code === 'MODULO_BY_ZERO', 'Should have correct error code');
  }, results);

  test('Security: toJSON handles circular reference', () => {
    const obj = {};
    obj.self = obj;
    const result = Operations.toJSON(obj);
    assert(result.error === true, 'Should return error for circular ref');
    assert(result.code === 'JSON_STRINGIFY_ERROR', 'Should have correct error code');
  }, results);

  test('Security: pick filters dangerous keys', () => {
    const obj = { a: 1, b: 2 };
    // Test that dangerous keys are not picked even if requested
    const result = Operations.pick(obj, ['a', '__proto__', 'constructor']);
    assert(result.a === 1, 'Should pick safe keys');
    // Use Object.keys to check own properties only
    const keys = Object.keys(result);
    assert(keys.length === 1, 'Should only have one key');
    assert(!keys.includes('__proto__'), 'Should not have __proto__ as own key');
    assert(!keys.includes('constructor'), 'Should not have constructor as own key');
  }, results);

  test('Security: omit filters dangerous keys', () => {
    const obj = { a: 1, b: 2 };
    const result = Operations.omit(obj, ['a']);
    assert(result.b === 2, 'Should keep non-omitted keys');
    // Use Object.keys to check own properties only
    const keys = Object.keys(result);
    assert(!keys.includes('__proto__'), 'Should not have __proto__ as own key');
    assert(!keys.includes('constructor'), 'Should not have constructor as own key');
  }, results);

  test('Security: repeat limits string length', () => {
    const result = Operations.repeat('a', 2000000);
    assert(result.error === true, 'Should return error for huge string');
    assert(result.code === 'STRING_TOO_LONG', 'Should have correct error code');
  }, results);

  test('Security: padStart limits length', () => {
    const result = Operations.padStart('test', 2000000, ' ');
    assert(result.error === true, 'Should return error');
    assert(result.code === 'STRING_TOO_LONG', 'Should have correct error code');
  }, results);

  test('Security: padEnd limits length', () => {
    const result = Operations.padEnd('test', 2000000, ' ');
    assert(result.error === true, 'Should return error');
    assert(result.code === 'STRING_TOO_LONG', 'Should have correct error code');
  }, results);

  test('Security: Router pathToRegex limits path length', () => {
    const router = new RouterManager();
    const longPath = '/' + 'a'.repeat(600);

    try {
      router.pathToRegex(longPath);
      assert(false, 'Should throw error');
    } catch (e) {
      assert(e.code === 'PATH_TOO_LONG', 'Should have correct error code');
    }
  }, results);

  test('Security: Router pathToRegex limits params', () => {
    const router = new RouterManager();
    let path = '';
    for (let i = 0; i < 25; i++) {
      path += `/:param${i}`;
    }

    try {
      router.pathToRegex(path);
      assert(false, 'Should throw error');
    } catch (e) {
      assert(e.code === 'TOO_MANY_PARAMS', 'Should have correct error code');
    }
  }, results);

  test('Security: Validator limits node nesting depth', () => {
    // Create deeply nested node
    let node = { type: 'div' };
    for (let i = 0; i < 60; i++) {
      node = { type: 'div', children: [node] };
    }

    const program = {
      $ddjex: '0.1.0',
      id: 'test_deep_nesting',
      target: 'dom',
      root: node
    };

    // Use the full Validator (not Runtime.validate which is simpler)
    const result = validate(program);
    assert(result.valid === false, 'Should fail validation');
    assert(result.errors.some(e => e.code === 'MAX_NESTING_DEPTH_EXCEEDED'), 'Should have depth error');
  }, results);

  await testAsync('Security: WebSocket blocks non-ws protocols', async () => {
    const manager = new WebSocketManager();

    try {
      await manager.connect('test', 'http://example.com');
      assert(false, 'Should reject');
    } catch (e) {
      assert(e.code === 'INVALID_WS_PROTOCOL', 'Should have correct error code');
    }
  }, results);

  await testAsync('Security: WebSocket blocks javascript: URLs', async () => {
    const manager = new WebSocketManager();

    try {
      await manager.connect('test', 'javascript:alert(1)');
      assert(false, 'Should reject');
    } catch (e) {
      assert(e.code === 'INVALID_WS_URL' || e.code === 'INVALID_WS_PROTOCOL', 'Should have error code');
    }
  }, results);

  console.log('');
}

async function runSpecTests(results) {
  console.log('Spec Conformance Tests\n----------------------');

  const examplesDir = path.join(__dirname, '../spec/examples');

  // Recursively find all JSON files
  async function findJsonFiles(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...await findJsonFiles(fullPath, relativePath));
      } else if (entry.name.endsWith('.json')) {
        files.push({ path: fullPath, name: relativePath });
      }
    }
    return files;
  }

  try {
    const jsonFiles = await findJsonFiles(examplesDir);

    for (const { path: filePath, name: file } of jsonFiles) {
      const content = await fs.readFile(filePath, 'utf-8');

      test(`Spec: ${file} parses and validates`, () => {
        const program = JSON.parse(content);
        const validation = Runtime.validate(program);
        assert(validation.valid, `Should be valid: ${JSON.stringify(validation.errors)}`);
      }, results);

      test(`Spec: ${file} initializes`, () => {
        const program = JSON.parse(content);
        const runtime = new Runtime(program, new TestTarget());
        runtime.initialize();
        assert(runtime.mounted === false, 'Should not be mounted yet');
        assert(runtime.stateManager !== null, 'Should have state manager');
      }, results);
    }
  } catch (e) {
    console.log(`  Could not read examples: ${e.message}`);
  }

  console.log('');
}

function test(name, fn, results) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    results.passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    results.failed++;
    results.errors.push({ test: name, message: e.message });
  }
}

async function testAsync(name, fn, results) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    results.failed++;
    results.errors.push({ test: name, message: e.message });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

runTests().catch(console.error);
