#!/usr/bin/env node

/**
 * Asserts that every publishable package is installable once packed.
 *
 * `@bitsquare/nopy` depends on `@bitsquare/nopy-cubes` through `workspace:*`, and
 * `link-workspace-packages` is off, so a plain semver range would resolve from
 * the registry instead of linking the workspace copy — the protocol is not
 * optional. But npm has no idea what `workspace:` means: a tarball that still
 * carries one fails at install time with EUNSUPPORTEDPROTOCOL, long after the
 * publish went green. `pnpm publish` rewrites the range at pack time; this
 * checks that it actually did, on the artefact rather than on the promise.
 *
 * Run it in CI between the build and the publish. Failing here costs a red run;
 * failing in the registry costs a version number.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PACKAGES_DIR = 'packages';
const RANGE_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const packages = fs
  .readdirSync(PACKAGES_DIR)
  .map((name) => path.join(PACKAGES_DIR, name))
  .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
  .filter((dir) => !JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).private);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-pack-'));
const failures = [];

try {
  for (const dir of packages) {
    // `pnpm pack` has no --ignore-scripts, so prepack runs and rebuilds. That is
    // incremental, and it means the tarball under test is the one publish ships.
    const output = execFileSync('pnpm', ['pack', '--pack-destination', tmpDir], {
      cwd: dir,
      encoding: 'utf-8',
    });
    // pnpm prints the tarball path last; anything before it is progress noise.
    const tarball = output.trim().split('\n').at(-1).trim();

    const manifest = JSON.parse(
      execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf-8' })
    );

    const ranges = RANGE_FIELDS.flatMap((field) =>
      Object.entries(manifest[field] ?? {}).map(([name, range]) => ({ field, name, range }))
    );
    const unresolved = ranges.filter(({ range }) => range.startsWith('workspace:'));

    for (const { field, name, range } of unresolved) {
      failures.push(`${manifest.name}: ${field}.${name} is still '${range}'`);
    }

    const linked = ranges.filter(({ name }) => name.startsWith('@bitsquare/'));
    const summary = linked.map(({ name, range }) => `${name}@${range}`).join(', ');
    console.log(`${manifest.name}@${manifest.version} — ${summary || 'no workspace dependencies'}`);
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('\nUnresolved workspace ranges in packed manifests:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nPublish with `pnpm publish`, not `npm publish`.');
  process.exit(1);
}
