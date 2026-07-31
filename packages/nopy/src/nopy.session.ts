/**
 * Session management for saving and replaying deployments
 * @module nopy.session
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TVariables } from './nopy.common.js';
import { NopyUsageError } from './nopy.errors.js';

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
  /**
   * Authentication method.
   *
   * `ssh` is not a third kind of credential — it means the connector owns
   * authentication and nopy supplies none. It is what an `@vagrant/` or
   * `@docker/` host gets, and nothing prompts for it.
   */
  method: 'ssh-key' | 'password' | 'ssh';
  /** Username for authentication (password auth only) */
  username?: string;
  // Note: password is intentionally excluded for security
}

/**
 * Complete session configuration
 *
 * Everything but `cubes` and `auth` is optional, because a hand-written session
 * is a first-class one — the loader requires exactly what it cannot work without.
 * `version`, `timestamp` and `name` are stamped on every session nopy writes and
 * never demanded of one it reads.
 */
export interface NopySession {
  /**
   * Format version of the file. Absent on every session written before this was
   * stamped, and on most hand-written ones.
   */
  version?: string;
  /** ISO 8601 time the session was created */
  timestamp?: string;
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
 * The format version stamped into every session nopy writes.
 *
 * There is one, and nothing yet reads it to decide anything — it exists so that
 * a future change to the shape can tell an old file from a new one, which is
 * impossible after the fact.
 */
export const SESSION_VERSION = '1.0.0';

/**
 * A one-line description of a session: `YYYY-MM-DD HH:mm - cubes → hosts`.
 *
 * Shared with the history list, which is where the format comes from — the two
 * name the same thing and there is no reason for them to disagree.
 */
export function describeSession(session: NopySession, timestamp: string): string {
  const dateStr = new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const cubeNames = session.cubes.map((c) => c.key).join(', ');
  const truncatedCubes = cubeNames.length > 40 ? `${cubeNames.substring(0, 37)}...` : cubeNames;

  const hosts = session.hosts?.join(', ') || 'no host';
  const truncatedHosts = hosts.length > 20 ? `${hosts.substring(0, 17)}...` : hosts;

  return `${dateStr} - ${truncatedCubes} → ${truncatedHosts}`;
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
export function saveSession(session: NopySession, filePath: string): void {
  const sessionToSave = {
    ...session,
  };

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(sessionToSave, null, 2), 'utf-8');
}

/**
 * Loads a session from an MJS file
 *
 * @param filePath - Path to the MJS session file
 * @returns The loaded session
 */
async function loadSessionFromMJS(filePath: string): Promise<NopySession> {
  const absolutePath = path.resolve(filePath);
  const fileUrl = `file://${absolutePath}`;

  try {
    const module = (await import(fileUrl)) as { default?: NopySession };
    const session = module.default;

    if (!session) {
      throw new Error('MJS file must export a default object');
    }

    return session;
  } catch (error) {
    throw new Error(
      `Failed to load MJS session: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Loads a session from a JSON file
 *
 * @param filePath - Path to the JSON session file
 * @returns The loaded session
 */
function loadSessionFromJSON(filePath: string): NopySession {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as NopySession;
}

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
export async function loadSession(filePath: string): Promise<NopySession> {
  if (!fs.existsSync(filePath)) {
    throw new NopyUsageError(`Session file not found: ${filePath}`);
  }

  const ext = path.extname(filePath);
  let session: NopySession;

  if (ext === '.mjs') {
    session = await loadSessionFromMJS(filePath);
  } else if (ext === '.json') {
    session = loadSessionFromJSON(filePath);
  } else {
    throw new NopyUsageError(`Unsupported session file format: ${ext}. Use .json or .mjs`);
  }

  // Validate required fields
  if (!session.cubes || !Array.isArray(session.cubes)) {
    throw new NopyUsageError('Invalid session format: missing or invalid "cubes" field');
  }
  if (session.hosts && !Array.isArray(session.hosts)) {
    throw new NopyUsageError('Invalid session format: invalid "hosts" field');
  }
  if (!session.auth) {
    throw new NopyUsageError('Invalid session format: missing "auth" field');
  }

  // A version this build does not know is a warning, never a refusal: the file
  // may well still load, and a session is often the only record of a deployment.
  // A missing version says nothing at all — it predates the stamp.
  if (session.version !== undefined && session.version !== SESSION_VERSION) {
    console.error(
      `Warning: session "${filePath}" declares version ${session.version}; ` +
        `this build writes ${SESSION_VERSION}. Loading it anyway.`
    );
  }

  return session;
}

/**
 * Suffixes {@link listSessions} recognises.
 *
 * `.nopysession.*` is the documented name and the one the README's examples use;
 * it was not matched at all, because `wild.nopysession.json` does not end in
 * `.session.json` — the dot before `session` is part of the suffix. The shorter
 * pair stays recognised: `saveSession` writes whatever path it is given, so
 * files under the old name exist and there is no reason to stop finding them.
 */
const SESSION_SUFFIXES = ['.nopysession.json', '.nopysession.mjs', '.session.json', '.session.mjs'];

/**
 * Lists all session files in a directory
 *
 * @param dirPath - Directory to search for session files
 * @returns Array of session file paths
 */
export function listSessions(dirPath: string = process.cwd()): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath);
  return files
    .filter((file) => SESSION_SUFFIXES.some((suffix) => file.endsWith(suffix)))
    .map((file) => path.join(dirPath, file));
}

/**
 * Creates a session object from runtime data
 *
 * @param params - Session parameters
 * @returns A NopySession object
 */
export function createSession(params: {
  name?: string;
  cubes: CubeSession[];
  hosts: string[];
  auth: AuthSession;
  env?: TVariables;
  /** Overrides the creation time; for tests, and for re-stamping a replay. */
  timestamp?: string;
}): NopySession {
  return {
    version: SESSION_VERSION,
    timestamp: params.timestamp ?? new Date().toISOString(),
    name: params.name,
    cubes: params.cubes,
    hosts: params.hosts,
    auth: params.auth,
    env: params.env,
  };
}
