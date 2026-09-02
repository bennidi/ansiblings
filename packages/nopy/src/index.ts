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
  CubePackageRef,
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
// Graceful exit
export {
  CANCELLED_EXIT_CODE,
  exitWithFarewell,
  FAREWELL,
  installGracefulExit,
  isCancellation,
  restoreTerminal,
} from './nopy.exit.js';
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
export type { InitFileResult, InitFileStatus, InitOptions } from './nopy.init.js';
// Project initialization
export { formatInitResults, GUIDE_FILENAME, initProject, STARTER_CONFIG } from './nopy.init.js';
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
export type {
  Channel,
  CommandRunner,
  PackageManager,
  SelfUpdateResult,
  UpdateCache,
  UpdateStatus,
} from './nopy.update.js';
// Update checking and self-update
export {
  buildSelfUpdateCommand,
  channelForVersion,
  checkForUpdate,
  DEFAULT_CHECK_INTERVAL_MS,
  detectPackageManager,
  fetchChannelVersion,
  formatCommand,
  formatUpdateNotice,
  getUpdateCachePath,
  isUpdateCheckDisabled,
  NPMJS_REGISTRY,
  normalizeRegistry,
  PACKAGE_NAME,
  readUpdateCache,
  resolveRegistry,
  selfUpdate,
  updateNotice,
  writeUpdateCache,
} from './nopy.update.js';
export type { WorkflowOptions, WorkflowResult } from './nopy.workflow.js';
// Workflow
export {
  runInteractiveWorkflow,
  runReplayWorkflow,
  runSessionReplayWorkflow,
  runWorkflow,
} from './nopy.workflow.js';
