/**
 * Tests for the executeDeployCalls path of nopy.executor.
 *
 * execa is mocked so no pyinfra process is ever spawned. The module calls
 * `execa(file, args, opts)` directly — no shell, so no factory call to unwrap
 * as there was while it went through `execa({ shell: true })`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runner = vi.fn();

vi.mock('execa', () => ({
  execa: vi.fn((...args: unknown[]) => runner(...args)),
}));

import { execa } from 'execa';
import { type DeployCall, executeDeployCalls } from '../src/nopy.executor.js';

const call = (cube: string, host = 'web-1'): DeployCall => ({
  cube,
  host,
  cwd: `/cubes/${cube}`,
  command: ['pyinfra', host, '-y', `${cube}.deploy.py`],
  env: {},
  dependencies: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  runner.mockResolvedValue({ exitCode: 0 });
});

describe('executeDeployCalls', () => {
  it('returns early without spawning anything for an empty list', async () => {
    const results = await executeDeployCalls([]);

    expect(results).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it('prints the plan and skips execution on a dry run', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const results = await executeDeployCalls([call('cube-a')], { dryRun: true });

    expect(results).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('Execution Plan');
    logSpy.mockRestore();
  });

  it('spawns the argv directly in the call cwd with inherited stdio', async () => {
    await executeDeployCalls([call('cube-a')]);

    expect(execa).toHaveBeenCalledWith('pyinfra', ['web-1', '-y', 'cube-a.deploy.py'], {
      cwd: '/cubes/cube-a',
      stdio: 'inherit',
    });
  });

  it('never asks execa for a shell', async () => {
    // The regression that matters: with `shell: true` every `--data` value was
    // shell syntax, so a password or a variable containing `;` or `$(…)` ran.
    await executeDeployCalls([
      { ...call('cube-a'), command: ['pyinfra', 'web-1', '--data', 'MOTD=$(id); rm -rf /'] },
    ]);

    const [, , options] = vi.mocked(execa).mock.calls[0] as unknown[];
    expect(options).not.toHaveProperty('shell');
    expect(vi.mocked(execa).mock.calls[0][1]).toContain('MOTD=$(id); rm -rf /');
  });

  it('reports success with a non-negative duration', async () => {
    const [result] = await executeDeployCalls([call('cube-a')]);

    expect(result.success).toBe(true);
    expect(result.cube).toBe('cube-a');
    expect(result.host).toBe('web-1');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('captures a thrown Error as a failed result rather than rejecting', async () => {
    runner.mockRejectedValue(new Error('exit code 1'));

    const [result] = await executeDeployCalls([call('cube-a')]);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('exit code 1');
  });

  it('wraps a non-Error rejection into an Error', async () => {
    runner.mockRejectedValue('boom');

    const [result] = await executeDeployCalls([call('cube-a')]);

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('boom');
  });

  it('stops after the first failure by default', async () => {
    runner.mockRejectedValueOnce(new Error('nope')).mockResolvedValue({ exitCode: 0 });

    const results = await executeDeployCalls([call('cube-a'), call('cube-b')]);

    expect(results).toHaveLength(1);
    expect(results[0].cube).toBe('cube-a');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('keeps going past a failure when continueOnError is set', async () => {
    runner.mockRejectedValueOnce(new Error('nope')).mockResolvedValue({ exitCode: 0 });

    const results = await executeDeployCalls([call('cube-a'), call('cube-b')], {
      continueOnError: true,
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.success)).toEqual([false, true]);
  });

  it('invokes onStart before each call', async () => {
    const onStart = vi.fn();

    await executeDeployCalls([call('cube-a'), call('cube-b', 'web-2')], { onStart });

    expect(onStart.mock.calls).toEqual([
      ['cube-a', 'web-1'],
      ['cube-b', 'web-2'],
    ]);
  });

  it('invokes onProgress with running completed/total counts', async () => {
    const onProgress = vi.fn();

    await executeDeployCalls([call('cube-a'), call('cube-b')], { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0].slice(1)).toEqual([1, 2]);
    expect(onProgress.mock.calls[1].slice(1)).toEqual([2, 2]);
  });

  it('reports progress for the failing call before stopping', async () => {
    const onProgress = vi.fn();
    runner.mockRejectedValue(new Error('nope'));

    await executeDeployCalls([call('cube-a'), call('cube-b')], { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0].success).toBe(false);
  });

  it('works without any callbacks supplied', async () => {
    await expect(executeDeployCalls([call('cube-a')])).resolves.toHaveLength(1);
  });
});
