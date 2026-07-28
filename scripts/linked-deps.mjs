#!/usr/bin/env node

/**
 * Prints the workspace packages a package links to, as `<name> <version>` lines.
 *
 * The version is the one the linked package declares *right now*, which is
 * exactly what `pnpm publish` will substitute for `workspace:*` when it packs.
 * A release can therefore check that each of them is already on the registry
 * before shipping a manifest that points at a version nobody can install.
 *
 *   node scripts/linked-deps.mjs packages/nopy
 */

import fs from 'node:fs';
import path from 'node:path';

const PACKAGES_DIR = 'packages';
const RANGE_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/linked-deps.mjs <package-dir>');
  process.exit(2);
}

const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));

// Resolved by name rather than by directory: nothing guarantees that
// `@bitsquare/nopy-cube` lives in `packages/nopy-cube`.
const versionByName = new Map(
  fs
    .readdirSync(PACKAGES_DIR)
    .map((name) => path.join(PACKAGES_DIR, name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => read(dir))
    .map((manifest) => [manifest.name, manifest.version])
);

const manifest = read(target);
const linked = RANGE_FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {}))
  .filter(([, range]) => range.startsWith('workspace:'))
  .map(([name]) => name);

for (const name of linked) {
  const version = versionByName.get(name);
  if (version === undefined) {
    console.error(`${manifest.name} links to ${name}, which is not in ${PACKAGES_DIR}/.`);
    process.exit(1);
  }
  console.log(`${name} ${version}`);
}
