/**
 * Tests for nopy.update module
 *
 * Every network call, clock read and spawn is injected, so nothing here
 * reaches a registry or the user's home directory.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSelfUpdateCommand,
  type Channel,
  channelForVersion,
  checkForUpdate,
  detectPackageManager,
  fetchChannelVersion,
  formatCommand,
  formatUpdateNotice,
  getUpdateCachePath,
  isUpdateCheckDisabled,
  NPMJS_REGISTRY,
  normalizeRegistry,
  readUpdateCache,
  resolveRegistry,
  selfUpdate,
  type UpdateCache,
  updateNotice,
  writeUpdateCache,
} from '../src/nopy.update.js';

const GITEA = 'https://gitea.bitsquare.dev/api/packages/BitSquare/npm/';

let tmpDir: string;
let cachePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-update-'));
  cachePath = path.join(tmpDir, 'update-check.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A fetch stand-in returning the given dist-tags */
function fakeFetch(distTags: Record<string, string>, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      json: async () => ({ 'dist-tags': distTags }),
    }) as Response) as unknown as typeof fetch;
}

describe('channelForVersion', () => {
  it('maps a clean release to latest', () => {
    expect(channelForVersion('0.5.0')).toBe('latest');
    expect(channelForVersion('1.2.3')).toBe('latest');
  });

  it('maps a snapshot to main', () => {
    expect(channelForVersion('0.5.0-main.14.g6ecb2c3')).toBe('main');
  });

  it('maps any other prerelease to next', () => {
    expect(channelForVersion('0.6.0-rc.1')).toBe('next');
    expect(channelForVersion('1.0.0-alpha5')).toBe('next');
  });

  it('treats an unparseable version as latest', () => {
    expect(channelForVersion('not-a-version')).toBe('latest');
    expect(channelForVersion('')).toBe('latest');
  });
});

describe('normalizeRegistry', () => {
  it('adds a trailing slash', () => {
    expect(normalizeRegistry('https://example.com/npm')).toBe('https://example.com/npm/');
  });

  it('leaves an existing trailing slash alone', () => {
    expect(normalizeRegistry(GITEA)).toBe(GITEA);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeRegistry('  https://example.com/npm  ')).toBe('https://example.com/npm/');
  });
});

describe('resolveRegistry', () => {
  it('prefers the NOPY_REGISTRY override', async () => {
    const run = vi.fn();
    const registry = await resolveRegistry({
      env: { NOPY_REGISTRY: 'https://example.com/npm' },
      run,
    });
    expect(registry).toBe('https://example.com/npm/');
    expect(run).not.toHaveBeenCalled();
  });

  it('falls back to npm config', async () => {
    const run = vi.fn(async () => GITEA);
    expect(await resolveRegistry({ env: {}, run })).toBe(GITEA);
    expect(run).toHaveBeenCalledWith('npm', ['config', 'get', '@bitsquare:registry']);
  });

  it('treats npm printing "undefined" as unset', async () => {
    const run = vi.fn(async () => 'undefined');
    expect(await resolveRegistry({ env: {}, run })).toBe(NPMJS_REGISTRY);
  });

  it('treats npm printing "null" as unset', async () => {
    const run = vi.fn(async () => 'null');
    expect(await resolveRegistry({ env: {}, run })).toBe(NPMJS_REGISTRY);
  });

  it('treats empty output as unset', async () => {
    const run = vi.fn(async () => '   ');
    expect(await resolveRegistry({ env: {}, run })).toBe(NPMJS_REGISTRY);
  });

  it('falls back to npmjs when npm is missing', async () => {
    const run = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    expect(await resolveRegistry({ env: {}, run })).toBe(NPMJS_REGISTRY);
  });

  it('ignores a blank override', async () => {
    const run = vi.fn(async () => GITEA);
    expect(await resolveRegistry({ env: { NOPY_REGISTRY: '  ' }, run })).toBe(GITEA);
  });
});

describe('fetchChannelVersion', () => {
  it('reads the requested dist-tag', async () => {
    const version = await fetchChannelVersion({
      registry: GITEA,
      channel: 'main',
      fetchImpl: fakeFetch({ main: '0.5.0-main.14.gabc1234', latest: '0.5.0' }),
    });
    expect(version).toBe('0.5.0-main.14.gabc1234');
  });

  it('returns null when the tag does not exist', async () => {
    const version = await fetchChannelVersion({
      registry: GITEA,
      channel: 'latest',
      fetchImpl: fakeFetch({ main: '0.5.0-main.14.gabc1234' }),
    });
    expect(version).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const version = await fetchChannelVersion({
      registry: GITEA,
      channel: 'latest',
      fetchImpl: fakeFetch({}, false),
    });
    expect(version).toBeNull();
  });

  it('returns null when the packument has no dist-tags at all', async () => {
    const fetchImpl = (async () =>
      ({ ok: true, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await fetchChannelVersion({ registry: GITEA, channel: 'latest', fetchImpl })).toBeNull();
  });

  it('url-encodes the scoped package name onto the registry', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return { ok: true, json: async () => ({ 'dist-tags': { latest: '0.5.0' } }) } as Response;
    }) as unknown as typeof fetch;

    // No trailing slash on purpose: it must be normalised before joining.
    await fetchChannelVersion({
      registry: 'https://example.com/npm',
      channel: 'latest',
      fetchImpl,
    });
    expect(seen[0]).toBe('https://example.com/npm/%40bitsquare%2Fnopy');
  });

  it('sends a bearer token when one is given', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return { ok: true, json: async () => ({ 'dist-tags': { latest: '0.5.0' } }) } as Response;
    }) as unknown as typeof fetch;

    await fetchChannelVersion({ registry: GITEA, channel: 'latest', token: 'secret', fetchImpl });
    expect(headers.authorization).toBe('Bearer secret');
  });

  it('omits the authorization header when no token is given', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return { ok: true, json: async () => ({ 'dist-tags': { latest: '0.5.0' } }) } as Response;
    }) as unknown as typeof fetch;

    await fetchChannelVersion({ registry: GITEA, channel: 'latest', fetchImpl });
    expect(headers.authorization).toBeUndefined();
  });
});

describe('the update cache', () => {
  it('round-trips', () => {
    const cache: UpdateCache = {
      checkedAt: '2026-07-29T00:00:00.000Z',
      channel: 'latest',
      registry: NPMJS_REGISTRY,
      latest: '0.6.0',
    };
    writeUpdateCache(cache, cachePath);
    expect(readUpdateCache(cachePath)).toEqual(cache);
  });

  it('creates the containing directory', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'update-check.json');
    writeUpdateCache(
      {
        checkedAt: '2026-07-29T00:00:00.000Z',
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: null,
      },
      nested
    );
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('reads a missing file as null', () => {
    expect(readUpdateCache(path.join(tmpDir, 'absent.json'))).toBeNull();
  });

  it('reads malformed JSON as null', () => {
    fs.writeFileSync(cachePath, '{ not json', 'utf-8');
    expect(readUpdateCache(cachePath)).toBeNull();
  });

  it('rejects a file without a checkedAt stamp', () => {
    fs.writeFileSync(cachePath, JSON.stringify({ latest: '9.9.9' }), 'utf-8');
    expect(readUpdateCache(cachePath)).toBeNull();
  });

  it('swallows a write it cannot perform', () => {
    // A path whose parent is a file, not a directory.
    const blocked = path.join(cachePath, 'nested.json');
    fs.writeFileSync(cachePath, '{}', 'utf-8');
    expect(() =>
      writeUpdateCache(
        {
          checkedAt: '2026-07-29T00:00:00.000Z',
          channel: 'latest',
          registry: NPMJS_REGISTRY,
          latest: null,
        },
        blocked
      )
    ).not.toThrow();
  });

  it('defaults to a path under the home directory', () => {
    expect(getUpdateCachePath('/home/someone')).toBe('/home/someone/.nopy/update-check.json');
  });
});

describe('isUpdateCheckDisabled', () => {
  it('is off by default', () => {
    expect(isUpdateCheckDisabled({})).toBe(false);
  });

  it('honours NOPY_NO_UPDATE_CHECK', () => {
    expect(isUpdateCheckDisabled({ NOPY_NO_UPDATE_CHECK: '1' })).toBe(true);
    expect(isUpdateCheckDisabled({ NOPY_NO_UPDATE_CHECK: 'yes' })).toBe(true);
  });

  it('treats 0 and false as not disabled', () => {
    expect(isUpdateCheckDisabled({ NOPY_NO_UPDATE_CHECK: '0' })).toBe(false);
    expect(isUpdateCheckDisabled({ NOPY_NO_UPDATE_CHECK: 'false' })).toBe(false);
    expect(isUpdateCheckDisabled({ NOPY_NO_UPDATE_CHECK: '' })).toBe(false);
  });

  it('disables itself in CI', () => {
    expect(isUpdateCheckDisabled({ CI: 'true' })).toBe(true);
  });
});

describe('checkForUpdate', () => {
  const base = {
    currentVersion: '0.5.0',
    registry: NPMJS_REGISTRY,
    env: {} as NodeJS.ProcessEnv,
    now: Date.parse('2026-07-29T12:00:00.000Z'),
  };

  it('reports a newer version on the channel', async () => {
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(status).toMatchObject({
      current: '0.5.0',
      latest: '0.6.0',
      channel: 'latest',
      updateAvailable: true,
      fromCache: false,
    });
  });

  it('reports no update when the channel matches', async () => {
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.5.0' }),
    });
    expect(status.updateAvailable).toBe(false);
  });

  it('does not treat an older published version as an update', async () => {
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.4.0' }),
    });
    expect(status.updateAvailable).toBe(false);
  });

  it('derives the channel from the running version', async () => {
    const status = await checkForUpdate({
      ...base,
      currentVersion: '0.5.0-main.13.gabc1234',
      cachePath,
      fetchImpl: fakeFetch({ main: '0.5.0-main.14.gdef5678', latest: '0.5.0' }),
    });
    expect(status.channel).toBe('main');
    expect(status.latest).toBe('0.5.0-main.14.gdef5678');
    expect(status.updateAvailable).toBe(true);
  });

  it('writes what it found to the cache', async () => {
    await checkForUpdate({ ...base, cachePath, fetchImpl: fakeFetch({ latest: '0.6.0' }) });
    expect(readUpdateCache(cachePath)).toEqual({
      checkedAt: '2026-07-29T12:00:00.000Z',
      channel: 'latest',
      registry: NPMJS_REGISTRY,
      latest: '0.6.0',
    });
  });

  it('answers from a fresh cache without touching the network', async () => {
    writeUpdateCache(
      {
        checkedAt: '2026-07-29T11:00:00.000Z',
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: '0.7.0',
      },
      cachePath
    );
    const fetchImpl = vi.fn();
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(status.latest).toBe('0.7.0');
    expect(status.fromCache).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refetches once the cache goes stale', async () => {
    writeUpdateCache(
      {
        checkedAt: '2026-07-27T11:00:00.000Z',
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: '0.7.0',
      },
      cachePath
    );
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.8.0' }),
    });
    expect(status.latest).toBe('0.8.0');
    expect(status.fromCache).toBe(false);
  });

  it('ignores a cache written for a different channel', async () => {
    writeUpdateCache(
      {
        checkedAt: '2026-07-29T11:00:00.000Z',
        channel: 'next',
        registry: NPMJS_REGISTRY,
        latest: '9.9.9',
      },
      cachePath
    );
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(status.latest).toBe('0.6.0');
  });

  it('ignores a cache written for a different registry', async () => {
    writeUpdateCache(
      {
        checkedAt: '2026-07-29T11:00:00.000Z',
        channel: 'latest',
        registry: GITEA,
        latest: '9.9.9',
      },
      cachePath
    );
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(status.latest).toBe('0.6.0');
  });

  it('ignores a cache stamped in the future', async () => {
    writeUpdateCache(
      {
        checkedAt: '2027-01-01T00:00:00.000Z',
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: '9.9.9',
      },
      cachePath
    );
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(status.latest).toBe('0.6.0');
  });

  it('ignores a cache with an unparseable stamp', async () => {
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: 'whenever',
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: '9.9.9',
      }),
      'utf-8'
    );
    const status = await checkForUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(status.latest).toBe('0.6.0');
  });

  it('refetches when forced, even with a fresh cache', async () => {
    writeUpdateCache(
      {
        checkedAt: '2026-07-29T11:00:00.000Z',
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: '0.7.0',
      },
      cachePath
    );
    const status = await checkForUpdate({
      ...base,
      cachePath,
      force: true,
      fetchImpl: fakeFetch({ latest: '0.9.0' }),
    });
    expect(status.latest).toBe('0.9.0');
    expect(status.fromCache).toBe(false);
  });

  it('falls back to the cached answer when the network fails', async () => {
    writeUpdateCache(
      {
        checkedAt: '2026-07-20T11:00:00.000Z',
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: '0.7.0',
      },
      cachePath
    );
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const status = await checkForUpdate({ ...base, cachePath, fetchImpl });
    expect(status.latest).toBe('0.7.0');
    expect(status.updateAvailable).toBe(true);
    expect(status.fromCache).toBe(true);
  });

  it('reports nothing when the network fails and no cache applies', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const status = await checkForUpdate({ ...base, cachePath, fetchImpl });
    expect(status.latest).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });

  it('resolves the registry when none is given', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.5.0',
      cachePath,
      env: {},
      run: async () => GITEA,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(status.registry).toBe(GITEA);
  });

  it('passes a registry token from the environment through', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return { ok: true, json: async () => ({ 'dist-tags': { latest: '0.6.0' } }) } as Response;
    }) as unknown as typeof fetch;

    await checkForUpdate({
      ...base,
      cachePath,
      env: { NOPY_REGISTRY_TOKEN: 'tok' },
      fetchImpl,
    });
    expect(headers.authorization).toBe('Bearer tok');
  });

  it('does not compare against an unparseable current version', async () => {
    const status = await checkForUpdate({
      ...base,
      currentVersion: 'dev',
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(status.updateAvailable).toBe(false);
  });
});

describe('detectPackageManager', () => {
  it('honours the environment override', () => {
    expect(
      detectPackageManager({ env: { NOPY_PACKAGE_MANAGER: 'pnpm' }, execPath: '/usr/lib/x' })
    ).toBe('pnpm');
    expect(
      detectPackageManager({ env: { NOPY_PACKAGE_MANAGER: 'YARN' }, execPath: '/usr/lib/x' })
    ).toBe('yarn');
    expect(
      detectPackageManager({ env: { NOPY_PACKAGE_MANAGER: 'bun' }, execPath: '/usr/lib/x' })
    ).toBe('bun');
    expect(
      detectPackageManager({ env: { NOPY_PACKAGE_MANAGER: 'npm' }, execPath: '/x/pnpm/y' })
    ).toBe('npm');
  });

  it('ignores an unrecognised override', () => {
    expect(
      detectPackageManager({ env: { NOPY_PACKAGE_MANAGER: 'cargo' }, execPath: '/usr/lib/x' })
    ).toBe('npm');
  });

  it('recognises a pnpm global install', () => {
    expect(
      detectPackageManager({
        env: {},
        execPath: '/Users/x/Library/pnpm/global/5/node_modules/.bin/nopy',
      })
    ).toBe('pnpm');
  });

  it('recognises a bun global install', () => {
    expect(
      detectPackageManager({ env: {}, execPath: '/Users/x/.bun/install/global/node_modules/nopy' })
    ).toBe('bun');
  });

  it('recognises a yarn global install', () => {
    expect(detectPackageManager({ env: {}, execPath: '/Users/x/.yarn/bin/nopy' })).toBe('yarn');
  });

  it('defaults to npm', () => {
    expect(
      detectPackageManager({
        env: {},
        execPath: '/usr/local/lib/node_modules/@bitsquare/nopy/dist/nopy.cli.js',
      })
    ).toBe('npm');
  });

  it('handles a windows-style path and an empty path', () => {
    expect(
      detectPackageManager({ env: {}, execPath: 'C:\\Users\\x\\AppData\\Local\\pnpm\\nopy.exe' })
    ).toBe('pnpm');
    expect(detectPackageManager({ env: {}, execPath: '' })).toBe('npm');
  });
});

describe('buildSelfUpdateCommand', () => {
  it('builds an npm global install without a registry flag for npmjs', () => {
    const command = buildSelfUpdateCommand({
      packageManager: 'npm',
      channel: 'latest',
      registry: NPMJS_REGISTRY,
    });
    expect(formatCommand(command)).toBe('npm install --global @bitsquare/nopy@latest');
  });

  it('adds a scoped registry override for a non-npmjs registry', () => {
    const command = buildSelfUpdateCommand({
      packageManager: 'npm',
      channel: 'main',
      registry: GITEA,
    });
    // Scoped, not `--registry`: Gitea does not proxy npmjs, so the transitive
    // dependencies have to keep resolving from npmjs.
    expect(formatCommand(command)).toBe(
      `npm install --global @bitsquare/nopy@main --@bitsquare:registry=${GITEA}`
    );
    expect(command.args).not.toContain('--registry');
  });

  it('normalises a registry given without a trailing slash', () => {
    const command = buildSelfUpdateCommand({
      packageManager: 'npm',
      channel: 'latest',
      registry: 'https://registry.npmjs.org',
    });
    expect(command.args).toEqual(['install', '--global', '@bitsquare/nopy@latest']);
  });

  it('builds for pnpm, yarn and bun', () => {
    expect(
      formatCommand(
        buildSelfUpdateCommand({
          packageManager: 'pnpm',
          channel: 'next',
          registry: NPMJS_REGISTRY,
        })
      )
    ).toBe('pnpm add --global @bitsquare/nopy@next');
    expect(
      formatCommand(
        buildSelfUpdateCommand({
          packageManager: 'yarn',
          channel: 'next',
          registry: NPMJS_REGISTRY,
        })
      )
    ).toBe('yarn global add @bitsquare/nopy@next');
    expect(
      formatCommand(
        buildSelfUpdateCommand({ packageManager: 'bun', channel: 'next', registry: NPMJS_REGISTRY })
      )
    ).toBe('bun add --global @bitsquare/nopy@next');
  });

  it('accepts an explicit package name', () => {
    const command = buildSelfUpdateCommand({
      packageManager: 'npm',
      channel: 'latest',
      registry: NPMJS_REGISTRY,
      packageName: '@bitsquare/keyman',
    });
    expect(formatCommand(command)).toBe('npm install --global @bitsquare/keyman@latest');
  });
});

describe('formatUpdateNotice', () => {
  const status = {
    current: '0.5.0',
    latest: '0.6.0',
    channel: 'latest' as Channel,
    registry: NPMJS_REGISTRY,
    updateAvailable: true,
    fromCache: false,
  };

  it('names both versions and the command', () => {
    const notice = formatUpdateNotice(status, 'npm');
    expect(notice).toContain('0.5.0 -> 0.6.0');
    expect(notice).toContain('nopy self-update');
    expect(notice).toContain('npm install --global @bitsquare/nopy@latest');
  });

  it('names a non-default channel', () => {
    expect(formatUpdateNotice({ ...status, channel: 'main' }, 'npm')).toContain('(main)');
  });

  it('says nothing when there is no update', () => {
    expect(formatUpdateNotice({ ...status, updateAvailable: false }, 'npm')).toBeNull();
  });

  it('says nothing when the latest version is unknown', () => {
    expect(formatUpdateNotice({ ...status, latest: null }, 'npm')).toBeNull();
  });

  it('detects the package manager when none is given', () => {
    expect(formatUpdateNotice(status)).toContain('@bitsquare/nopy@latest');
  });
});

describe('updateNotice', () => {
  it('returns a notice when an update exists', async () => {
    const notice = await updateNotice({
      currentVersion: '0.5.0',
      env: { NOPY_REGISTRY: NPMJS_REGISTRY },
      cachePath,
      now: Date.parse('2026-07-29T12:00:00.000Z'),
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
    });
    expect(notice).toContain('0.5.0 -> 0.6.0');
  });

  it('returns null when the check is disabled', async () => {
    const fetchImpl = vi.fn();
    const notice = await updateNotice({
      currentVersion: '0.5.0',
      env: { NOPY_NO_UPDATE_CHECK: '1' },
      cachePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(notice).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when everything fails', async () => {
    const notice = await updateNotice({
      currentVersion: '0.5.0',
      env: {},
      cachePath,
      run: async () => {
        throw new Error('no npm');
      },
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(notice).toBeNull();
  });
});

describe('selfUpdate', () => {
  const base = {
    currentVersion: '0.5.0',
    env: { NOPY_REGISTRY: NPMJS_REGISTRY } as NodeJS.ProcessEnv,
    packageManager: 'npm' as const,
  };

  it('runs the install when a newer version exists', async () => {
    const spawn = vi.fn(async () => undefined);
    const result = await selfUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
      spawn,
    });
    expect(result.ran).toBe(true);
    expect(spawn).toHaveBeenCalledWith('npm', ['install', '--global', '@bitsquare/nopy@latest']);
  });

  it('does nothing when already up to date', async () => {
    const spawn = vi.fn(async () => undefined);
    const result = await selfUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.5.0' }),
      spawn,
    });
    expect(result.ran).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reinstalls when forced', async () => {
    const spawn = vi.fn(async () => undefined);
    const result = await selfUpdate({
      ...base,
      cachePath,
      force: true,
      fetchImpl: fakeFetch({ latest: '0.5.0' }),
      spawn,
    });
    expect(result.ran).toBe(true);
  });

  it('reports the command without running it on a dry run', async () => {
    const spawn = vi.fn(async () => undefined);
    const result = await selfUpdate({
      ...base,
      cachePath,
      dryRun: true,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
      spawn,
    });
    expect(result.ran).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(formatCommand(result.command)).toBe('npm install --global @bitsquare/nopy@latest');
  });

  it('ignores a fresh cache, because the user asked', async () => {
    writeUpdateCache(
      {
        checkedAt: new Date().toISOString(),
        channel: 'latest',
        registry: NPMJS_REGISTRY,
        latest: '0.5.0',
      },
      cachePath
    );
    const result = await selfUpdate({
      ...base,
      cachePath,
      fetchImpl: fakeFetch({ latest: '0.6.0' }),
      spawn: async () => undefined,
    });
    expect(result.status.latest).toBe('0.6.0');
    expect(result.ran).toBe(true);
  });

  it('follows an explicit channel and registry', async () => {
    const result = await selfUpdate({
      currentVersion: '0.5.0',
      env: {},
      packageManager: 'pnpm',
      channel: 'main',
      registry: GITEA,
      cachePath,
      fetchImpl: fakeFetch({ main: '0.5.0-main.20.gaaaaaaa' }),
      spawn: async () => undefined,
    });
    expect(formatCommand(result.command)).toBe(
      `pnpm add --global @bitsquare/nopy@main --@bitsquare:registry=${GITEA}`
    );
  });

  it('does not run when the registry could not be reached', async () => {
    const spawn = vi.fn(async () => undefined);
    const result = await selfUpdate({
      ...base,
      cachePath,
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      spawn,
    });
    expect(result.status.latest).toBeNull();
    expect(result.ran).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});
