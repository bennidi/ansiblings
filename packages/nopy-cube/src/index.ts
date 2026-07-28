/**
 * @bitsquare/nopy-cube — the authoring surface for nopy cubes.
 *
 * Everything a `manifest.mjs` needs and nothing else: no CLI, no prompts, no
 * process spawning. `@bitsquare/nopy` re-exports all of it, so a manifest can
 * import from either package.
 *
 * @packageDocumentation
 */

export {
  createManifest,
  ManifestFactory,
  manifest,
} from './factories.js';
export type {
  AnyObjectSchema,
  CubeSource,
  CubeVariables,
  DependencySpec,
  Hook,
  HookContext,
  LoadResult,
} from './types.js';
export {
  Cube,
  Manifest,
  zodInner,
  zodKind,
} from './types.js';
export { uniqid } from './utils.js';
