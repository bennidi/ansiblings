/**
 * Backwards compatibility re-export
 *
 * This file maintains the `cubes` namespace for existing code.
 * New code should import directly from './cubes/index.js'
 *
 * @deprecated Import from './cubes/index.js' instead
 */
import * as cubesModule from './cubes/index.js';
export declare const cubes: {
    Cube: typeof cubesModule.Cube;
    Manifest: typeof cubesModule.Manifest;
    createManifest: typeof cubesModule.createManifest;
    manifest: typeof cubesModule.createManifest;
    loadCubes: typeof cubesModule.loadCubes;
    getCube: typeof cubesModule.getCube;
    BuildContext: typeof cubesModule.BuildContext;
    uniqid: typeof cubesModule.uniqid;
    load: typeof cubesModule.loadCubes;
    findCubeDirectories: typeof cubesModule.findCubeDirectories;
};
export type { Hook, HookContext, Cube, Manifest, LoadResult, CubeVariables, } from './cubes/index.js';
