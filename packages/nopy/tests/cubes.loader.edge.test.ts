/**
 * Error and discovery edge cases for cubes/loader.
 *
 * Runs against a real temp directory because loadCubes() dynamically imports
 * manifest files — there is no seam worth faking here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCubeDirectories, getCube, loadCubes } from '../src/cubes/loader.js';

describe('loader edge cases', () => {
  let originalCwd: string;
  let originalHome: string | undefined;
  let tmpDir: string;
  let emptyHome: string;

  const cube = (dir: string, manifest: string, deployName = 'deploy.py') => {
    fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, dir, 'manifest.mjs'), manifest);
    fs.writeFileSync(path.join(tmpDir, dir, deployName), '# deploy');
  };

  beforeEach(() => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-loader-')));
    emptyHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-loader-home-')));
    process.env.HOME = emptyHome;
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.nopyrc.json'), JSON.stringify({ cubeDirs: ['./'] }));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  });

  describe('findCubeDirectories', () => {
    it('includes directories from cubeDirs', () => {
      expect(findCubeDirectories()).toContain(tmpDir);
    });

    it('includes directories marked with a .npcubes file', () => {
      fs.writeFileSync(path.join(tmpDir, '.nopyrc.json'), JSON.stringify({ cubeDirs: [] }));
      fs.writeFileSync(path.join(tmpDir, '.npcubes'), '');
      const nested = path.join(tmpDir, 'a', 'b');
      fs.mkdirSync(nested, { recursive: true });
      process.chdir(nested);

      expect(findCubeDirectories()).toContain(tmpDir);
    });

    it('does not treat a .npcubes directory as a marker', () => {
      fs.writeFileSync(path.join(tmpDir, '.nopyrc.json'), JSON.stringify({ cubeDirs: [] }));
      fs.mkdirSync(path.join(tmpDir, '.npcubes'));

      expect(findCubeDirectories()).not.toContain(tmpDir);
    });

    it('de-duplicates a directory listed twice', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.nopyrc.json'),
        JSON.stringify({ cubeDirs: ['./', tmpDir] })
      );
      fs.writeFileSync(path.join(tmpDir, '.npcubes'), '');

      expect(findCubeDirectories().filter((d) => d === tmpDir)).toHaveLength(1);
    });
  });

  describe('loadCubes', () => {
    it('derives the id from a [bracket] name prefix', async () => {
      cube('bracketed', 'export default { name: "[apt:base] Apt Base" }');

      const { cubes, errors } = await loadCubes();

      expect(errors).toEqual([]);
      expect(cubes['apt:base'].name).toBe('[apt:base] Apt Base');
    });

    it('falls back to the directory name when no id is derivable', async () => {
      cube('fallback-id', 'export default { name: "No Id Here" }');

      const { cubes } = await loadCubes();

      expect(cubes['fallback-id']).toBeDefined();
    });

    it('defaults the schema when the manifest omits one', async () => {
      cube('no-schema', 'export default { id: "no-schema", name: "No Schema" }');

      const { cubes } = await loadCubes();

      expect(cubes['no-schema'].getDefaults()).toEqual({});
    });

    it('reports a manifest whose default export is not an object', async () => {
      cube('bad-export', 'export default "just a string"');

      const { cubes, errors } = await loadCubes();

      expect(cubes['bad-export']).toBeUndefined();
      expect(errors[0]).toMatch(/Invalid manifest export/);
    });

    it('reports a manifest with no default export', async () => {
      cube('no-export', 'export const nothing = 1;');

      const { errors } = await loadCubes();

      expect(errors[0]).toMatch(/Invalid manifest export/);
    });

    it('reports a manifest missing a name', async () => {
      cube('no-name', 'export default { id: "no-name" }');

      const { errors } = await loadCubes();

      expect(errors[0]).toMatch(/missing 'name'/);
    });

    it('reports a manifest that fails to import', async () => {
      cube('broken', 'this is not valid javascript !!!');

      const { errors } = await loadCubes();

      expect(errors[0]).toMatch(/Failed to load manifest/);
    });

    it('reports duplicate cube ids, naming every directory that claims one', async () => {
      cube('first', 'export default { id: "dup", name: "First" }');
      cube('second', 'export default { id: "dup", name: "Second" }');

      const { cubes, errors } = await loadCubes();

      expect(Object.keys(cubes)).toEqual(['dup']);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/Duplicate cube id 'dup' from 2 sources/);
      expect(errors[0]).toContain(path.join(tmpDir, 'first'));
      expect(errors[0]).toContain(path.join(tmpDir, 'second'));
    });

    it('keeps scanning below a duplicate instead of dropping the subtree', async () => {
      cube('first', 'export default { id: "dup", name: "First" }');
      cube('second', 'export default { id: "dup", name: "Second" }');
      cube('second/inner', 'export default { id: "buried", name: "Buried" }');

      const { cubes, errors } = await loadCubes();

      expect(cubes.buried).toBeDefined();
      expect(errors).toHaveLength(1);
    });

    it('reports the same duplicate whichever root is scanned first', async () => {
      cube('a/one', 'export default { id: "dup", name: "One" }');
      cube('b/two', 'export default { id: "dup", name: "Two" }');
      const roots = [path.join(tmpDir, 'a'), path.join(tmpDir, 'b')];

      fs.writeFileSync(path.join(tmpDir, '.nopyrc.json'), JSON.stringify({ cubeDirs: roots }));
      const forwards = await loadCubes();

      fs.writeFileSync(
        path.join(tmpDir, '.nopyrc.json'),
        JSON.stringify({ cubeDirs: [...roots].reverse() })
      );
      const backwards = await loadCubes();

      expect(forwards.errors[0]).toContain(path.join(tmpDir, 'a', 'one'));
      expect(forwards.errors[0]).toContain(path.join(tmpDir, 'b', 'two'));
      expect(backwards.errors).toHaveLength(1);
      expect(new Set(backwards.errors[0].split('\n'))).toEqual(
        new Set(forwards.errors[0].split('\n'))
      );
    });

    it('does not call one directory a duplicate of itself when two roots reach it', async () => {
      cube('nested/one', 'export default { id: "once", name: "Once" }');
      fs.writeFileSync(
        path.join(tmpDir, '.nopyrc.json'),
        JSON.stringify({ cubeDirs: ['./', './nested'] })
      );

      const { cubes, errors } = await loadCubes();

      expect(errors).toEqual([]);
      expect(cubes.once).toBeDefined();
    });

    it('skips hidden and node_modules directories', async () => {
      cube('.hidden/inner', 'export default { id: "hidden", name: "Hidden" }');
      cube('node_modules/pkg', 'export default { id: "vendored", name: "Vendored" }');
      cube('visible', 'export default { id: "visible", name: "Visible" }');

      const { cubes } = await loadCubes();

      expect(Object.keys(cubes)).toEqual(['visible']);
    });

    it('ignores configured cube directories that do not exist', async () => {
      fs.writeFileSync(
        path.join(tmpDir, '.nopyrc.json'),
        JSON.stringify({ cubeDirs: ['./', './does-not-exist'] })
      );
      cube('visible', 'export default { id: "visible", name: "Visible" }');

      const { cubes, errors } = await loadCubes();

      expect(errors).toEqual([]);
      expect(cubes.visible).toBeDefined();
    });
  });

  describe('getCube', () => {
    it('returns a single cube by id', async () => {
      cube('one', 'export default { id: "one", name: "One" }');

      await expect(getCube('one')).resolves.toMatchObject({ id: 'one' });
    });

    it('returns undefined for an unknown id', async () => {
      await expect(getCube('nope')).resolves.toBeUndefined();
    });
  });
});
