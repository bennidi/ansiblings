#!/usr/bin/env node

import { createRequire } from 'node:module';
import { helpText, type ParsedArgs, parseArgs, UsageError } from './keyman.args.js';
import { loadConfig, resolveConfigPaths } from './keyman.config.js';
import { keyman } from './keyman.main.js';
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

let parsed: ParsedArgs;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`❌ ${error.message}`);
  console.error('Run `keyman --help` for usage.');
  process.exit(2);
}

if (parsed.command === 'help') {
  console.log(helpText());
  process.exit(0);
}

if (parsed.command === 'print-config') {
  const config = loadConfig();
  const paths = resolveConfigPaths(config);
  console.log(JSON.stringify(paths));
  process.exit(0);
}

if (parsed.command === 'version') {
  console.log(versionLabel);
  process.exit(0);
}

if (parsed.command === 'self-update') {
  const { dryRun } = parsed;
  try {
    const result = await selfUpdate({
      currentVersion: version,
      channel: parsed.channel,
      registry: parsed.registry,
      dryRun,
      force: parsed.force,
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

try {
  await keyman();
} catch (error) {
  // Ctrl-C at any inquirer prompt lands here. `name`, not `instanceof`:
  // @inquirer/core is transitive and does not resolve from this package.
  if ((error as { name?: string }).name === 'ExitPromptError') {
    console.log('\n👋 Goodbye!\n');
    process.exit(0);
  }
  console.error(`❌ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
