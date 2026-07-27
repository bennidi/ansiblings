/**
 * Workflow logic for interactive and replay modes
 * @module nopy.workflow
 */
import type { Cube } from './cubes/index.js';
import type { NopyConfig } from './nopy.config.js';
import { type NopySession } from './nopy.session.js';
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
export declare function runInteractiveWorkflow(cubes: Record<string, Cube>, config: NopyConfig, options?: WorkflowOptions): Promise<WorkflowResult>;
/**
 * Runs the replay workflow from a saved session file
 */
export declare function runReplayWorkflow(sessionPath: string, cubes: Record<string, Cube>, config: NopyConfig): Promise<WorkflowResult>;
/**
 * Runs replay workflow from a session object (from history)
 */
export declare function runSessionReplayWorkflow(session: NopySession, cubes: Record<string, Cube>, config: NopyConfig): Promise<WorkflowResult>;
/**
 * Determines the appropriate workflow based on options
 */
export declare function runWorkflow(sessionPath: string | undefined, cubes: Record<string, Cube>, config: NopyConfig, options?: WorkflowOptions, replaySession?: NopySession): Promise<WorkflowResult>;
