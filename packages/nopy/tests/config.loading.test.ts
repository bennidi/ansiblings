/**
 * Tests for nopy.config loading, merging and path resolution.
 *
 * findConfigFiles() walks from cwd up to the filesystem root and also consults
 * $HOME, so every test runs inside a fresh mkdtemp directory with HOME pointed
 * at an empty directory. Without that, a developer's own ~/.nopyrc.json would
 * leak into the merge result and make these tests machine-dependent.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigPaths, loadConfig, type NopyConfigFile, saveConfig } from '../src/nopy.config.js';

describe('config loading', () => {
  let originalCwd: string;
  let originalHome: string | undefined;
  let rootDir: string;
  let emptyHome: string;

  const write = (dir: string, config: NopyConfigFile) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.nopyrc.json'), JSON.stringify(config, null, 2));
  };

  beforeEach(() => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-config-')));
    emptyHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-home-')));
    process.env.HOME = emptyHome;
    process.chdir(rootDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  });

  describe('discovery', () => {
    it('throws a helpful error when no config exists anywhere', () => {
      expect(() => loadConfig()).toThrow(/No \.nopyrc\.json found/);
    });

    it('loads a config from the current directory', () => {
      write(rootDir, { hosts: ['web-1'] });
      expect(loadConfig().hosts).toEqual(['web-1']);
    });

    it('applies defaults for properties the file omits', () => {
      write(rootDir, { hosts: ['web-1'] });
      const config = loadConfig();
      expect(config.cubeDirs).toEqual([]);
      expect(config.env).toEqual({});
    });

    it('finds a config in a parent directory', () => {
      write(rootDir, { hosts: ['parent-host'] });
      const child = path.join(rootDir, 'a', 'b');
      fs.mkdirSync(child, { recursive: true });
      process.chdir(child);

      expect(loadConfig().hosts).toEqual(['parent-host']);
    });

    it('picks up $HOME config at the lowest priority', () => {
      write(emptyHome, { hosts: ['home-host'] });
      write(rootDir, { hosts: ['project-host'] });

      // Root-first ordering means the home value is merged in first.
      expect(loadConfig().hosts).toEqual(['home-host', 'project-host']);
    });

    it('does not duplicate the home config when cwd is $HOME', () => {
      write(emptyHome, { hosts: ['home-host'] });
      process.chdir(emptyHome);

      expect(getConfigPaths().filter((p) => p.startsWith(emptyHome))).toHaveLength(1);
      expect(loadConfig().hosts).toEqual(['home-host']);
    });

    it('tolerates an unset HOME', () => {
      process.env.HOME = '';
      write(rootDir, { hosts: ['web-1'] });
      expect(loadConfig().hosts).toEqual(['web-1']);
    });

    it('reports discovered config paths parent-first', () => {
      write(rootDir, { hosts: ['parent'] });
      const child = path.join(rootDir, 'child');
      write(child, { hosts: ['child'] });
      process.chdir(child);

      const paths = getConfigPaths();
      expect(paths).toEqual([path.join(rootDir, '.nopyrc.json'), path.join(child, '.nopyrc.json')]);
    });

    it('wraps malformed JSON with the offending path', () => {
      fs.writeFileSync(path.join(rootDir, '.nopyrc.json'), '{ not valid json');
      expect(() => loadConfig()).toThrow(/Failed to load config .*\.nopyrc\.json/);
    });
  });

  describe('merge strategy', () => {
    const nested = () => {
      const child = path.join(rootDir, 'child');
      fs.mkdirSync(child, { recursive: true });
      return child;
    };

    it('concatenates arrays and de-duplicates primitives', () => {
      const child = nested();
      write(rootDir, { hosts: ['a', 'b'] });
      write(child, { hosts: ['b', 'c'] });
      process.chdir(child);

      expect(loadConfig().hosts).toEqual(['a', 'b', 'c']);
    });

    it('replaces arrays entirely under the override strategy', () => {
      const child = nested();
      write(rootDir, { hosts: ['a', 'b'] });
      write(child, { hosts: ['only-me'], resolution: { hosts: 'override' } });
      process.chdir(child);

      expect(loadConfig().hosts).toEqual(['only-me']);
    });

    it('deep merges nested objects', () => {
      const child = nested();
      write(rootDir, { env: { SHARED: 'parent', ONLY_PARENT: 'p' } });
      write(child, { env: { SHARED: 'child', ONLY_CHILD: 'c' } });
      process.chdir(child);

      expect(loadConfig().env).toEqual({
        SHARED: 'child',
        ONLY_PARENT: 'p',
        ONLY_CHILD: 'c',
      });
    });

    it('lets a child primitive override a parent primitive', () => {
      const child = nested();
      write(rootDir, { log: { verbosity: 'info', debug: true } });
      write(child, { log: { verbosity: 'trace' } });
      process.chdir(child);

      expect(loadConfig().log).toEqual({ verbosity: 'trace', debug: true });
    });

    it('adds properties the parent never defined', () => {
      const child = nested();
      write(rootDir, { hosts: ['a'] });
      write(child, { execution: { continueOnError: true } });
      process.chdir(child);

      expect(loadConfig().execution).toEqual({ continueOnError: true });
    });

    it('keeps arrays of objects without de-duplicating them', () => {
      const child = nested();
      write(rootDir, { env: { list: [{ a: 1 }] } as never });
      write(child, { env: { list: [{ a: 1 }] } as never });
      process.chdir(child);

      expect((loadConfig().env as Record<string, unknown>).list).toHaveLength(2);
    });

    it('never surfaces the resolution key in the merged config', () => {
      write(rootDir, { hosts: ['a'], resolution: { hosts: 'override' } });
      expect(loadConfig()).not.toHaveProperty('resolution');
    });
  });

  describe('relative path resolution', () => {
    it('resolves ./ cubeDirs against the config file location', () => {
      write(rootDir, { cubeDirs: ['./cubes'] });
      expect(loadConfig().cubeDirs).toEqual([path.join(rootDir, 'cubes')]);
    });

    it('resolves ../ cubeDirs against the config file location', () => {
      const child = path.join(rootDir, 'child');
      write(child, { cubeDirs: ['../shared-cubes'] });
      process.chdir(child);

      expect(loadConfig().cubeDirs).toEqual([path.join(rootDir, 'shared-cubes')]);
    });

    it('resolves bare paths containing a separator', () => {
      write(rootDir, { cubeDirs: ['nested/cubes'] });
      expect(loadConfig().cubeDirs).toEqual([path.join(rootDir, 'nested', 'cubes')]);
    });

    it('leaves absolute cubeDirs untouched', () => {
      write(rootDir, { cubeDirs: ['/opt/cubes'] });
      expect(loadConfig().cubeDirs).toEqual(['/opt/cubes']);
    });

    it('leaves ~ and URL-like values untouched', () => {
      write(rootDir, { cubeDirs: ['~/cubes', 'https://example.com/cubes'] });
      expect(loadConfig().cubeDirs).toEqual(['~/cubes', 'https://example.com/cubes']);
    });

    it('leaves a bare single-segment name untouched', () => {
      write(rootDir, { cubeDirs: ['cubes'] });
      expect(loadConfig().cubeDirs).toEqual(['cubes']);
    });

    it('does not resolve paths for non-path properties such as hosts', () => {
      write(rootDir, { hosts: ['@docker/ubuntu', './not-a-path'] });
      expect(loadConfig().hosts).toEqual(['@docker/ubuntu', './not-a-path']);
    });

    it('resolves each config file against its own directory', () => {
      const child = path.join(rootDir, 'child');
      write(rootDir, { cubeDirs: ['./cubes'] });
      write(child, { cubeDirs: ['./cubes'] });
      process.chdir(child);

      expect(loadConfig().cubeDirs).toEqual([
        path.join(rootDir, 'cubes'),
        path.join(child, 'cubes'),
      ]);
    });
  });

  describe('saveConfig', () => {
    it('writes a new config file at the given path', () => {
      const target = path.join(rootDir, 'custom.json');
      saveConfig({ hosts: ['web-1'] }, target);

      expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ hosts: ['web-1'] });
    });

    it('defaults to .nopyrc.json in the cwd', () => {
      saveConfig({ hosts: ['web-1'] });
      const written = path.join(rootDir, '.nopyrc.json');

      expect(fs.existsSync(written)).toBe(true);
      expect(JSON.parse(fs.readFileSync(written, 'utf-8')).hosts).toEqual(['web-1']);
    });

    it('shallow merges over an existing file', () => {
      write(rootDir, { hosts: ['old'], env: { KEEP: '1' } });
      saveConfig({ hosts: ['new'] });

      const result = JSON.parse(fs.readFileSync(path.join(rootDir, '.nopyrc.json'), 'utf-8'));
      expect(result).toEqual({ hosts: ['new'], env: { KEEP: '1' } });
    });

    it('starts fresh when the existing file is unparseable', () => {
      fs.writeFileSync(path.join(rootDir, '.nopyrc.json'), '{{{ broken');
      saveConfig({ hosts: ['new'] });

      const result = JSON.parse(fs.readFileSync(path.join(rootDir, '.nopyrc.json'), 'utf-8'));
      expect(result).toEqual({ hosts: ['new'] });
    });
  });
});
