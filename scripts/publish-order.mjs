#!/usr/bin/env node

/**
 * Prints the publishable workspace package directories, dependencies first.
 *
 * `packages/*` in alphabetical order puts `nopy` ahead of the `nopy-cube` it
 * depends on, which leaves a window where the registry holds a package whose
 * dependency does not exist yet. Ordering the publish by the workspace graph
 * closes it. One directory per line, so the caller can `for dir in $(…)`.
 */

import fs from 'node:fs';
import path from 'node:path';

const PACKAGES_DIR = 'packages';
const RANGE_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const packages = fs
  .readdirSync(PACKAGES_DIR)
  .map((name) => path.join(PACKAGES_DIR, name))
  .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
  .map((dir) => ({ dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))) }))
  .filter(({ manifest }) => !manifest.private);

const dirByName = new Map(packages.map(({ dir, manifest }) => [manifest.name, dir]));

/** The other workspace packages this one links to, by directory. */
const dependenciesOf = ({ manifest }) =>
  RANGE_FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {}))
    .filter(([, range]) => range.startsWith('workspace:'))
    .map(([name]) => dirByName.get(name))
    .filter((dir) => dir !== undefined);

const ordered = [];
const emitted = new Set();
const visiting = new Set();

const visit = (pkg) => {
  if (emitted.has(pkg.dir)) return;
  if (visiting.has(pkg.dir)) {
    // pnpm rejects a workspace cycle at install time, so reaching this means
    // something stranger than a bad dependency edge.
    throw new Error(`Dependency cycle in the workspace, at ${pkg.dir}`);
  }
  visiting.add(pkg.dir);
  for (const dir of dependenciesOf(pkg)) {
    visit(packages.find((candidate) => candidate.dir === dir));
  }
  visiting.delete(pkg.dir);
  emitted.add(pkg.dir);
  ordered.push(pkg.dir);
};

// Alphabetical among packages the graph does not separate, so the output is
// stable across runs and platforms.
for (const pkg of [...packages].sort((a, b) => a.dir.localeCompare(b.dir))) visit(pkg);

console.log(ordered.join('\n'));
