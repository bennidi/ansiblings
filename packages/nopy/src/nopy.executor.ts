/**
 * Pyinfra command execution
 * @module nopy.executor
 */

import { getLogger } from '@logtape/logtape';
import { execa } from 'execa';
import type { DependencySpec } from './cubes/types.js';

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
  /** Full command array */
  command: string[];
  /** Environment variables for the cube */
  env: Record<string, unknown>;
  /** Cube dependencies */
  dependencies: DependencySpec[];
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
  const commandStr = call.command.join(' ');

  try {
    log.info(`Executing: ${call.cube} -> ${call.host}`);
    log.debug(`Command: ${commandStr}`);

    // Inherit stdio for live output
    await execa({ shell: true })(commandStr, {
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
 * @param asJson - Output as JSON instead of text
 */
export function outputExecutionPlan(calls: DeployCall[], asJson?: boolean): void {
  if (asJson) {
    const plan = calls.map((call) => ({
      cube: call.cube,
      host: call.host,
      command: call.command.join(' '),
      variables: call.env,
    }));
    console.log(JSON.stringify({ plan }, null, 2));
    return;
  }

  console.log('\n=== Execution Plan (Dry Run) ===\n');

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    console.log(`Step ${i + 1}: ${call.cube} -> ${call.host}`);
    console.log(`  Command: ${call.command.join(' ')}`);

    const envKeys = Object.keys(call.env);
    if (envKeys.length > 0) {
      console.log('  Variables:');
      for (const [key, value] of Object.entries(call.env)) {
        // Mask sensitive values
        const displayValue = key.toLowerCase().includes('password') ? '********' : String(value);
        console.log(`    ${key}=${displayValue}`);
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
