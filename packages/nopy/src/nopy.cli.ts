#!/usr/bin/env node

/**
 * Nopy CLI - pyinfra deployment management
 * @module nopy.cli
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { loadConfig } from './nopy.config.js';
import { reportError } from './nopy.errors.js';
import { exitWithFarewell, installGracefulExit, isCancellation } from './nopy.exit.js';
import {
  clearHistory,
  formatHistoryList,
  getLastSession,
  getSessionById,
  listHistory,
} from './nopy.history.js';
import { nopy } from './nopy.main.js';
import type { Channel } from './nopy.update.js';
import { formatCommand, selfUpdate, updateNotice } from './nopy.update.js';

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

/**
 * Prints the update hint to stderr, so it never lands in a `--print-only`
 * command list being piped somewhere.
 */
async function printUpdateNotice(): Promise<void> {
  const notice = await updateNotice({ currentVersion: version });
  if (notice) {
    console.error(`\n${notice}\n`);
  }
}

// Before anything can open a prompt: a cancelled TUI leaves through
// nopy.exit, not through node's default unhandled-rejection trace.
installGracefulExit();

const program = new Command();

program
  .name('nopy')
  .version(versionLabel)
  .description('A CLI tool for pyinfra script management and execution.')
  .addHelpText(
    'after',
    `
Examples:
  $ nopy                      Interactive cube selection and deployment
  $ nopy -R                   Repeat the last deployment session
  $ nopy -H <id>              Run a specific session from history
  $ nopy -l session.json      Load and replay a saved session file
  $ nopy -s session.json      Save session to file after deployment
  $ nopy -n                   Dry run (show plan without executing)
  $ nopy -P                   Print deploy commands only
  $ nopy history              List all saved sessions
  $ nopy clear-history        Clear session history

  Every flag above belongs to 'install', the default command — 'nopy -R' is
  'nopy install -R'. Run 'nopy install --help' for the full list.

Session Replay:
  Sessions are automatically saved to history after each deployment.
  Use 'nopy history' to see available sessions and their IDs.
  Use 'nopy -R' to quickly repeat the last session.
  Use 'nopy -H <id>' to run any session from history.
`
  );

program
  .command('install', { isDefault: true })
  .description('Install cubes on a given host')
  .alias('i')
  .option('-D, --use-defaults', 'Run cubes with default values without prompts')
  .option('-K, --auth-method-key', 'Use SSH key authentication')
  .option('-R, --repeat-last', 'Repeat the last session from history')
  .option('-H, --history <id>', 'Run a specific session from history by ID')
  .option('-s, --save-session <path>', 'Save session to file for later replay')
  .option('-l, --load-session <path>', 'Load and replay session from file')
  .option('-n, --dry-run', 'Show execution plan without running')
  .option('-P, --print-only', 'Print deploy commands and exit (no execution)')
  .option('-c, --continue-on-error', 'Continue executing after failures')
  .option('--no-history', 'Do not save this session to history')
  .action(async (options) => {
    await printUpdateNotice();

    try {
      // Loaded lazily so that --help/--version work outside a configured
      // project — and inside the try, so that "no .nopyrc.json here" is
      // reported by `reportError` rather than escaping as an unhandled
      // rejection and printing node's own stack. It is the likeliest first-run
      // mistake there is.
      const execConfig = loadConfig().execution ?? {};
      const continueOnError = options.continueOnError ?? execConfig.continueOnError ?? false;

      // Handle session replay
      const loadSessionPath = options.loadSession;
      let sessionToReplay: { session: import('./nopy.session.js').NopySession } | undefined;

      if (options.repeatLast) {
        const lastEntry = getLastSession();
        if (!lastEntry) {
          console.error('No sessions in history. Run a deployment first.');
          process.exit(1);
        }
        sessionToReplay = lastEntry;
        // stderr, like everything nopy says about itself — `-R --print-only` has
        // to leave stdout to the commands.
        console.error(`Repeating: ${lastEntry.name}\n`);
      } else if (options.history) {
        const entry = getSessionById(options.history);
        if (!entry) {
          console.error(`Session not found: ${options.history}`);
          console.error('Use "nopy history" to list available sessions.');
          process.exit(1);
        }
        sessionToReplay = entry;
        console.error(`Running: ${entry.name}\n`);
      }

      const result = await nopy({
        useDefaults: options.useDefaults,
        useAuthKey: options.authMethodKey,
        saveSession: options.saveSession,
        loadSession: loadSessionPath,
        replaySession: sessionToReplay?.session,
        dryRun: options.dryRun,
        printOnly: options.printOnly,
        continueOnError,
        saveToHistory: options.history !== false && !options.dryRun,
      });

      // Exit with error code if deployment failed
      if (result && !result.success) {
        process.exit(1);
      }
    } catch (error) {
      // A prompt the user backed out of is not a failed run: inquirer rejects
      // cleanly, so unlike the enquirer case this arrives here rather than at
      // the process-level handler.
      if (isCancellation(error)) exitWithFarewell();

      reportError(error);
      process.exit(1);
    }
  });

program
  .command('history')
  .description('List session history')
  .alias('h')
  .option('-j, --json', 'Output as JSON')
  .action((options) => {
    const entries = listHistory();

    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      console.log(formatHistoryList(entries));
    }
  });

program
  .command('clear-history')
  .description('Clear all session history')
  .action(() => {
    clearHistory();
    console.log('Session history cleared.');
  });

program
  .command('self-update')
  .description('Update nopy to the newest version on your channel')
  .alias('upgrade')
  .option('-n, --dry-run', 'Show the install command without running it')
  .option('-f, --force', 'Reinstall even when already up to date')
  .option('--channel <tag>', 'Check a specific channel (latest, next, main)')
  .option('--registry <url>', 'Install from a specific registry')
  .action(async (options) => {
    try {
      const result = await selfUpdate({
        currentVersion: version,
        channel: options.channel as Channel | undefined,
        registry: options.registry,
        dryRun: options.dryRun,
        force: options.force,
      });

      const { status } = result;
      console.log(`Installed: ${status.current}`);
      console.log(`Channel:   ${status.channel}`);
      console.log(`Registry:  ${status.registry}`);
      console.log(`Available: ${status.latest ?? 'unknown'}`);
      console.log('');

      if (result.ran) {
        console.log(`Updated to ${status.latest}.`);
      } else if (options.dryRun) {
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
  });

program.parse();
