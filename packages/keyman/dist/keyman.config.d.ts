import { z } from 'zod';
/**
 * Configuration schema for keyman
 */
declare const KeymanConfigSchema: z.ZodObject<{
    vaultRoot: z.ZodDefault<z.ZodString>;
    keysDir: z.ZodDefault<z.ZodString>;
    tmpDir: z.ZodDefault<z.ZodString>;
    ageKeyFile: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    vaultRoot: string;
    keysDir: string;
    tmpDir: string;
    ageKeyFile: string;
}, {
    vaultRoot?: string | undefined;
    keysDir?: string | undefined;
    tmpDir?: string | undefined;
    ageKeyFile?: string | undefined;
}>;
export type KeymanConfig = z.infer<typeof KeymanConfigSchema>;
/**
 * Resolution strategy for merging config properties
 * - 'merge': Arrays are concatenated, objects are deep merged (default)
 * - 'override': Child value completely replaces parent value
 */
export type ResolutionStrategy = 'merge' | 'override';
/**
 * Resolution configuration for customizing merge behavior
 */
export type KeymanResolutionConfig = {
    [K in keyof KeymanConfig]?: ResolutionStrategy;
};
/**
 * Raw config file structure (includes resolution)
 */
export interface KeymanConfigFile extends Partial<KeymanConfig> {
    /** Customize merge behavior for specific properties */
    resolution?: KeymanResolutionConfig;
}
/**
 * Loads configuration from .keymanrc.json files
 *
 * Searches for `.keymanrc.json` by traversing upwards from cwd to root.
 * Multiple config files are merged, with child configs overriding parent configs.
 *
 * Use the `resolution` property to customize merge behavior:
 * ```json
 * {
 *   "vaultRoot": "../vault",
 *   "resolution": {
 *     "vaultRoot": "override"
 *   }
 * }
 * ```
 *
 * @returns Validated keyman configuration
 */
export declare function loadConfig(): KeymanConfig;
/**
 * Resolves configuration paths relative to VAULT_ROOT or current directory
 * @param config The keyman configuration
 * @returns Resolved absolute paths
 */
export declare function resolveConfigPaths(config: KeymanConfig): {
    vaultRoot: string;
    keysDir: string;
    tmpDir: string;
    keyPath: string;
};
/**
 * Gets the paths of all discovered config files (for debugging)
 * @returns Array of paths to .keymanrc.json files, ordered from root to cwd
 */
export declare function getConfigPaths(): string[];
export {};
