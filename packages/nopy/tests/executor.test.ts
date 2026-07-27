/**
 * Tests for nopy.executor module
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DeployCall,
  type ExecutionResult,
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

  it('masks password variables in text output', () => {
    const call: DeployCall = {
      ...createTestCall('cube-a', 'host1'),
      env: { PASSWORD: 'secret', OTHER: 'visible' },
    };

    outputExecutionPlan([call]);

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('********');
    expect(output).not.toContain('secret');
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
