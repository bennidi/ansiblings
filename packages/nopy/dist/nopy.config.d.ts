/**
 * Configuration loading and management
 * @module nopy.config
 */
import type { TVariables } from './nopy.common.js';
/**
 * Log verbosity levels for pyinfra output
 */
export type LogVerbosity = 'silent' | 'info' | 'verbose' | 'trace';
/**
 * Logging configuration
 */
export interface LogConfig {
    /** Output verbosity level */
    verbosity?: LogVerbosity;
    /** Enable pyinfra debug logging */
    debug?: boolean;
}
/**
 * History configuration
 */
export interface HistoryConfig {
    /** Maximum number of sessions to keep in history (default: 10) */
    maxSessions?: number;
    /** Whether to auto-save sessions to history (default: true) */
    autoSave?: boolean;
}
/**
 * Execution configuration
 */
export interface ExecutionConfig {
    /** Continue executing after a cube fails (default: false) */
    continueOnError?: boolean;
}
/**
 * Resolution strategy for merging config properties
 * - 'merge': Arrays are concatenated, objects are deep merged (default)
 * - 'override': Child value completely replaces parent value
 */
export type ResolutionStrategy = 'merge' | 'override';
/**
 * Resolution configuration for customizing merge behavior
 */
export type ResolutionConfig = {
    [K in keyof NopyConfig]?: ResolutionStrategy;
};
/**
 * Raw config file structure (includes resolution)
 */
export interface NopyConfigFile extends Partial<NopyConfig> {
    /** Customize merge behavior for specific properties */
    resolution?: ResolutionConfig;
}
/**
 * Nopy configuration file structure
 */
export interface NopyConfig {
    /** Available host addresses */
    hosts: string[];
    /** Directories to search for cubes */
    cubeDirs: string[];
    /** Global environment variables */
    env: TVariables;
    /** Logging configuration */
    log?: LogConfig;
    /** Session history configuration */
    history?: HistoryConfig;
    /** Execution configuration */
    execution?: ExecutionConfig;
}
/**
 * Loads the nopy configuration
 *
 * Searches for `.nopyrc.json` by traversing upwards from cwd to root.
 * Multiple config files are merged, with child configs overriding parent configs.
 *
 * Use the `resolution` property to customize merge behavior:
 * ```json
 * {
 *   "hosts": ["local-host"],
 *   "resolution": {
 *     "hosts": "override"
 *   }
 * }
 * ```
 *
 * @returns The merged configuration
 * @throws Error if no config file is found
 */
export declare function loadConfig(): NopyConfig;
/**
 * Gets the paths of all discovered config files (for debugging)
 */
export declare function getConfigPaths(): string[];
/**
 * Saves configuration to a file
 *
 * @param data - Configuration data to save
 * @param configPath - Path to save to (defaults to cwd/.nopyrc.json)
 */
export declare function saveConfig(data: Partial<NopyConfig>, configPath?: string): void;
/**
 * Converts log configuration to pyinfra command line flags
 *
 * @param logConfig - Log configuration with verbosity and debug settings
 * @returns Array of pyinfra flags
 *
 * @example
 * ```typescript
 * const flags = logConfigToFlags({ verbosity: 'verbose', debug: true });
 * // Returns: ['-vv', '--debug']
 * ```
 */
export declare function logConfigToFlags(logConfig?: LogConfig): string[];
