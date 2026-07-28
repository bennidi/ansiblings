/**
 * Resolving cube packages named in `cubePackages` to directories on disk.
 * @module cubes/packages
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { CubePackageRef } from '../nopy.config.js';

/** An installed cube package, located and validated. */
export interface CubePackage {
  /** The name it was requested under. */
  name: string;
  /** Absolute path to the package root. */
  root: string;
  /** Absolute paths to its cube directories, from `nopy.cubes`. */
  dirs: string[];
}

/**
 * Finds a package root without going through its `exports` map.
 *
 * `exports` is deliberately bypassed: a cube bundle ships directories, not an
 * entry point, and requiring it to declare one would make the contract heavier
 * for no gain. Reading `package.json` off disk also sidesteps pnpm's layout —
 * `existsSync` follows the symlink pnpm plants at `node_modules/<name>`, which
 * a directory scan would skip (`readdir` reports it as a symlink, not a
 * directory).
 */
function findPackageRoot(ref: CubePackageRef): string | undefined {
  // createRequire needs a file path, not a directory; the file need not exist.
  const req = createRequire(path.join(ref.from, 'noop.js'));
  for (const dir of req.resolve.paths(ref.spec) ?? []) {
    if (fs.existsSync(path.join(dir, ref.spec, 'package.json'))) {
      return path.join(dir, ref.spec);
    }
  }
  return undefined;
}

/**
 * Resolves every named package to its cube directories.
 *
 * Anything wrong is an error rather than a silent skip: naming a package in
 * `cubePackages` is a statement that cubes are expected from it, and errors
 * abort the run (see `nopy.main.ts`).
 */
export function resolveCubePackages(refs: CubePackageRef[]): {
  packages: CubePackage[];
  errors: string[];
} {
  const packages: CubePackage[] = [];
  const errors: string[] = [];

  // `mergeValue` only de-duplicates arrays of primitives, and these are
  // objects, so the same package named by a parent and a child config arrives
  // twice. Last wins: configs merge root-first, so the last occurrence came
  // from the most specific config and carries the right resolution origin.
  const unique = new Map<string, CubePackageRef>();
  for (const ref of refs) unique.set(ref.spec, ref);

  for (const ref of unique.values()) {
    const root = findPackageRoot(ref);
    if (!root) {
      errors.push(`Cube package '${ref.spec}' is not installed (looked up from ${ref.from}).`);
      continue;
    }

    let manifest: { nopy?: { cubes?: unknown } };
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    } catch (err) {
      errors.push(`Cube package '${ref.spec}': cannot read ${root}/package.json: ${err}`);
      continue;
    }

    const declared = manifest.nopy?.cubes;
    if (
      !Array.isArray(declared) ||
      declared.length === 0 ||
      !declared.every((entry) => typeof entry === 'string')
    ) {
      errors.push(
        `Cube package '${ref.spec}' declares no cubes. ` +
          `Expected "nopy": { "cubes": ["./cubes"] } in ${root}/package.json.`
      );
      continue;
    }

    const dirs: string[] = [];
    for (const entry of declared as string[]) {
      const dir = path.resolve(root, entry);

      if (dir !== root && !dir.startsWith(root + path.sep)) {
        errors.push(`Cube package '${ref.spec}': '${entry}' points outside the package.`);
      } else if (!fs.existsSync(dir)) {
        errors.push(`Cube package '${ref.spec}': '${entry}' does not exist in ${root}.`);
      } else {
        dirs.push(dir);
      }
    }

    if (dirs.length > 0) packages.push({ name: ref.spec, root, dirs });
  }

  return { packages, errors };
}
