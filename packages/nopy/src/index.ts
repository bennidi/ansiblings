/**
 * Nopy - A CLI tool for pyinfra script management and execution
 *
 * @packageDocumentation
 */

// Cubes module
export * from './cubes/index.js';
export type { Assignment, Origin, TVariables, Value } from './nopy.common.js';
// Variables
export { MASK, Variable, Variables } from './nopy.common.js';
export type {
  ExecutionConfig,
  HistoryConfig,
  LogConfig,
  LogVerbosity,
  NopyConfig,
  NopyConfigFile,
  ResolutionConfig,
  ResolutionStrategy,
} from './nopy.config.js';
// Configuration
export { getConfigPaths, loadConfig, logConfigToFlags, saveConfig } from './nopy.config.js';
// Backwards compatibility - cubes namespace
export { cubes } from './nopy.cubes.js';
export type {
  DeployCall,
  ExecutionOptions,
  ExecutionResult,
} from './nopy.executor.js';
// Executor
export {
  executeDeployCalls,
  maskCommand,
  maskVariables,
  outputExecutionPlan,
  summarizeResults,
} from './nopy.executor.js';
export type { HistoryEntry, SessionHistory } from './nopy.history.js';
// History management
export {
  addToHistory,
  clearHistory,
  DEFAULT_HISTORY_SIZE,
  formatHistoryList,
  getHistoryPath,
  getLastSession,
  getSessionById,
  HISTORY_FILE,
  listHistory,
  loadHistory,
  removeFromHistory,
  saveHistory,
} from './nopy.history.js';
export type { NopyOptions, NopyResult } from './nopy.main.js';
// Main entry point
export { nopy } from './nopy.main.js';
// Prompts
export {
  AuthSelection,
  CubeSelection,
  HostSelection,
  PasswordSelection,
  VariableAssignment,
} from './nopy.prompts.js';
export type { AuthSession, CubeSession, NopySession } from './nopy.session.js';
// Session management
export { createSession, listSessions, loadSession, saveSession } from './nopy.session.js';
export type { WorkflowOptions, WorkflowResult } from './nopy.workflow.js';
// Workflow
export {
  runInteractiveWorkflow,
  runReplayWorkflow,
  runSessionReplayWorkflow,
  runWorkflow,
} from './nopy.workflow.js';
