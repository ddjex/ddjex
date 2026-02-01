/**
 * ddjex CLI Target
 * Command-line interface with arguments and flags
 */

import { Target } from '../core/runtime.js';

class CLITarget extends Target {
  constructor(args = process.argv.slice(2)) {
    super();
    this.rawArgs = args;
  }

  mount(runtime) {
    this.runtime = runtime;
    this.commands = this.buildCommands(runtime.program.commands || []);

    // Parse and execute command
    return this.execute();
  }

  unmount(runtime) {
    return this;
  }

  buildCommands(commandDefs) {
    const commands = new Map();

    for (const cmd of commandDefs) {
      commands.set(cmd.name, {
        name: cmd.name,
        args: cmd.args || [],
        flags: cmd.flags || [],
        handler: cmd.handler
      });
    }

    return commands;
  }

  async execute() {
    const { command, args, flags } = this.parseArgs();

    if (!command) {
      this.printHelp();
      return this;
    }

    const cmd = this.commands.get(command);
    if (!cmd) {
      console.error(`Unknown command: ${command}`);
      this.printHelp();
      process.exit(1);
    }

    // Build context
    const context = {
      ...flags
    };

    // Map positional args
    cmd.args.forEach((argDef, index) => {
      const value = args[index];
      if (argDef.required && value === undefined) {
        console.error(`Missing required argument: ${argDef.name}`);
        process.exit(1);
      }
      context[argDef.name] = this.coerceType(value ?? argDef.default, argDef.type);
    });

    // Apply flag defaults
    for (const flagDef of cmd.flags) {
      if (!(flagDef.name in context)) {
        context[flagDef.name] = flagDef.default;
      }
    }

    // Execute handler
    try {
      for (const step of cmd.handler) {
        await this.executeStep(step, context);
      }
    } catch (error) {
      if (error.error) {
        console.error(`Error: ${error.message}`);
        if (error.code) console.error(`Code: ${error.code}`);
      } else {
        console.error(error);
      }
      process.exit(1);
    }

    return this;
  }

  parseArgs() {
    const result = {
      command: null,
      args: [],
      flags: {}
    };

    let i = 0;

    // First non-flag argument is the command
    while (i < this.rawArgs.length) {
      const arg = this.rawArgs[i];

      if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=');
        result.flags[key.replace(/-/g, '_')] = value ?? true;
      } else if (arg.startsWith('-') && arg.length === 2) {
        const short = arg[1];
        // Find matching flag definition
        const nextArg = this.rawArgs[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          result.flags[short] = nextArg;
          i++;
        } else {
          result.flags[short] = true;
        }
      } else if (!result.command) {
        result.command = arg;
      } else {
        result.args.push(arg);
      }

      i++;
    }

    // Resolve short flags to full names
    if (result.command) {
      const cmd = this.commands?.get(result.command);
      if (cmd) {
        for (const flagDef of cmd.flags) {
          if (flagDef.short && flagDef.short in result.flags) {
            result.flags[flagDef.name] = result.flags[flagDef.short];
            delete result.flags[flagDef.short];
          }
        }
      }
    }

    return result;
  }

  coerceType(value, type) {
    if (value === undefined) return undefined;

    switch (type) {
      case 'number':
        return Number(value);
      case 'boolean':
        return value === true || value === 'true';
      case 'string':
      default:
        return String(value);
    }
  }

  async executeStep(step, context) {
    const { op, args: opArgs, as } = step;

    let result;

    switch (op) {
      case 'read':
        const filePath = this.runtime.resolve(opArgs[0], context);
        const fs = await import('fs/promises');
        result = await fs.readFile(filePath, 'utf-8');
        break;

      case 'write':
        const writePath = this.runtime.resolve(opArgs[0], context);
        const content = this.runtime.resolve(opArgs[1], context);
        const fsWrite = await import('fs/promises');
        await fsWrite.writeFile(writePath, content, 'utf-8');
        break;

      case 'glob':
        const pattern = this.runtime.resolve(opArgs[0], context);
        const dir = this.runtime.resolve(opArgs[1], context);
        const fsGlob = await import('fs/promises');
        const path = await import('path');

        // Simple glob implementation
        const files = await this.simpleGlob(dir, pattern);
        result = files;
        break;

      case 'print':
        const printArgs = opArgs.map(arg => this.runtime.resolve(arg, context));
        console.log(...printArgs);
        break;

      case 'if':
        const [condition, then, else_] = opArgs;
        const condResult = this.runtime.resolve(condition, context);
        if (condResult) {
          result = await this.executeStep(then, context);
        } else if (else_) {
          result = await this.executeStep(else_, context);
        }
        break;

      case 'forEach':
        const [arr, body] = opArgs;
        const resolvedArr = this.runtime.resolve(arr, context);
        for (let i = 0; i < resolvedArr.length; i++) {
          await this.executeStep(body, { ...context, item: resolvedArr[i], index: i });
        }
        break;

      case 'pipe':
        let pipeValue = this.runtime.resolve(opArgs[0], context);
        for (let i = 1; i < opArgs.length; i++) {
          pipeValue = this.runtime.resolve(opArgs[i], { ...context, _: pipeValue });
        }
        result = pipeValue;
        break;

      default:
        result = this.runtime.resolve(step, context);
    }

    if (as) {
      context[as] = result;
    }

    return result;
  }

  async simpleGlob(dir, pattern) {
    const fs = await import('fs/promises');
    const path = await import('path');

    const results = [];
    const isRecursive = pattern.includes('**');

    async function walk(currentDir) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && isRecursive) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          results.push(fullPath);
        }
      }
    }

    await walk(dir);
    return results;
  }

  printHelp() {
    const program = this.runtime?.program;

    console.log(`\nUsage: ${program?.id || 'ddjex'} <command> [options]\n`);

    if (this.commands?.size > 0) {
      console.log('Commands:');
      for (const [name, cmd] of this.commands) {
        const args = cmd.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ');
        console.log(`  ${name} ${args}`);

        if (cmd.flags.length > 0) {
          for (const flag of cmd.flags) {
            const short = flag.short ? `-${flag.short}, ` : '    ';
            console.log(`    ${short}--${flag.name.replace(/_/g, '-')}`);
          }
        }
      }
    }

    console.log('');
  }
}

export { CLITarget };
