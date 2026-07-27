/**
 * Dynamic dependency resolution for cubes
 * @module cubes/dependencies
 */
import type { Variables } from '../nopy.common.js';
import type { NopyConfig } from '../nopy.config.js';
import type { DeployCall } from '../nopy.executor.js';
import { type CubeSession, type NopySession } from '../nopy.session.js';
import type { Cube, CubeVariables } from './types.js';
/**
 * Context for the resolution process
 */
export declare class BuildContext {
    readonly allCubes: Record<string, Cube>;
    readonly variables: Variables;
    readonly session: NopySession;
    readonly config: NopyConfig;
    readonly auth: {
        method: string;
        username?: string;
        password?: string;
    };
    readonly options: {
        useDefaults?: boolean;
        isSessionReplay?: boolean;
    };
    readonly deployCalls: DeployCall[];
    readonly cubeSessions: CubeSession[];
    private readonly resolvedCubes;
    constructor(allCubes: Record<string, Cube>, variables: Variables, session: NopySession, config: NopyConfig, auth: {
        method: string;
        username?: string;
        password?: string;
    }, options?: {
        useDefaults?: boolean;
        isSessionReplay?: boolean;
    });
    /**
     * Resolves a cube, its dependencies, and hooks recursively
     */
    resolveCube(cubeId: string, host: string, overrides?: CubeVariables): Promise<void>;
    /**
     * Builds and stores a deployment call for a resolved cube
     */
    private buildDeployCall;
}
