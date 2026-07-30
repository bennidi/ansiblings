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

export type KeymanConfig = z.infer<typeof KeymanConfigSchema>;

/** Raw config file structure */
export type KeymanConfigFile = Partial<KeymanConfig>;

/** Every key a config file may set. */
const KNOWN_KEYS = Object.keys(KeymanConfigSchema.shape) as (keyof KeymanConfig)[];

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: KeymanConfig = {
  vaultRoot: 'vault',
  keysDir: 'keys',
  tmpDir: 'tmp',
  ageKeyFile: 'age.key',
};

const CONFIG_FILENAME = '.keymanrc.json';

/**
 * Path-based properties that should be resolved relative to config file location
 */
const PATH_PROPERTIES: (keyof KeymanConfig)[] = ['vaultRoot'];

/**
 * Resolves path properties in a config object relative to the config file's directory
 * @param configFile The raw config file contents
 * @param configDir Directory containing the config file
 * @returns Config with path properties resolved to absolute paths
 */
function resolvePathsRelativeToConfig(
  configFile: KeymanConfigFile,
  configDir: string
): KeymanConfigFile {
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
function findConfigFiles(startDir: string): string[] {
  const configPaths: string[] = [];
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
 * Reports keys a config file sets that keyman does not read.
 *
 * `z.object` strips them silently, so `{"vaultroot": "…"}` used to be
 * indistinguishable from an empty file — the vault quietly stayed at the default
 * and nothing said why. Warned rather than fatal, which is this module's posture
 * throughout, and warned *here* because this is the only place the filename is in
 * hand: `z.strictObject` on the merged result cannot name the file that said it.
 */
function warnUnknownKeys(configFile: KeymanConfigFile, configPath: string): void {
  const unknown = Object.keys(configFile).filter(
    (key) => !KNOWN_KEYS.includes(key as keyof KeymanConfig)
  );

  if (unknown.length > 0) {
    console.warn(
      `⚠️  ${configPath}: ignoring unknown ${unknown.length === 1 ? 'key' : 'keys'} ${unknown.join(', ')}. Known keys: ${KNOWN_KEYS.join(', ')}.`
    );
  }
}

/**
 * Merges a child config into a parent config.
 *
 * Every property is a string, so a child simply wins. keyman deliberately has
 * none of nopy's `resolution` machinery: deep-merge and array-concatenation
 * strategies are meaningful there because its config holds arrays and objects,
 * and here they would be 45 lines that cannot change an outcome.
 */
function mergeConfigs(parent: KeymanConfig, childFile: KeymanConfigFile): KeymanConfig {
  return { ...parent, ...childFile };
}

/**
 * Loads configuration from .keymanrc.json files
 *
 * Searches for `.keymanrc.json` by traversing upwards from cwd to root.
 * Multiple config files are merged, with child configs overriding parent configs.
 *
 * @returns Validated keyman configuration
 */
export function loadConfig(): KeymanConfig {
  const startDir = process.cwd();
  const configPaths = findConfigFiles(startDir);

  if (configPaths.length === 0) {
    console.error('ℹ️  No .keymanrc.json found, using default configuration');
    return DEFAULT_CONFIG;
  }

  // Start with defaults and merge each config file
  let config: KeymanConfig = { ...DEFAULT_CONFIG };

  for (const configPath of configPaths) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const rawConfig = JSON.parse(content) as KeymanConfigFile;
      warnUnknownKeys(rawConfig, configPath);
      // Resolve path properties relative to the config file's directory
      const configDir = path.dirname(configPath);
      const resolvedConfig = resolvePathsRelativeToConfig(rawConfig, configDir);
      config = mergeConfigs(config, resolvedConfig);
      console.error(`✅ Loaded configuration from ${configPath}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn(`⚠️  Skipping invalid JSON in ${configPath}: ${error.message}`);
      } else {
        console.warn(`⚠️  Skipping config ${configPath}: ${error}`);
      }
      // Continue with other configs instead of failing entirely
    }
  }

  // Validate the final merged result
  try {
    return KeymanConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ ERROR: Invalid merged configuration:');
      error.issues.forEach((err) => {
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
export function resolveConfigPaths(config: KeymanConfig) {
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
export function getConfigPaths(): string[] {
  return findConfigFiles(process.cwd());
}

/**
 * What `--print-config` prints.
 *
 * `configFiles` is the question the flag could not answer before: which files
 * were read, in the order they were merged. It existed only as unstructured
 * stderr from `loadConfig`, which is exactly the wrong place for it — the JSON is
 * the machine-readable half.
 */
export function describeConfig(): ReturnType<typeof resolveConfigPaths> & {
  configFiles: string[];
} {
  return { ...resolveConfigPaths(loadConfig()), configFiles: getConfigPaths() };
}
