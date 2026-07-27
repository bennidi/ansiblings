/**
 * Session management for saving and replaying deployments
 * @module nopy.session
 */
import fs from 'node:fs';
import path from 'node:path';
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
export function saveSession(session, filePath) {
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
async function loadSessionFromMJS(filePath) {
    const absolutePath = path.resolve(filePath);
    const fileUrl = `file://${absolutePath}`;
    try {
        const module = (await import(fileUrl));
        const session = module.default;
        if (!session) {
            throw new Error('MJS file must export a default object');
        }
        return session;
    }
    catch (error) {
        throw new Error(`Failed to load MJS session: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Loads a session from a JSON file
 *
 * @param filePath - Path to the JSON session file
 * @returns The loaded session
 */
function loadSessionFromJSON(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
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
export async function loadSession(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Session file not found: ${filePath}`);
    }
    const ext = path.extname(filePath);
    let session;
    if (ext === '.mjs') {
        session = await loadSessionFromMJS(filePath);
    }
    else if (ext === '.json') {
        session = loadSessionFromJSON(filePath);
    }
    else {
        throw new Error(`Unsupported session file format: ${ext}. Use .json or .mjs`);
    }
    // Validate required fields
    if (!session.cubes || !Array.isArray(session.cubes)) {
        throw new Error('Invalid session format: missing or invalid "cubes" field');
    }
    if (session.hosts && !Array.isArray(session.hosts)) {
        throw new Error('Invalid session format: invalid "hosts" field');
    }
    if (!session.auth) {
        throw new Error('Invalid session format: missing "auth" field');
    }
    return session;
}
/**
 * Lists all session files in a directory
 *
 * @param dirPath - Directory to search for session files
 * @returns Array of session file paths
 */
export function listSessions(dirPath = process.cwd()) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }
    const files = fs.readdirSync(dirPath);
    return files
        .filter((file) => file.endsWith('.session.json') || file.endsWith('.session.mjs'))
        .map((file) => path.join(dirPath, file));
}
/**
 * Creates a session object from runtime data
 *
 * @param params - Session parameters
 * @returns A NopySession object
 */
export function createSession(params) {
    return {
        name: params.name,
        cubes: params.cubes,
        hosts: params.hosts,
        auth: params.auth,
        env: params.env,
    };
}
/**
 * Filters out internal variables from cube variables
 *
 * Internal variables are those used by the prompts system
 * and should not be saved in session files.
 *
 * @param variables - Variables object
 * @returns Filtered variables without internal keys
 */
export function filterInternalVariables(variables) {
    const internalKeys = ['customize'];
    const filtered = {};
    for (const [key, value] of Object.entries(variables)) {
        if (!internalKeys.includes(key)) {
            filtered[key] = value;
        }
    }
    return filtered;
}
/**
 * Separates environment variables from cube-specific variables
 *
 * @param allVariables - All variables including env and cube-specific
 * @param envVariables - Known environment variables from config
 * @returns Object with separate env and cube variables
 */
export function separateEnvAndCubeVariables(allVariables, envVariables) {
    const env = {};
    const cubeVars = {};
    for (const [key, value] of Object.entries(allVariables)) {
        if (key in envVariables) {
            env[key] = value;
        }
        else {
            cubeVars[key] = value;
        }
    }
    return { env, cubeVars };
}
