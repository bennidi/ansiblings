/**
 * Tests for nopy.executor module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DeployCall,
  type ExecutionResult,
  maskCommand,
  outputExecutionPlan,
  summarizeResults,
} from '../src/nopy.executor.js';

/**
 * Helper to create a test deploy call
 */
function createTestCall(cube: string, host: string, deps: string[] = []): DeployCall {
  return {
    cube,
    host,
    cwd: `/test/${cube}`,
    command: ['pyinfra', host, '-y', `${cube}.deploy.py`],
    env: { VAR: 'value' },
    dependencies: deps,
  };
}

/**
 * Helper to create a test execution result
 */
function createTestResult(
  cube: string,
  host: string,
  success: boolean,
  duration = 1000
): ExecutionResult {
  return {
    cube,
    host,
    success,
    duration,
    ...(success ? {} : { error: new Error('Test error') }),
  };
}

describe('summarizeResults', () => {
  it('summarizes successful results', () => {
    const results: ExecutionResult[] = [
      createTestResult('cube-a', 'host1', true, 1000),
      createTestResult('cube-b', 'host1', true, 2000),
    ];

    const summary = summarizeResults(results);

    expect(summary.total).toBe(2);
    expect(summary.successful).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.totalDuration).toBe(3000);
    expect(summary.failures).toHaveLength(0);
  });

  it('summarizes failed results', () => {
    const results: ExecutionResult[] = [
      createTestResult('cube-a', 'host1', true, 1000),
      createTestResult('cube-b', 'host1', false, 500),
    ];

    const summary = summarizeResults(results);

    expect(summary.total).toBe(2);
    expect(summary.successful).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.totalDuration).toBe(1500);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].cube).toBe('cube-b');
  });

  it('handles empty results', () => {
    const summary = summarizeResults([]);

    expect(summary.total).toBe(0);
    expect(summary.successful).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.totalDuration).toBe(0);
  });

  it('handles all failed results', () => {
    const results: ExecutionResult[] = [
      createTestResult('cube-a', 'host1', false, 100),
      createTestResult('cube-b', 'host1', false, 200),
    ];

    const summary = summarizeResults(results);

    expect(summary.successful).toBe(0);
    expect(summary.failed).toBe(2);
    expect(summary.failures).toHaveLength(2);
  });
});

describe('outputExecutionPlan', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  // vitest reuses an existing spy rather than re-wrapping, so recorded calls
  // would otherwise leak from one test into the next.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('outputs text format by default', () => {
    const calls = [createTestCall('cube-a', 'host1')];

    outputExecutionPlan(calls);

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Execution Plan');
    expect(output).toContain('cube-a');
    expect(output).toContain('host1');
  });

  it('outputs JSON format when requested', () => {
    const calls = [createTestCall('cube-a', 'host1')];

    outputExecutionPlan(calls, true);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.plan).toHaveLength(1);
    expect(parsed.plan[0].cube).toBe('cube-a');
    expect(parsed.plan[0].host).toBe('host1');
  });

  it('masks variables the manifest declared secret', () => {
    const call: DeployCall = {
      ...createTestCall('cube-a', 'host1'),
      command: ['pyinfra', 'host1', '-y', '--data "PASSWORD=hunter2"', '--data "OTHER=visible"'],
      env: { PASSWORD: 'hunter2', OTHER: 'visible' },
      secrets: ['PASSWORD'],
    };

    outputExecutionPlan([call]);

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('********');
    // Both the variable list and the command line above it — the command used
    // to be printed unmasked, which defeated the masking entirely.
    expect(output).not.toContain('hunter2');
    expect(output).toContain('visible');
  });

  it('leaves a password-looking variable alone when the manifest says nothing', () => {
    const call: DeployCall = {
      ...createTestCall('cube-a', 'host1'),
      env: { PASSWORD: 'visible' },
    };

    outputExecutionPlan([call]);

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('visible');
  });

  it('shows step numbers', () => {
    const calls = [createTestCall('cube-a', 'host1'), createTestCall('cube-b', 'host1')];

    outputExecutionPlan(calls);

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Step 1');
    expect(output).toContain('Step 2');
  });

  it('shows total count', () => {
    const calls = [
      createTestCall('cube-a', 'host1'),
      createTestCall('cube-b', 'host1'),
      createTestCall('cube-c', 'host1'),
    ];

    outputExecutionPlan(calls);

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Total: 3');
  });
});

describe('maskCommand', () => {
  const call = (command: string[], secrets?: string[]): DeployCall => ({
    ...createTestCall('cube-a', 'host1'),
    command,
    secrets,
  });

  it('replaces the value of a declared secret', () => {
    const masked = maskCommand(
      call(['pyinfra', 'host1', '--data "PASSWORD=hunter2"'], ['PASSWORD'])
    );

    expect(masked).toBe('pyinfra host1 --data "PASSWORD=********"');
  });

  it('leaves other data alone', () => {
    const masked = maskCommand(
      call(['--data "SSID=home"', '--data "PASSWORD=hunter2"'], ['PASSWORD'])
    );

    expect(masked).toBe('--data "SSID=home" --data "PASSWORD=********"');
  });

  it('masks a value containing spaces up to the closing quote', () => {
    const masked = maskCommand(call(['--data "PASSWORD=two words"', '--chdir /x'], ['PASSWORD']));

    expect(masked).toBe('--data "PASSWORD=********" --chdir /x');
  });

  it('masks an empty secret value', () => {
    expect(maskCommand(call(['--data "PASSWORD="'], ['PASSWORD']))).toBe(
      '--data "PASSWORD=********"'
    );
  });

  it('masks the ssh password whether or not the cube declares secrets', () => {
    const masked = maskCommand(call(['pyinfra', 'host1', '--user bob --password s3cr3t', '-y']));

    expect(masked).toBe('pyinfra host1 --user bob --password ******** -y');
  });

  it('returns the command untouched when there is nothing to hide', () => {
    expect(maskCommand(call(['pyinfra', 'host1', '-y']))).toBe('pyinfra host1 -y');
  });
});
