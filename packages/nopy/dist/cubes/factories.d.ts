/**
 * Factory functions for creating cube configurations
 * @module cubes/factories
 */
import { Manifest } from './types.js';
/**
 * Creates a manifest configuration for a cube
 *
 * @param opts - Manifest options including name, schema, dependencies, and hooks
 * @returns Manifest configuration object
 */
export declare function createManifest<Schema extends import('zod').z.AnyZodObject>(opts: Pick<Manifest<Schema>, 'name'> & Partial<Omit<Manifest<Schema>, 'name'>>): Manifest<Schema>;
/**
 * Alias for createManifest - for backwards compatibility with existing manifests
 */
export declare const manifest: typeof createManifest;
/**
 * @deprecated Use createManifest or manifest instead
 */
export declare const ManifestFactory: typeof createManifest;
export { Manifest } from './types.js';
