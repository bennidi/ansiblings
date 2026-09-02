/**
 * Tests for nopy.create-cube.
 *
 * The contract under test is not "two files appear" but "the loader accepts
 * what the scaffold wrote": the round-trip through `loadCubes()` is what
 * proves the templates and the loader agree.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCubes } from '../src/cubes/index.js';
import {
  assertCubeIdAvailable,
  createCube,
  cubeDirWarning,
  DEPLOY_FILENAME,
  formatCreateCubeResults,
  MANIFEST_FILENAME,
  suggestCubeDir,
  validateCubeId,
} from '../src/nopy.create-cube.js';
import { NopyUsageError } from '../src/nopy.errors.js';

let tmpDir: string;
let originalCwd: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  // realpath: os.tmpdir() is a symlink on macOS, and paths reported back by
  // process.cwd() after a chdir are resolved — comparisons need one form.
  tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nopy-create-cube-'));
  process.chdir(tmpDir);
  // Point HOME at an empty directory so a developer's ~/.nopyrc.json cannot
  // leak extra cube roots into the "no config anywhere" assertions.
  originalHome = process.env.HOME;
  process.env.HOME = tmpDir;
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env.HOME = originalHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(config: Record<string, unknown>, dir = tmpDir): void {
  fs.writeFileSync(path.join(dir, '.nopyrc.json'), JSON.stringify(config));
}

describe('validateCubeId', () => {
  it('accepts the shapes the core bundle uses', () => {
    for (const id of ['apt', 'net:tailscale', 'user:add', 'a1-b_c.d']) {
      expect(validateCubeId(id)).toBeUndefined();
    }
  });

  it('names the problem for ids the loader or shell would choke on', () => {
    for (const id of ['', '  ', ':leading', 'has space', 'net/tailscale', '[bracketed]']) {
      expect(validateCubeId(id)).toBeTypeOf('string');
    }
  });
});

describe('createCube', () => {
  it('writes a manifest and deploy script with every token replaced', () => {
    const dir = path.join(tmpDir, 'cubes', 'net', 'hello');
    const results = createCube({ id: 'net:hello', name: 'Say hello', dir });

    expect(results.map((r) => r.status)).toEqual(['created', 'created']);
    expect(results.map((r) => r.file)).toEqual([MANIFEST_FILENAME, DEPLOY_FILENAME]);

    for (const file of [MANIFEST_FILENAME, DEPLOY_FILENAME]) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      expect(content).not.toContain('__CUBE_ID__');
      expect(content).not.toContain('__CUBE_NAME__');
      expect(content).toContain('net:hello');
    }
    expect(fs.readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf-8')).toContain('Say hello');
  });

  it('rejects an invalid id and an empty name as usage errors', () => {
    expect(() => createCube({ id: 'has space', name: 'x', dir: tmpDir })).toThrow(NopyUsageError);
    expect(() => createCube({ id: 'ok', name: '  ', dir: tmpDir })).toThrow(NopyUsageError);
  });

  it('refuses a directory that is already a cube, naming the files', () => {
    const dir = path.join(tmpDir, 'occupied');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'my.manifest.mjs'), 'export default {}');
    fs.writeFileSync(path.join(dir, 'my.deploy.py'), '# deploy');

    expect(() => createCube({ id: 'x', name: 'X', dir })).toThrow(/my\.manifest\.mjs/);
    // A lone deploy script blocks too — scaffolding next to it would leave the
    // loader with two deploy candidates and readdir order picking one.
    const half = path.join(tmpDir, 'half');
    fs.mkdirSync(half);
    fs.writeFileSync(path.join(half, DEPLOY_FILENAME), '# deploy');
    expect(() => createCube({ id: 'x', name: 'X', dir: half })).toThrow(NopyUsageError);
  });

  it('overwrites with force and reports it', () => {
    const dir = path.join(tmpDir, 'again');
    createCube({ id: 'again', name: 'First', dir });
    const results = createCube({ id: 'again', name: 'Second', dir, force: true });

    expect(results.map((r) => r.status)).toEqual(['overwritten', 'overwritten']);
    expect(fs.readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf-8')).toContain('Second');
  });
});

describe('scaffolded cube', () => {
  it('is discovered by the loader with the declared id, name and schema', async () => {
    writeConfig({ cubeDirs: ['./cubes'] });
    createCube({
      id: 'net:hello',
      // The apostrophe is the point: free text spliced into a single-quoted
      // string literal must still parse.
      name: "Bob's greeting",
      dir: path.join(tmpDir, 'cubes', 'net', 'hello'),
    });

    const { cubes, errors } = await loadCubes();

    expect(errors).toHaveLength(0);
    const cube = cubes['net:hello'];
    expect(cube).toBeDefined();
    expect(cube.name).toBe("Bob's greeting");
    expect(cube.schemaKeys()).toContain('GREETING');
    expect(cube.getDefaults().GREETING).toContain('net:hello');
  });
});

describe('suggestCubeDir', () => {
  it('derives a path under ./cubes from the id when there is no config', () => {
    expect(suggestCubeDir('net:tailscale')).toBe(path.join('cubes', 'net', 'tailscale'));
  });

  it('uses the first configured cube directory, relative to cwd when under it', () => {
    const config = { cubeDirs: [path.join(tmpDir, 'deploy', 'cubes')] };
    expect(suggestCubeDir('apt', config)).toBe(path.join('deploy', 'cubes', 'apt'));
  });

  it('stays absolute when the cube directory is outside cwd', () => {
    const elsewhere = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nopy-elsewhere-'));
    try {
      const suggested = suggestCubeDir('apt', { cubeDirs: [elsewhere] });
      expect(path.isAbsolute(suggested)).toBe(true);
      expect(suggested).toBe(path.join(elsewhere, 'apt'));
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('cubeDirWarning', () => {
  it('is silent without a config to consult', () => {
    expect(cubeDirWarning(path.join(tmpDir, 'cubes', 'x'))).toBeUndefined();
  });

  it('is silent for a directory the loader will scan', () => {
    writeConfig({ cubeDirs: ['./cubes'] });
    expect(cubeDirWarning(path.join(tmpDir, 'cubes', 'net', 'x'))).toBeUndefined();
  });

  it('warns when the loader will never look there', () => {
    writeConfig({ cubeDirs: ['./cubes'] });
    const outside = path.join(tmpDir, 'elsewhere', 'x');
    expect(cubeDirWarning(outside)).toContain('cubeDirs');
  });
});

describe('assertCubeIdAvailable', () => {
  it('resolves when there is no config to check against', async () => {
    await expect(assertCubeIdAvailable('x', path.join(tmpDir, 'x'))).resolves.toBeUndefined();
  });

  it('resolves for an unclaimed id', async () => {
    writeConfig({ cubeDirs: ['./cubes'] });
    await expect(
      assertCubeIdAvailable('free', path.join(tmpDir, 'cubes', 'free'))
    ).resolves.toBeUndefined();
  });

  it('rejects an id another directory already claims', async () => {
    writeConfig({ cubeDirs: ['./cubes'] });
    createCube({ id: 'taken', name: 'Taken', dir: path.join(tmpDir, 'cubes', 'taken') });

    await expect(
      assertCubeIdAvailable('taken', path.join(tmpDir, 'cubes', 'other'))
    ).rejects.toThrow(/already claimed/);
  });

  it('tolerates the claim coming from the target directory itself', async () => {
    writeConfig({ cubeDirs: ['./cubes'] });
    const dir = path.join(tmpDir, 'cubes', 'mine');
    createCube({ id: 'mine', name: 'Mine', dir });

    // The --force re-scaffold case: the id is "claimed", but by the very cube
    // being recreated.
    await expect(assertCubeIdAvailable('mine', dir)).resolves.toBeUndefined();
  });
});

describe('formatCreateCubeResults', () => {
  const results = [
    { file: MANIFEST_FILENAME, path: `/x/${MANIFEST_FILENAME}`, status: 'created' as const },
    { file: DEPLOY_FILENAME, path: `/x/${DEPLOY_FILENAME}`, status: 'created' as const },
  ];

  it('reports the files and the next steps', () => {
    const output = formatCreateCubeResults(results, { id: 'net:hello' });

    expect(output).toContain(MANIFEST_FILENAME);
    expect(output).toContain(DEPLOY_FILENAME);
    expect(output).toContain('Next steps:');
    expect(output).toContain('net:hello');
    expect(output).not.toContain('Note:');
  });

  it('appends the discoverability warning when there is one', () => {
    const warning = 'Note: /x is outside every configured cube directory';
    expect(formatCreateCubeResults(results, { id: 'x', warning })).toContain(warning);
  });

  it('points skipped files at --force', () => {
    const output = formatCreateCubeResults(
      [{ file: MANIFEST_FILENAME, path: `/x/${MANIFEST_FILENAME}`, status: 'skipped' as const }],
      { id: 'x' }
    );
    expect(output).toContain('exists, skipped');
    expect(output).toContain('--force');
  });
});
