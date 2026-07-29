#!/usr/bin/env node

/**
 * Installs a published snapshot the way a stranger would, into a throwaway
 * project, and runs it.
 *
 * This is the rehearsal that the local `pnpm pack` check cannot be: it goes to
 * the real registry, resolves the real `@bitsquare/nopy-cubes` version that
 * `pnpm publish` baked into the tarball, and puts a real `nopy` binary on disk.
 * A tarball that installs here is one a user can install.
 *
 *   node scripts/try-snapshot.mjs                 # @main from Gitea
 *   node scripts/try-snapshot.mjs --tag latest    # a release, still from Gitea
 *   node scripts/try-snapshot.mjs --registry https://registry.npmjs.org/
 *   node scripts/try-snapshot.mjs --keep          # leave the directory behind
 *
 * `npm` is used rather than `pnpm` on purpose: npm is the client that rejects a
 * leaked `workspace:` range, so a clean install here is the stronger proof.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCOPE = '@bitsquare';
const DEFAULT_REGISTRY = 'https://gitea.bitsquare.dev/api/packages/BitSquare/npm/';
const CLI_PACKAGE = '@bitsquare/nopy';
const BUNDLE_PACKAGE = '@bitsquare/nopy-cubes-core';

const args = process.argv.slice(2);

/** Reads `--flag value`, falling back to a default */
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const tag = flag('--tag', 'main');
const registry = flag('--registry', DEFAULT_REGISTRY).replace(/\/?$/, '/');
const keep = args.includes('--keep');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-snapshot-'));

/** Runs a command in the throwaway project, streaming its output */
const run = (file, argv) =>
  execFileSync(file, argv, { cwd: dir, stdio: 'inherit', env: process.env });

/** Runs a command and captures stdout */
const capture = (file, argv) =>
  execFileSync(file, argv, { cwd: dir, encoding: 'utf-8', env: process.env }).trim();

/**
 * Runs a command with stdin closed and returns everything it printed,
 * regardless of exit status — used for the interactive path, which is expected
 * to bail out once it finds no terminal to prompt at.
 */
const probe = (file, argv) => {
  try {
    return execFileSync(file, argv, {
      cwd: dir,
      encoding: 'utf-8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
};

let failed = false;
try {
  console.log(`Registry: ${registry}`);
  console.log(`Channel:  ${tag}`);
  console.log(`Project:  ${dir}\n`);

  // Scoped, never a bare `registry=`: the Gitea registry serves @bitsquare and
  // does not proxy npmjs, so commander/execa/zod must keep resolving there.
  fs.writeFileSync(path.join(dir, '.npmrc'), `${SCOPE}:registry=${registry}\n`, 'utf-8');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'nopy-snapshot-check', version: '0.0.0', private: true }, null, 2)}\n`,
    'utf-8'
  );

  console.log('--- install ---');
  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    `${CLI_PACKAGE}@${tag}`,
    `${BUNDLE_PACKAGE}@${tag}`,
  ]);

  const installed = JSON.parse(
    fs.readFileSync(path.join(dir, 'node_modules', CLI_PACKAGE, 'package.json'), 'utf-8')
  );
  const bundle = JSON.parse(
    fs.readFileSync(path.join(dir, 'node_modules', BUNDLE_PACKAGE, 'package.json'), 'utf-8')
  );

  // The whole point of packing with pnpm: this must be a concrete version, not
  // the literal string `workspace:*`.
  const linked = installed.dependencies?.['@bitsquare/nopy-cubes'];
  if (!linked || linked.startsWith('workspace:')) {
    throw new Error(
      `${CLI_PACKAGE} declares nopy-cubes as "${linked}" — a workspace range escaped.`
    );
  }

  console.log('\n--- versions ---');
  console.log(`${CLI_PACKAGE}@${installed.version}`);
  console.log(`${BUNDLE_PACKAGE}@${bundle.version}`);
  console.log(`  -> @bitsquare/nopy-cubes ${linked}`);

  console.log('\n--- nopy --version ---');
  console.log(capture(path.join(dir, 'node_modules', '.bin', 'nopy'), ['--version']));

  // The part a tarball most often breaks: the loader reading cubes out of an
  // installed bundle in node_modules rather than a local directory.
  fs.writeFileSync(
    path.join(dir, '.nopyrc.json'),
    `${JSON.stringify({ hosts: ['snapshot-check'], cubePackages: [BUNDLE_PACKAGE] }, null, 2)}\n`,
    'utf-8'
  );

  console.log('\n--- cube discovery ---');
  // stdin is closed, so the cube-selection prompt renders its choices and
  // gives up immediately instead of waiting for a keystroke. Those rendered
  // choices are the evidence: they only exist if the loader resolved the
  // bundle out of node_modules and imported every manifest.
  const discovery = probe(path.join(dir, 'node_modules', '.bin', 'nopy'), ['install', '-P', '-D']);

  // Built from a char code rather than written literally: a raw escape byte in
  // a regex is a lint error, and the `\x1b` escape is flagged just the same.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
  const listed = [
    ...new Set(
      [
        ...discovery
          .replace(ansi, '')
          .matchAll(/([a-z0-9:_-]+) - [^\n]*\(@bitsquare\/nopy-cubes-core\)/g),
      ].map((match) => match[1])
    ),
  ];

  if (listed.length === 0) {
    throw new Error(
      `nopy loaded no cubes from ${BUNDLE_PACKAGE}. Output was:\n${discovery.slice(0, 2000)}`
    );
  }

  // A count of what the prompt's viewport rendered, not of the whole bundle —
  // the check is that the loader found cubes at all, not how many.
  console.log(`${listed.length} cubes listed by the selection prompt`);
  console.log(`  ${listed.slice(0, 5).join(', ')}${listed.length > 5 ? ', …' : ''}`);

  console.log('\nSnapshot install works.');
} catch (error) {
  failed = true;
  console.error(`\nSnapshot check failed: ${error.message}`);
} finally {
  if (keep || failed) {
    console.error(`\nLeft the project at ${dir}`);
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
