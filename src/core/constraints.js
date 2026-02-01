/**
 * ddjex Constraints System
 * Runtime validation of state constraints and invariants
 */

import { safeRegex } from './operations.js';

/**
 * Constraint violation error
 */
class ConstraintViolationError extends Error {
  constructor(details) {
    super(details.message);
    this.name = 'ConstraintViolationError';
    this.error = true;
    this.code = 'CONSTRAINT_VIOLATION';
    this.state = details.state;
    this.constraint = details.constraint;
    this.value = details.value;
    this.limit = details.limit;
    this.message = details.message;
    this.action = details.action;
    this.suggestion = details.suggestion;
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      state: this.state,
      constraint: this.constraint,
      value: this.value,
      limit: this.limit,
      message: this.message,
      action: this.action,
      suggestion: this.suggestion
    };
  }
}

/**
 * Invariant violation error
 */
class InvariantViolationError extends Error {
  constructor(details) {
    super(details.message);
    this.name = 'InvariantViolationError';
    this.error = true;
    this.code = 'INVARIANT_VIOLATION';
    this.invariant = details.invariant;
    this.message = details.message;
    this.severity = details.severity || 'error';
    this.snapshot = details.snapshot;
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      invariant: this.invariant,
      message: this.message,
      severity: this.severity,
      snapshot: this.snapshot
    };
  }
}

/**
 * Check a single constraint against a value
 * @param {string} stateId - State identifier
 * @param {*} value - Value to check
 * @param {string} constraintType - Type of constraint (min, max, etc.)
 * @param {*} constraintValue - Constraint limit/value
 * @param {string} customMessage - Optional custom error message
 * @param {string} action - Action that triggered the mutation
 * @returns {null|ConstraintViolationError} - null if valid, error if violated
 */
function checkConstraint(stateId, value, constraintType, constraintValue, customMessage, action) {
  const baseError = {
    state: stateId,
    constraint: constraintType,
    value: value,
    limit: constraintValue,
    action: action
  };

  switch (constraintType) {
    case 'min':
      if (typeof value === 'number' && value < constraintValue) {
        return new ConstraintViolationError({
          ...baseError,
          message: customMessage || `${stateId} must be at least ${constraintValue}`,
          suggestion: { minValue: constraintValue }
        });
      }
      break;

    case 'max':
      if (typeof value === 'number' && value > constraintValue) {
        return new ConstraintViolationError({
          ...baseError,
          message: customMessage || `${stateId} must be at most ${constraintValue}`,
          suggestion: { maxValue: constraintValue }
        });
      }
      break;

    case 'minLength':
      if ((typeof value === 'string' || Array.isArray(value)) && value.length < constraintValue) {
        return new ConstraintViolationError({
          ...baseError,
          message: customMessage || `${stateId} must have at least ${constraintValue} items/characters`,
          suggestion: { minLength: constraintValue, currentLength: value.length }
        });
      }
      break;

    case 'maxLength':
      if ((typeof value === 'string' || Array.isArray(value)) && value.length > constraintValue) {
        return new ConstraintViolationError({
          ...baseError,
          message: customMessage || `${stateId} must have at most ${constraintValue} items/characters`,
          suggestion: { maxLength: constraintValue, currentLength: value.length }
        });
      }
      break;

    case 'pattern':
      if (typeof value === 'string') {
        const regex = safeRegex(constraintValue);
        if (!regex) {
          return new ConstraintViolationError({
            ...baseError,
            constraint: 'pattern',
            message: `Invalid or unsafe regex pattern: ${constraintValue}`,
            suggestion: { pattern: constraintValue, issue: 'Pattern is too complex or invalid' }
          });
        }
        if (!regex.test(value)) {
          return new ConstraintViolationError({
            ...baseError,
            message: customMessage || `${stateId} does not match pattern ${constraintValue}`,
            suggestion: { pattern: constraintValue }
          });
        }
      }
      break;

    case 'unique':
      if (Array.isArray(value) && constraintValue === true) {
        const seen = new Set();
        for (const item of value) {
          const key = JSON.stringify(item);
          if (seen.has(key)) {
            return new ConstraintViolationError({
              ...baseError,
              message: customMessage || `${stateId} must contain unique items`,
              suggestion: { duplicateItem: item }
            });
          }
          seen.add(key);
        }
      }
      break;

    case 'enum':
      if (Array.isArray(constraintValue) && !constraintValue.includes(value)) {
        return new ConstraintViolationError({
          ...baseError,
          message: customMessage || `${stateId} must be one of: ${constraintValue.join(', ')}`,
          suggestion: { allowedValues: constraintValue }
        });
      }
      break;

    case 'required':
      if (constraintValue === true && (value === null || value === undefined)) {
        return new ConstraintViolationError({
          ...baseError,
          message: customMessage || `${stateId} is required`,
          suggestion: { required: true }
        });
      }
      break;

    // 'custom' and 'message' are handled separately
    case 'custom':
    case 'message':
      break;

    default:
      // Unknown constraint type - ignore
      break;
  }

  return null;
}

/**
 * Validate all constraints for a state value
 * @param {string} stateId - State identifier
 * @param {*} value - Value to validate
 * @param {Object} constraints - Constraints object from state definition
 * @param {string} action - Action that triggered the mutation
 * @param {Function} opResolver - Function to resolve custom operations
 * @returns {null|ConstraintViolationError} - null if valid, error if violated
 */
function validateConstraints(stateId, value, constraints, action, opResolver) {
  if (!constraints) return null;

  const customMessage = constraints.message;

  // Check each constraint
  for (const [constraintType, constraintValue] of Object.entries(constraints)) {
    if (constraintType === 'message') continue;

    // Handle custom constraint
    if (constraintType === 'custom' && opResolver) {
      const result = opResolver(constraintValue, { $value: value, $state: stateId });
      if (result === false) {
        return new ConstraintViolationError({
          state: stateId,
          constraint: 'custom',
          value: value,
          message: customMessage || `${stateId} failed custom validation`,
          action: action
        });
      }
      continue;
    }

    const error = checkConstraint(stateId, value, constraintType, constraintValue, customMessage, action);
    if (error) return error;
  }

  return null;
}

/**
 * Check a single invariant
 * @param {Object} invariant - Invariant definition
 * @param {Function} opResolver - Function to resolve operations
 * @param {Object} stateSnapshot - Current state snapshot
 * @returns {null|InvariantViolationError} - null if valid, error if violated
 */
function checkInvariant(invariant, opResolver, stateSnapshot) {
  const result = opResolver(invariant.check);

  if (result === false) {
    return new InvariantViolationError({
      invariant: invariant.id,
      message: invariant.message,
      severity: invariant.severity || 'error',
      snapshot: stateSnapshot
    });
  }

  return null;
}

/**
 * Validate all invariants
 * @param {Array} invariants - Array of invariant definitions
 * @param {Function} opResolver - Function to resolve operations
 * @param {Object} stateSnapshot - Current state snapshot
 * @returns {Array<InvariantViolationError>} - Array of violations (empty if all pass)
 */
function validateInvariants(invariants, opResolver, stateSnapshot) {
  if (!invariants || invariants.length === 0) return [];

  const violations = [];

  for (const invariant of invariants) {
    const error = checkInvariant(invariant, opResolver, stateSnapshot);
    if (error) {
      violations.push(error);
    }
  }

  return violations;
}

/**
 * Constraints manager that integrates with StateManager
 */
class ConstraintManager {
  constructor() {
    this.stateConstraints = new Map(); // stateId -> constraints
    this.invariants = [];
    this.opResolver = null;
    this.stateGetter = null;
    this.enabled = true;
  }

  /**
   * Set the operation resolver function
   */
  setOpResolver(resolver) {
    this.opResolver = resolver;
  }

  /**
   * Set the state getter function
   */
  setStateGetter(getter) {
    this.stateGetter = getter;
  }

  /**
   * Register constraints for a state
   */
  registerConstraints(stateId, constraints) {
    if (constraints) {
      this.stateConstraints.set(stateId, constraints);
    }
  }

  /**
   * Register program invariants
   */
  registerInvariants(invariants) {
    this.invariants = invariants || [];
  }

  /**
   * Validate a state value against its constraints
   * @returns {null|ConstraintViolationError}
   */
  validateState(stateId, value, action) {
    if (!this.enabled) return null;

    const constraints = this.stateConstraints.get(stateId);
    if (!constraints) return null;

    return validateConstraints(stateId, value, constraints, action, this.opResolver);
  }

  /**
   * Validate all invariants
   * @returns {Array<InvariantViolationError>}
   */
  validateAllInvariants() {
    if (!this.enabled || this.invariants.length === 0) return [];

    const snapshot = this.stateGetter ? this.stateGetter() : {};
    return validateInvariants(this.invariants, this.opResolver, snapshot);
  }

  /**
   * Check if state has constraints
   */
  hasConstraints(stateId) {
    return this.stateConstraints.has(stateId);
  }

  /**
   * Get constraints for a state
   */
  getConstraints(stateId) {
    return this.stateConstraints.get(stateId);
  }

  /**
   * Enable/disable constraint checking
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Clear all constraints and invariants
   */
  clear() {
    this.stateConstraints.clear();
    this.invariants = [];
  }
}

export {
  ConstraintManager,
  ConstraintViolationError,
  InvariantViolationError,
  validateConstraints,
  validateInvariants,
  checkConstraint,
  checkInvariant
};
