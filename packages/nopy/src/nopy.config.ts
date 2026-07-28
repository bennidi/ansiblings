/**
 * Configuration loading and management
 * @module nopy.config
 */

import fs from 'node:fs';
import path from 'node:path';
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
 * A cube package named in `cubePackages`, paired with where it was named.
 *
 * Node resolution has to start from the config file that asked for the package,
 * not from `process.cwd()` — otherwise a package listed in `~/.nopyrc.json`
 * only resolves in projects that happen to depend on it themselves. This is the
 * same problem {@link PATH_PROPERTIES} solves for `cubeDirs`, except the answer
 * is a reference to resolve later rather than a rewritten path.
 */
export interface CubePackageRef {
  /** The package name as written in the config, e.g. `@acme/cubes-net`. */
  spec: string;
  /** Directory of the `.nopyrc.json` that named it. */
  from: string;
}

/**
 * Raw config file structure (includes resolution)
 *
 * Diverges from {@link NopyConfig} for `cubePackages`: a file lists plain
 * package names, and loading turns each into a {@link CubePackageRef}.
 */
export interface NopyConfigFile extends Omit<Partial<NopyConfig>, 'cubePackages'> {
  /** Cube packages to load, by package name */
  cubePackages?: string[];
  /** Customize merge behavior for specific properties */
  resolution?: ResolutionConfig;
}

/**
 * A config file whose paths have been resolved — what actually gets merged.
 */
type ResolvedConfigFile = Omit<NopyConfigFile, 'cubePackages'> & {
  cubePackages?: CubePackageRef[];
};

/**
 * Nopy configuration file structure
 */
export interface NopyConfig {
  /** Available host addresses */
  hosts: string[];
  /** Directories to search for cubes */
  cubeDirs: string[];
  /** Installed packages to load cubes from */
  cubePackages: CubePackageRef[];
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
 * Default configuration
 */
const DEFAULT_CONFIG: NopyConfig = {
  hosts: [],
  cubeDirs: [],
  cubePackages: [],
  env: {},
};

const CONFIG_FILENAME = '.nopyrc.json';

/**
 * Finds all config files by traversing upwards from cwd to root
 * Returns configs in order from root to cwd (parent first, child last)
 */
function findConfigFiles(): string[] {
  const configPaths: string[] = [];
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
function mergeValue(
  parentValue: unknown,
  childValue: unknown,
  strategy: ResolutionStrategy
): unknown {
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

  if (
    typeof parentValue === 'object' &&
    parentValue !== null &&
    typeof childValue === 'object' &&
    childValue !== null &&
    !Array.isArray(parentValue) &&
    !Array.isArray(childValue)
  ) {
    // Deep merge objects
    const result: Record<string, unknown> = { ...parentValue };
    for (const [key, value] of Object.entries(childValue)) {
      if (key in result) {
        result[key] = mergeValue(result[key], value, 'merge');
      } else {
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
function isRelativePath(value: string): boolean {
  return (
    value.startsWith('./') ||
    value.startsWith('../') ||
    // Also match paths without ./ prefix that don't look like URLs or absolute paths
    (!value.startsWith('/') &&
      !value.startsWith('~') &&
      !value.includes('://') &&
      (value.includes('/') || value.endsWith('.json') || value.endsWith('.yml')))
  );
}

/**
 * Resolves relative paths in a value based on config file location
 */
function resolveRelativePaths(value: unknown, configDir: string): unknown {
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
    const result: Record<string, unknown> = {};
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
const PATH_PROPERTIES: (keyof NopyConfig)[] = ['cubeDirs'];

/**
 * Resolves relative paths in a config file based on its location
 * Only resolves paths for properties that are known to contain filesystem paths
 */
function resolveConfigPaths(config: NopyConfigFile, configPath: string): ResolvedConfigFile {
  const configDir = path.dirname(configPath);
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (key === 'resolution') {
      // Don't resolve the resolution config itself
      resolved[key] = value as ResolutionConfig;
    } else if (key === 'cubePackages') {
      // Not a path — a package name, tagged with where to resolve it from.
      resolved[key] = (value as string[]).map((spec) => ({ spec, from: configDir }));
    } else if (PATH_PROPERTIES.includes(key as keyof NopyConfig)) {
      // Only resolve paths for known path properties
      resolved[key] = resolveRelativePaths(value, configDir);
    } else {
      // Copy other properties as-is (including hosts)
      resolved[key] = value;
    }
  }

  return resolved as ResolvedConfigFile;
}

/**
 * Merges a child config into a parent config
 */
function mergeConfigs(parent: NopyConfig, childFile: ResolvedConfigFile): NopyConfig {
  const resolution = childFile.resolution || {};
  const result: Record<string, unknown> = { ...parent };

  for (const [key, value] of Object.entries(childFile)) {
    if (key === 'resolution') continue; // Skip resolution property itself

    const strategy = resolution[key as keyof NopyConfig] || 'merge';
    if (key in result) {
      result[key] = mergeValue(result[key], value, strategy);
    } else {
      result[key] = value;
    }
  }

  return result as unknown as NopyConfig;
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
export function loadConfig(): NopyConfig {
  const configPaths = findConfigFiles();

  if (configPaths.length === 0) {
    throw new Error(
      `No ${CONFIG_FILENAME} found. Create one in your project directory or any parent directory.`
    );
  }

  // Start with defaults and merge each config file
  let config: NopyConfig = { ...DEFAULT_CONFIG };

  for (const configPath of configPaths) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const rawConfig = JSON.parse(content) as NopyConfigFile;
      // Resolve relative paths based on config file location
      const resolvedConfig = resolveConfigPaths(rawConfig, configPath);
      config = mergeConfigs(config, resolvedConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load config ${configPath}: ${message}`);
    }
  }

  return config;
}

/**
 * Gets the paths of all discovered config files (for debugging)
 */
export function getConfigPaths(): string[] {
  return findConfigFiles();
}

/**
 * Saves configuration to a file
 *
 * @param data - Configuration data to save
 * @param configPath - Path to save to (defaults to cwd/.nopyrc.json)
 */
export function saveConfig(data: Partial<NopyConfig>, configPath?: string): void {
  const savePath = configPath || path.resolve(process.cwd(), CONFIG_FILENAME);

  // Try to load existing config from this specific file
  let existing: Partial<NopyConfig> = {};
  if (fs.existsSync(savePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(savePath, 'utf-8'));
    } catch {
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
export function logConfigToFlags(logConfig?: LogConfig): string[] {
  const flags: string[] = [];
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
