/**
 * Workflow logic for interactive and replay modes
 * @module nopy.workflow
 */

import { getLogger } from '@logtape/logtape';
import type { Cube } from './cubes/index.js';
import type { NopyConfig } from './nopy.config.js';
import { AuthSelection, CubeSelection, HostSelection, PasswordSelection } from './nopy.prompts.js';
import { type AuthSession, createSession, loadSession, type NopySession } from './nopy.session.js';

const log = getLogger(['nopy', 'workflow']);

/**
 * Options for workflow execution
 */
export interface WorkflowOptions {
  /** Use defaults without prompting */
  useDefaults?: boolean;
  /** Force SSH key authentication */
  useAuthKey?: boolean;
}

/**
 * Result of running a workflow
 */
export interface WorkflowResult {
  /** The session configuration */
  session: NopySession;
  /** Target cubes selected for execution */
  selectedCubes: string[];
  /** Authentication method used */
  authMethod: string;
  /** Username if applicable */
  username?: string;
  /** Password if applicable */
  password?: string;
  /** Whether this is a session replay */
  isReplay: boolean;
}

/**
 * Runs the interactive workflow for cube selection and configuration
 */
export async function runInteractiveWorkflow(
  cubes: Record<string, Cube>,
  config: NopyConfig,
  options: WorkflowOptions = {}
): Promise<WorkflowResult> {
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
    ? { authMethod: 'ssh' as const, username: undefined, password: undefined }
    : await AuthSelection(useAuthKey);

  // Create session
  const session = createSession({
    cubes: [], // Will be populated during build
    hosts: [host],
    auth: {
      method: authResult.authMethod as AuthSession['method'],
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
export async function runReplayWorkflow(
  sessionPath: string,
  cubes: Record<string, Cube>,
  config: NopyConfig
): Promise<WorkflowResult> {
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
  let password: string | undefined;

  // Prompt for password if needed (passwords are never stored)
  if (authMethod === 'password') {
    if (username) {
      password = await PasswordSelection(username);
    } else {
      log.info('Password auth requires username, prompting');
      const authResult = await AuthSelection(false);
      authMethod = authResult.authMethod as AuthSession['method'];
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
export async function runSessionReplayWorkflow(
  session: NopySession,
  cubes: Record<string, Cube>,
  config: NopyConfig
): Promise<WorkflowResult> {
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
  let password: string | undefined;

  // Prompt for password if needed (passwords are never stored)
  if (authMethod === 'password') {
    if (username) {
      password = await PasswordSelection(username);
    } else {
      log.info('Password auth requires username, prompting');
      const authResult = await AuthSelection(false);
      authMethod = authResult.authMethod as AuthSession['method'];
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
export async function runWorkflow(
  sessionPath: string | undefined,
  cubes: Record<string, Cube>,
  config: NopyConfig,
  options: WorkflowOptions = {},
  replaySession?: NopySession
): Promise<WorkflowResult> {
  if (replaySession) {
    return runSessionReplayWorkflow(replaySession, cubes, config);
  }
  if (sessionPath) {
    return runReplayWorkflow(sessionPath, cubes, config);
  }
  return runInteractiveWorkflow(cubes, config, options);
}
