/**
 * ddjex Error Classes
 * Proper Error subclasses with stack traces and JSON serialization
 */

/**
 * Base error class for all ddjex errors
 */
class DDJEXError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DDJEXError';
    this.code = code;
    this.error = true;
    this.details = details;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      ...this.details
    };
  }
}

/**
 * Error for state-related issues
 */
class StateError extends DDJEXError {
  constructor(code, message, stateId, details = {}) {
    super(code, message, { state: stateId, ...details });
    this.name = 'StateError';
  }
}

/**
 * Error for action-related issues
 */
class ActionError extends DDJEXError {
  constructor(code, message, actionId, details = {}) {
    super(code, message, { action: actionId, ...details });
    this.name = 'ActionError';
  }
}

/**
 * Error for operation-related issues
 */
class OperationError extends DDJEXError {
  constructor(code, message, operation, details = {}) {
    super(code, message, { operation, ...details });
    this.name = 'OperationError';
  }
}

/**
 * Error for context-related issues
 */
class ContextError extends DDJEXError {
  constructor(code, message, contextId, details = {}) {
    super(code, message, { context: contextId, ...details });
    this.name = 'ContextError';
  }
}

/**
 * Error for mutation-related issues
 */
class MutationError extends DDJEXError {
  constructor(code, message, details = {}) {
    super(code, message, details);
    this.name = 'MutationError';
  }
}

/**
 * Error for expression depth exceeded
 */
class DepthError extends DDJEXError {
  constructor(maxDepth) {
    super('MAX_DEPTH_EXCEEDED', `Expression nesting too deep (max ${maxDepth})`, { maxDepth });
    this.name = 'DepthError';
  }
}

/**
 * Error for regex-related issues
 */
class RegexError extends DDJEXError {
  constructor(code, message, pattern, details = {}) {
    super(code, message, { pattern, ...details });
    this.name = 'RegexError';
  }
}

export {
  DDJEXError,
  StateError,
  ActionError,
  OperationError,
  ContextError,
  MutationError,
  DepthError,
  RegexError
};
