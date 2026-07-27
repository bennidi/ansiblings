/**
 * Session management for saving and replaying deployments
 * @module nopy.session
 */
import type { TVariables } from './nopy.common.js';
/**
 * Primitive value types that can be stored in session variables
 */
export type SessionValue = string | number | boolean | null | undefined;
/**
 * Record of session variables
 */
export type SessionVariables = Record<string, unknown>;
/**
 * Configuration for a single cube within a session
 */
export interface CubeSession {
    /** Cube identifier */
    key: string;
    /** Cube-specific variables */
    variables: TVariables;
}
/**
 * Authentication configuration for a session
 */
export interface AuthSession {
    /** Authentication method */
    method: 'ssh-key' | 'password' | 'ssh';
    /** Username for authentication (password auth only) */
    username?: string;
}
/**
 * Complete session configuration
 */
export interface NopySession {
    /** Optional session name */
    name?: string;
    /** Array of cube configurations */
    cubes: CubeSession[];
    /** Target hosts */
    hosts?: string[];
    /** Authentication configuration */
    auth: AuthSession;
    /** Global environment variables */
    env?: TVariables;
}
/**
 * Saves a session to a JSON file
 *
 * @param session - The session to save
 * @param filePath - Path to save the session file
 *
 * @example
 * ```typescript
 * saveSession(session, './my-deployment.nopysession.json');
 * ```
 */
export declare function saveSession(session: NopySession, filePath: string): void;
/**
 * Loads a session from a JSON or MJS file
 *
 * @param filePath - Path to the session file (.json or .mjs)
 * @returns The loaded session
 * @throws Error if file not found or invalid format
 *
 * @example
 * ```typescript
 * const session = await loadSession('./deployment.nopysession.json');
 * ```
 */
export declare function loadSession(filePath: string): Promise<NopySession>;
/**
 * Lists all session files in a directory
 *
 * @param dirPath - Directory to search for session files
 * @returns Array of session file paths
 */
export declare function listSessions(dirPath?: string): string[];
/**
 * Creates a session object from runtime data
 *
 * @param params - Session parameters
 * @returns A NopySession object
 */
export declare function createSession(params: {
    name?: string;
    cubes: CubeSession[];
    hosts: string[];
    auth: AuthSession;
    env?: TVariables;
}): NopySession;
/**
 * Filters out internal variables from cube variables
 *
 * Internal variables are those used by the prompts system
 * and should not be saved in session files.
 *
 * @param variables - Variables object
 * @returns Filtered variables without internal keys
 */
export declare function filterInternalVariables(variables: Record<string, unknown>): Record<string, unknown>;
/**
 * Separates environment variables from cube-specific variables
 *
 * @param allVariables - All variables including env and cube-specific
 * @param envVariables - Known environment variables from config
 * @returns Object with separate env and cube variables
 */
export declare function separateEnvAndCubeVariables(allVariables: Record<string, unknown>, envVariables: Record<string, unknown>): {
    env: Record<string, unknown>;
    cubeVars: Record<string, unknown>;
};
