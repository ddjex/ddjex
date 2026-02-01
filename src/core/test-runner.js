/**
 * ddjex Self-Testing Framework
 * Runs tests defined in ddjex JSON programs
 */

import { Runtime } from './runtime.js';

/**
 * Assertion error with structured data for LLM debugging
 */
class AssertionError {
  constructor(code, message, path, expected, actual, stepIndex) {
    this.error = true;
    this.code = code;
    this.message = message;
    this.path = path;
    this.expected = expected;
    this.actual = actual;
    this.stepIndex = stepIndex;
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      location: { path: this.path, stepIndex: this.stepIndex },
      expected: this.expected,
      actual: this.actual
    };
  }
}

/**
 * Stub target for headless test execution
 */
class TestTarget {
  mount(runtime) { return this; }
  unmount(runtime) { return this; }
}

/**
 * Test runner for ddjex programs
 */
class TestRunner {
  constructor(program, options = {}) {
    this.program = program;
    this.options = {
      timeout: options.timeout || 5000,
      verbose: options.verbose || false,
      stopOnFailure: options.stopOnFailure || false,
      filter: options.filter || null,
      ...options
    };
    this.onTestStart = options.onTestStart || (() => {});
    this.onTestEnd = options.onTestEnd || (() => {});
    this.onAssertionFail = options.onAssertionFail || (() => {});
  }

  /**
   * Run all tests in the program
   * @returns {Promise<Object>} Test results
   */
  async run() {
    const tests = this.program.tests || [];

    if (tests.length === 0) {
      return { passed: 0, failed: 0, skipped: 0, total: 0, results: [] };
    }

    // Filter tests
    let testsToRun = this.filterTests(tests);

    // Handle only flag
    const onlyTests = testsToRun.filter(t => t.only);
    if (onlyTests.length > 0) {
      testsToRun = onlyTests;
    }

    const results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: tests.length,
      results: []
    };

    for (const test of testsToRun) {
      if (test.skip) {
        results.skipped++;
        results.results.push({
          id: test.id,
          name: test.name || test.id,
          status: 'skipped',
          duration: 0
        });
        continue;
      }

      const testResult = await this.runTest(test);
      results.results.push(testResult);

      if (testResult.status === 'passed') {
        results.passed++;
      } else {
        results.failed++;
        if (this.options.stopOnFailure) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Filter tests by regex pattern
   */
  filterTests(tests) {
    if (!this.options.filter) return tests;

    const filter = this.options.filter;
    const regex = filter instanceof RegExp ? filter : new RegExp(filter, 'i');

    return tests.filter(t =>
      regex.test(t.id) ||
      (t.name && regex.test(t.name))
    );
  }

  /**
   * Run a single test
   */
  async runTest(test) {
    const startTime = Date.now();
    this.onTestStart(test);

    const result = {
      id: test.id,
      name: test.name || test.id,
      status: 'passed',
      duration: 0,
      errors: [],
      stepResults: []
    };

    // Create isolated runtime for this test
    let runtime;
    try {
      runtime = this.createTestRuntime(test.setup);
    } catch (e) {
      result.status = 'failed';
      result.errors.push({
        error: true,
        code: 'RUNTIME_INIT_FAILED',
        message: e.message || String(e)
      });
      result.duration = Date.now() - startTime;
      this.onTestEnd(result);
      return result;
    }

    try {
      // Run with timeout
      await this.withTimeout(
        this.executeSteps(runtime, test.steps, result),
        test.timeout || this.options.timeout,
        test.id
      );
    } catch (error) {
      result.status = 'failed';
      if (error.code === 'TEST_TIMEOUT') {
        result.errors.push(error.toJSON ? error.toJSON() : error);
      } else {
        result.errors.push({
          error: true,
          code: 'UNEXPECTED_ERROR',
          message: error.message || String(error),
          stack: this.options.verbose ? error.stack : undefined
        });
      }
    } finally {
      try {
        runtime.unmount();
      } catch (e) {
        // Ignore unmount errors
      }
    }

    result.duration = Date.now() - startTime;
    this.onTestEnd(result);
    return result;
  }

  /**
   * Create an isolated runtime for test execution
   */
  createTestRuntime(setup) {
    // Clone program without tests to avoid recursion
    const programWithoutTests = { ...this.program };
    delete programWithoutTests.tests;

    // Apply setup overrides to initial state
    if (setup && programWithoutTests.state) {
      programWithoutTests.state = { ...programWithoutTests.state };
      for (const [key, value] of Object.entries(setup)) {
        if (programWithoutTests.state[key]) {
          programWithoutTests.state[key] = {
            ...programWithoutTests.state[key],
            initial: value
          };
        }
      }
    }

    const runtime = new Runtime(programWithoutTests, new TestTarget());
    runtime.initialize();
    return runtime;
  }

  /**
   * Execute test steps sequentially
   */
  async executeSteps(runtime, steps, result) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepResult = { index: i, type: null, passed: true };

      try {
        if ('assert' in step) {
          stepResult.type = 'assert';
          this.executeAssertion(runtime, step.assert, i, step.message);
        } else if ('dispatch' in step) {
          stepResult.type = 'dispatch';
          const args = step.args ? step.args.map(arg => runtime.resolve(arg)) : [];
          runtime.dispatch(step.dispatch, ...args);
        } else if ('wait' in step) {
          stepResult.type = 'wait';
          await this.delay(step.wait);
        } else if ('setState' in step) {
          stepResult.type = 'setState';
          for (const [key, value] of Object.entries(step.setState)) {
            const resolved = runtime.resolve(value);
            runtime.stateManager.set(key, resolved);
          }
        }
      } catch (error) {
        stepResult.passed = false;
        stepResult.error = error.toJSON ? error.toJSON() : {
          error: true,
          code: 'STEP_ERROR',
          message: error.message || String(error),
          stepIndex: i
        };

        result.status = 'failed';
        result.errors.push(stepResult.error);
        this.onAssertionFail(stepResult.error);

        if (this.options.stopOnFailure) {
          break;
        }
      }

      result.stepResults.push(stepResult);
    }
  }

  /**
   * Execute a single assertion
   */
  executeAssertion(runtime, assertion, stepIndex, message) {
    // Get the value to assert
    let actual;
    if ('ref' in assertion) {
      actual = runtime.stateManager.get(assertion.ref);
    } else if ('context' in assertion) {
      actual = runtime.contextManager.get(assertion.context);
    } else if ('value' in assertion) {
      actual = runtime.resolve(assertion.value);
    } else {
      throw new AssertionError(
        'INVALID_ASSERTION',
        'Assertion must have ref, context, or value',
        `$.tests[*].steps[${stepIndex}].assert`,
        null,
        null,
        stepIndex
      );
    }

    const path = `$.tests[*].steps[${stepIndex}].assert`;

    // eq - strict equality
    if ('eq' in assertion) {
      const expected = runtime.resolve(assertion.eq);
      if (actual !== expected) {
        throw new AssertionError(
          'ASSERTION_EQ_FAILED',
          message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          path, expected, actual, stepIndex
        );
      }
    }

    // neq - not equal
    if ('neq' in assertion) {
      const notExpected = runtime.resolve(assertion.neq);
      if (actual === notExpected) {
        throw new AssertionError(
          'ASSERTION_NEQ_FAILED',
          message || `Expected value to not equal ${JSON.stringify(notExpected)}`,
          path, `not ${JSON.stringify(notExpected)}`, actual, stepIndex
        );
      }
    }

    // gt - greater than
    if ('gt' in assertion) {
      if (!(actual > assertion.gt)) {
        throw new AssertionError(
          'ASSERTION_GT_FAILED',
          message || `Expected ${actual} > ${assertion.gt}`,
          path, `> ${assertion.gt}`, actual, stepIndex
        );
      }
    }

    // gte - greater than or equal
    if ('gte' in assertion) {
      if (!(actual >= assertion.gte)) {
        throw new AssertionError(
          'ASSERTION_GTE_FAILED',
          message || `Expected ${actual} >= ${assertion.gte}`,
          path, `>= ${assertion.gte}`, actual, stepIndex
        );
      }
    }

    // lt - less than
    if ('lt' in assertion) {
      if (!(actual < assertion.lt)) {
        throw new AssertionError(
          'ASSERTION_LT_FAILED',
          message || `Expected ${actual} < ${assertion.lt}`,
          path, `< ${assertion.lt}`, actual, stepIndex
        );
      }
    }

    // lte - less than or equal
    if ('lte' in assertion) {
      if (!(actual <= assertion.lte)) {
        throw new AssertionError(
          'ASSERTION_LTE_FAILED',
          message || `Expected ${actual} <= ${assertion.lte}`,
          path, `<= ${assertion.lte}`, actual, stepIndex
        );
      }
    }

    // contains - array/string contains
    if ('contains' in assertion) {
      const expected = runtime.resolve(assertion.contains);
      const containsResult = Array.isArray(actual)
        ? actual.includes(expected)
        : typeof actual === 'string'
          ? actual.includes(expected)
          : false;

      if (!containsResult) {
        throw new AssertionError(
          'ASSERTION_CONTAINS_FAILED',
          message || `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`,
          path, `contains ${JSON.stringify(expected)}`, actual, stepIndex
        );
      }
    }

    // length - array/string length
    if ('length' in assertion) {
      const actualLength = actual?.length ?? 0;
      if (actualLength !== assertion.length) {
        throw new AssertionError(
          'ASSERTION_LENGTH_FAILED',
          message || `Expected length ${assertion.length}, got ${actualLength}`,
          path, assertion.length, actualLength, stepIndex
        );
      }
    }

    // matches - regex pattern
    if ('matches' in assertion) {
      const regex = new RegExp(assertion.matches);
      if (!regex.test(String(actual))) {
        throw new AssertionError(
          'ASSERTION_MATCHES_FAILED',
          message || `Expected ${actual} to match ${assertion.matches}`,
          path, `matches ${assertion.matches}`, actual, stepIndex
        );
      }
    }

    // type - type check
    if ('type' in assertion) {
      const actualType = actual === null ? 'null'
        : actual === undefined ? 'undefined'
        : Array.isArray(actual) ? 'array'
        : typeof actual;

      if (actualType !== assertion.type) {
        throw new AssertionError(
          'ASSERTION_TYPE_FAILED',
          message || `Expected type ${assertion.type}, got ${actualType}`,
          path, assertion.type, actualType, stepIndex
        );
      }
    }

    // deepEquals - deep object comparison
    if ('deepEquals' in assertion) {
      const expected = runtime.resolve(assertion.deepEquals);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new AssertionError(
          'ASSERTION_DEEP_EQUALS_FAILED',
          message || `Deep equality failed`,
          path, expected, actual, stepIndex
        );
      }
    }

    // truthy
    if ('truthy' in assertion && assertion.truthy) {
      if (!actual) {
        throw new AssertionError(
          'ASSERTION_TRUTHY_FAILED',
          message || `Expected truthy value, got ${JSON.stringify(actual)}`,
          path, 'truthy', actual, stepIndex
        );
      }
    }

    // falsy
    if ('falsy' in assertion && assertion.falsy) {
      if (actual) {
        throw new AssertionError(
          'ASSERTION_FALSY_FAILED',
          message || `Expected falsy value, got ${JSON.stringify(actual)}`,
          path, 'falsy', actual, stepIndex
        );
      }
    }
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run promise with timeout
   */
  async withTimeout(promise, ms, testId) {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new AssertionError(
          'TEST_TIMEOUT',
          `Test ${testId} timed out after ${ms}ms`,
          '$.tests',
          `completes within ${ms}ms`,
          'timeout',
          -1
        ));
      }, ms);
    });

    return Promise.race([promise, timeout]);
  }
}

/**
 * Run tests from an ddjex program
 * @param {Object} program - ddjex program with tests array
 * @param {Object} options - Runner options
 * @returns {Promise<Object>} Test results
 */
async function runTests(program, options = {}) {
  const runner = new TestRunner(program, options);
  return runner.run();
}

export { TestRunner, TestTarget, AssertionError, runTests };
