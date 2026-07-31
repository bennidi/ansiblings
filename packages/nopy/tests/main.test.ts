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
// Only the writer is a spy — `describeSession` and the version constant are pure
// and the assertions below are about what nopy() actually stamps.
vi.mock('../src/nopy.session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/nopy.session.js')>()),
  saveSession,
}));
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

/**
 * A session as bare as the loader will accept one — no `version`, `timestamp`
 * or `name`, which is exactly what a hand-written file looks like and what
 * `nopy()` has to fill in.
 */
const session = (): NopySession => ({
  cubes: [],
  hosts: ['web-1'],
  auth: { method: 'ssh-key' },
  env: {},
});

const call = (cube: string): DeployCall => ({
  cube,
  host: 'web-1',
  cwd: `/cubes/${cube}`,
  command: ['pyinfra', 'web-1', '-y', `${cube}.deploy.py`],
  env: {},
  dependencies: [],
});

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  state.config = { hosts: ['web-1'], cubeDirs: [], cubePackages: [], env: {} };
  state.loadResult = { cubes: { 'cube-a': {} }, errors: [] };
  state.deployCalls = [call('cube-a')];
  state.cubeSessions = [{ key: 'cube-a', variables: {} }];

  runWorkflow.mockResolvedValue({
    session: session(),
    selectedCubes: ['cube-a'],
    authMethod: 'ssh-key',
    replaySource: undefined,
  });
  executeDeployCalls.mockResolvedValue([
    { cube: 'cube-a', host: 'web-1', success: true, duration: 10 },
  ]);
});

/**
 * The two streams, kept apart on purpose: stdout carries the deploy commands
 * and pyinfra's own output, everything nopy says about itself goes to stderr.
 */
const stdout = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
const stderr = () => errSpy.mock.calls.map((c) => c.join(' ')).join('\n');

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
      replaySource: undefined,
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

    it('reports them on stderr', async () => {
      state.loadResult = { cubes: {}, errors: ['bad manifest'] };

      await nopy();

      expect(stderr()).toContain('bad manifest');
      expect(stdout()).toBe('');
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

      const text = stderr();
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

      const text = stderr();
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

      const text = stderr();
      expect(text).toContain('~/.nopyrc.json');
      expect(text).toContain('./.nopyrc.json');
      expect(text).toContain('/etc/nopy/.nopyrc.json');
    });

    it('is suppressed when replaying a session object', async () => {
      await nopy({ replaySession: session() });
      expect(stderr()).not.toContain('Configuration');
    });

    it('is suppressed when replaying a session file', async () => {
      await nopy({ loadSession: '/tmp/s.json' });
      expect(stderr()).not.toContain('Configuration');
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

    it('leaves a declared secret out of the recorded env', async () => {
      // The session's `env` is a copy of the config's, and used to be copied
      // verbatim — writing to disk, in plaintext, the credential that was kept
      // out of every cube's `variables` one key below.
      state.config = {
        ...state.config,
        env: { PASSWORD: 'hunter2', KEY_DIR: './vault' },
        secrets: ['PASSWORD'],
      };

      await nopy({ saveSession: '/tmp/out.json' });

      expect(saveSession.mock.calls[0][0].env).toEqual({ KEY_DIR: './vault' });
    });

    it('saves a replayed session too', async () => {
      runWorkflow.mockResolvedValue({
        session: session(),
        selectedCubes: ['cube-a'],
        authMethod: 'ssh-key',
        replaySource: 'history',
      });

      await nopy({ saveSession: '/tmp/out.json' });

      expect(saveSession).toHaveBeenCalledTimes(1);
      expect(saveSession.mock.calls[0][1]).toBe('/tmp/out.json');
    });

    it('stamps version, timestamp and a derived name', async () => {
      await nopy({ saveSession: '/tmp/out.json' });

      const [written] = saveSession.mock.calls[0];
      expect(written.version).toBe('1.0.0');
      expect(written.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(written.name).toContain('cube-a');
      expect(written.name).toContain('web-1');
    });

    it('keeps the name and version a replayed session already carried', async () => {
      runWorkflow.mockResolvedValue({
        session: { ...session(), version: '0.9.0', name: 'hand-written', timestamp: 'then' },
        selectedCubes: ['cube-a'],
        authMethod: 'ssh-key',
        replaySource: 'file',
      });

      await nopy({ saveSession: '/tmp/out.json' });

      const [written] = saveSession.mock.calls[0];
      expect(written).toMatchObject({ version: '0.9.0', name: 'hand-written', timestamp: 'then' });
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

    it('skips history for a replay out of history', async () => {
      runWorkflow.mockResolvedValue({
        session: session(),
        selectedCubes: ['cube-a'],
        authMethod: 'ssh-key',
        replaySource: 'history',
      });

      await nopy();

      expect(addToHistory).not.toHaveBeenCalled();
    });

    it('records a replay out of a session file', async () => {
      runWorkflow.mockResolvedValue({
        session: session(),
        selectedCubes: ['cube-a'],
        authMethod: 'ssh-key',
        replaySource: 'file',
      });

      await nopy();

      expect(addToHistory).toHaveBeenCalledTimes(1);
    });

    it('skips history when nothing would be deployed', async () => {
      state.deployCalls = [];

      await nopy();

      expect(addToHistory).not.toHaveBeenCalled();
    });

    it('skips history for a print-only run', async () => {
      // Same rule as `--dry-run`: nothing was deployed, so nothing belongs at
      // the head of the list `-R` repeats.
      await nopy({ printOnly: true });

      expect(addToHistory).not.toHaveBeenCalled();
    });
  });

  describe('printOnly', () => {
    it('prints commands and never executes', async () => {
      await nopy({ printOnly: true });

      const text = stdout();
      expect(text).toContain('Deploy Commands');
      expect(text).toContain('# cube-a -> web-1');
      expect(text).toContain('pyinfra web-1 -y cube-a.deploy.py');
      expect(executeDeployCalls).not.toHaveBeenCalled();
    });

    it('keeps stdout to the commands and nothing else', async () => {
      // The whole point of the split: `nopy -P > plan.txt` has to be the plan.
      // The config banner and every log line are on the other stream.
      await nopy({ printOnly: true });

      expect(stdout()).not.toContain('Configuration');
      expect(stderr()).toContain('Configuration');
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
      // Exercises both the ✓ and ✗ branches; logtape writes via console.error.
      expect(stderr()).toContain('cube-a');
      expect(stderr()).toContain('cube-b');
    });
  });
});
