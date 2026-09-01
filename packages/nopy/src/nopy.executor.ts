/**
 * Pyinfra command execution
 * @module nopy.executor
 */

import type { DependencySpec } from '@bitsquare/nopy-cubes';
import { getLogger } from '@logtape/logtape';
import { execa } from 'execa';
import { MASK } from './nopy.common.js';

const log = getLogger(['nopy', 'executor']);

/**
 * A deployment command ready for execution
 */
export interface DeployCall {
  /** Cube being deployed */
  cube: string;
  /** Target host */
  host: string;
  /** Working directory for execution */
  cwd: string;
  /**
   * The command as argv — `command[0]` is the executable, the rest are its
   * arguments, one element each and none of them quoted. Nothing joins this to
   * run it; {@link maskCommand} joins it to *show* it.
   */
  command: string[];
  /** Environment variables for the cube */
  env: Record<string, unknown>;
  /** Schema keys the cube's manifest declared as secrets */
  secrets?: string[];
  /** Cube dependencies */
  dependencies: DependencySpec[];
}

/**
 * One argv element, quoted for a POSIX shell.
 *
 * Display only — nothing is executed through a shell any more. The point is
 * that what `--print-only` writes can be pasted into a terminal and mean the
 * same thing it meant here.
 */
function shellQuote(arg: string): string {
  if (arg.length > 0 && /^[\w@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command as it is safe to show: the SSH password, and every `--data KEY=…`
 * whose key the manifest declared a secret, have their values replaced.
 *
 * pyinfra takes its data on the command line, so the real values have to be in
 * `call.command` — this is the last point before they would reach a log, a
 * `--print-only` dump or a dry-run plan.
 *
 * Walks the argv rather than pattern-matching a joined string. The old version
 * bounded a `--data` value on the closing quote the builder had written, which
 * tied masking to a quoting convention two modules apart; a value containing a
 * `"` broke it, and it was the same brittleness that made the command a shell
 * injection in the first place. Position is not guessable.
 */
export function maskCommand(call: DeployCall): string {
  const secrets = new Set(call.secrets ?? []);
  const argv = call.command;
  const out: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--password' && next !== undefined) {
      out.push(arg, MASK);
      i++;
    } else if (arg === '--data' && next !== undefined) {
      // Split on the first `=` only: the key cannot contain one, the value can.
      const eq = next.indexOf('=');
      const key = eq === -1 ? next : next.slice(0, eq);
      out.push(arg, secrets.has(key) ? `${key}=${MASK}` : shellQuote(next));
      i++;
    } else {
      out.push(shellQuote(arg));
    }
  }

  return out.join(' ');
}

/**
 * The cube's variables as they are safe to show.
 *
 * This used to guess, masking any key whose name contained "password" — which
 * missed `TOKEN` and `PSK`, and was defeated anyway by the unmasked command
 * printed on the line above it. The manifest says which keys are secret now.
 */
export function maskVariables(call: DeployCall): Record<string, string> {
  const secrets = new Set(call.secrets ?? []);
  return Object.fromEntries(
    Object.entries(call.env).map(([key, value]) => [key, secrets.has(key) ? MASK : String(value)])
  );
}

/**
 * Result of executing a deployment command
 */
export interface ExecutionResult {
  /** Cube that was deployed */
  cube: string;
  /** Target host */
  host: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Execution duration in milliseconds */
  duration: number;
  /** Standard output (if captured) */
  stdout?: string;
  /** Standard error (if captured) */
  stderr?: string;
  /** Error if execution failed */
  error?: Error;
}

/**
 * Options for deployment execution
 */
export interface ExecutionOptions {
  /** Continue executing remaining cubes after failure */
  continueOnError?: boolean;
  /** Show what would be executed without running */
  dryRun?: boolean;
  /** Callback for progress updates */
  onProgress?: (result: ExecutionResult, completed: number, total: number) => void;
  /** Callback when execution starts */
  onStart?: (cube: string, host: string) => void;
}

/**
 * Executes a single deployment call
 *
 * @param call - The deployment call to execute
 * @returns Execution result
 */
async function executeCall(call: DeployCall): Promise<ExecutionResult> {
  const startTime = Date.now();
  const [file, ...args] = call.command;

  try {
    log.info(`Executing: ${call.cube} -> ${call.host}`);
    log.debug(`Command: ${maskCommand(call)}`);

    // No shell. `execa({shell: true})` used to run the whole command as one
    // string, which made every variable value shell syntax — a password or a
    // `--data` value containing `;`, a backtick or `$(…)` was executed rather
    // than passed along. Spawning the argv directly removes the parse step;
    // pyinfra is still found on PATH, and stdio stays inherited for live output.
    await execa(file, args, {
      cwd: call.cwd,
      stdio: 'inherit',
    });

    return {
      cube: call.cube,
      host: call.host,
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error(`Failed: ${call.cube} -> ${call.host}`, { error: err.message });

    return {
      cube: call.cube,
      host: call.host,
      success: false,
      duration: Date.now() - startTime,
      error: err,
    };
  }
}

/**
 * Outputs the execution plan without running (dry run)
 *
 * @param calls - Array of deployment calls
 */
export function outputExecutionPlan(calls: DeployCall[]): void {
  console.log('\n=== Execution Plan (Dry Run) ===\n');

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    console.log(`Step ${i + 1}: ${call.cube} -> ${call.host}`);
    console.log(`  Command: ${maskCommand(call)}`);

    const variables = maskVariables(call);
    if (Object.keys(variables).length > 0) {
      console.log('  Variables:');
      for (const [key, value] of Object.entries(variables)) {
        console.log(`    ${key}=${value}`);
      }
    }
    console.log();
  }

  console.log(`Total: ${calls.length} command(s)\n`);
  console.log('Run without --dry-run to execute.\n');
}

/**
 * Executes an array of deployment calls
 *
 * @param calls - Array of deployment calls to execute
 * @param options - Execution options
 * @returns Array of execution results
 *
 * @example
 * ```typescript
 * const results = await executeDeployCalls(calls, {
 *   continueOnError: false,
 *   onProgress: (result, completed, total) => {
 *     console.log(`${completed}/${total} complete`);
 *   },
 * });
 * ```
 */
export async function executeDeployCalls(
  calls: DeployCall[],
  options: ExecutionOptions = {}
): Promise<ExecutionResult[]> {
  if (calls.length === 0) {
    log.info('No deployment calls to execute');
    return [];
  }

  if (options.dryRun) {
    outputExecutionPlan(calls);
    return [];
  }

  log.info(`Executing ${calls.length} deployment call(s)`);

  const results: ExecutionResult[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    options.onStart?.(call.cube, call.host);

    const result = await executeCall(call);
    results.push(result);

    options.onProgress?.(result, i + 1, calls.length);

    if (!result.success && !options.continueOnError) {
      log.warn(`Stopping execution due to failure in ${call.cube}`);
      break;
    }
  }

  return results;
}

/**
 * Generates a summary of execution results
 *
 * @param results - Array of execution results
 * @returns Summary object
 */
export function summarizeResults(results: ExecutionResult[]): {
  total: number;
  successful: number;
  failed: number;
  totalDuration: number;
  failures: ExecutionResult[];
} {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  return {
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    totalDuration,
    failures: failed,
  };
}
