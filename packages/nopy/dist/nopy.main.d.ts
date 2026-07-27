/**
 * Main entry point for nopy
 * @module nopy.main
 */
import { type ExecutionResult } from './nopy.executor.js';
import { type NopySession } from './nopy.session.js';
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
export declare function nopy(opts?: NopyOptions): Promise<NopyResult | undefined>;
