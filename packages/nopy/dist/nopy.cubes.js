/**
 * Backwards compatibility re-export
 *
 * This file maintains the `cubes` namespace for existing code.
 * New code should import directly from './cubes/index.js'
 *
 * @deprecated Import from './cubes/index.js' instead
 */
import * as cubesModule from './cubes/index.js';
export const cubes = {
    // Runtime exports
    ...cubesModule,
    // Aliases for backwards compatibility
    load: cubesModule.loadCubes,
    findCubeDirectories: cubesModule.findCubeDirectories,
};
