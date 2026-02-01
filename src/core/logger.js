/**
 * ddjex Logger
 * Configurable logging for ddjex runtime
 * Can be disabled in production to reduce console noise
 */

const LogLevel = {
  NONE: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4
};

class Logger {
  constructor() {
    this.level = LogLevel.WARN; // Default: only errors and warnings
    this.prefix = '[ddjex]';
  }

  /**
   * Set the log level
   * @param {number} level - LogLevel.NONE, ERROR, WARN, INFO, or DEBUG
   */
  setLevel(level) {
    this.level = level;
  }

  /**
   * Enable all logging (DEBUG level)
   */
  enableAll() {
    this.level = LogLevel.DEBUG;
  }

  /**
   * Disable all logging
   */
  disable() {
    this.level = LogLevel.NONE;
  }

  /**
   * Set to production mode (only errors)
   */
  production() {
    this.level = LogLevel.ERROR;
  }

  /**
   * Log an error message (always logged unless level is NONE)
   */
  error(...args) {
    if (this.level >= LogLevel.ERROR) {
      console.error(this.prefix, ...args);
    }
  }

  /**
   * Log a warning message
   */
  warn(...args) {
    if (this.level >= LogLevel.WARN) {
      console.warn(this.prefix, ...args);
    }
  }

  /**
   * Log an info message
   */
  info(...args) {
    if (this.level >= LogLevel.INFO) {
      console.log(this.prefix, ...args);
    }
  }

  /**
   * Log a debug message
   */
  debug(...args) {
    if (this.level >= LogLevel.DEBUG) {
      console.log(this.prefix, '[DEBUG]', ...args);
    }
  }
}

// Singleton instance
const logger = new Logger();

export { Logger, LogLevel, logger };
