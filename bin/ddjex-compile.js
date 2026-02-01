#!/usr/bin/env node
/**
 * ddjex Compiler CLI
 * Usage: node bin/ddjex-compile.js <input.json> [output.js] [--minify]
 */

import { readFile, writeFile } from 'fs/promises';
import { compile } from '../src/compiler/index.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
ddjex Compiler

Usage:
  ddjex-compile <input.json> [output.js] [options]

Options:
  --minify    Minify output
  --module    Output as ES module
  --help      Show this help

Example:
  ddjex-compile app.ddjex.json app.js --minify
`);
    process.exit(0);
  }

  const inputFile = args.find(a => !a.startsWith('--'));
  const outputFile = args.filter(a => !a.startsWith('--'))[1];
  const minify = args.includes('--minify');
  const module = args.includes('--module');

  if (!inputFile) {
    console.error('Error: Input file required');
    process.exit(1);
  }

  try {
    // Read input
    const json = await readFile(inputFile, 'utf-8');
    const program = JSON.parse(json);

    // Compile
    const code = compile(program, {
      minify,
      target: module ? 'module' : 'browser'
    });

    // Output
    if (outputFile) {
      await writeFile(outputFile, code);
      console.log(`Compiled: ${inputFile} -> ${outputFile}`);
      console.log(`Size: ${code.length} bytes`);
    } else {
      console.log(code);
    }

  } catch (e) {
    console.error('Compilation failed:', e.message);
    process.exit(1);
  }
}

main();
