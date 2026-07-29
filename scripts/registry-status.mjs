#!/usr/bin/env node

/**
 * Reports what each publishable package looks like on Gitea versus npmjs.
 *
 * The two registries are deliberately not equivalent: `publish-snapshot.yml`
 * pushes a `main` snapshot to Gitea on every push to `main`, while `release.yml`
 * publishes a tagged version to both. Gitea is therefore a superset, and the
 * interesting question before a release is which versions exist *only* there —
 * those are the ones that can still be tested and un-published.
 *
 * It also flags a missing `latest` dist-tag, which is worth a line of output
 * because npm reports it by printing nothing and exiting 0. `npm view <name>`
 * against a registry with no `latest` looks identical to a working lookup of an
 * empty package, which is how the whole 1.0.0-alphaN dist-tag problem stayed
 * invisible for as long as it did.
 *
 *   node scripts/registry-status.mjs
 *   node scripts/registry-status.mjs --json
 *   node scripts/registry-status.mjs --registry http://localhost:4873/
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGES_DIR = 'packages';
const SCOPE = '@bitsquare';
const NPMJS_REGISTRY = 'https://registry.npmjs.org/';
const FALLBACK_GITEA = 'https://gitea.bitsquare.dev/api/packages/BitSquare/npm/';
const TIMEOUT_MS = 15_000;

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at !== -1 && argv[at + 1] ? argv[at + 1] : fallback;
};

const withSlash = (url) => (url.endsWith('/') ? url : `${url}/`);

/**
 * The scope mapping in the repo's own `.npmrc` is the single source of truth,
 * so this never drifts from what an actual install would do.
 */
function resolveGiteaRegistry() {
  try {
    const out = execFileSync('npm', ['config', 'get', `${SCOPE}:registry`], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    // npm prints the literal string "undefined" for an unset key.
    if (out && out !== 'undefined' && out !== 'null') return withSlash(out);
  } catch {
    // npm missing or unreadable config — the fallback is still correct.
  }
  return FALLBACK_GITEA;
}

const GITEA_REGISTRY = withSlash(flag('--registry', resolveGiteaRegistry()));

/** Fetches a packument, normalising every failure into a shape the report can print. */
async function packument(registry, name) {
  let response;
  try {
    response = await fetch(`${registry}${encodeURIComponent(name)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { reachable: false, note: error.name === 'TimeoutError' ? 'timed out' : 'unreachable' };
  }

  if (response.status === 404) return { reachable: true, published: false };
  if (!response.ok) return { reachable: true, note: `HTTP ${response.status}` };

  let body;
  try {
    body = await response.json();
  } catch {
    return { reachable: true, note: 'unparseable response' };
  }

  // Gitea answers a missing package with 200 + {"error": "Not found"} rather
  // than a 404, so the body has to be checked as well as the status.
  if (body.error) return { reachable: true, published: false };

  return {
    reachable: true,
    published: true,
    tags: body['dist-tags'] ?? {},
    versions: Object.keys(body.versions ?? {}),
  };
}

const packages = fs
  .readdirSync(PACKAGES_DIR)
  .map((name) => path.join(PACKAGES_DIR, name))
  .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
  .map((dir) => ({ dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))) }))
  .filter(({ manifest }) => !manifest.private)
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

const report = await Promise.all(
  packages.map(async ({ dir, manifest }) => {
    const [gitea, npmjs] = await Promise.all([
      packument(GITEA_REGISTRY, manifest.name),
      packument(NPMJS_REGISTRY, manifest.name),
    ]);

    const npmjsVersions = new Set(npmjs.versions ?? []);
    const giteaOnly = (gitea.versions ?? []).filter((v) => !npmjsVersions.has(v));

    return {
      name: manifest.name,
      dir,
      local: manifest.version,
      gitea,
      npmjs,
      giteaOnly,
      localPublished: {
        gitea: (gitea.versions ?? []).includes(manifest.version),
        npmjs: npmjsVersions.has(manifest.version),
      },
    };
  })
);

if (asJson) {
  console.log(
    JSON.stringify(
      { registries: { gitea: GITEA_REGISTRY, npmjs: NPMJS_REGISTRY }, report },
      null,
      2
    )
  );
  process.exit(0);
}

const describe = (result) => {
  if (!result.reachable) return `(${result.note})`;
  if (result.note) return `(${result.note})`;
  if (!result.published) return '(not published)';
  const tags = Object.entries(result.tags)
    .map(([tag, version]) => `${tag}=${version}`)
    .sort()
    .join(', ');
  const count = `${result.versions.length} version${result.versions.length === 1 ? '' : 's'}`;
  return `${count}${tags ? ` — ${tags}` : ' — no dist-tags'}`;
};

console.log('Registry status\n');
console.log(`  gitea  ${GITEA_REGISTRY}`);
console.log(`  npmjs  ${NPMJS_REGISTRY}`);

for (const entry of report) {
  console.log(`\n${entry.name}  (local ${entry.local})`);
  console.log(`  gitea  ${describe(entry.gitea)}`);
  console.log(`  npmjs  ${describe(entry.npmjs)}`);

  if (entry.giteaOnly.length > 0) {
    console.log(`  gitea only  ${entry.giteaOnly.join(', ')}`);
  }

  const notes = [];
  if (entry.gitea.published && !entry.gitea.tags.latest) {
    notes.push('no `latest` on gitea — an untagged install resolves to nothing, silently');
  }
  if (!entry.localPublished.gitea && !entry.localPublished.npmjs) {
    notes.push(`local ${entry.local} is on neither registry`);
  } else if (entry.localPublished.gitea && !entry.localPublished.npmjs) {
    notes.push(`local ${entry.local} is testable on gitea, not yet released to npmjs`);
  }
  for (const note of notes) console.log(`  ! ${note}`);
}

const testable = report.filter((entry) => entry.giteaOnly.length > 0);
console.log(
  testable.length > 0
    ? `\n${testable.length} of ${report.length} packages have versions on gitea that npmjs does not.` +
        '\nInstall one with an explicit tag, e.g. `npm i -g @bitsquare/nopy@main` — see README.PUBLISH.md.'
    : '\nEvery version on gitea is also on npmjs.'
);
