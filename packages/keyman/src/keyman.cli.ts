#!/usr/bin/env node

import { createRequire } from 'node:module';
import { loadConfig, resolveConfigPaths } from './keyman.config.js';
import { keyman } from './keyman.main.js';
import type { Channel } from './keyman.update.js';
import { formatCommand, selfUpdate, updateNotice } from './keyman.update.js';

const { version, buildInfo } = createRequire(import.meta.url)('../package.json') as {
  version: string;
  buildInfo?: { commit?: string };
};

/**
 * What `--version` prints. `version` itself stays untouched everywhere else —
 * the commit is an annotation, stamped into `package.json` on the runner by the
 * publish workflows and absent when running from source.
 */
const versionLabel = buildInfo?.commit ? `${version} (${buildInfo.commit})` : version;

const args = process.argv.slice(2);

/** Reads `--flag value` out of argv, or undefined when the flag is absent */
function flagValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (args.includes('--print-config')) {
  const config = loadConfig();
  const paths = resolveConfigPaths(config);
  console.log(JSON.stringify(paths));
  process.exit(0);
}

if (args.includes('--version') || args.includes('-V')) {
  console.log(versionLabel);
  process.exit(0);
}

if (args[0] === 'self-update' || args[0] === 'upgrade' || args.includes('--self-update')) {
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  try {
    const result = await selfUpdate({
      currentVersion: version,
      channel: flagValue('--channel') as Channel | undefined,
      registry: flagValue('--registry'),
      dryRun,
      force: args.includes('--force') || args.includes('-f'),
    });

    const { status } = result;
    console.log(`Installed: ${status.current}`);
    console.log(`Channel:   ${status.channel}`);
    console.log(`Registry:  ${status.registry}`);
    console.log(`Available: ${status.latest ?? 'unknown'}`);
    console.log('');

    if (result.ran) {
      console.log(`Updated to ${status.latest}.`);
    } else if (dryRun) {
      console.log(`Would run: ${formatCommand(result.command)}`);
    } else if (status.latest === null) {
      console.error(`Could not reach ${status.registry} — nothing was changed.`);
      process.exit(1);
    } else {
      console.log('Already up to date.');
    }
  } catch (error) {
    console.error('Update failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
  process.exit(0);
}

// Printed to stderr so it never mixes into machine-read output.
const notice = await updateNotice({ currentVersion: version });
if (notice) {
  console.error(`\n${notice}\n`);
}

keyman();
