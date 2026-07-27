/**
 * Workflow logic for interactive and replay modes
 * @module nopy.workflow
 */
import { getLogger } from '@logtape/logtape';
import { AuthSelection, CubeSelection, HostSelection, PasswordSelection } from './nopy.prompts.js';
import { createSession, loadSession } from './nopy.session.js';
const log = getLogger(['nopy', 'workflow']);
/**
 * Runs the interactive workflow for cube selection and configuration
 */
export async function runInteractiveWorkflow(cubes, config, options = {}) {
    const { useAuthKey } = options;
    // Step 1: Select cubes
    const { selectedCubes } = await CubeSelection(cubes);
    log.info('Selected cubes', { selectedCubes });
    if (selectedCubes.length === 0) {
        log.warn('No cubes selected');
    }
    // Step 2: Select host
    const host = await HostSelection(config.hosts);
    // Step 3: Select authentication
    const isLocalHost = host.includes('@vagrant') || host.includes('@docker');
    const authResult = isLocalHost
        ? { authMethod: 'ssh', username: undefined, password: undefined }
        : await AuthSelection(useAuthKey);
    // Create session
    const session = createSession({
        cubes: [], // Will be populated during build
        hosts: [host],
        auth: {
            method: authResult.authMethod,
            username: authResult.username,
        },
        env: config.env,
    });
    return {
        session,
        selectedCubes,
        authMethod: authResult.authMethod,
        username: authResult.username,
        password: authResult.password,
        isReplay: false,
    };
}
/**
 * Runs the replay workflow from a saved session file
 */
export async function runReplayWorkflow(sessionPath, cubes, config) {
    log.info('Loading session from', { path: sessionPath });
    const session = await loadSession(sessionPath);
    log.info('Session loaded', { name: session.name, cubeCount: session.cubes.length });
    // Validate cubes exist
    for (const cubeSession of session.cubes) {
        if (!cubes[cubeSession.key]) {
            log.warn(`Cube from session not found: ${cubeSession.key}`);
        }
    }
    // Handle missing hosts
    if (!session.hosts || session.hosts.length === 0) {
        log.info('No hosts in session, prompting for selection');
        const host = await HostSelection(config.hosts);
        session.hosts = [host];
    }
    // Extract auth details
    let authMethod = session.auth.method;
    let username = session.auth.username;
    let password;
    // Prompt for password if needed (passwords are never stored)
    if (authMethod === 'password') {
        if (username) {
            password = await PasswordSelection(username);
        }
        else {
            log.info('Password auth requires username, prompting');
            const authResult = await AuthSelection(false);
            authMethod = authResult.authMethod;
            username = authResult.username;
            password = authResult.password;
        }
    }
    // Target cubes are those in the session
    const selectedCubes = session.cubes.map((c) => c.key);
    return {
        session,
        selectedCubes,
        authMethod,
        username,
        password,
        isReplay: true,
    };
}
/**
 * Runs replay workflow from a session object (from history)
 */
export async function runSessionReplayWorkflow(session, cubes, config) {
    log.info('Replaying session from history', { cubeCount: session.cubes.length });
    // Validate cubes exist
    for (const cubeSession of session.cubes) {
        if (!cubes[cubeSession.key]) {
            log.warn(`Cube from session not found: ${cubeSession.key}`);
        }
    }
    // Handle missing hosts
    if (!session.hosts || session.hosts.length === 0) {
        log.info('No hosts in session, prompting for selection');
        const host = await HostSelection(config.hosts);
        session.hosts = [host];
    }
    // Extract auth details
    let authMethod = session.auth.method;
    let username = session.auth.username;
    let password;
    // Prompt for password if needed (passwords are never stored)
    if (authMethod === 'password') {
        if (username) {
            password = await PasswordSelection(username);
        }
        else {
            log.info('Password auth requires username, prompting');
            const authResult = await AuthSelection(false);
            authMethod = authResult.authMethod;
            username = authResult.username;
            password = authResult.password;
        }
    }
    // Target cubes are those in the session
    const selectedCubes = session.cubes.map((c) => c.key);
    return {
        session,
        selectedCubes,
        authMethod,
        username,
        password,
        isReplay: true,
    };
}
/**
 * Determines the appropriate workflow based on options
 */
export async function runWorkflow(sessionPath, cubes, config, options = {}, replaySession) {
    if (replaySession) {
        return runSessionReplayWorkflow(replaySession, cubes, config);
    }
    if (sessionPath) {
        return runReplayWorkflow(sessionPath, cubes, config);
    }
    return runInteractiveWorkflow(cubes, config, options);
}
