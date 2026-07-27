/**
 * Configuration loading and management
 * @module nopy.config
 */
import fs from 'node:fs';
import path from 'node:path';
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    hosts: [],
    cubeDirs: [],
    env: {},
};
const CONFIG_FILENAME = '.nopyrc.json';
/**
 * Finds all config files by traversing upwards from cwd to root
 * Returns configs in order from root to cwd (parent first, child last)
 */
function findConfigFiles() {
    const configPaths = [];
    let currentDir = process.cwd();
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
    const homeConfig = path.join(process.env.HOME || '', CONFIG_FILENAME);
    if (homeConfig && fs.existsSync(homeConfig) && !configPaths.includes(homeConfig)) {
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
 * Checks if a string looks like a relative path
 */
function isRelativePath(value) {
    return (value.startsWith('./') ||
        value.startsWith('../') ||
        // Also match paths without ./ prefix that don't look like URLs or absolute paths
        (!value.startsWith('/') &&
            !value.startsWith('~') &&
            !value.includes('://') &&
            (value.includes('/') || value.endsWith('.json') || value.endsWith('.yml'))));
}
/**
 * Resolves relative paths in a value based on config file location
 */
function resolveRelativePaths(value, configDir) {
    if (typeof value === 'string') {
        if (isRelativePath(value)) {
            return path.resolve(configDir, value);
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveRelativePaths(item, configDir));
    }
    if (typeof value === 'object' && value !== null) {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = resolveRelativePaths(val, configDir);
        }
        return result;
    }
    return value;
}
/**
 * Properties that contain filesystem paths and should have relative paths resolved
 */
const PATH_PROPERTIES = ['cubeDirs'];
/**
 * Resolves relative paths in a config file based on its location
 * Only resolves paths for properties that are known to contain filesystem paths
 */
function resolveConfigPaths(config, configPath) {
    const configDir = path.dirname(configPath);
    const resolved = {};
    for (const [key, value] of Object.entries(config)) {
        if (key === 'resolution') {
            // Don't resolve the resolution config itself
            resolved[key] = value;
        }
        else if (PATH_PROPERTIES.includes(key)) {
            // Only resolve paths for known path properties
            resolved[key] = resolveRelativePaths(value, configDir);
        }
        else {
            // Copy other properties as-is (including hosts)
            resolved[key] = value;
        }
    }
    return resolved;
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
export function loadConfig() {
    const configPaths = findConfigFiles();
    if (configPaths.length === 0) {
        throw new Error(`No ${CONFIG_FILENAME} found. Create one in your project directory or any parent directory.`);
    }
    // Start with defaults and merge each config file
    let config = { ...DEFAULT_CONFIG };
    for (const configPath of configPaths) {
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            const rawConfig = JSON.parse(content);
            // Resolve relative paths based on config file location
            const resolvedConfig = resolveConfigPaths(rawConfig, configPath);
            config = mergeConfigs(config, resolvedConfig);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to load config ${configPath}: ${message}`);
        }
    }
    return config;
}
/**
 * Gets the paths of all discovered config files (for debugging)
 */
export function getConfigPaths() {
    return findConfigFiles();
}
/**
 * Saves configuration to a file
 *
 * @param data - Configuration data to save
 * @param configPath - Path to save to (defaults to cwd/.nopyrc.json)
 */
export function saveConfig(data, configPath) {
    const savePath = configPath || path.resolve(process.cwd(), CONFIG_FILENAME);
    // Try to load existing config from this specific file
    let existing = {};
    if (fs.existsSync(savePath)) {
        try {
            existing = JSON.parse(fs.readFileSync(savePath, 'utf-8'));
        }
        catch {
            // Ignore parse errors, start fresh
        }
    }
    const merged = { ...existing, ...data };
    fs.writeFileSync(savePath, JSON.stringify(merged, null, 2));
}
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
export function logConfigToFlags(logConfig) {
    const flags = [];
    const verbosity = logConfig?.verbosity ?? 'silent';
    // Add verbosity flags
    switch (verbosity) {
        case 'silent':
            // No verbosity flags
            break;
        case 'info':
            flags.push('-v'); // Print meta information
            break;
        case 'verbose':
            flags.push('-vv'); // Print meta + input data
            break;
        case 'trace':
            flags.push('-vvv'); // Print meta + input + output
            break;
    }
    // Add debug flag if enabled
    if (logConfig?.debug) {
        flags.push('--debug');
    }
    return flags;
}
