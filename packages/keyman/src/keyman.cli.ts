#!/usr/bin/env node

import { loadConfig, resolveConfigPaths } from './keyman.config.js';
import { keyman } from './keyman.main.js';

const args = process.argv.slice(2);

if (args.includes('--print-config')) {
  const config = loadConfig();
  const paths = resolveConfigPaths(config);
  console.log(JSON.stringify(paths));
  process.exit(0);
}

keyman();
