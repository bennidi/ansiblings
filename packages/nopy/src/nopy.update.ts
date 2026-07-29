/**
 * Update checking and self-update for the nopy CLI
 *
 * The channel a user is on is never stored anywhere — it is derived from the
 * version they are running, which is the one piece of state that is always
 * correct. A `-main.` prerelease came from the snapshot workflow, any other
 * prerelease came out under `next`, and a clean version came out under
 * `latest`. Upgrading therefore keeps you on the channel you installed from
 * instead of silently moving you to a different one.
 *
 * @module nopy.update
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import semver from 'semver';

/** The published package this CLI ships as */
export const PACKAGE_NAME = '@bitsquare/nopy';

/** The npm scope the package lives under, used for the registry config key */
export const SCOPE = '@bitsquare';

/** Where packages resolve from when nothing says otherwise */
export const NPMJS_REGISTRY = 'https://registry.npmjs.org/';

/** Directory under the user's home holding the update-check cache */
export const UPDATE_CACHE_DIR = '.nopy';

/** File name of the update-check cache */
export const UPDATE_CACHE_FILE = 'update-check.json';

/** How long a cached check is considered fresh */
export const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How long the background check may block the CLI.
 *
 * Short on purpose: this runs before the first prompt, so a slow or
 * unreachable registry has to cost a moment, not a session.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 1500;

/** How long `npm config get` may take before the registry falls back to npmjs */
export const DEFAULT_CONFIG_TIMEOUT_MS = 5000;

/**
 * A dist-tag this project publishes under.
 *
 * `latest` is a release, `next` a prerelease (`0.6.0-rc.1`), `main` a snapshot
 * built from a commit on `main` and published to Gitea only.
 */
export type Channel = 'latest' | 'next' | 'main';

/** A package manager that can install a global binary */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Runs a command and resolves with its trimmed stdout */
export type CommandRunner = (file: string, args: string[]) => Promise<string>;

/** The result of an update check */
export interface UpdateStatus {
  /** The version currently running */
  current: string;
  /** The version the channel points at, or null if it could not be determined */
  latest: string | null;
  /** The channel the current version implies */
  channel: Channel;
  /** The registry the check went to */
  registry: string;
  /** Whether `latest` is strictly newer than `current` */
  updateAvailable: boolean;
  /** Whether the answer came from cache rather than the network */
  fromCache: boolean;
}

/** The on-disk update-check cache */
export interface UpdateCache {
  /** ISO timestamp of the check */
  checkedAt: string;
  /** The channel that was checked */
  channel: Channel;
  /** The registry that was checked */
  registry: string;
  /** The version the channel pointed at, or null if the lookup found nothing */
  latest: string | null;
}

/**
 * Derives the release channel from a version string.
 *
 * @param version - a semver version, typically this package's own
 * @returns the dist-tag that version would have been published under
 */
export function channelForVersion(version: string): Channel {
  const parsed = semver.parse(version, { loose: true });

  // An unparseable version is treated as a release: the worst case is that a
  // check goes to `latest` and finds nothing newer.
  if (!parsed || parsed.prerelease.length === 0) {
    return 'latest';
  }

  return parsed.prerelease.some((part) => part === 'main') ? 'main' : 'next';
}

/**
 * Normalises a registry URL to the trailing-slash form the packument path is
 * appended to.
 */
export function normalizeRegistry(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** Runs a command through execa and returns its stdout */
const defaultRunner: CommandRunner = async (file, args) => {
  const { stdout } = await execa(file, args, { timeout: DEFAULT_CONFIG_TIMEOUT_MS });
  return stdout;
};

/**
 * Resolves the registry `@bitsquare` packages come from.
 *
 * `NOPY_REGISTRY` wins, then npm's own scoped-registry config — asking npm is
 * what makes a global install from Gitea check Gitea for its updates without
 * anything else being configured — and npmjs is the fallback.
 *
 * @returns a registry URL in trailing-slash form
 */
export async function resolveRegistry(
  options: { env?: NodeJS.ProcessEnv; run?: CommandRunner } = {}
): Promise<string> {
  const env = options.env ?? process.env;

  const override = env.NOPY_REGISTRY?.trim();
  if (override) {
    return normalizeRegistry(override);
  }

  const run = options.run ?? defaultRunner;
  try {
    const stdout = (await run('npm', ['config', 'get', `${SCOPE}:registry`])).trim();
    // npm prints the string "undefined" for an unset key rather than nothing.
    if (stdout && stdout !== 'undefined' && stdout !== 'null') {
      return normalizeRegistry(stdout);
    }
  } catch {
    // npm not on PATH, or the config is unreadable. Neither is worth failing a
    // deployment over.
  }

  return NPMJS_REGISTRY;
}

/**
 * Reads the version a dist-tag points at, straight from the registry.
 *
 * Deliberately a plain `fetch` of the packument rather than shelling out to
 * `npm view`: it is one request, it honours a timeout, and it cannot be slowed
 * down by npm's own startup.
 *
 * @returns the version, or null if the registry or the tag has nothing
 */
export async function fetchChannelVersion(options: {
  registry: string;
  channel: Channel;
  packageName?: string;
  timeoutMs?: number;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const packageName = options.packageName ?? PACKAGE_NAME;
  const url = `${normalizeRegistry(options.registry)}${encodeURIComponent(packageName)}`;

  const headers: Record<string, string> = {
    // The abbreviated packument where the registry supports it; Gitea ignores
    // this and sends the full document, which parses the same.
    accept: 'application/vnd.npm.install-v1+json, application/json',
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await doFetch(url, {
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { 'dist-tags'?: Record<string, string> };
  return body['dist-tags']?.[options.channel] ?? null;
}

/** Path of the update-check cache file */
export function getUpdateCachePath(homedir: string = os.homedir()): string {
  return path.join(homedir, UPDATE_CACHE_DIR, UPDATE_CACHE_FILE);
}

/**
 * Reads the update-check cache.
 *
 * @returns the cache, or null if it is missing or unreadable
 */
export function readUpdateCache(cachePath: string = getUpdateCachePath()): UpdateCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as UpdateCache;
    // A hand-edited or half-written file must not be trusted into the compare.
    return typeof parsed?.checkedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Writes the update-check cache. Best effort — a read-only home directory
 * costs a network check per run, not a failure.
 */
export function writeUpdateCache(
  cache: UpdateCache,
  cachePath: string = getUpdateCachePath()
): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
  } catch {
    // Ignored on purpose.
  }
}

/**
 * Whether the startup check should be skipped entirely.
 *
 * `NOPY_NO_UPDATE_CHECK` is the explicit opt-out; `CI` covers the case nobody
 * remembers to opt out of.
 */
export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.NOPY_NO_UPDATE_CHECK?.trim().toLowerCase();
  if (flag && flag !== '0' && flag !== 'false') {
    return true;
  }
  return Boolean(env.CI);
}

/**
 * Checks whether a newer version exists on the current channel.
 *
 * Answers from cache when a check happened recently for the same channel and
 * registry; otherwise asks the registry and refreshes the cache. A failed
 * lookup falls back to whatever the cache last saw, so a flaky network degrades
 * to a stale answer rather than no answer.
 */
export async function checkForUpdate(options: {
  currentVersion: string;
  channel?: Channel;
  registry?: string;
  force?: boolean;
  intervalMs?: number;
  cachePath?: string;
  now?: number;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  run?: CommandRunner;
}): Promise<UpdateStatus> {
  const {
    currentVersion,
    force = false,
    intervalMs = DEFAULT_CHECK_INTERVAL_MS,
    cachePath = getUpdateCachePath(),
    now = Date.now(),
    env = process.env,
  } = options;

  const channel = options.channel ?? channelForVersion(currentVersion);
  const registry = normalizeRegistry(
    options.registry ?? (await resolveRegistry({ env, run: options.run }))
  );

  const cache = readUpdateCache(cachePath);
  // A cache entry for a different channel or registry answers a different
  // question, so it is never fresh for this one.
  const applicable = cache && cache.channel === channel && cache.registry === registry;
  const age = cache ? now - Date.parse(cache.checkedAt) : Number.POSITIVE_INFINITY;
  const fresh = applicable && Number.isFinite(age) && age >= 0 && age < intervalMs;

  if (!force && fresh && cache) {
    return status(currentVersion, cache.latest, channel, registry, true);
  }

  try {
    const latest = await fetchChannelVersion({
      registry,
      channel,
      timeoutMs: options.timeoutMs,
      token: env.NOPY_REGISTRY_TOKEN?.trim() || undefined,
      fetchImpl: options.fetchImpl,
    });
    writeUpdateCache(
      { checkedAt: new Date(now).toISOString(), channel, registry, latest },
      cachePath
    );
    return status(currentVersion, latest, channel, registry, false);
  } catch {
    // Offline, timed out, or the registry returned something unparseable.
    return status(
      currentVersion,
      applicable && cache ? cache.latest : null,
      channel,
      registry,
      true
    );
  }
}

/** Assembles an {@link UpdateStatus}, deciding whether the remote version wins */
function status(
  current: string,
  latest: string | null,
  channel: Channel,
  registry: string,
  fromCache: boolean
): UpdateStatus {
  const updateAvailable = Boolean(
    latest && semver.valid(latest) && semver.valid(current) && semver.gt(latest, current)
  );
  return { current, latest, channel, registry, updateAvailable, fromCache };
}

/**
 * Detects which package manager installed this CLI, so `self-update` re-runs
 * the same one rather than leaving two copies on the PATH.
 *
 * The install path is the evidence: pnpm and bun keep globals under their own
 * directory, npm does not.
 */
export function detectPackageManager(
  options: { execPath?: string; env?: NodeJS.ProcessEnv } = {}
): PackageManager {
  const env = options.env ?? process.env;

  const override = env.NOPY_PACKAGE_MANAGER?.trim().toLowerCase();
  if (override === 'npm' || override === 'pnpm' || override === 'yarn' || override === 'bun') {
    return override;
  }

  const from = (options.execPath ?? process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
  if (from.includes('/pnpm/')) return 'pnpm';
  if (from.includes('/.bun/')) return 'bun';
  if (from.includes('/.yarn/') || from.includes('/yarn/')) return 'yarn';
  return 'npm';
}

/**
 * Builds the command that installs a given channel globally.
 *
 * The registry is passed as a **scoped** override rather than `--registry`.
 * That is load-bearing for Gitea: its npm registry serves `@bitsquare`
 * packages and does not proxy npmjs, so a global `--registry` would send
 * `commander`, `execa` and every other dependency to a registry that has never
 * heard of them.
 */
export function buildSelfUpdateCommand(options: {
  packageManager: PackageManager;
  channel: Channel;
  registry: string;
  packageName?: string;
}): { file: string; args: string[] } {
  const packageName = options.packageName ?? PACKAGE_NAME;
  const spec = `${packageName}@${options.channel}`;

  const registryArgs =
    normalizeRegistry(options.registry) === NPMJS_REGISTRY
      ? []
      : [`--${SCOPE}:registry=${normalizeRegistry(options.registry)}`];

  switch (options.packageManager) {
    case 'pnpm':
      return { file: 'pnpm', args: ['add', '--global', spec, ...registryArgs] };
    case 'yarn':
      return { file: 'yarn', args: ['global', 'add', spec, ...registryArgs] };
    case 'bun':
      return { file: 'bun', args: ['add', '--global', spec, ...registryArgs] };
    default:
      return { file: 'npm', args: ['install', '--global', spec, ...registryArgs] };
  }
}

/** Renders a command as the shell line a user could paste */
export function formatCommand(command: { file: string; args: string[] }): string {
  return [command.file, ...command.args].join(' ');
}

/**
 * Renders the one-line hint printed at startup when an update exists.
 *
 * @returns the notice, or null when there is nothing to say
 */
export function formatUpdateNotice(
  status: UpdateStatus,
  packageManager?: PackageManager
): string | null {
  if (!status.updateAvailable || !status.latest) {
    return null;
  }

  const command = buildSelfUpdateCommand({
    packageManager: packageManager ?? detectPackageManager(),
    channel: status.channel,
    registry: status.registry,
  });

  const channelNote = status.channel === 'latest' ? '' : ` (${status.channel})`;
  return [
    `Update available: ${status.current} -> ${status.latest}${channelNote}`,
    `Run "nopy self-update" or "${formatCommand(command)}"`,
  ].join('\n');
}

/**
 * The startup path: returns the notice to print, or null.
 *
 * Never throws and never blocks for longer than the fetch timeout, because it
 * sits in front of every command the user actually asked for.
 */
export async function updateNotice(options: {
  currentVersion: string;
  env?: NodeJS.ProcessEnv;
  cachePath?: string;
  intervalMs?: number;
  timeoutMs?: number;
  now?: number;
  fetchImpl?: typeof fetch;
  run?: CommandRunner;
}): Promise<string | null> {
  const env = options.env ?? process.env;
  if (isUpdateCheckDisabled(env)) {
    return null;
  }

  try {
    const status = await checkForUpdate({ ...options, env });
    return formatUpdateNotice(status, detectPackageManager({ env }));
  } catch {
    return null;
  }
}

/** Outcome of a {@link selfUpdate} run */
export interface SelfUpdateResult {
  /** The status the decision was based on */
  status: UpdateStatus;
  /** The command that was run, or would have been run */
  command: { file: string; args: string[] };
  /** Whether the install actually ran */
  ran: boolean;
}

/**
 * Installs the newest version on the current channel.
 *
 * @param options.dryRun - print the command instead of running it
 * @param options.force - reinstall even when already up to date
 */
export async function selfUpdate(options: {
  currentVersion: string;
  channel?: Channel;
  registry?: string;
  packageManager?: PackageManager;
  dryRun?: boolean;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  cachePath?: string;
  fetchImpl?: typeof fetch;
  run?: CommandRunner;
  spawn?: (file: string, args: string[]) => Promise<unknown>;
}): Promise<SelfUpdateResult> {
  const env = options.env ?? process.env;

  // Always ignore the cache here: the user asked, so the answer has to be current.
  const status = await checkForUpdate({
    currentVersion: options.currentVersion,
    channel: options.channel,
    registry: options.registry,
    force: true,
    cachePath: options.cachePath,
    env,
    fetchImpl: options.fetchImpl,
    run: options.run,
  });

  const command = buildSelfUpdateCommand({
    packageManager: options.packageManager ?? detectPackageManager({ env }),
    channel: status.channel,
    registry: status.registry,
  });

  if (options.dryRun || (!status.updateAvailable && !options.force)) {
    return { status, command, ran: false };
  }

  const spawn =
    options.spawn ?? ((file: string, args: string[]) => execa(file, args, { stdio: 'inherit' }));
  await spawn(command.file, command.args);

  return { status, command, ran: true };
}
