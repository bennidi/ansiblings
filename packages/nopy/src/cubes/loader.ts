/**
 * Cube discovery and loading from the filesystem
 * @module cubes/loader
 */

import module from 'node:module';
import path from 'node:path';
import { Cube, type CubeSource, type LoadResult, type Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';
import { fs } from 'zx';
import { loadConfig } from '../nopy.config.js';
import { resolveCubePackages } from './packages.js';

let hookRegistered = false;

/**
 * Installs the fallback resolver that lets a manifest in a bare directory
 * import `@bitsquare/nopy-cubes` or `zod` — see `resolve-hook.mjs`.
 *
 * `module.register()` is process-global and cannot be undone, so this runs once
 * and only when cubes are about to be imported. Registration failing is not
 * worth aborting a run over: without the hook, a cube that needed it fails on
 * its own import with a message that names the file.
 */
function registerResolveHook(): void {
  if (hookRegistered) return;
  hookRegistered = true;

  try {
    // `from` is a URL inside this package, so the hook thread resolves the
    // fallbacks out of the running CLI's own dependencies.
    module.register('./resolve-hook.mjs', import.meta.url, { data: { from: import.meta.url } });
  } catch {
    // Nothing to do: the hook is a convenience, never load-bearing.
  }
}

/** A directory to scan, and what put it in the list. */
export interface CubeRoot {
  dir: string;
  source: CubeSource;
}

/**
 * Collects every root to scan for cubes:
 *
 * - `cubeDirs` from the merged configuration,
 * - every ancestor of the working directory holding a `.npcubes` marker file,
 * - the cube directories of every package named in `cubePackages`.
 *
 * Only the last of those can fail — a missing directory is ignored, a missing
 * package is not (see `resolveCubePackages`).
 */
export function findCubeRoots(): { roots: CubeRoot[]; errors: string[] } {
  let currentDir = process.cwd();
  const config = loadConfig();
  const dirSet = new Set<string>(config.cubeDirs.map((dir) => path.resolve(process.cwd(), dir)));

  while (true) {
    const targetFile = path.join(currentDir, '.npcubes');

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
      dirSet.add(currentDir);
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      break; // Stop when reaching the root
    }

    currentDir = parentDir;
  }

  const roots: CubeRoot[] = [...dirSet].map((dir) => ({ dir, source: { type: 'dir', dir } }));

  const { packages, errors } = resolveCubePackages(config.cubePackages);
  for (const pkg of packages) {
    for (const dir of pkg.dirs) {
      roots.push({ dir, source: { type: 'package', packageName: pkg.name, dir } });
    }
  }

  return { roots, errors };
}

/**
 * The directories {@link findCubeRoots} would scan.
 *
 * Kept for callers that only want the paths; anything that needs to attribute
 * a cube to where it came from should use `findCubeRoots` instead, which also
 * reports the errors this one drops.
 *
 * @returns Array of absolute paths to directories containing cubes
 */
export function findCubeDirectories(): string[] {
  return findCubeRoots().roots.map((root) => root.dir);
}

/**
 * Extracts cube ID from name pattern [id] or explicit id field
 */
function extractCubeId(manifest: Manifest): string | undefined {
  if (manifest.id) return manifest.id;
  const match = manifest.name.match(/^\[([^\]]+)\]/);
  return match ? match[1] : undefined;
}

/** A cube found on disk, before ids have been checked against each other. */
interface CubeCandidate {
  id: string;
  manifest: Manifest;
  dir: string;
  deployScript: string;
  source: CubeSource;
}

/** What one root directory contributed. */
interface ScanResult {
  root: CubeRoot;
  candidates: CubeCandidate[];
  errors: string[];
}

/**
 * Walks one root, collecting every cube below it.
 *
 * Deliberately does not decide anything about ids: a duplicate is only visible
 * once every root has been walked, and stopping the descent here would hide
 * whatever sits below the offending directory.
 */
async function scanDirectory(currentDir: string, result: ScanResult): Promise<void> {
  const entries = (await fs.readdir(currentDir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const files = entries.filter((e) => e.isFile());
  const manifestFile = files.find(
    (f) => f.name === 'manifest.mjs' || f.name.endsWith('.manifest.mjs')
  );
  const deployFile = files.find((f) => f.name === 'deploy.py' || f.name.endsWith('.deploy.py'));

  if (manifestFile && deployFile) {
    const manifestPath = path.join(currentDir, manifestFile.name);

    try {
      const manifest = (await import(manifestPath)).default as Manifest;

      if (!manifest || typeof manifest !== 'object') {
        result.errors.push(`Invalid manifest export in ${manifestPath}`);
      } else if (!manifest.name) {
        result.errors.push(`Invalid manifest format in ${manifestPath}: missing 'name'`);
      } else {
        const cubeId = extractCubeId(manifest) || path.basename(currentDir);

        // Ensure basic properties
        manifest.id = cubeId;
        manifest.schema = manifest.schema ?? z.object({});

        // A `secrets` entry naming a key that is not in the schema protects
        // nothing, and a typo in one is invisible at runtime — the value would
        // just be persisted. Cheaper to refuse the cube than to ship the leak.
        const unknown = (manifest.secrets ?? []).filter((key) => !(key in manifest.schema.shape));
        if (unknown.length > 0) {
          result.errors.push(
            `Invalid manifest in ${manifestPath}: 'secrets' names ${unknown.join(', ')}, ` +
              `which ${unknown.length === 1 ? 'is' : 'are'} not in the schema`
          );
        }

        result.candidates.push({
          id: cubeId,
          manifest,
          dir: currentDir,
          deployScript: deployFile.name,
          source: result.root.source,
        });
      }
    } catch (err) {
      result.errors.push(`Failed to load manifest ${manifestPath}: ${err}`);
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      await scanDirectory(path.join(currentDir, entry.name), result);
    }
  }
}

/**
 * The message a duplicate id produces. Aborts the run — see `nopy.main.ts`.
 *
 * There is deliberately no precedence rule to fall back on: two cubes claiming
 * one id are mutually exclusive, and the fix belongs upstream. So the message
 * has to carry everything needed to go and make it, which means naming every
 * claimant and how each got into the run.
 */
function duplicateError(id: string, group: CubeCandidate[]): string {
  const label = (candidate: CubeCandidate) =>
    candidate.source.type === 'package' ? `package ${candidate.source.packageName}` : 'directory';
  const width = Math.max(...group.map((candidate) => label(candidate).length));

  const where = group
    .map((candidate) => `  ${label(candidate).padEnd(width)}  ${candidate.dir}`)
    .join('\n');

  return (
    `Duplicate cube id '${id}' from ${group.length} sources:\n${where}\n` +
    `Rename one of them, or remove a source from .nopyrc.json.`
  );
}

/**
 * Loads all cubes from discovered cube directories.
 *
 * Scanning and id resolution are separate passes on purpose. Each root
 * contributes its own candidate list, and those lists are concatenated in
 * root order rather than in whichever order the concurrent scans happened to
 * finish — so which cube is reported as "the duplicate" is the same on every
 * run, which is what makes the hard error testable.
 */
export async function loadCubes(): Promise<LoadResult> {
  const { roots, errors: rootErrors } = findCubeRoots();
  registerResolveHook();

  const scans = await Promise.all(
    roots.map(async (root) => {
      const result: ScanResult = { root, candidates: [], errors: [] };
      if (fs.existsSync(root.dir)) {
        await scanDirectory(root.dir, result);
      }
      return result;
    })
  );

  // Promise.all preserves input order regardless of completion order.
  const errors = [...rootErrors, ...scans.flatMap((scan) => scan.errors)];

  // One directory reachable from two roots (a `cubeDirs` entry nested under a
  // `.npcubes` marker, say) is one cube seen twice, not a collision.
  const seenDirs = new Set<string>();
  const byId = new Map<string, CubeCandidate[]>();

  for (const candidate of scans.flatMap((scan) => scan.candidates)) {
    if (seenDirs.has(candidate.dir)) continue;
    seenDirs.add(candidate.dir);

    const group = byId.get(candidate.id);
    if (group) group.push(candidate);
    else byId.set(candidate.id, [candidate]);
  }

  const cubes: Record<string, Cube> = {};
  for (const [id, group] of byId) {
    if (group.length > 1) errors.push(duplicateError(id, group));
    // The map is still populated for the callers that only report; a duplicate
    // is fatal, so which candidate landed here never reaches a deploy.
    const [first] = group;
    cubes[id] = new Cube(first.manifest, first.dir, first.deployScript, first.source);
  }

  return { cubes, errors };
}

/**
 * Gets information about a single cube by name.
 */
export async function getCube(cubeName: string): Promise<Cube | undefined> {
  const { cubes } = await loadCubes();
  return cubes[cubeName];
}
