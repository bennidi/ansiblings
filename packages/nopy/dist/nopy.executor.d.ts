/**
 * Pyinfra command execution
 * @module nopy.executor
 */
import type { DependencySpec } from './cubes/types.js';
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
 * Outputs the execution plan without running (dry run)
 *
 * @param calls - Array of deployment calls
 * @param asJson - Output as JSON instead of text
 */
export declare function outputExecutionPlan(calls: DeployCall[], asJson?: boolean): void;
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
export declare function executeDeployCalls(calls: DeployCall[], options?: ExecutionOptions): Promise<ExecutionResult[]>;
/**
 * Generates a summary of execution results
 *
 * @param results - Array of execution results
 * @returns Summary object
 */
export declare function summarizeResults(results: ExecutionResult[]): {
    total: number;
    successful: number;
    failed: number;
    totalDuration: number;
    failures: ExecutionResult[];
};
