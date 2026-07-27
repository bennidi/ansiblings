/**
 * Cube discovery and loading from the filesystem
 * @module cubes/loader
 */
import { Cube, type LoadResult } from './types.js';
/**
 * Traverses upwards from the current working directory to the root
 * and collects all directories that contain a `.npcubes` marker file.
 *
 * Also includes directories specified in the `.nopyrc.json` configuration.
 *
 * @returns Array of absolute paths to directories containing cubes
 */
export declare function findCubeDirectories(): string[];
/**
 * Loads all cubes from discovered cube directories.
 */
export declare function loadCubes(): Promise<LoadResult>;
/**
 * Gets information about a single cube by name.
 */
export declare function getCube(cubeName: string): Promise<Cube | undefined>;
