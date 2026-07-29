#!/usr/bin/env node
export { loadConfig, resolveConfigPaths } from './keyman.config.js';
export * from './keyman.main.js';
export type {
  Channel,
  CommandRunner,
  PackageManager,
  SelfUpdateResult,
  UpdateCache,
  UpdateStatus,
} from './keyman.update.js';
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
} from './keyman.update.js';
