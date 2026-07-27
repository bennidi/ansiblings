/**
 * Pyinfra command execution
 * @module nopy.executor
 */
import { getLogger } from '@logtape/logtape';
import { execa } from 'execa';
const log = getLogger(['nopy', 'executor']);
/**
 * Executes a single deployment call
 *
 * @param call - The deployment call to execute
 * @returns Execution result
 */
async function executeCall(call) {
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
    }
    catch (error) {
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
export function outputExecutionPlan(calls, asJson) {
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
export async function executeDeployCalls(calls, options = {}) {
    if (calls.length === 0) {
        log.info('No deployment calls to execute');
        return [];
    }
    if (options.dryRun) {
        outputExecutionPlan(calls);
        return [];
    }
    log.info(`Executing ${calls.length} deployment call(s)`);
    const results = [];
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
export function summarizeResults(results) {
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
