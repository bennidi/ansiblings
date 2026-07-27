#!/usr/bin/env node

/**
 * Nopy CLI - pyinfra deployment management
 * @module nopy.cli
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { loadConfig } from './nopy.config.js';
import {
  clearHistory,
  formatHistoryList,
  getLastSession,
  getSessionById,
  listHistory,
} from './nopy.history.js';
import { nopy } from './nopy.main.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const program = new Command();

program
  .name('nopy')
  .version(version)
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
  .option('-j, --json', 'Output results as JSON')
  .option('--no-history', 'Do not save this session to history')
  .action(async (options) => {
    // Loaded lazily so that --help/--version work outside a configured project.
    const execConfig = loadConfig().execution ?? {};
    const continueOnError = options.continueOnError ?? execConfig.continueOnError ?? false;

    try {
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
        console.log(`Repeating: ${lastEntry.name}\n`);
      } else if (options.history) {
        const entry = getSessionById(options.history);
        if (!entry) {
          console.error(`Session not found: ${options.history}`);
          console.error('Use "nopy history" to list available sessions.');
          process.exit(1);
        }
        sessionToReplay = entry;
        console.log(`Running: ${entry.name}\n`);
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
        jsonOutput: options.json,
        saveToHistory: options.history !== false && !options.dryRun,
      });

      // Exit with error code if deployment failed
      if (result && !result.success) {
        process.exit(1);
      }
    } catch (error) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        );
      } else {
        console.error('Error:', error instanceof Error ? error.message : error, error);
      }
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

program.parse();
