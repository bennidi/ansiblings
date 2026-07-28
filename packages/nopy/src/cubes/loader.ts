/**
 * Cube discovery and loading from the filesystem
 * @module cubes/loader
 */

import path from 'node:path';
import { z } from 'zod';
import { fs } from 'zx';
import { loadConfig } from '../nopy.config.js';
import { Cube, type LoadResult, type Manifest } from './types.js';

/**
 * Traverses upwards from the current working directory to the root
 * and collects all directories that contain a `.npcubes` marker file.
 *
 * Also includes directories specified in the `.nopyrc.json` configuration.
 *
 * @returns Array of absolute paths to directories containing cubes
 */
export function findCubeDirectories(): string[] {
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

  return [...dirSet];
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
}

/** What one root directory contributed. */
interface ScanResult {
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

        result.candidates.push({
          id: cubeId,
          manifest,
          dir: currentDir,
          deployScript: deployFile.name,
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

/** The message a duplicate id produces. Aborts the run — see `nopy.main.ts`. */
function duplicateError(id: string, group: CubeCandidate[]): string {
  const where = group.map((c) => `  ${c.dir}`).join('\n');
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
  const cubesFolders = findCubeDirectories();

  const scans = await Promise.all(
    cubesFolders.map(async (folder) => {
      const result: ScanResult = { candidates: [], errors: [] };
      if (fs.existsSync(folder)) {
        await scanDirectory(folder, result);
      }
      return result;
    })
  );

  // Promise.all preserves input order regardless of completion order.
  const errors = scans.flatMap((scan) => scan.errors);

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
    cubes[id] = new Cube(first.manifest, first.dir, first.deployScript);
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
