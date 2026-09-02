/**
 * Tests for nopy.init module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILENAME, loadConfig } from '../src/nopy.config.js';
import { formatInitResults, GUIDE_FILENAME, initProject } from '../src/nopy.init.js';

describe('initProject', () => {
  let dir: string;

  beforeEach(() => {
    // realpath: os.tmpdir() is a symlink on macOS, and paths reported back by
    // process.cwd() after a chdir are resolved — comparisons need one form.
    dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nopy-init-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates both files in an empty directory', () => {
    const results = initProject({ dir });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status)).toEqual(['created', 'created']);
    expect(results.map((r) => r.file)).toEqual([CONFIG_FILENAME, GUIDE_FILENAME]);
    for (const result of results) {
      expect(fs.existsSync(result.path)).toBe(true);
      expect(path.dirname(result.path)).toBe(dir);
    }
  });

  it('writes a config that parses and carries the starter shape', () => {
    initProject({ dir });

    const config = JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILENAME), 'utf-8'));
    expect(config.hosts).toEqual([]);
    expect(config.cubeDirs).toEqual(['./cubes']);
    expect(config.cubePackages).toEqual([]);
    expect(config.log.verbosity).toBe('info');
  });

  it('writes a config that loadConfig accepts', () => {
    initProject({ dir });

    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const config = loadConfig();
      expect(config.cubeDirs).toContain(path.join(dir, 'cubes'));
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('writes the bundled guide', () => {
    initProject({ dir });

    const guide = fs.readFileSync(path.join(dir, GUIDE_FILENAME), 'utf-8');
    expect(guide).toContain('# NOPY.LLM.md');
    expect(guide).toContain('pyinfra');
    expect(guide).toContain('.nopyrc.json');
  });

  it('skips existing files without force', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILENAME), '{"hosts":["mine"]}');
    fs.writeFileSync(path.join(dir, GUIDE_FILENAME), 'my notes');

    const results = initProject({ dir });

    expect(results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(fs.readFileSync(path.join(dir, CONFIG_FILENAME), 'utf-8')).toBe('{"hosts":["mine"]}');
    expect(fs.readFileSync(path.join(dir, GUIDE_FILENAME), 'utf-8')).toBe('my notes');
  });

  it('overwrites existing files with force', () => {
    fs.writeFileSync(path.join(dir, GUIDE_FILENAME), 'my notes');

    const results = initProject({ dir, force: true });

    expect(results.map((r) => r.status)).toEqual(['created', 'overwritten']);
    expect(fs.readFileSync(path.join(dir, GUIDE_FILENAME), 'utf-8')).toContain('# NOPY.LLM.md');
  });

  it('defaults to the working directory', () => {
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const results = initProject();
      expect(results.map((r) => path.dirname(r.path))).toEqual([dir, dir]);
      expect(fs.existsSync(path.join(dir, CONFIG_FILENAME))).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('formatInitResults', () => {
  it('reports created files and next steps', () => {
    const output = formatInitResults([
      { file: CONFIG_FILENAME, path: `/x/${CONFIG_FILENAME}`, status: 'created' },
      { file: GUIDE_FILENAME, path: `/x/${GUIDE_FILENAME}`, status: 'created' },
    ]);

    expect(output).toContain(`created`);
    expect(output).toContain(CONFIG_FILENAME);
    expect(output).toContain(GUIDE_FILENAME);
    expect(output).toContain('Next steps:');
  });

  it('points skipped files at --force', () => {
    const output = formatInitResults([
      { file: GUIDE_FILENAME, path: `/x/${GUIDE_FILENAME}`, status: 'skipped' },
    ]);

    expect(output).toContain('exists, skipped');
    expect(output).toContain('--force');
  });
});
