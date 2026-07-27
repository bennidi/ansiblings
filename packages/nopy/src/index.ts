/**
 * Nopy - A CLI tool for pyinfra script management and execution
 *
 * @packageDocumentation
 */

// Cubes module
export * from './cubes/index.js';

// Backwards compatibility - cubes namespace
export { cubes } from './nopy.cubes.js';

// Main entry point
export { nopy } from './nopy.main.js';
export type { NopyOptions, NopyResult } from './nopy.main.js';

// Executor
export {
  executeDeployCalls,
  outputExecutionPlan,
  summarizeResults,
} from './nopy.executor.js';
export type {
  DeployCall,
  ExecutionResult,
  ExecutionOptions,
} from './nopy.executor.js';

// Workflow
export {
  runWorkflow,
  runInteractiveWorkflow,
  runReplayWorkflow,
  runSessionReplayWorkflow,
} from './nopy.workflow.js';
export type { WorkflowOptions, WorkflowResult } from './nopy.workflow.js';

// Prompts
export {
  CubeSelection,
  AuthSelection,
  HostSelection,
  VariableAssignment,
  PasswordSelection,
} from './nopy.prompts.js';

// Session management
export {
  loadSession,
  saveSession,
  createSession,
  listSessions,
  filterInternalVariables,
  separateEnvAndCubeVariables,
} from './nopy.session.js';
export type { NopySession, CubeSession, AuthSession } from './nopy.session.js';

// History management
export {
  loadHistory,
  saveHistory,
  addToHistory,
  getLastSession,
  getSessionById,
  listHistory,
  clearHistory,
  removeFromHistory,
  formatHistoryList,
  getHistoryPath,
  DEFAULT_HISTORY_SIZE,
  HISTORY_FILE,
} from './nopy.history.js';
export type { HistoryEntry, SessionHistory } from './nopy.history.js';

// Configuration
export { loadConfig, saveConfig, logConfigToFlags, getConfigPaths } from './nopy.config.js';
export type {
  NopyConfig,
  NopyConfigFile,
  LogConfig,
  LogVerbosity,
  HistoryConfig,
  ExecutionConfig,
  ResolutionStrategy,
  ResolutionConfig,
} from './nopy.config.js';
