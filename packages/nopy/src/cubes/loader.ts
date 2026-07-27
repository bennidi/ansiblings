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

/**
 * Loads all cubes from discovered cube directories.
 */
export async function loadCubes(): Promise<LoadResult> {
  const cubesFolders = findCubeDirectories();
  const cubes: Record<string, Cube> = {};
  const errors: string[] = [];

  async function scanDirectory(currentDir: string, baseDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    const files = entries.filter((e) => e.isFile());
    const manifestFile = files.find(
      (f) => f.name === 'manifest.mjs' || f.name.endsWith('.manifest.mjs')
    );
    const deployFile = files.find((f) => f.name === 'deploy.py' || f.name.endsWith('.deploy.py'));

    if (manifestFile && deployFile) {
      const cubePath = currentDir;
      const manifestPath = path.join(cubePath, manifestFile.name);

      try {
        const manifest = (await import(manifestPath)).default as Manifest;

        if (!manifest || typeof manifest !== 'object') {
          errors.push(`Invalid manifest export in ${manifestPath}`);
        } else if (!manifest.name) {
          errors.push(`Invalid manifest format in ${manifestPath}: missing 'name'`);
        } else {
          const cubeId = extractCubeId(manifest) || path.basename(cubePath);
          
          if (cubes[cubeId]) {
            errors.push(`Duplicate cube id '${cubeId}'`);
            return;
          }

          // Ensure basic properties
          manifest.id = cubeId;
          manifest.schema = manifest.schema ?? z.object({});

          cubes[cubeId] = new Cube(manifest, cubePath, deployFile.name);
        }
      } catch (err) {
        errors.push(`Failed to load manifest ${manifestPath}: ${err}`);
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await scanDirectory(path.join(currentDir, entry.name), baseDir);
      }
    }
  }

  await Promise.all(
    cubesFolders.map(async (folder) => {
      if (fs.existsSync(folder)) {
        await scanDirectory(folder, folder);
      }
    })
  );

  return { cubes, errors };
}

/**
 * Gets information about a single cube by name.
 */
export async function getCube(cubeName: string): Promise<Cube | undefined> {
  const { cubes } = await loadCubes();
  return cubes[cubeName];
}
