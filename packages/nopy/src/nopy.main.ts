/**
 * Main entry point for nopy
 * @module nopy.main
 */

import { type LogRecord, configure, getAnsiColorFormatter, getLogger } from '@logtape/logtape';
import { loadCubes } from './cubes/index.js';
import { BuildContext } from './cubes/dependencies.js';
import { Variables } from './nopy.common.js';
import { getConfigPaths, loadConfig } from './nopy.config.js';
import { type ExecutionResult, executeDeployCalls, summarizeResults } from './nopy.executor.js';
import { DEFAULT_HISTORY_SIZE, addToHistory } from './nopy.history.js';
import { type NopySession, saveSession } from './nopy.session.js';
import { runWorkflow } from './nopy.workflow.js';

/**
 * Configures the logtape logger for console output
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
            console.log(msg, ...Object.values(props));
          }
        };
      })(),
    },
    loggers: [
      {
        category: ['logtape', 'meta'],
        level: 'error',
        sinks: ['console'],
      },
      {
        category: 'nopy',
        level: 'debug',
        sinks: ['console'],
      },
    ],
  });
}

// Initialize logging
configureLogtape();

/**
 * Prints the active configuration summary
 */
function printActiveConfig(config: import('./nopy.config.js').NopyConfig, opts: { continueOnError: boolean }): void {
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
  console.log(lines.join('\n'));
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
  jsonOutput?: boolean;
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
    jsonOutput = false,
    saveToHistory = true,
  } = opts;

  const log = getLogger(['nopy']);
  const config = loadConfig();

  if (!jsonOutput && !replaySession && !loadSessionPath) {
    printActiveConfig(config, { continueOnError });
  }

  const { cubes, errors } = await loadCubes();
  const variables = new Variables(config.env);

  if (errors.length > 0) {
    log.error('Errors found during cube loading:');
    errors.forEach((error) => log.error(error));
    if (jsonOutput) console.log(JSON.stringify({ success: false, errors }, null, 2));
    return undefined;
  }

  const workflow = await runWorkflow(loadSessionPath, cubes, config, { useDefaults, useAuthKey }, replaySession);

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
      isSessionReplay: workflow.isReplay,
    }
  );

  for (const host of workflow.session.hosts!) {
    for (const cubeId of workflow.selectedCubes) {
      await context.resolveCube(cubeId, host);
    }
  }

  const sessionForSaving: NopySession = {
    ...workflow.session,
    cubes: context.cubeSessions,
    env: variables.get('global'),
  };

  if (saveSessionPath && !workflow.isReplay) {
    saveSession(sessionForSaving, saveSessionPath);
  }

  if (saveToHistory && !dryRun && !workflow.isReplay && context.deployCalls.length > 0) {
    const historySize = config.history?.maxSessions ?? DEFAULT_HISTORY_SIZE;
    if (config.history?.autoSave !== false) {
      addToHistory(sessionForSaving, historySize);
    }
  }

  if (printOnly) {
    console.log('\n  Deploy Commands\n  ───────────────\n');
    for (const call of context.deployCalls) {
      console.log(`  # ${call.cube} -> ${call.host}`);
      console.log(`  ${call.command.join(' ')}\n`);
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
      if (!jsonOutput) {
        const status = result.success ? '✓' : '✗';
        log.info(`[${completed}/${total}] ${status} ${result.cube} -> ${result.host}`);
      }
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
