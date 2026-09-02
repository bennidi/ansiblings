/**
 * Cube scaffolding — `nopy create-cube`
 * @module nopy.create-cube
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCubeDirectories, loadCubes } from './cubes/index.js';
import type { NopyConfig } from './nopy.config.js';
import { NopyUsageError } from './nopy.errors.js';
import { type InitFileResult, writeGuarded } from './nopy.init.js';

/** What the scaffold writes — the loader's two exact-name candidates. */
export const MANIFEST_FILENAME = 'manifest.mjs';
export const DEPLOY_FILENAME = 'deploy.py';

/**
 * Templates resolved relative to this module, so the same path works from
 * `src/` (tsx, vitest) and from `dist/` (the build copies `src/templates`
 * alongside). Named `*.example.*` because the loader declares any directory
 * holding a manifest **and** a deploy script a cube — under their real names
 * the template directory itself would be one, and a `cubeDirs` entry sweeping
 * this package would deploy the template.
 */
const TEMPLATES: Record<string, URL> = {
  [MANIFEST_FILENAME]: new URL('./templates/cube/manifest.example.mjs', import.meta.url),
  [DEPLOY_FILENAME]: new URL('./templates/cube/deploy.example.py', import.meta.url),
};

const CUBE_ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/i;

/**
 * Why `id` cannot name a cube, or `undefined` when it can. Returns the message
 * rather than throwing so a prompt can use it as an inline `validate` while
 * {@link createCube} turns it into the error it is.
 */
export function validateCubeId(id: string): string | undefined {
  if (!id.trim()) return 'Cube id is required';
  if (!CUBE_ID_PATTERN.test(id)) {
    return `Cube id may hold letters, digits and ":-_." — like "net:tailscale" or "apt"`;
  }
  return undefined;
}

/**
 * Where the prompt suggests putting a cube: the first configured cube
 * directory (falling back to `./cubes`) plus the id with each `:` segment as a
 * subdirectory, so `net:tailscale` lands in `cubes/net/tailscale`. Ids are
 * flat and need not mirror the path — this is a suggestion, not a rule.
 * Returned relative to the working directory when it is under it, because
 * that is the form a prompt default should show.
 */
export function suggestCubeDir(id: string, config?: Pick<NopyConfig, 'cubeDirs'>): string {
  const base = config?.cubeDirs?.[0] ?? path.resolve(process.cwd(), 'cubes');
  const target = path.join(base, ...id.split(':').filter(Boolean));
  const relative = path.relative(process.cwd(), target);
  return relative.startsWith('..') ? target : relative;
}

/**
 * Files that already make `dir` a cube, by the loader's own patterns — not
 * just the two exact names the scaffold writes. A `foo.manifest.mjs` already
 * present would leave the directory with two manifests and the loader picking
 * whichever `readdir` returns first, so it has to block the scaffold too.
 */
function existingCubeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name === MANIFEST_FILENAME ||
        name.endsWith('.manifest.mjs') ||
        name === DEPLOY_FILENAME ||
        name.endsWith('.deploy.py')
    )
    .sort();
}

/**
 * Escapes a value for splicing into a single-quoted string literal in the
 * manifest template — the cube name is free text, and an apostrophe in it
 * must not produce a manifest that does not parse.
 */
function jsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export interface CreateCubeOptions {
  /** Cube id, e.g. `net:tailscale`. */
  id: string;
  /** Human-readable name, shown in the cube list. */
  name: string;
  /** Target directory; created if missing. Relative paths resolve against cwd. */
  dir: string;
  /** Overwrite existing cube files. */
  force?: boolean;
}

/**
 * Refuses an id another cube already claims — at creation time, rather than
 * as the loader's hard duplicate error on the next run. Best-effort: no
 * config, or a loader that cannot run, skips the check (the loader still
 * catches the collision later). A claim by the target directory itself is the
 * `--force` re-scaffold case, not a collision.
 */
export async function assertCubeIdAvailable(id: string, dir: string): Promise<void> {
  let cubes: Awaited<ReturnType<typeof loadCubes>>['cubes'];
  try {
    ({ cubes } = await loadCubes());
  } catch {
    return;
  }

  const claimant = cubes[id];
  if (!claimant || path.resolve(claimant.dir) === path.resolve(dir)) return;

  const from =
    claimant.source.type === 'package' ? `package ${claimant.source.packageName}` : claimant.dir;
  throw new NopyUsageError(`Cube id "${id}" is already claimed by ${from}.`);
}

/**
 * The hint when a cube lands where the loader will never look, or `undefined`
 * when it is discoverable (or there is no config to consult — a bare
 * directory gets the next-steps line about `.nopyrc.json` instead of a
 * warning about one that does not exist).
 */
export function cubeDirWarning(dir: string): string | undefined {
  let roots: string[];
  try {
    roots = findCubeDirectories();
  } catch {
    return undefined;
  }

  const target = path.resolve(dir);
  const inside = roots.some((root) => {
    const relative = path.relative(path.resolve(root), target);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });

  if (inside) return undefined;
  return (
    `Note: ${dir} is outside every configured cube directory — ` +
    'add it to "cubeDirs" in .nopyrc.json or nopy will not find it.'
  );
}

/**
 * Scaffolds a cube directory from the bundled templates: `manifest.mjs` with
 * the id and name spliced in, plus a minimal `deploy.py`. The result is
 * loadable as-is; the schema is an example to replace.
 */
export function createCube(options: CreateCubeOptions): InitFileResult[] {
  const idError = validateCubeId(options.id);
  if (idError) throw new NopyUsageError(idError);
  if (!options.name.trim()) throw new NopyUsageError('Cube name is required');

  const dir = path.resolve(options.dir);
  const force = options.force ?? false;

  const existing = existingCubeFiles(dir);
  if (existing.length > 0 && !force) {
    throw new NopyUsageError(
      `${dir} already holds cube files (${existing.join(', ')}). ` +
        `Use --force to overwrite ${MANIFEST_FILENAME} and ${DEPLOY_FILENAME}.`
    );
  }

  fs.mkdirSync(dir, { recursive: true });

  return Object.entries(TEMPLATES).map(([filename, url]) => {
    // Function replacements, so a `$` in a cube name is never expanded as a
    // replacement pattern.
    const content = fs
      .readFileSync(fileURLToPath(url), 'utf-8')
      .replace(/__CUBE_ID__/g, () => jsEscape(options.id))
      .replace(/__CUBE_NAME__/g, () => jsEscape(options.name));
    return writeGuarded(path.join(dir, filename), content, force);
  });
}

/**
 * The report `create-cube` prints. Lives here rather than in the CLI because
 * the CLI is excluded from coverage.
 */
export function formatCreateCubeResults(
  results: InitFileResult[],
  options: { id: string; warning?: string }
): string {
  const lines = results.map((result) =>
    result.status === 'skipped'
      ? `  exists, skipped  ${result.file} (use --force to overwrite)`
      : `  ${result.status.padEnd(15)}  ${result.file}`
  );

  lines.push(
    '',
    'Next steps:',
    `  1. Declare the cube's variables in ${MANIFEST_FILENAME} — the schema is an example`,
    `  2. Write the deployment in ${DEPLOY_FILENAME}; every schema key arrives on host.data`,
    `  3. Run \`nopy\` and select ${options.id}`
  );

  if (options.warning) lines.push('', options.warning);

  return lines.join('\n');
}
