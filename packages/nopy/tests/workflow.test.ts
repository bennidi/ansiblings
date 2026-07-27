/**
 * Tests for nopy.workflow module.
 *
 * The prompt layer is the only I/O in this module, so mocking nopy.prompts
 * exercises every branch without touching a TTY.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/nopy.prompts.js', () => ({
  CubeSelection: vi.fn(),
  HostSelection: vi.fn(),
  AuthSelection: vi.fn(),
  PasswordSelection: vi.fn(),
}));

vi.mock('../src/nopy.session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/nopy.session.js')>();
  return { ...actual, loadSession: vi.fn() };
});

import type { Cube } from '../src/cubes/index.js';
import type { NopyConfig } from '../src/nopy.config.js';
import {
  AuthSelection,
  CubeSelection,
  HostSelection,
  PasswordSelection,
} from '../src/nopy.prompts.js';
import type { NopySession } from '../src/nopy.session.js';
import { loadSession } from '../src/nopy.session.js';
import {
  runInteractiveWorkflow,
  runReplayWorkflow,
  runSessionReplayWorkflow,
  runWorkflow,
} from '../src/nopy.workflow.js';

const mockCubeSelection = vi.mocked(CubeSelection);
const mockHostSelection = vi.mocked(HostSelection);
const mockAuthSelection = vi.mocked(AuthSelection);
const mockPasswordSelection = vi.mocked(PasswordSelection);
const mockLoadSession = vi.mocked(loadSession);

const config: NopyConfig = {
  hosts: ['web-1', 'web-2'],
  cubeDirs: [],
  env: { GLOBAL: 'value' },
};

const cubes = {
  'cube-a': { id: 'cube-a', name: 'Cube A' } as Cube,
};

const session = (overrides: Partial<NopySession> = {}): NopySession =>
  ({
    version: '1.0',
    name: 'test-session',
    createdAt: '2026-01-01T00:00:00.000Z',
    cubes: [{ key: 'cube-a', variables: {} }],
    hosts: ['web-1'],
    auth: { method: 'ssh-key' },
    env: {},
    ...overrides,
  }) as NopySession;

beforeEach(() => {
  vi.clearAllMocks();
  mockCubeSelection.mockResolvedValue({ selectedCubes: ['cube-a'] });
  mockHostSelection.mockResolvedValue('web-1');
  mockAuthSelection.mockResolvedValue({ authMethod: 'ssh-key' });
  mockPasswordSelection.mockResolvedValue('s3cret');
});

describe('runInteractiveWorkflow', () => {
  it('collects cubes, host and auth into a fresh session', async () => {
    const result = await runInteractiveWorkflow(cubes, config);

    expect(result.selectedCubes).toEqual(['cube-a']);
    expect(result.authMethod).toBe('ssh-key');
    expect(result.isReplay).toBe(false);
    expect(result.session.hosts).toEqual(['web-1']);
    expect(result.session.env).toEqual({ GLOBAL: 'value' });
    expect(mockHostSelection).toHaveBeenCalledWith(config.hosts);
  });

  it('forwards useAuthKey to the auth prompt', async () => {
    await runInteractiveWorkflow(cubes, config, { useAuthKey: true });
    expect(mockAuthSelection).toHaveBeenCalledWith(true);
  });

  it('carries username and password through from password auth', async () => {
    mockAuthSelection.mockResolvedValue({
      authMethod: 'password',
      username: 'deploy',
      password: 'hunter2',
    });

    const result = await runInteractiveWorkflow(cubes, config);

    expect(result.username).toBe('deploy');
    expect(result.password).toBe('hunter2');
    expect(result.session.auth.username).toBe('deploy');
  });

  it('skips the auth prompt entirely for vagrant hosts', async () => {
    mockHostSelection.mockResolvedValue('@vagrant/default');

    const result = await runInteractiveWorkflow(cubes, config);

    expect(mockAuthSelection).not.toHaveBeenCalled();
    expect(result.authMethod).toBe('ssh');
    expect(result.username).toBeUndefined();
  });

  it('skips the auth prompt entirely for docker hosts', async () => {
    mockHostSelection.mockResolvedValue('@docker/box');

    const result = await runInteractiveWorkflow(cubes, config);

    expect(mockAuthSelection).not.toHaveBeenCalled();
    expect(result.authMethod).toBe('ssh');
  });

  it('proceeds when the user selects nothing', async () => {
    mockCubeSelection.mockResolvedValue({ selectedCubes: [] });

    const result = await runInteractiveWorkflow(cubes, config);

    expect(result.selectedCubes).toEqual([]);
  });

  it('never stores a password on the session', async () => {
    mockAuthSelection.mockResolvedValue({
      authMethod: 'password',
      username: 'deploy',
      password: 'hunter2',
    });

    const result = await runInteractiveWorkflow(cubes, config);

    expect(JSON.stringify(result.session)).not.toContain('hunter2');
  });
});

describe('runReplayWorkflow', () => {
  it('replays a session file without prompting', async () => {
    mockLoadSession.mockResolvedValue(session());

    const result = await runReplayWorkflow('/tmp/s.json', cubes, config);

    expect(mockLoadSession).toHaveBeenCalledWith('/tmp/s.json');
    expect(result.isReplay).toBe(true);
    expect(result.selectedCubes).toEqual(['cube-a']);
    expect(mockHostSelection).not.toHaveBeenCalled();
    expect(mockPasswordSelection).not.toHaveBeenCalled();
  });

  it('tolerates a session referencing an unknown cube', async () => {
    mockLoadSession.mockResolvedValue(
      session({ cubes: [{ key: 'ghost-cube', variables: {} }] } as Partial<NopySession>)
    );

    const result = await runReplayWorkflow('/tmp/s.json', cubes, config);

    expect(result.selectedCubes).toEqual(['ghost-cube']);
  });

  it('prompts for a host when the session has none', async () => {
    mockLoadSession.mockResolvedValue(session({ hosts: [] }));

    const result = await runReplayWorkflow('/tmp/s.json', cubes, config);

    expect(mockHostSelection).toHaveBeenCalledWith(config.hosts);
    expect(result.session.hosts).toEqual(['web-1']);
  });

  it('prompts for a host when hosts is missing entirely', async () => {
    mockLoadSession.mockResolvedValue(session({ hosts: undefined }));

    const result = await runReplayWorkflow('/tmp/s.json', cubes, config);

    expect(result.session.hosts).toEqual(['web-1']);
  });

  it('re-prompts only for the password when a username is stored', async () => {
    mockLoadSession.mockResolvedValue(
      session({ auth: { method: 'password', username: 'deploy' } })
    );

    const result = await runReplayWorkflow('/tmp/s.json', cubes, config);

    expect(mockPasswordSelection).toHaveBeenCalledWith('deploy');
    expect(mockAuthSelection).not.toHaveBeenCalled();
    expect(result.password).toBe('s3cret');
    expect(result.username).toBe('deploy');
  });

  it('falls back to the full auth prompt when the username is missing', async () => {
    mockLoadSession.mockResolvedValue(session({ auth: { method: 'password' } }));
    mockAuthSelection.mockResolvedValue({
      authMethod: 'password',
      username: 'recovered',
      password: 'fresh',
    });

    const result = await runReplayWorkflow('/tmp/s.json', cubes, config);

    expect(mockAuthSelection).toHaveBeenCalledWith(false);
    expect(mockPasswordSelection).not.toHaveBeenCalled();
    expect(result.username).toBe('recovered');
    expect(result.password).toBe('fresh');
  });

  it('propagates load failures', async () => {
    mockLoadSession.mockRejectedValue(new Error('missing file'));

    await expect(runReplayWorkflow('/tmp/nope.json', cubes, config)).rejects.toThrow(
      'missing file'
    );
  });
});

describe('runSessionReplayWorkflow', () => {
  it('replays an in-memory session without prompting', async () => {
    const result = await runSessionReplayWorkflow(session(), cubes, config);

    expect(result.isReplay).toBe(true);
    expect(result.selectedCubes).toEqual(['cube-a']);
    expect(mockLoadSession).not.toHaveBeenCalled();
    expect(mockHostSelection).not.toHaveBeenCalled();
  });

  it('tolerates a session referencing an unknown cube', async () => {
    const result = await runSessionReplayWorkflow(
      session({ cubes: [{ key: 'ghost-cube', variables: {} }] } as Partial<NopySession>),
      cubes,
      config
    );

    expect(result.selectedCubes).toEqual(['ghost-cube']);
  });

  it('prompts for a host when the session has none', async () => {
    const result = await runSessionReplayWorkflow(session({ hosts: [] }), cubes, config);

    expect(mockHostSelection).toHaveBeenCalled();
    expect(result.session.hosts).toEqual(['web-1']);
  });

  it('prompts for a host when hosts is missing entirely', async () => {
    const result = await runSessionReplayWorkflow(session({ hosts: undefined }), cubes, config);

    expect(result.session.hosts).toEqual(['web-1']);
  });

  it('re-prompts only for the password when a username is stored', async () => {
    const result = await runSessionReplayWorkflow(
      session({ auth: { method: 'password', username: 'deploy' } }),
      cubes,
      config
    );

    expect(mockPasswordSelection).toHaveBeenCalledWith('deploy');
    expect(result.password).toBe('s3cret');
  });

  it('falls back to the full auth prompt when the username is missing', async () => {
    mockAuthSelection.mockResolvedValue({
      authMethod: 'password',
      username: 'recovered',
      password: 'fresh',
    });

    const result = await runSessionReplayWorkflow(
      session({ auth: { method: 'password' } }),
      cubes,
      config
    );

    expect(mockAuthSelection).toHaveBeenCalledWith(false);
    expect(result.username).toBe('recovered');
  });
});

describe('runWorkflow dispatch', () => {
  it('prefers an in-memory replay session over everything else', async () => {
    const result = await runWorkflow('/tmp/s.json', cubes, config, {}, session());

    expect(result.isReplay).toBe(true);
    expect(mockLoadSession).not.toHaveBeenCalled();
    expect(mockCubeSelection).not.toHaveBeenCalled();
  });

  it('uses the session file when no in-memory session is given', async () => {
    mockLoadSession.mockResolvedValue(session());

    const result = await runWorkflow('/tmp/s.json', cubes, config);

    expect(mockLoadSession).toHaveBeenCalledWith('/tmp/s.json');
    expect(result.isReplay).toBe(true);
    expect(mockCubeSelection).not.toHaveBeenCalled();
  });

  it('falls back to the interactive workflow', async () => {
    const result = await runWorkflow(undefined, cubes, config, { useAuthKey: true });

    expect(result.isReplay).toBe(false);
    expect(mockCubeSelection).toHaveBeenCalled();
    expect(mockAuthSelection).toHaveBeenCalledWith(true);
  });
});
