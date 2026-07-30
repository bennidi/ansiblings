/**
 * The library surface — `exports["."]`, imported and never executed, which is why
 * it no longer carries the bin's shebang (AUDIT §4.1). The bin is
 * `dist/keyman.cli.js`.
 *
 * Deliberately narrow: config resolution, the update machinery, and `keyman()` to
 * run the menu. The operation modules stay internal — every one of them prompts,
 * prints and spawns, so there is nothing to do with a single one except reproduce
 * the menu around it (§4.3). The update module is re-exported wholesale rather
 * than by name list, because the list had drifted to half of it (§4.4).
 */
export type { KeymanConfig, KeymanConfigFile } from './keyman.config.js';
export { describeConfig, loadConfig, resolveConfigPaths } from './keyman.config.js';
export * from './keyman.main.js';
export * from './keyman.update.js';
