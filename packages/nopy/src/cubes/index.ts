/**
 * Nopy Cubes Module
 *
 * Self-contained deployment units for pyinfra automation.
 *
 * @module cubes
 */

// The authoring surface lives in its own package so that a cube bundle can
// depend on it without pulling the CLI in. Re-exported here so that
// `import { cubes } from '@bitsquare/nopy'` in a manifest keeps working.
export type {
  AnyObjectSchema,
  CubeSource,
  CubeVariables,
  DependencySpec,
  Hook,
  HookContext,
  LoadResult,
} from '@bitsquare/nopy-cubes';
export {
  Cube,
  createManifest,
  Manifest,
  manifest,
  uniqid,
  zodInner,
  zodKind,
} from '@bitsquare/nopy-cubes';
// Dependencies
export { BuildContext } from './dependencies.js';
// Loader
export type { CubeRoot } from './loader.js';
export {
  findCubeDirectories,
  findCubeRoots,
  getCube,
  loadCubes,
} from './loader.js';
// Packages
export type { CubePackage } from './packages.js';
export { resolveCubePackages } from './packages.js';
