/**
 * ddjex Form Validation
 * Built-in validators and validation utilities
 */

// Built-in validators
const Validators = {
  // Required - value must be non-empty
  required: (value, options = {}) => {
    const message = options.message || 'This field is required';
    if (value === null || value === undefined || value === '') {
      return { valid: false, error: message };
    }
    if (Array.isArray(value) && value.length === 0) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Min length for strings/arrays
  minLength: (value, options = {}) => {
    const min = options.min || options.value || 0;
    const message = options.message || `Minimum length is ${min}`;
    const length = value?.length ?? 0;
    if (length < min) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Max length for strings/arrays
  maxLength: (value, options = {}) => {
    const max = options.max || options.value || Infinity;
    const message = options.message || `Maximum length is ${max}`;
    const length = value?.length ?? 0;
    if (length > max) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Min value for numbers
  min: (value, options = {}) => {
    const min = options.min || options.value || -Infinity;
    const message = options.message || `Minimum value is ${min}`;
    if (typeof value === 'number' && value < min) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Max value for numbers
  max: (value, options = {}) => {
    const max = options.max || options.value || Infinity;
    const message = options.message || `Maximum value is ${max}`;
    if (typeof value === 'number' && value > max) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Email format
  email: (value, options = {}) => {
    const message = options.message || 'Invalid email address';
    if (!value) return { valid: true }; // Empty is ok, use required for that
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // URL format
  url: (value, options = {}) => {
    const message = options.message || 'Invalid URL';
    if (!value) return { valid: true };
    try {
      new URL(value);
      return { valid: true };
    } catch {
      return { valid: false, error: message };
    }
  },

  // Pattern match (regex)
  pattern: (value, options = {}) => {
    const pattern = options.pattern || options.value;
    const message = options.message || 'Invalid format';
    if (!value) return { valid: true };
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    if (!regex.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Numeric only
  numeric: (value, options = {}) => {
    const message = options.message || 'Must be a number';
    if (!value) return { valid: true };
    if (isNaN(Number(value))) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Integer only
  integer: (value, options = {}) => {
    const message = options.message || 'Must be an integer';
    if (!value) return { valid: true };
    if (!Number.isInteger(Number(value))) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Alpha only (letters)
  alpha: (value, options = {}) => {
    const message = options.message || 'Must contain only letters';
    if (!value) return { valid: true };
    if (!/^[a-zA-Z]+$/.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Alphanumeric
  alphanumeric: (value, options = {}) => {
    const message = options.message || 'Must contain only letters and numbers';
    if (!value) return { valid: true };
    if (!/^[a-zA-Z0-9]+$/.test(value)) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Equals another field
  equals: (value, options = {}) => {
    const other = options.value;
    const message = options.message || 'Values must match';
    if (value !== other) {
      return { valid: false, error: message };
    }
    return { valid: true };
  },

  // Custom validator function
  custom: (value, options = {}) => {
    const fn = options.fn || options.validate;
    const message = options.message || 'Validation failed';
    if (typeof fn === 'function') {
      const result = fn(value);
      if (result === true) return { valid: true };
      if (result === false) return { valid: false, error: message };
      if (typeof result === 'string') return { valid: false, error: result };
      return result;
    }
    return { valid: true };
  }
};

/**
 * Validate a single value against rules
 */
function validateValue(value, rules) {
  const errors = [];

  for (const rule of rules) {
    const validatorName = typeof rule === 'string' ? rule : rule.type || rule.validator;
    const options = typeof rule === 'string' ? {} : rule;

    const validator = Validators[validatorName];
    if (!validator) {
      console.warn(`Unknown validator: ${validatorName}`);
      continue;
    }

    const result = validator(value, options);
    if (!result.valid) {
      errors.push(result.error);
      // Stop on first error unless continueOnError is set
      if (!options.continueOnError) break;
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate a form (multiple fields)
 */
function validateForm(values, schema) {
  const result = {
    valid: true,
    errors: {},
    firstError: null
  };

  for (const [field, rules] of Object.entries(schema)) {
    const value = values[field];
    const fieldResult = validateValue(value, Array.isArray(rules) ? rules : [rules]);

    if (!fieldResult.valid) {
      result.valid = false;
      result.errors[field] = fieldResult.errors;
      if (!result.firstError) {
        result.firstError = { field, error: fieldResult.errors[0] };
      }
    }
  }

  return result;
}

/**
 * Create a form state manager
 */
function createFormState(initialValues = {}, schema = {}) {
  const state = {
    values: { ...initialValues },
    errors: {},
    touched: {},
    dirty: {},
    isValid: true,
    isSubmitting: false
  };

  return {
    getState: () => ({ ...state }),

    setValue: (field, value) => {
      state.values[field] = value;
      state.dirty[field] = true;

      // Validate on change if field has been touched
      if (state.touched[field] && schema[field]) {
        const result = validateValue(value, schema[field]);
        state.errors[field] = result.errors;
      }

      return state;
    },

    setTouched: (field) => {
      state.touched[field] = true;

      // Validate on blur
      if (schema[field]) {
        const result = validateValue(state.values[field], schema[field]);
        state.errors[field] = result.errors;
      }

      return state;
    },

    validate: () => {
      const result = validateForm(state.values, schema);
      state.errors = result.errors;
      state.isValid = result.valid;
      return result;
    },

    reset: (values = initialValues) => {
      state.values = { ...values };
      state.errors = {};
      state.touched = {};
      state.dirty = {};
      state.isValid = true;
      state.isSubmitting = false;
      return state;
    }
  };
}

// Operations for use in ddjex expressions
const ValidationOperations = {
  // Validate a single field
  validate: (value, rules) => validateValue(value, rules),

  // Validate entire form
  validateForm: (values, schema) => validateForm(values, schema),

  // Check if value passes a single rule
  isValid: (value, rule) => {
    const result = validateValue(value, [rule]);
    return result.valid;
  },

  // Get first error for a field
  getError: (value, rules) => {
    const result = validateValue(value, rules);
    return result.errors[0] || null;
  },

  // Check if email
  isEmail: (value) => Validators.email(value).valid,

  // Check if URL
  isUrl: (value) => Validators.url(value).valid,

  // Check if numeric
  isNumeric: (value) => Validators.numeric(value).valid,

  // Check if empty
  isEmpty: (value) => !Validators.required(value).valid,

  // Check if matches pattern
  matches: (value, pattern) => Validators.pattern(value, { pattern }).valid
};

export {
  Validators,
  validateValue,
  validateForm,
  createFormState,
  ValidationOperations
};
