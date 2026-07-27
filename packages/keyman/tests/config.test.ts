/**
 * Tests for keyman config discovery, merging and path resolution.
 *
 * Real .keymanrc.json files are written into temp directories and cwd is moved
 * there, because discovery is defined in terms of the real filesystem walk.
 * os.homedir() is stubbed so the developer's own home config cannot leak in.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getConfigPaths,
  type KeymanConfigFile,
  loadConfig,
  resolveConfigPaths,
} from '../src/keyman.config.js';

const DEFAULTS = {
  vaultRoot: 'vault',
  keysDir: 'keys',
  tmpDir: 'tmp',
  ageKeyFile: 'age.key',
};

describe('keyman config', () => {
  let originalCwd: string;
  let originalVaultRoot: string | undefined;
  let rootDir: string;
  let emptyHome: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const write = (dir: string, config: KeymanConfigFile | string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.keymanrc.json'),
      typeof config === 'string' ? config : JSON.stringify(config, null, 2)
    );
  };

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    originalCwd = process.cwd();
    originalVaultRoot = process.env.VAULT_ROOT;
    delete process.env.VAULT_ROOT;

    rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-config-')));
    emptyHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-home-')));
    vi.spyOn(os, 'homedir').mockReturnValue(emptyHome);

    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    process.chdir(rootDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    if (originalVaultRoot === undefined) {
      delete process.env.VAULT_ROOT;
    } else {
      process.env.VAULT_ROOT = originalVaultRoot;
    }
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  });

  describe('discovery', () => {
    it('falls back to defaults when no config file exists', () => {
      expect(loadConfig()).toEqual(DEFAULTS);
      expect(messages(errorSpy)).toContain('No .keymanrc.json found');
    });

    it('loads the config file in the current directory', () => {
      write(rootDir, { keysDir: 'my-keys' });

      expect(loadConfig().keysDir).toBe('my-keys');
      expect(messages(errorSpy)).toContain('Loaded configuration from');
    });

    it('fills unspecified properties from the defaults', () => {
      write(rootDir, { keysDir: 'my-keys' });

      const config = loadConfig();

      expect(config.tmpDir).toBe(DEFAULTS.tmpDir);
      expect(config.ageKeyFile).toBe(DEFAULTS.ageKeyFile);
    });

    it('lets a child config override its parent', () => {
      write(rootDir, { keysDir: 'parent-keys', tmpDir: 'parent-tmp' });
      const child = path.join(rootDir, 'nested');
      write(child, { keysDir: 'child-keys' });
      process.chdir(child);

      const config = loadConfig();

      expect(config.keysDir).toBe('child-keys');
      expect(config.tmpDir).toBe('parent-tmp');
    });

    it('gives the home config the lowest priority', () => {
      write(emptyHome, { keysDir: 'home-keys', tmpDir: 'home-tmp' });
      write(rootDir, { keysDir: 'local-keys' });

      const config = loadConfig();

      expect(config.keysDir).toBe('local-keys');
      expect(config.tmpDir).toBe('home-tmp');
    });

    it('does not load the home config twice when cwd is the home directory', () => {
      write(emptyHome, { keysDir: 'home-keys' });
      process.chdir(emptyHome);

      const homeConfig = path.join(emptyHome, '.keymanrc.json');
      expect(getConfigPaths().filter((p) => p === homeConfig)).toHaveLength(1);
    });

    it('orders discovered config files parent first', () => {
      write(rootDir, {});
      const child = path.join(rootDir, 'a', 'b');
      write(child, {});
      process.chdir(child);

      expect(getConfigPaths()).toEqual([
        path.join(rootDir, '.keymanrc.json'),
        path.join(child, '.keymanrc.json'),
      ]);
    });
  });

  describe('malformed configs', () => {
    it('skips a file with invalid JSON and keeps the rest', () => {
      write(rootDir, { keysDir: 'parent-keys' });
      const child = path.join(rootDir, 'nested');
      write(child, '{ not json');
      process.chdir(child);

      const config = loadConfig();

      expect(config.keysDir).toBe('parent-keys');
      expect(messages(warnSpy)).toContain('Skipping invalid JSON in');
    });

    it('skips a config it cannot read at all', () => {
      // A directory where a file is expected: readFileSync fails with EISDIR,
      // which is not a SyntaxError.
      fs.mkdirSync(path.join(rootDir, '.keymanrc.json'));

      expect(loadConfig()).toEqual(DEFAULTS);
      expect(messages(warnSpy)).toContain('Skipping config');
      expect(messages(warnSpy)).not.toContain('invalid JSON');
    });

    it('falls back to defaults when the merged config fails validation', () => {
      write(rootDir, { keysDir: 123 } as unknown as KeymanConfigFile);

      expect(loadConfig()).toEqual(DEFAULTS);
      expect(messages(errorSpy)).toContain('Invalid merged configuration');
      expect(messages(errorSpy)).toContain('keysDir');
      expect(messages(errorSpy)).toContain('Falling back to default configuration');
    });
  });

  describe('path resolution', () => {
    it('resolves a relative vaultRoot against the config file directory', () => {
      write(rootDir, { vaultRoot: './secrets' });

      expect(loadConfig().vaultRoot).toBe(path.join(rootDir, 'secrets'));
    });

    it('resolves a vaultRoot that points above the config file', () => {
      const child = path.join(rootDir, 'nested');
      write(child, { vaultRoot: '../secrets' });
      process.chdir(child);

      expect(loadConfig().vaultRoot).toBe(path.join(rootDir, 'secrets'));
    });

    it('leaves an absolute vaultRoot untouched', () => {
      write(rootDir, { vaultRoot: '/srv/vault' });

      expect(loadConfig().vaultRoot).toBe('/srv/vault');
    });

    it('leaves non-path properties alone', () => {
      write(rootDir, { keysDir: './keys', tmpDir: './tmp' });

      const config = loadConfig();

      expect(config.keysDir).toBe('./keys');
      expect(config.tmpDir).toBe('./tmp');
    });

    it('resolves each config file against its own directory', () => {
      write(rootDir, { vaultRoot: './parent-vault' });
      const child = path.join(rootDir, 'nested');
      write(child, {});
      process.chdir(child);

      expect(loadConfig().vaultRoot).toBe(path.join(rootDir, 'parent-vault'));
    });
  });

  describe('merge strategy', () => {
    it('honours an explicit override strategy', () => {
      write(rootDir, { vaultRoot: '/parent-vault' });
      const child = path.join(rootDir, 'nested');
      write(child, { vaultRoot: '/child-vault', resolution: { vaultRoot: 'override' } });
      process.chdir(child);

      expect(loadConfig().vaultRoot).toBe('/child-vault');
    });

    it('never surfaces the resolution key in the loaded config', () => {
      write(rootDir, { keysDir: 'my-keys', resolution: { keysDir: 'override' } });

      expect(loadConfig()).not.toHaveProperty('resolution');
    });

    it('tolerates and drops array-valued keys the schema does not define', () => {
      write(rootDir, { extra: ['a', 'b'] } as unknown as KeymanConfigFile);
      const child = path.join(rootDir, 'nested');
      write(child, { extra: ['b', 'c'], keysDir: 'my-keys' } as unknown as KeymanConfigFile);
      process.chdir(child);

      const config = loadConfig();

      expect(config).toEqual({ ...DEFAULTS, keysDir: 'my-keys' });
    });

    it('tolerates and drops object-valued keys the schema does not define', () => {
      write(rootDir, { extra: { a: 1 } } as unknown as KeymanConfigFile);
      const child = path.join(rootDir, 'nested');
      write(child, { extra: { a: 2, b: 3 } } as unknown as KeymanConfigFile);
      process.chdir(child);

      expect(loadConfig()).toEqual(DEFAULTS);
    });

    it('tolerates arrays of objects, which cannot be de-duplicated', () => {
      write(rootDir, { extra: [{ a: 1 }] } as unknown as KeymanConfigFile);
      const child = path.join(rootDir, 'nested');
      write(child, { extra: [{ a: 2 }] } as unknown as KeymanConfigFile);
      process.chdir(child);

      expect(loadConfig()).toEqual(DEFAULTS);
    });
  });

  describe('resolveConfigPaths', () => {
    it('places every directory under the vault root', () => {
      const paths = resolveConfigPaths({ ...DEFAULTS, vaultRoot: '/srv/vault' });

      expect(paths).toEqual({
        vaultRoot: '/srv/vault',
        keysDir: '/srv/vault/keys',
        tmpDir: '/srv/vault/tmp',
        keyPath: '/srv/vault/age.key',
      });
    });

    it('resolves a relative vault root against the current directory', () => {
      const paths = resolveConfigPaths({ ...DEFAULTS, vaultRoot: 'vault' });

      expect(paths.vaultRoot).toBe(path.join(rootDir, 'vault'));
    });

    it('lets VAULT_ROOT take precedence over the config', () => {
      process.env.VAULT_ROOT = '/env/vault';

      const paths = resolveConfigPaths({ ...DEFAULTS, vaultRoot: '/srv/vault' });

      expect(paths.vaultRoot).toBe('/env/vault');
      expect(paths.keyPath).toBe('/env/vault/age.key');
    });

    it('honours absolute sub-directory overrides', () => {
      const paths = resolveConfigPaths({
        ...DEFAULTS,
        vaultRoot: '/srv/vault',
        keysDir: '/elsewhere/keys',
      });

      expect(paths.keysDir).toBe('/elsewhere/keys');
    });
  });
});
