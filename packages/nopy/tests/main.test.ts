/**
 * Tests for the nopy() orchestrator.
 *
 * Every collaborator is mocked: this module's job is wiring and branching, and
 * the pieces it wires (config loading, cube loading, dependency resolution,
 * execution) are covered by their own suites.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NopyConfig } from '../src/nopy.config.js';
import type { DeployCall } from '../src/nopy.executor.js';
import type { NopySession } from '../src/nopy.session.js';

// vi.mock factories are hoisted above module scope, so everything they close
// over has to be created inside vi.hoisted.
const {
  state,
  resolveCube,
  loadCubes,
  loadConfig,
  getConfigPaths,
  runWorkflow,
  executeDeployCalls,
  addToHistory,
  saveSession,
} = vi.hoisted(() => {
  const state = {
    config: {} as NopyConfig,
    loadResult: { cubes: {} as Record<string, unknown>, errors: [] as string[] },
    deployCalls: [] as DeployCall[],
    cubeSessions: [] as unknown[],
  };

  return {
    state,
    resolveCube: vi.fn(),
    loadCubes: vi.fn(async () => state.loadResult),
    loadConfig: vi.fn(() => state.config),
    getConfigPaths: vi.fn(() => ['/project/.nopyrc.json']),
    runWorkflow: vi.fn(),
    executeDeployCalls: vi.fn(async () => [] as unknown[]),
    addToHistory: vi.fn(),
    saveSession: vi.fn(),
  };
});

vi.mock('../src/cubes/index.js', () => ({ loadCubes }));
vi.mock('../src/nopy.config.js', () => ({ loadConfig, getConfigPaths }));
vi.mock('../src/nopy.workflow.js', () => ({ runWorkflow }));
vi.mock('../src/nopy.history.js', () => ({ addToHistory, DEFAULT_HISTORY_SIZE: 10 }));
vi.mock('../src/nopy.session.js', () => ({ saveSession }));
vi.mock('../src/cubes/dependencies.js', () => ({
  BuildContext: class {
    resolveCube = resolveCube;
    get deployCalls() {
      return state.deployCalls;
    }
    get cubeSessions() {
      return state.cubeSessions;
    }
  },
}));
vi.mock('../src/nopy.executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/nopy.executor.js')>();
  return { ...actual, executeDeployCalls };
});

import { nopy } from '../src/nopy.main.js';

const session = (): NopySession =>
  ({
    version: '1.0',
    name: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    cubes: [],
    hosts: ['web-1'],
    auth: { method: 'ssh-key' },
    env: {},
  }) as NopySession;

const call = (cube: string): DeployCall => ({
  cube,
  host: 'web-1',
  cwd: `/cubes/${cube}`,
  command: ['pyinfra', 'web-1', '-y', `${cube}.deploy.py`],
  env: {},
  dependencies: [],
});

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  state.config = { hosts: ['web-1'], cubeDirs: [], cubePackages: [], env: {} };
  state.loadResult = { cubes: { 'cube-a': {} }, errors: [] };
  state.deployCalls = [call('cube-a')];
  state.cubeSessions = [{ key: 'cube-a', variables: {} }];

  runWorkflow.mockResolvedValue({
    session: session(),
    selectedCubes: ['cube-a'],
    authMethod: 'ssh-key',
    isReplay: false,
  });
  executeDeployCalls.mockResolvedValue([
    { cube: 'cube-a', host: 'web-1', success: true, duration: 10 },
  ]);
});

const output = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

describe('nopy', () => {
  it('runs the happy path and reports success', async () => {
    const result = await nopy();

    expect(result?.success).toBe(true);
    expect(result?.summary).toEqual({
      total: 1,
      successful: 1,
      failed: 0,
      totalDuration: 10,
    });
    expect(resolveCube).toHaveBeenCalledWith('cube-a', 'web-1');
  });

  it('reports failure when any call fails', async () => {
    executeDeployCalls.mockResolvedValue([
      { cube: 'cube-a', host: 'web-1', success: false, duration: 5, error: new Error('x') },
    ]);

    const result = await nopy();

    expect(result?.success).toBe(false);
    expect(result?.summary.failed).toBe(1);
  });

  it('resolves every cube against every host', async () => {
    runWorkflow.mockResolvedValue({
      session: { ...session(), hosts: ['web-1', 'web-2'] },
      selectedCubes: ['cube-a', 'cube-b'],
      authMethod: 'ssh-key',
      isReplay: false,
    });

    await nopy();

    expect(resolveCube).toHaveBeenCalledTimes(4);
  });

  describe('cube loading errors', () => {
    it('aborts and returns undefined', async () => {
      state.loadResult = { cubes: {}, errors: ['bad manifest'] };

      const result = await nopy();

      expect(result).toBeUndefined();
      expect(runWorkflow).not.toHaveBeenCalled();
    });

    it('emits the errors as JSON when jsonOutput is set', async () => {
      state.loadResult = { cubes: {}, errors: ['bad manifest'] };

      await nopy({ jsonOutput: true });

      const payload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
      expect(payload).toEqual({ success: false, errors: ['bad manifest'] });
    });
  });

  describe('config banner', () => {
    it('prints the active configuration in interactive mode', async () => {
      state.config = {
        hosts: ['web-1'],
        cubeDirs: ['/cubes'],
        cubePackages: [{ spec: '@acme/cubes-net', from: '/project' }],
        env: { TOKEN: 'secret', EMPTY: '' },
      };

      await nopy({ continueOnError: true });

      const text = output();
      expect(text).toContain('Configuration');
      expect(text).toContain('Hosts:');
      expect(text).toContain('Cube dirs:');
      // Named by package, not by wherever it resolved to on disk.
      expect(text).toContain('Cube pkgs:   @acme/cubes-net');
      expect(text).toContain('continue-on-error');
      // Values are never echoed, only their presence.
      expect(text).toContain('TOKEN: <VALUE>');
      expect(text).toContain('EMPTY: <EMPTY>');
      expect(text).not.toContain('secret');
    });

    it('omits empty sections', async () => {
      state.config = { hosts: [], cubeDirs: [], cubePackages: [], env: {} };

      await nopy();

      const text = output();
      expect(text).toContain('Configuration');
      expect(text).not.toContain('Hosts:');
      expect(text).not.toContain('Cube dirs:');
      expect(text).not.toContain('Cube pkgs:');
      expect(text).not.toContain('Env vars:');
    });

    it('shortens paths under cwd and under HOME', async () => {
      getConfigPaths.mockReturnValue([
        `${process.env.HOME}/.nopyrc.json`,
        `${process.cwd()}/.nopyrc.json`,
        '/etc/nopy/.nopyrc.json',
      ]);

      await nopy();

      const text = output();
      expect(text).toContain('~/.nopyrc.json');
      expect(text).toContain('./.nopyrc.json');
      expect(text).toContain('/etc/nopy/.nopyrc.json');
    });

    it('is suppressed for JSON output', async () => {
      await nopy({ jsonOutput: true });
      expect(output()).not.toContain('Configuration');
    });

    it('is suppressed when replaying a session object', async () => {
      await nopy({ replaySession: session() });
      expect(output()).not.toContain('Configuration');
    });

    it('is suppressed when replaying a session file', async () => {
      await nopy({ loadSession: '/tmp/s.json' });
      expect(output()).not.toContain('Configuration');
    });
  });

  describe('session persistence', () => {
    it('saves the session when a path is given', async () => {
      await nopy({ saveSession: '/tmp/out.json' });

      expect(saveSession).toHaveBeenCalledTimes(1);
      const [written, path] = saveSession.mock.calls[0];
      expect(path).toBe('/tmp/out.json');
      expect(written.cubes).toEqual(state.cubeSessions);
    });

    it('does not save a replayed session back to file', async () => {
      runWorkflow.mockResolvedValue({
        session: session(),
        selectedCubes: ['cube-a'],
        authMethod: 'ssh-key',
        isReplay: true,
      });

      await nopy({ saveSession: '/tmp/out.json' });

      expect(saveSession).not.toHaveBeenCalled();
    });

    it('does not save when no path is given', async () => {
      await nopy();
      expect(saveSession).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('records the session with the default size', async () => {
      await nopy();

      expect(addToHistory).toHaveBeenCalledTimes(1);
      expect(addToHistory.mock.calls[0][1]).toBe(10);
    });

    it('honours a configured maxSessions', async () => {
      state.config = { ...state.config, history: { maxSessions: 3 } };

      await nopy();

      expect(addToHistory.mock.calls[0][1]).toBe(3);
    });

    it('respects autoSave: false', async () => {
      state.config = { ...state.config, history: { autoSave: false } };

      await nopy();

      expect(addToHistory).not.toHaveBeenCalled();
    });

    it('skips history on a dry run', async () => {
      await nopy({ dryRun: true });
      expect(addToHistory).not.toHaveBeenCalled();
    });

    it('skips history when the caller opts out', async () => {
      await nopy({ saveToHistory: false });
      expect(addToHistory).not.toHaveBeenCalled();
    });

    it('skips history for a replay', async () => {
      runWorkflow.mockResolvedValue({
        session: session(),
        selectedCubes: ['cube-a'],
        authMethod: 'ssh-key',
        isReplay: true,
      });

      await nopy();

      expect(addToHistory).not.toHaveBeenCalled();
    });

    it('skips history when nothing would be deployed', async () => {
      state.deployCalls = [];

      await nopy();

      expect(addToHistory).not.toHaveBeenCalled();
    });
  });

  describe('printOnly', () => {
    it('prints commands and never executes', async () => {
      await nopy({ printOnly: true });

      const text = output();
      expect(text).toContain('Deploy Commands');
      expect(text).toContain('# cube-a -> web-1');
      expect(text).toContain('pyinfra web-1 -y cube-a.deploy.py');
      expect(executeDeployCalls).not.toHaveBeenCalled();
    });

    it('reports the command count as the summary total', async () => {
      const result = await nopy({ printOnly: true });

      expect(result).toEqual({
        success: true,
        results: [],
        summary: { total: 1, successful: 0, failed: 0, totalDuration: 0 },
      });
    });
  });

  describe('execution options', () => {
    it('forwards dryRun and continueOnError to the executor', async () => {
      await nopy({ dryRun: true, continueOnError: true });

      const [, options] = executeDeployCalls.mock.calls[0];
      expect(options.dryRun).toBe(true);
      expect(options.continueOnError).toBe(true);
    });

    it('logs progress lines in interactive mode', async () => {
      await nopy();

      const [, options] = executeDeployCalls.mock.calls[0];
      options.onProgress({ cube: 'cube-a', host: 'web-1', success: true }, 1, 1);
      options.onProgress({ cube: 'cube-b', host: 'web-1', success: false }, 1, 1);
      // Exercises both the ✓ and ✗ branches; logtape writes via console.log.
      expect(logSpy).toHaveBeenCalled();
    });

    it('stays silent on progress when jsonOutput is set', async () => {
      await nopy({ jsonOutput: true });

      const [, options] = executeDeployCalls.mock.calls[0];
      const before = logSpy.mock.calls.length;
      options.onProgress({ cube: 'cube-a', host: 'web-1', success: true }, 1, 1);
      expect(logSpy.mock.calls.length).toBe(before);
    });
  });
});
