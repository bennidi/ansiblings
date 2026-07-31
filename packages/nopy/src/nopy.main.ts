/**
 * Main entry point for nopy
 * @module nopy.main
 */

import { configure, getAnsiColorFormatter, getLogger, type LogRecord } from '@logtape/logtape';
import { BuildContext } from './cubes/dependencies.js';
import { loadCubes } from './cubes/index.js';
import { Variables } from './nopy.common.js';
import { getConfigPaths, loadConfig } from './nopy.config.js';
import {
  type ExecutionResult,
  executeDeployCalls,
  maskCommand,
  summarizeResults,
} from './nopy.executor.js';
import { addToHistory, DEFAULT_HISTORY_SIZE } from './nopy.history.js';
import { describeSession, type NopySession, SESSION_VERSION, saveSession } from './nopy.session.js';
import { runWorkflow } from './nopy.workflow.js';

/**
 * Configures the logtape logger for console output.
 *
 * **stderr**, deliberately. stdout carries the deploy commands and pyinfra's own
 * output; everything nopy says about itself goes to stderr, so `--print-only`
 * can be piped somewhere. The sink used to write to stdout and was held back
 * only by `--json`, which never worked and is gone.
 */
function configureLogtape(): void {
  configure({
    sinks: {
      console: (() => {
        const formatter = getAnsiColorFormatter();
        return (record: LogRecord) => {
          const formatted = formatter(record);
          if (typeof formatted === 'string') {
            const msg = formatted.replace(/\r?\n$/, '');
            const props = record.properties as Record<string, unknown>;
            console.error(msg, ...Object.values(props));
          }
        };
      })(),
    },
    loggers: [
      {
        category: ['logtape', 'meta'],
        lowestLevel: 'error',
        sinks: ['console'],
      },
      {
        category: 'nopy',
        lowestLevel: 'debug',
        sinks: ['console'],
      },
    ],
  });
}

// Initialize logging
configureLogtape();

/**
 * Prints the active configuration summary — to stderr, see {@link configureLogtape}.
 */
function printActiveConfig(
  config: import('./nopy.config.js').NopyConfig,
  opts: { continueOnError: boolean }
): void {
  const configPaths = getConfigPaths();
  const cwd = process.cwd();

  const lines: string[] = [''];
  lines.push('  Configuration');
  lines.push('  ─────────────');

  const relativePaths = configPaths.map((p) => {
    if (p.startsWith(cwd)) return `.${p.slice(cwd.length)}`;
    if (p.startsWith(process.env.HOME || '')) return `~${p.slice((process.env.HOME || '').length)}`;
    return p;
  });
  lines.push(`  Config:      ${relativePaths.join(' → ')}`);

  if (config.hosts.length > 0) lines.push(`  Hosts:       ${config.hosts.join(', ')}`);
  if (config.cubeDirs.length > 0) lines.push(`  Cube dirs:   ${config.cubeDirs.join(', ')}`);
  if (config.cubePackages.length > 0) {
    lines.push(`  Cube pkgs:   ${config.cubePackages.map((ref) => ref.spec).join(', ')}`);
  }
  if (opts.continueOnError) lines.push('  Execution:   continue-on-error');

  const envEntries = Object.entries(config.env);
  if (envEntries.length > 0) {
    lines.push('  Env vars:');
    for (const [key, value] of envEntries) {
      const isEmpty = value === null || value === undefined || value === '';
      lines.push(`    ${key}: ${isEmpty ? '<EMPTY>' : '<VALUE>'}`);
    }
  }

  lines.push('');
  console.error(lines.join('\n'));
}

/**
 * Options for the nopy main function
 */
export interface NopyOptions {
  useDefaults?: boolean;
  useAuthKey?: boolean;
  saveSession?: string;
  loadSession?: string;
  replaySession?: NopySession;
  dryRun?: boolean;
  printOnly?: boolean;
  continueOnError?: boolean;
  saveToHistory?: boolean;
}

/**
 * Result of a nopy execution
 */
export interface NopyResult {
  success: boolean;
  results: ExecutionResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    totalDuration: number;
  };
}

/**
 * Main entry point for nopy deployments
 */
export async function nopy(opts: NopyOptions = {}): Promise<NopyResult | undefined> {
  const {
    useDefaults = false,
    useAuthKey,
    saveSession: saveSessionPath,
    loadSession: loadSessionPath,
    replaySession,
    dryRun = false,
    printOnly = false,
    continueOnError = false,
    saveToHistory = true,
  } = opts;

  const log = getLogger(['nopy']);
  const config = loadConfig();

  if (!replaySession && !loadSessionPath) {
    printActiveConfig(config, { continueOnError });
  }

  const { cubes, errors } = await loadCubes();

  // Every key any manifest calls a secret, plus the config's own list. Computed
  // before the first cube resolves, so which cube happens to run first cannot
  // change whether a credential is treated as one.
  const declaredSecrets = new Set([
    ...Object.values(cubes).flatMap((cube) => cube.secrets),
    ...(config.secrets ?? []),
  ]);
  const variables = new Variables(config.env, declaredSecrets);

  if (errors.length > 0) {
    log.error('Errors found during cube loading:');
    for (const error of errors) log.error(error);
    return undefined;
  }

  const workflow = await runWorkflow(
    loadSessionPath,
    cubes,
    config,
    { useDefaults, useAuthKey },
    replaySession
  );

  // Step 3: Build deployment calls using BuildContext
  const context = new BuildContext(
    cubes,
    variables,
    workflow.session,
    config,
    {
      method: workflow.authMethod,
      username: workflow.username,
      password: workflow.password,
    },
    {
      useDefaults,
      isSessionReplay: workflow.replaySource !== undefined,
    }
  );

  for (const host of workflow.session.hosts!) {
    for (const cubeId of workflow.selectedCubes) {
      await context.resolveCube(cubeId, host);
    }
  }

  // The default name needs the resolved cube list, which does not exist until
  // the build has run — so it is filled in here rather than in `createSession`,
  // and only when nothing supplied one. `version` sits before the spread so that
  // a replayed session keeps whatever its file declared; a hand-written session
  // that declared none of the three gets all three.
  const timestamp = workflow.session.timestamp ?? new Date().toISOString();
  const sessionForSaving: NopySession = {
    version: SESSION_VERSION,
    ...workflow.session,
    timestamp,
    cubes: context.cubeSessions,
    // Not `config.env` — a declared secret in there would be written to the
    // session file in plaintext, one key above the `variables` it was carefully
    // kept out of.
    env: variables.persistableEnv(),
  };
  sessionForSaving.name ??= describeSession(sessionForSaving, timestamp);

  // Saved on a replay too: the resolved cube set is exactly what was asked for,
  // and a session written from a replay is no less valid than one written from a
  // fresh run. The old `!isReplay` guard made `nopy install -R -s out.json` exit
  // 0 having written nothing.
  if (saveSessionPath) {
    saveSession(sessionForSaving, saveSessionPath);
  }

  // A `-R`/`-H` replay is already in history and re-recording it would push the
  // original out of the list. A `--load-session` run is not in history at all,
  // so unless it is recorded here, `nopy history` reports nothing afterwards and
  // `-R` has nothing to repeat.
  const recordable = workflow.replaySource !== 'history';

  // `--print-only` is excluded for the same reason `--dry-run` is: neither
  // deployed anything, and history is what `-R` repeats. Recording a run that
  // never happened made `nopy install -P` — the safe look-before-you-leap flag —
  // silently displace the last real deployment at the head of the list.
  if (saveToHistory && !dryRun && !printOnly && recordable && context.deployCalls.length > 0) {
    const historySize = config.history?.maxSessions ?? DEFAULT_HISTORY_SIZE;
    if (config.history?.autoSave !== false) {
      addToHistory(sessionForSaving, historySize);
    }
  }

  if (printOnly) {
    console.log('\n  Deploy Commands\n  ───────────────\n');
    for (const call of context.deployCalls) {
      console.log(`  # ${call.cube} -> ${call.host}`);
      console.log(`  ${maskCommand(call)}\n`);
    }
    return {
      success: true,
      results: [],
      summary: { total: context.deployCalls.length, successful: 0, failed: 0, totalDuration: 0 },
    };
  }

  const results = await executeDeployCalls(context.deployCalls, {
    dryRun,
    continueOnError,
    onProgress: (result, completed, total) => {
      const status = result.success ? '✓' : '✗';
      log.info(`[${completed}/${total}] ${status} ${result.cube} -> ${result.host}`);
    },
  });

  const summary = summarizeResults(results);
  return {
    success: summary.failed === 0,
    results,
    summary: {
      total: summary.total,
      successful: summary.successful,
      failed: summary.failed,
      totalDuration: summary.totalDuration,
    },
  };
}
