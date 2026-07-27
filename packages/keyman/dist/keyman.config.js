import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
/**
 * Configuration schema for keyman
 */
const KeymanConfigSchema = z.object({
    vaultRoot: z.string().default('vault'),
    keysDir: z.string().default('keys'),
    tmpDir: z.string().default('tmp'),
    ageKeyFile: z.string().default('age.key'),
});
/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
    vaultRoot: 'vault',
    keysDir: 'keys',
    tmpDir: 'tmp',
    ageKeyFile: 'age.key',
};
const CONFIG_FILENAME = '.keymanrc.json';
/**
 * Path-based properties that should be resolved relative to config file location
 */
const PATH_PROPERTIES = ['vaultRoot'];
/**
 * Resolves path properties in a config object relative to the config file's directory
 * @param configFile The raw config file contents
 * @param configDir Directory containing the config file
 * @returns Config with path properties resolved to absolute paths
 */
function resolvePathsRelativeToConfig(configFile, configDir) {
    const resolved = { ...configFile };
    for (const prop of PATH_PROPERTIES) {
        const value = configFile[prop];
        if (typeof value === 'string' && !path.isAbsolute(value)) {
            resolved[prop] = path.resolve(configDir, value);
        }
    }
    return resolved;
}
/**
 * Finds all config files by traversing upwards from cwd to root
 * Returns configs in order from root to cwd (parent first, child last)
 * @param startDir Directory to start searching from
 * @returns Array of paths to .keymanrc.json files
 */
function findConfigFiles(startDir) {
    const configPaths = [];
    let currentDir = startDir;
    // Traverse upwards
    while (true) {
        const configPath = path.join(currentDir, CONFIG_FILENAME);
        if (fs.existsSync(configPath)) {
            configPaths.unshift(configPath); // Add to front (root first)
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break; // Reached root
        }
        currentDir = parentDir;
    }
    // Also check home directory (lowest priority)
    const homeConfig = path.join(os.homedir(), CONFIG_FILENAME);
    if (fs.existsSync(homeConfig) && !configPaths.includes(homeConfig)) {
        configPaths.unshift(homeConfig);
    }
    return configPaths;
}
/**
 * Deep merges two values based on resolution strategy
 */
function mergeValue(parentValue, childValue, strategy) {
    // Override strategy: child replaces parent completely
    if (strategy === 'override') {
        return childValue;
    }
    // Merge strategy (default)
    if (Array.isArray(parentValue) && Array.isArray(childValue)) {
        // Concatenate arrays, remove duplicates for primitives
        const combined = [...parentValue, ...childValue];
        if (combined.every((v) => typeof v !== 'object')) {
            return [...new Set(combined)];
        }
        return combined;
    }
    if (typeof parentValue === 'object' &&
        parentValue !== null &&
        typeof childValue === 'object' &&
        childValue !== null &&
        !Array.isArray(parentValue) &&
        !Array.isArray(childValue)) {
        // Deep merge objects
        const result = { ...parentValue };
        for (const [key, value] of Object.entries(childValue)) {
            if (key in result) {
                result[key] = mergeValue(result[key], value, 'merge');
            }
            else {
                result[key] = value;
            }
        }
        return result;
    }
    // Primitives: child overrides parent
    return childValue;
}
/**
 * Merges a child config into a parent config
 */
function mergeConfigs(parent, childFile) {
    const resolution = childFile.resolution || {};
    const result = { ...parent };
    for (const [key, value] of Object.entries(childFile)) {
        if (key === 'resolution')
            continue; // Skip resolution property itself
        const strategy = resolution[key] || 'merge';
        if (key in result) {
            result[key] = mergeValue(result[key], value, strategy);
        }
        else {
            result[key] = value;
        }
    }
    return result;
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
export function loadConfig() {
    const startDir = process.cwd();
    const configPaths = findConfigFiles(startDir);
    if (configPaths.length === 0) {
        console.error('ℹ️  No .keymanrc.json found, using default configuration');
        return DEFAULT_CONFIG;
    }
    // Start with defaults and merge each config file
    let config = { ...DEFAULT_CONFIG };
    for (const configPath of configPaths) {
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            const rawConfig = JSON.parse(content);
            // Resolve path properties relative to the config file's directory
            const configDir = path.dirname(configPath);
            const resolvedConfig = resolvePathsRelativeToConfig(rawConfig, configDir);
            config = mergeConfigs(config, resolvedConfig);
            console.error(`✅ Loaded configuration from ${configPath}`);
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                console.warn(`⚠️  Skipping invalid JSON in ${configPath}: ${error.message}`);
            }
            else {
                console.warn(`⚠️  Skipping config ${configPath}: ${error}`);
            }
            // Continue with other configs instead of failing entirely
        }
    }
    // Validate the final merged result
    try {
        return KeymanConfigSchema.parse(config);
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            console.error('❌ ERROR: Invalid merged configuration:');
            error.errors.forEach((err) => {
                console.error(`  - ${err.path.join('.')}: ${err.message}`);
            });
        }
        console.error('ℹ️  Falling back to default configuration');
        return DEFAULT_CONFIG;
    }
}
/**
 * Resolves configuration paths relative to VAULT_ROOT or current directory
 * @param config The keyman configuration
 * @returns Resolved absolute paths
 */
export function resolveConfigPaths(config) {
    // VAULT_ROOT environment variable takes precedence
    const vaultRoot = path.resolve(process.env.VAULT_ROOT ?? config.vaultRoot);
    return {
        vaultRoot,
        keysDir: path.resolve(vaultRoot, config.keysDir),
        tmpDir: path.resolve(vaultRoot, config.tmpDir),
        keyPath: path.resolve(vaultRoot, config.ageKeyFile),
    };
}
/**
 * Gets the paths of all discovered config files (for debugging)
 * @returns Array of paths to .keymanrc.json files, ordered from root to cwd
 */
export function getConfigPaths() {
    return findConfigFiles(process.cwd());
}
