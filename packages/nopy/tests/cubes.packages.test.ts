/**
 * Resolution of the packages named in `cubePackages`.
 *
 * Builds real `node_modules` trees under os.tmpdir() rather than faking the
 * filesystem: what is under test is Node's own resolution, including the
 * symlink layout pnpm produces, and neither survives a mock.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCubePackages } from '../src/cubes/packages.js';

describe('resolveCubePackages', () => {
  let tmpDir: string;

  /** Writes a package into `<root>/node_modules/<name>`, cubes and all. */
  const install = (
    root: string,
    name: string,
    manifest: Record<string, unknown>,
    cubeDirs: string[] = ['cubes']
  ) => {
    const dir = path.join(root, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, ...manifest }));
    for (const cubeDir of cubeDirs) fs.mkdirSync(path.join(dir, cubeDir), { recursive: true });
    return dir;
  };

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-packages-')));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves a scoped package to its cube directories', () => {
    const dir = install(tmpDir, '@acme/cubes-net', { nopy: { cubes: ['./cubes'] } });

    const { packages, errors } = resolveCubePackages([{ spec: '@acme/cubes-net', from: tmpDir }]);

    expect(errors).toEqual([]);
    expect(packages).toEqual([
      { name: '@acme/cubes-net', root: dir, dirs: [path.join(dir, 'cubes')] },
    ]);
  });

  it('resolves an unscoped package and every directory it declares', () => {
    const dir = install(tmpDir, 'cubes-net', { nopy: { cubes: ['./cubes', './extra'] } }, [
      'cubes',
      'extra',
    ]);

    const { packages, errors } = resolveCubePackages([{ spec: 'cubes-net', from: tmpDir }]);

    expect(errors).toEqual([]);
    expect(packages[0].dirs).toEqual([path.join(dir, 'cubes'), path.join(dir, 'extra')]);
  });

  it('resolves through a symlinked package directory, as pnpm installs it', () => {
    // pnpm puts the real package under .pnpm and symlinks it into place, which
    // is why the resolver reads package.json instead of scanning node_modules.
    const store = path.join(tmpDir, 'store', 'cubes-net');
    fs.mkdirSync(path.join(store, 'cubes'), { recursive: true });
    fs.writeFileSync(
      path.join(store, 'package.json'),
      JSON.stringify({ name: 'cubes-net', nopy: { cubes: ['./cubes'] } })
    );
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(store, path.join(tmpDir, 'node_modules', 'cubes-net'));

    const { packages, errors } = resolveCubePackages([{ spec: 'cubes-net', from: tmpDir }]);

    expect(errors).toEqual([]);
    expect(packages[0].dirs).toEqual([path.join(tmpDir, 'node_modules', 'cubes-net', 'cubes')]);
  });

  it('resolves from the declaring config directory, not the working directory', () => {
    // The package is installed next to the config that names it. Nothing at the
    // process cwd can see it, which is the case a package named in
    // ~/.nopyrc.json always hits.
    const elsewhere = path.join(tmpDir, 'elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    install(elsewhere, 'cubes-net', { nopy: { cubes: ['./cubes'] } });

    expect(resolveCubePackages([{ spec: 'cubes-net', from: elsewhere }]).errors).toEqual([]);
    expect(resolveCubePackages([{ spec: 'cubes-net', from: tmpDir }]).errors).toHaveLength(1);
  });

  it('reports a package that is not installed', () => {
    const { packages, errors } = resolveCubePackages([{ spec: '@acme/missing', from: tmpDir }]);

    expect(packages).toEqual([]);
    expect(errors[0]).toMatch(/'@acme\/missing' is not installed/);
    expect(errors[0]).toContain(tmpDir);
  });

  it('reports a package.json that cannot be parsed', () => {
    const dir = path.join(tmpDir, 'node_modules', 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');

    const { errors } = resolveCubePackages([{ spec: 'broken', from: tmpDir }]);

    expect(errors[0]).toMatch(/cannot read/);
  });

  it('falls back to cubes/ when the package declares nothing', () => {
    // The convention. A bundle that ships cubes/ at its root needs no `nopy`
    // block at all, and one with an unrelated `nopy` block still gets it.
    const plain = install(tmpDir, 'plain', {});
    const other = install(tmpDir, 'other', { nopy: { somethingElse: true } });

    const { packages, errors } = resolveCubePackages(
      ['plain', 'other'].map((spec) => ({ spec, from: tmpDir }))
    );

    expect(errors).toEqual([]);
    expect(packages.map((pkg) => pkg.dirs)).toEqual([
      [path.join(plain, 'cubes')],
      [path.join(other, 'cubes')],
    ]);
  });

  it('reports a package with neither a declaration nor a cubes/ directory', () => {
    install(tmpDir, 'bare', {}, []);

    const { packages, errors } = resolveCubePackages([{ spec: 'bare', from: tmpDir }]);

    expect(packages).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/has no cubes\/ directory/);
    expect(errors[0]).toMatch(/declares no "nopy"/);
  });

  it('reports a malformed declaration instead of falling back to the default', () => {
    // Each of these ships a usable cubes/ directory. Saying something that does
    // not parse is not the same as saying nothing, so none of them resolve.
    install(tmpDir, 'empty', { nopy: { cubes: [] } });
    install(tmpDir, 'wrong-type', { nopy: { cubes: 'cubes' } });
    install(tmpDir, 'not-strings', { nopy: { cubes: [1] } });

    const { packages, errors } = resolveCubePackages(
      ['empty', 'wrong-type', 'not-strings'].map((spec) => ({ spec, from: tmpDir }))
    );

    expect(packages).toEqual([]);
    expect(errors).toHaveLength(3);
    for (const error of errors) expect(error).toMatch(/must be a non-empty array of strings/);
  });

  it('reports a cube directory that does not exist', () => {
    install(tmpDir, 'cubes-net', { nopy: { cubes: ['./nope'] } });

    const { packages, errors } = resolveCubePackages([{ spec: 'cubes-net', from: tmpDir }]);

    expect(packages).toEqual([]);
    expect(errors[0]).toMatch(/'\.\/nope' does not exist/);
  });

  it('reports a cube directory that points outside the package', () => {
    install(tmpDir, 'cubes-net', { nopy: { cubes: ['../../..'] } });

    const { errors } = resolveCubePackages([{ spec: 'cubes-net', from: tmpDir }]);

    expect(errors[0]).toMatch(/points outside the package/);
  });

  it('keeps the directories that are valid when a sibling entry is not', () => {
    const dir = install(tmpDir, 'cubes-net', { nopy: { cubes: ['./cubes', './nope'] } });

    const { packages, errors } = resolveCubePackages([{ spec: 'cubes-net', from: tmpDir }]);

    expect(errors).toHaveLength(1);
    expect(packages[0].dirs).toEqual([path.join(dir, 'cubes')]);
  });

  it('resolves a package named by two configs once, from the more specific one', () => {
    // Merge order is root-first, so the last ref came from the config nearest
    // the working directory — and only that one is guaranteed to resolve.
    const child = path.join(tmpDir, 'child');
    fs.mkdirSync(child, { recursive: true });
    const dir = install(child, 'cubes-net', { nopy: { cubes: ['./cubes'] } });

    const { packages, errors } = resolveCubePackages([
      { spec: 'cubes-net', from: path.join(tmpDir, 'nowhere') },
      { spec: 'cubes-net', from: child },
    ]);

    expect(errors).toEqual([]);
    expect(packages).toHaveLength(1);
    expect(packages[0].root).toBe(dir);
  });
});
