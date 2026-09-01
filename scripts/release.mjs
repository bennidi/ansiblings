#!/usr/bin/env node

/**
 * Interactive release client: pick packages, choose versions, hand tags to CI.
 *
 * `release.yml` is tag-driven and deliberately dumb — the tag names the package,
 * `package.json` names the version, and the run fails if they disagree. Getting
 * to a good tag is the fiddly part, and it is all manual today: bump the right
 * manifest, write a changelog the release body can quote, run the gate, tag with
 * the `<directory>-v<version>` spelling, and push the tags dependency-first
 * because `pnpm publish` bakes a linked package's *current* version into its
 * dependent's tarball at pack time. This script does that sequence.
 *
 *   pnpm run release                       # pick packages and versions
 *   pnpm run release -- -p nopy -v minor   # non-interactive version choice
 *   pnpm run release -- --dry-run          # print the plan, change nothing
 *
 * Order of operations is load-bearing: versions and changelogs are written to
 * the working tree, the gate runs against *that* tree, and only then is anything
 * committed. A failing gate therefore leaves no commit to unpick — the script
 * offers to restore the tree instead.
 *
 * After each tag is pushed it polls npmjs until that exact version resolves.
 * That is both the ordering barrier (a dependent must not be tagged until the
 * version pnpm will bake into it exists on the registry) and the final proof
 * that the release actually landed, rather than that CI accepted the tag.
 */

import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import Enquirer from 'enquirer';
import semver from 'semver';
import { $, chalk, fs } from 'zx';

const PACKAGES_DIR = 'packages';
const RANGE_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const NPMJS_REGISTRY = 'https://registry.npmjs.org/';
const FETCH_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 15_000;

// Terminals that report no size make enquirer render zero choices and submit
// silently — see the long note on `terminalSize` in nopy.prompts.ts.
const MIN_ROWS = 24;
const MIN_COLS = 80;

$.verbose = false;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));

/** Every publishable package, alphabetically by directory. */
function readWorkspace() {
  return fs
    .readdirSync(PACKAGES_DIR)
    .map((name) => path.join(PACKAGES_DIR, name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => ({ dir, slug: path.basename(dir), manifest: readManifest(dir) }))
    .filter(({ manifest }) => !manifest.private)
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The other workspace packages this one links to, as directories. */
function linkedDirs(pkg, byName) {
  return RANGE_FIELDS.flatMap((field) => Object.entries(pkg.manifest[field] ?? {}))
    .filter(([, range]) => range.startsWith('workspace:'))
    .map(([name]) => byName.get(name)?.dir)
    .filter((dir) => dir !== undefined);
}

/**
 * Topological order over the `workspace:` edges — dependencies first.
 *
 * The same ordering `scripts/publish-order.mjs` prints, recomputed here rather
 * than shelled out to because this needs the subset being released, not all of
 * `packages/`. Alphabetical among packages the graph does not separate, so a
 * plan printed twice reads the same both times.
 */
function dependencyOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));
  const ordered = [];
  const emitted = new Set();
  const visiting = new Set();

  const visit = (pkg) => {
    if (emitted.has(pkg.dir)) return;
    if (visiting.has(pkg.dir)) throw new Error(`Dependency cycle in the workspace, at ${pkg.dir}`);
    visiting.add(pkg.dir);
    for (const dir of linkedDirs(pkg, byName)) {
      const dependency = byDir.get(dir);
      if (dependency) visit(dependency);
    }
    visiting.delete(pkg.dir);
    emitted.add(pkg.dir);
    ordered.push(pkg);
  };

  for (const pkg of [...packages].sort((a, b) => a.dir.localeCompare(b.dir))) visit(pkg);
  return ordered;
}

// ---------------------------------------------------------------------------
// npmjs
// ---------------------------------------------------------------------------

/**
 * Fetches a packument from npmjs, normalising every failure into a printable
 * shape rather than throwing — an unreachable registry should soften the picker,
 * not abort the release.
 */
async function packument(name) {
  let response;
  try {
    response = await fetch(`${NPMJS_REGISTRY}${encodeURIComponent(name)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return { reachable: false, note: error.name === 'TimeoutError' ? 'timed out' : 'unreachable' };
  }

  if (response.status === 404) return { reachable: true, published: false, versions: [], tags: {} };
  if (!response.ok) return { reachable: true, note: `HTTP ${response.status}` };

  let body;
  try {
    body = await response.json();
  } catch {
    return { reachable: true, note: 'unparseable response' };
  }
  if (body.error) return { reachable: true, published: false, versions: [], tags: {} };

  return {
    reachable: true,
    published: true,
    tags: body['dist-tags'] ?? {},
    versions: Object.keys(body.versions ?? {}),
  };
}

/**
 * Whether one exact version resolves on npmjs.
 *
 * The per-version endpoint rather than the packument: it 404s until the publish
 * lands, where a cached packument can answer without the new version in it and
 * read as "not yet" long after it is there.
 */
async function versionExists(name, version) {
  try {
    const response = await fetch(
      `${NPMJS_REGISTRY}${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    return response.ok;
  } catch {
    // A blip mid-poll is not an answer; the next tick asks again.
    return false;
  }
}

/**
 * Polls until `name@version` resolves on npmjs, offering to keep waiting when
 * the deadline passes.
 *
 * The offer is the point. A timeout here is far more often a runner that has
 * not started the job than a release that failed, and no timeout value survives
 * a runner that has wedged — so the choice is between asking and making the
 * operator finish the release by hand. `--yes` and a non-interactive run give
 * up instead, the latter because {@link confirm} answers with its default when
 * there is no terminal, which here would extend the deadline forever.
 */
async function waitForRelease(name, version, timeoutMs, mayExtend) {
  const started = Date.now();
  const label = `${name}@${version}`;
  let deadline = started + timeoutMs;
  process.stdout.write(`  waiting for ${label} on npmjs `);

  for (;;) {
    if (await versionExists(name, version)) {
      const seconds = Math.round((Date.now() - started) / 1000);
      console.log(chalk.green(` published after ${seconds}s`));
      return true;
    }
    if (Date.now() > deadline) {
      console.log(chalk.red(' timed out'));
      if (!mayExtend || !process.stdin.isTTY) return false;
      console.log(
        chalk.dim('  A queued or wedged runner looks exactly like this — check the run.')
      );
      if (!(await confirm(`Keep waiting for ${label}?`, true))) return false;
      deadline = Date.now() + timeoutMs;
      process.stdout.write(`  waiting for ${label} on npmjs `);
      continue;
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

const git = async (...args) => (await $`git ${args}`).stdout.trim();

async function currentBranch() {
  return await git('rev-parse', '--abbrev-ref', 'HEAD');
}

async function isClean() {
  return (await git('status', '--porcelain')) === '';
}

/** Local tags plus whatever the remote has, so a re-tag is caught either way. */
async function existingTags(remote) {
  const local = (await git('tag', '--list')).split('\n').filter(Boolean);
  let remoteTags = [];
  try {
    const output = await git('ls-remote', '--tags', remote);
    remoteTags = output
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('refs/tags/')[1])
      .filter((tag) => tag && !tag.endsWith('^{}'));
  } catch {
    // Offline, or no such remote. The local list still catches the common case
    // and `git push` will reject a duplicate anyway.
  }
  return new Set([...local, ...remoteTags]);
}

/** The newest `<slug>-v*` tag by semver, or undefined if the package is unreleased. */
function lastTagFor(slug, tags) {
  const prefix = `${slug}-v`;
  return [...tags]
    .filter((tag) => tag.startsWith(prefix) && semver.valid(tag.slice(prefix.length)))
    .sort((a, b) => semver.rcompare(a.slice(prefix.length), b.slice(prefix.length)))[0];
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const terminalSize = () => ({
  rows: Math.max(process.stdout.rows || 0, MIN_ROWS),
  columns: Math.max(process.stdout.columns || 0, MIN_COLS),
});

/**
 * Runs an enquirer prompt, refusing outright when there is no terminal to run it
 * in.
 *
 * Without the guard a piped or CI invocation hangs on a prompt nobody can
 * answer, and node reports it as `unsettled top-level await` — which says
 * nothing about the missing flag that would have avoided the prompt.
 */
function ask(Kind, options) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `'${options.message}' needs an answer, but stdin is not a terminal.\n` +
        'Supply --package / --version (and --no-changelog) to run non-interactively.'
    );
  }
  return new Enquirer[Kind]({ ...options, ...terminalSize() }).run();
}

/**
 * A yes/no question. Unlike {@link ask} this has a defensible answer without a
 * terminal — the default — because every caller is an optional extra step.
 */
async function confirm(message, initial = false) {
  if (!process.stdin.isTTY) {
    console.log(chalk.dim(`  ${message} → ${initial ? 'yes' : 'no'} (not a terminal)`));
    return initial;
  }
  return await new Enquirer.Confirm({ name: 'ok', message, initial, ...terminalSize() }).run();
}

/** One line per package, so the picker shows what npmjs already has. */
function describeForPicker(pkg, registry) {
  const local = `local ${pkg.manifest.version}`;
  if (!registry.reachable) return `${local} · npmjs ${registry.note}`;
  if (registry.note) return `${local} · npmjs ${registry.note}`;
  if (!registry.published) return `${local} · not on npmjs`;
  const latest = registry.tags?.latest;
  return `${local} · npmjs latest ${latest ?? '(none)'}`;
}

async function selectPackages(candidates, registries) {
  const selected = await ask('MultiSelect', {
    name: 'packages',
    message: 'Which packages are you releasing?',
    hint: '(space to select, enter to confirm)',
    choices: candidates.map((pkg) => ({
      name: pkg.slug,
      message: `${pkg.manifest.name.padEnd(28)} ${describeForPicker(pkg, registries.get(pkg.manifest.name))}`,
    })),
    validate: (value) => (value.length > 0 ? true : 'Select at least one package.'),
  });
  return selected;
}

/**
 * Resolves a version for one package, either from `--version` or interactively.
 *
 * Bumps are computed from the manifest, not from npmjs: the manifest is the
 * repo's source of truth and the thing `release.yml` compares the tag against.
 * Where npmjs is ahead — which it is for every package still carrying the old
 * `1.0.0-alpha5` — that is surfaced as a warning rather than a different base,
 * because silently jumping the local version is how you lose a bump.
 */
async function chooseVersion(pkg, registry, requested, tags) {
  const current = pkg.manifest.version;
  const taken = new Set(registry.versions ?? []);
  const KEYWORDS = ['patch', 'minor', 'major', 'prerelease'];

  const check = (version) => {
    if (!semver.valid(version)) return `'${version}' is not a valid semver version.`;
    if (taken.has(version)) return `${pkg.manifest.name}@${version} is already on npmjs.`;
    if (tags.has(`${pkg.slug}-v${version}`)) return `Tag ${pkg.slug}-v${version} already exists.`;
    return true;
  };

  if (requested) {
    const version = KEYWORDS.includes(requested)
      ? semver.inc(current, requested, requested === 'prerelease' ? 'rc' : undefined)
      : requested;
    const problem = check(version);
    if (problem !== true) throw new Error(problem);
    return version;
  }

  const bump = (release, identifier) => semver.inc(current, release, identifier);
  const choices = [
    { name: bump('patch'), message: `patch      ${current} → ${bump('patch')}` },
    { name: bump('minor'), message: `minor      ${current} → ${bump('minor')}` },
    { name: bump('major'), message: `major      ${current} → ${bump('major')}` },
    {
      name: bump('prerelease', 'rc'),
      // Publishes under `next`, never `latest` — the rule in release.yml is
      // purely "does the version contain a `-`".
      message: `prerelease ${current} → ${bump('prerelease', 'rc')}  (dist-tag: next)`,
    },
    { name: 'custom', message: 'custom…' },
  ].map((choice) => {
    const problem = choice.name === 'custom' ? true : check(choice.name);
    return problem === true
      ? choice
      : { ...choice, message: `${choice.message}  ${problem}`, disabled: true };
  });

  const picked = await ask('Select', {
    name: 'version',
    message: `Version for ${pkg.manifest.name} (currently ${current})`,
    choices,
  });

  if (picked !== 'custom') {
    const problem = check(picked);
    if (problem !== true) throw new Error(problem);
    return picked;
  }

  return await ask('Input', {
    name: 'version',
    message: `Version for ${pkg.manifest.name}`,
    initial: bump('patch'),
    validate: check,
  });
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

const CHANGELOG_HEADER = '# Changelog\n';

/**
 * Collects release notes in `$EDITOR`, seeded with the commits since the
 * package's last tag.
 *
 * The seed is the point: `release.yml` quotes this section verbatim into the
 * Gitea release body, and a summary written next to the actual commit list is a
 * better one than a summary written from memory. Lines starting with `#` are
 * stripped, so the seed can carry instructions without them leaking into the
 * release.
 */
async function collectNotes(pkg, version, tags) {
  const editor = process.env.VISUAL || process.env.EDITOR;
  const lastTag = lastTagFor(pkg.slug, tags);

  let log = '';
  try {
    const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
    log = await git('log', range, '--oneline', '--no-decorate', '-n', '40', '--', pkg.dir);
  } catch {
    // A shallow clone or a brand new package — the template still works.
  }

  if (!process.stdin.isTTY) {
    // Nothing here can prompt, and an editor would have no terminal to draw on.
    // Missing notes are survivable — the release body degrades to the install
    // snippet — so say so and carry on rather than failing the release.
    console.log(chalk.yellow(`  no TTY — skipping release notes for ${pkg.manifest.name}.`));
    return '';
  }

  if (!editor) {
    // One line beats nothing when there is no editor to fall back on.
    const summary = await ask('Input', {
      name: 'notes',
      message: `Release notes for ${pkg.manifest.name}@${version} (blank to skip, $EDITOR unset)`,
    });
    return summary.trim() ? `- ${summary.trim()}` : '';
  }

  const seed = [
    '',
    `# Release notes for ${pkg.manifest.name}@${version}.`,
    '# Lines starting with "#" are ignored. Leave the file empty to skip.',
    '#',
    `# Commits since ${lastTag ?? 'the beginning'} touching ${pkg.dir}:`,
    ...(log ? log.split('\n').map((line) => `#   ${line}`) : ['#   (none)']),
    '',
  ].join('\n');

  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-')),
    `${pkg.slug}-${version}.md`
  );
  fs.writeFileSync(file, seed);

  try {
    // The editor owns the terminal — `stdio: inherit` is what makes a full-screen
    // vim usable here rather than a scrambled buffer.
    await $({ stdio: 'inherit' })`${editor} ${file}`;
    return fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim();
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

/** Prepends a section for `version`, creating the file if the package has none. */
function writeChangelog(pkg, version, notes, today) {
  const file = path.join(pkg.dir, 'CHANGELOG.md');
  const existed = fs.existsSync(file);
  const section = `## ${version} — ${today}\n\n${notes}\n`;

  if (!existed) {
    fs.writeFileSync(file, `${CHANGELOG_HEADER}\n${section}`);
    return { file, created: true };
  }

  // Insert above the newest existing section, so the file stays newest-first and
  // the new entry lands *below* any `# Changelog` title rather than above it.
  const body = fs.readFileSync(file, 'utf-8');
  const at = body.startsWith('## ') ? 0 : body.indexOf('\n## ') + 1;
  const updated =
    at === 0 && !body.startsWith('## ')
      ? `${body.replace(/\n*$/, '\n')}\n${section}`
      : `${body.slice(0, at)}${section}\n${body.slice(at)}`;

  fs.writeFileSync(file, updated);
  return { file, created: false };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function preflight(remote) {
  const root = await git('rev-parse', '--show-toplevel');
  if (path.resolve(root) !== path.resolve(process.cwd())) {
    throw new Error(`Run this from the repository root (${root}).`);
  }

  if (!(await isClean())) {
    throw new Error(
      'The working tree has uncommitted changes.\n' +
        'A release commit must contain the version bump and nothing else — commit or stash first.'
    );
  }

  const branch = await currentBranch();

  console.log(chalk.dim(`  fetching ${remote}…`));
  try {
    await $`git fetch ${remote} --tags --quiet`;
  } catch {
    console.log(chalk.yellow(`  could not reach ${remote} — continuing with local refs only.`));
    return { branch };
  }

  // Behind the remote is the dangerous one: the tag would point at a commit that
  // is not what `main` will look like, and the release would ship a tree nobody
  // reviewed. Ahead is merely unpushed, and this script pushes.
  const behind = await git('rev-list', '--count', `HEAD..${remote}/${branch}`).catch(() => '0');
  if (behind !== '0') {
    throw new Error(
      `${branch} is ${behind} commit(s) behind ${remote}/${branch}. Pull before releasing.`
    );
  }

  return { branch };
}

/** The gate, run against the bumped working tree. Same three commands as CI. */
async function verify() {
  const steps = [
    ['lint', ['run', 'lint:ci']],
    ['typecheck', ['run', 'typecheck']],
    ['test', ['run', 'test:coverage']],
    ['build', ['run', 'build']],
  ];

  for (const [label, args] of steps) {
    console.log(chalk.bold(`\n  ▸ pnpm ${args.join(' ')}`));
    const result = await $({ stdio: 'inherit', nothrow: true })`pnpm ${args}`;
    if (result.exitCode !== 0) return label;
  }

  console.log(chalk.bold('\n  ▸ node scripts/verify-pack.mjs'));
  const packed = await $({ stdio: 'inherit', nothrow: true })`node scripts/verify-pack.mjs`;
  return packed.exitCode === 0 ? null : 'verify-pack';
}

/** Puts the tree back the way preflight found it — which was clean, by contract. */
async function restore(touched) {
  for (const { file, created } of touched) {
    if (created) fs.rmSync(file, { force: true });
  }
  const tracked = touched.filter((entry) => !entry.created).map((entry) => entry.file);
  if (tracked.length > 0) await $`git checkout -- ${tracked}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function release(options) {
  const workspace = readWorkspace();
  const byName = new Map(workspace.map((pkg) => [pkg.manifest.name, pkg]));
  const bySlug = new Map(workspace.map((pkg) => [pkg.slug, pkg]));

  console.log(chalk.bold('\nRelease\n'));
  const { branch } = await preflight(options.remote);

  if (branch !== 'main') {
    console.log(
      chalk.yellow(
        `  You are on '${branch}', not 'main'. Tags release from any branch, but the\n` +
          '  snapshot lane and the review flow both assume main.'
      )
    );
    if (!options.yes && !(await confirm(`Release from '${branch}' anyway?`))) return 1;
  }

  const tags = await existingTags(options.remote);

  console.log(chalk.dim('  reading npmjs…\n'));
  const registries = new Map(
    await Promise.all(
      workspace.map(async (pkg) => [pkg.manifest.name, await packument(pkg.manifest.name)])
    )
  );

  // --- pick packages -------------------------------------------------------

  let slugs;
  if (options.package?.length) {
    slugs = options.package.map((given) => {
      const pkg = bySlug.get(given) ?? byName.get(given);
      if (!pkg) {
        throw new Error(
          `Unknown package '${given}'. Known: ${workspace.map((p) => p.slug).join(', ')}`
        );
      }
      return pkg.slug;
    });
  } else {
    slugs = await selectPackages(workspace, registries);
  }

  let selected = dependencyOrder(slugs.map((slug) => bySlug.get(slug)));

  if (options.version && selected.length !== 1) {
    throw new Error('--version applies to a single package; select one with --package.');
  }

  // --- warn about dependents ----------------------------------------------

  // `pnpm publish` resolves `workspace:*` to whatever the linked package
  // declares at pack time, so bumping a library silently changes what its
  // dependents' *next* release will require. Better to decide that here than to
  // discover it in a tarball.
  const selectedDirs = new Set(selected.map((pkg) => pkg.dir));
  const dependents = workspace.filter(
    (pkg) =>
      !selectedDirs.has(pkg.dir) && linkedDirs(pkg, byName).some((dir) => selectedDirs.has(dir))
  );

  if (dependents.length > 0) {
    const names = dependents.map((p) => p.manifest.name).join(', ');
    console.log(
      chalk.yellow(
        `\n  ${names} ${dependents.length === 1 ? 'links' : 'link'} to a package you are\n` +
          '  releasing. It is not in this release, but its next one will require the new\n' +
          '  version whether or not you meant it to.\n'
      )
    );
    // Not offered under --version (that flag names one version, and applying it
    // to a package the user did not ask for is worse than making them re-run)
    // and not under --dry-run, which must not change the plan it is printing.
    const mayAdd = !options.yes && !options.version && !options.dryRun;
    if (mayAdd && (await confirm('Add them to this release?'))) {
      selected = dependencyOrder([...selected, ...dependents]);
    }
  }

  // --- versions ------------------------------------------------------------

  const plan = [];
  for (const pkg of selected) {
    const version = await chooseVersion(
      pkg,
      registries.get(pkg.manifest.name),
      options.version,
      tags
    );

    const latest = registries.get(pkg.manifest.name)?.tags?.latest;
    if (latest && semver.valid(latest) && semver.lte(version, latest)) {
      console.log(
        chalk.yellow(
          `  ! ${version} is not above npmjs latest (${latest}) — 'latest' will not move to it.`
        )
      );
    }

    plan.push({ pkg, version, tag: `${pkg.slug}-v${version}` });
  }

  // --- notes ---------------------------------------------------------------

  // Not under --dry-run: a preview of the plan should not make you sit down and
  // write release notes for a release you have not committed to yet.
  if (options.changelog && !options.dryRun) {
    for (const entry of plan) {
      entry.notes = await collectNotes(entry.pkg, entry.version, tags);
    }
  }

  // --- plan ----------------------------------------------------------------

  const distTag = (version) => (version.includes('-') ? 'next' : 'latest');
  const message = `release: ${plan.map((e) => `${e.pkg.manifest.name}@${e.version}`).join(', ')}`;

  console.log(chalk.bold('\n  Plan\n'));
  for (const entry of plan) {
    const { pkg, version, tag } = entry;
    console.log(`  ${chalk.bold(pkg.manifest.name)}  ${pkg.manifest.version} → ${version}`);
    console.log(`    tag        ${tag}`);
    console.log(`    dist-tag   ${distTag(version)}`);
    const notes = entry.notes ? `${entry.notes.split('\n').length} line(s)` : '—';
    console.log(
      `    changelog  ${options.dryRun && options.changelog ? '(prompted later)' : notes}`
    );
  }
  console.log(`\n  commit  ${message}`);
  console.log(`  push    ${options.remote} ${branch}, then tags in the order above`);
  console.log(
    options.wait
      ? `  wait    for each version on npmjs (asks to continue after ${options.waitTimeout}s)\n`
      : '  wait    no — tags are pushed back to back\n'
  );

  if (options.dryRun) {
    console.log(chalk.dim('  --dry-run: nothing was changed.\n'));
    return 0;
  }

  if (!options.yes && !(await confirm('Proceed?', true))) {
    console.log('  Nothing was changed.');
    return 1;
  }

  // --- write ---------------------------------------------------------------

  const today = new Date().toISOString().slice(0, 10);
  const touched = [];

  for (const entry of plan) {
    // `npm pkg set`, the same edit the workflows make, rather than a hand-rolled
    // rewrite of the manifest.
    await $({ cwd: entry.pkg.dir })`npm pkg set version=${entry.version}`;
    touched.push({ file: path.join(entry.pkg.dir, 'package.json'), created: false });

    if (entry.notes) {
      touched.push(writeChangelog(entry.pkg, entry.version, entry.notes, today));
    }
  }
  console.log(chalk.green(`\n  wrote ${touched.length} file(s)`));

  // --- verify --------------------------------------------------------------

  if (options.verify) {
    const failed = await verify();
    if (failed) {
      console.log(chalk.red(`\n  ${failed} failed. Nothing has been committed.`));
      if (options.yes || (await confirm('Restore the version and changelog edits?', true))) {
        await restore(touched);
        console.log('  Tree restored.');
      } else {
        console.log('  Edits left in place for inspection.');
      }
      return 1;
    }
    console.log(chalk.green('\n  gate passed'));
  }

  // --- commit and tag ------------------------------------------------------

  await $`git add -- ${touched.map((entry) => entry.file)}`;
  await $`git commit -m ${message}`;
  console.log(chalk.green(`  committed ${await git('rev-parse', '--short=7', 'HEAD')}`));

  for (const entry of plan) {
    // Annotated (`-a -m`), never lightweight. A lightweight tag is rejected
    // outright under `tag.forceSignAnnotated`/`tag.gpgSign`, which is a common
    // enough setting to have hit this on the first real run; and the annotation
    // is worth having anyway, since it puts the notes in `git show <tag>`.
    const body = [`${entry.pkg.manifest.name}@${entry.version}`, entry.notes]
      .filter(Boolean)
      .join('\n\n');
    await $`git tag -a ${entry.tag} -m ${body}`;
  }
  console.log(chalk.green(`  tagged ${plan.map((e) => e.tag).join(', ')}`));

  // --- push ----------------------------------------------------------------

  // The gate just ran against this exact tree, so the pre-push hook would only
  // run it a second time. `quiet` is spelled out because a `$({…})` instance
  // does not inherit the module-level `$.verbose`, and git writes push progress
  // to stderr — this script reports each push itself.
  const push = $({ env: { ...process.env, SKIP_SIMPLE_GIT_HOOKS: '1' }, quiet: true });

  await push`git push ${options.remote} HEAD:${branch}`;
  console.log(chalk.green(`  pushed ${branch}`));

  const pending = [];
  for (const entry of plan) {
    await push`git push ${options.remote} ${entry.tag}`;
    console.log(chalk.green(`  pushed ${entry.tag}`));

    if (!options.wait) continue;

    const landed = await waitForRelease(
      entry.pkg.manifest.name,
      entry.version,
      options.waitTimeout * 1000,
      !options.yes
    );
    if (!landed) {
      pending.push(entry);
      console.log(
        chalk.red(
          `  ${entry.pkg.manifest.name}@${entry.version} has not appeared on npmjs.\n` +
            '  Check the Release run before pushing anything that depends on it.'
        )
      );
      // Deliberately no rollback: the tag is pushed and CI may still be mid-run.
      // Deleting it here would race the publish it is waiting for.
      break;
    }
  }

  // --- report --------------------------------------------------------------

  const blocked = pending[0];
  const shipped = blocked ? plan.slice(0, plan.indexOf(blocked)) : plan;

  // The header has to know whether this worked. It was an unconditional 'Done'
  // over a `shipped` list that is *empty* when the package that blocked is the
  // first one — a success banner above a release that shipped nothing, with the
  // diagnosis a screen further down. It read as success and was believed.
  console.log(chalk.bold(blocked ? '\n  Blocked\n' : '\n  Done\n'));

  if (blocked && shipped.length > 0) console.log(chalk.dim('  Released before the blockage:\n'));
  for (const entry of shipped) {
    console.log(`  ${entry.pkg.manifest.name}@${entry.version}  (${distTag(entry.version)})`);
    console.log(chalk.dim(`    npm install -g ${entry.pkg.manifest.name}@${entry.version}`));
  }

  if (blocked) {
    // Every tag was created locally before the first push, so the ones after the
    // blockage exist here and simply have not gone out.
    const unpushed = plan.slice(plan.indexOf(blocked) + 1);
    console.log(chalk.yellow(`\n  Blocked on ${blocked.pkg.manifest.name}@${blocked.version}.`));
    if (unpushed.length > 0) {
      console.log(
        chalk.yellow(
          `  Tagged locally but not pushed: ${unpushed.map((e) => e.tag).join(', ')}\n` +
            `  Push them once the blocked release lands:\n` +
            unpushed.map((e) => `    git push ${options.remote} ${e.tag}`).join('\n')
        )
      );
    }
    console.log('');
    return 1;
  }

  console.log('');
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('release')
  .description('Interactively version, verify, tag and push a release.')
  .option('-p, --package <name...>', 'Packages to release (directory or npm name)')
  .option('-v, --version <spec>', 'Version or bump (patch|minor|major|prerelease), one package')
  .option('-n, --dry-run', 'Print the plan and change nothing')
  .option('-y, --yes', 'Skip confirmations (assumes yes)')
  .option('--remote <name>', 'Git remote to push to', 'origin')
  .option('--no-verify', 'Skip the lint/typecheck/test/build gate')
  .option('--no-changelog', 'Do not prompt for release notes')
  .option('--no-wait', 'Do not poll npmjs between tag pushes')
  .option(
    '--wait-timeout <seconds>',
    'How long to wait before asking to keep waiting',
    Number,
    2400
  )
  .addHelpText(
    'after',
    `
Examples:
  $ pnpm run release                          Pick packages and versions
  $ pnpm run release -- -p nopy -v minor      Bump nopy's minor, no picker
  $ pnpm run release -- -p nopy-cubes nopy    Release both, dependency-first
  $ pnpm run release -- --dry-run             Show the plan only

The tag is '<directory>-v<version>' — 'nopy-v1.2.0', not the npm name. Tags are
pushed dependency-first and each version is confirmed on npmjs before the next
tag goes out, because pnpm bakes a linked package's version into its dependent's
tarball at pack time.
`
  )
  .action(async (options) => {
    try {
      process.exitCode = await release(options);
    } catch (error) {
      // A cancelled enquirer prompt rejects with '' — that is a user backing
      // out, not a failure worth a stack trace.
      if (error === '' || error === undefined) {
        console.log('\n  Cancelled. Nothing was changed.\n');
        process.exitCode = 1;
        return;
      }
      // Indented per line, not just the first — several of these messages are
      // two or three lines and the continuation used to hang off the margin.
      const text = String(error.message ?? error)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      console.error(chalk.red(`\n${text}\n`));
      process.exitCode = 1;
    }
  });

// `pnpm run release -- --dry-run` forwards the `--` itself rather than eating it
// (measured on pnpm 11), and commander reads a bare `--` as "the rest are
// positionals" — so the habitual spelling died with *too many arguments*. This
// script takes no positional arguments at all, so a `--` can only ever be that
// artefact; dropping it makes both spellings work.
await program.parseAsync(
  process.argv.slice(2).filter((argument) => argument !== '--'),
  { from: 'user' }
);
