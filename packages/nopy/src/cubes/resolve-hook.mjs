/**
 * A module resolve hook that lets a hand-written cube import the packages nopy
 * itself already has.
 *
 * A manifest is loaded with `import(manifestPath)`, so its imports resolve from
 * its own directory. A cube sitting in an arbitrary `cubeDirs` entry — no
 * package.json above it, no node_modules beside it — therefore cannot import
 * `@bitsquare/nopy-cube` or `zod` at all, and the run dies on
 * ERR_MODULE_NOT_FOUND before a single deploy is built.
 *
 * A published cube bundle never reaches this: it declares its own dependencies
 * and Node resolves them normally. This is for the local tree.
 *
 * Plain `.mjs` rather than TypeScript because the hook runs on its own thread,
 * loaded by Node directly from `dist` — there is no compile step in that path.
 *
 * @module cubes/resolve-hook
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * The specifiers worth rescuing: what a manifest legitimately needs and cannot
 * be expected to install for itself. Anything else stays a hard failure — a
 * cube that wants a library should depend on it.
 */
const FALLBACK_ROOTS = ['@bitsquare/nopy-cube', '@bitsquare/nopy', 'zod'];

/** @type {NodeRequire | undefined} */
let fallbackRequire;

/**
 * @param {{ from: string }} data - a URL inside the running CLI's own package,
 *   which is where the fallback resolution starts from.
 */
export function initialize(data) {
  fallbackRequire = createRequire(data.from);
}

/** True for `zod` and for subpaths like `zod/v4` or `@bitsquare/nopy/package.json`. */
function isCovered(specifier) {
  return FALLBACK_ROOTS.some((root) => specifier === root || specifier.startsWith(`${root}/`));
}

export async function resolve(specifier, context, next) {
  try {
    // Normal resolution first, always. A consumer that has its own copy
    // installed keeps using it, so the hook can never introduce version skew —
    // it only fills in for a lookup that was going to fail.
    return await next(specifier, context);
  } catch (error) {
    if (!fallbackRequire || !isCovered(specifier)) throw error;
    try {
      return { url: pathToFileURL(fallbackRequire.resolve(specifier)).href, shortCircuit: true };
    } catch {
      // The CLI cannot see it either. Report the original failure, which names
      // the importer rather than the CLI.
      throw error;
    }
  }
}
