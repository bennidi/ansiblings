/**
 * Project initialization — `nopy init`
 * @module nopy.init
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILENAME, type NopyConfigFile } from './nopy.config.js';

/** The LLM-facing usage guide `init` drops next to the config. */
export const GUIDE_FILENAME = 'NOPY.LLM.md';

/**
 * What a fresh project starts from. `cubePackages` stays empty on purpose:
 * naming a bundle is a hard error until it is installed, and `init` must leave
 * behind a config that loads.
 */
export const STARTER_CONFIG: NopyConfigFile = {
  hosts: [],
  cubeDirs: ['./cubes'],
  cubePackages: [],
  env: {},
  log: {
    verbosity: 'info',
    debug: false,
  },
};

/**
 * The bundled guide, resolved relative to this module so the same path works
 * from `src/` (tsx, vitest) and from `dist/` (the build copies `src/templates`
 * alongside the compiled module).
 */
const TEMPLATE_URL = new URL('./templates/NOPY.LLM.md', import.meta.url);

export type InitFileStatus = 'created' | 'overwritten' | 'skipped';

/** One file `init` considered, and what happened to it. */
export interface InitFileResult {
  /** Basename, for reporting. */
  file: string;
  /** Absolute path that was written or left alone. */
  path: string;
  status: InitFileStatus;
}

export interface InitOptions {
  /** Overwrite files that already exist. */
  force?: boolean;
  /** Target directory (defaults to the working directory). */
  dir?: string;
}

/**
 * Writes `filePath` unless it already exists and `force` is unset, and says
 * which of the three it was. Shared with `create-cube`, which scaffolds under
 * the same skip/overwrite rules.
 */
export function writeGuarded(filePath: string, content: string, force: boolean): InitFileResult {
  const existed = fs.existsSync(filePath);
  if (existed && !force) {
    return { file: path.basename(filePath), path: filePath, status: 'skipped' };
  }
  fs.writeFileSync(filePath, content);
  return {
    file: path.basename(filePath),
    path: filePath,
    status: existed ? 'overwritten' : 'created',
  };
}

/**
 * Writes a starter `.nopyrc.json` and the bundled `NOPY.LLM.md` guide into
 * `dir`. Existing files are left alone unless `force` is set; either way the
 * result names what happened to each file.
 */
export function initProject(options: InitOptions = {}): InitFileResult[] {
  const dir = options.dir ?? process.cwd();
  const force = options.force ?? false;

  const config = `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`;
  const guide = fs.readFileSync(fileURLToPath(TEMPLATE_URL), 'utf-8');

  return [
    writeGuarded(path.join(dir, CONFIG_FILENAME), config, force),
    writeGuarded(path.join(dir, GUIDE_FILENAME), guide, force),
  ];
}

/**
 * The report `nopy init` prints, one line per file plus a next-steps hint.
 * Lives here rather than in the CLI because the CLI is excluded from coverage.
 */
export function formatInitResults(results: InitFileResult[]): string {
  const lines = results.map((result) =>
    result.status === 'skipped'
      ? `  exists, skipped  ${result.file} (use --force to overwrite)`
      : `  ${result.status.padEnd(15)}  ${result.file}`
  );

  lines.push(
    '',
    'Next steps:',
    `  1. Add target hosts to "hosts" in ${CONFIG_FILENAME}`,
    '  2. Put cubes in ./cubes, or install a bundle and list it under "cubePackages"',
    '  3. Run `nopy` to deploy — NOPY.LLM.md explains the rest'
  );

  return lines.join('\n');
}
