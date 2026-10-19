#!/usr/bin/env node
import { run } from '../src/cli.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  process.stderr.write(`valyro requires Node.js 20 or newer (found ${process.versions.node}).\n`);
  process.exit(1);
}

process.exitCode = await run(process.argv.slice(2));
