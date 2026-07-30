/**
 * Tests for runTool.
 *
 * These spawn real processes rather than mocking execa. What runTool exists for
 * is the shape of an execa failure — a mock would assert only what this test
 * already assumes. It lives apart from utils.test.ts, which mocks execa to test
 * the callers.
 */

import { describe, expect, it } from 'vitest';
import { runTool, ToolNotFoundError } from '../src/keyman.utils.js';

describe('runTool', () => {
  it('returns stdout on success', async () => {
    const result = await runTool('node', ['-e', 'process.stdout.write("hi")']);

    expect(result.stdout).toBe('hi');
  });

  it('passes options through', async () => {
    const result = await runTool('node', ['-e', 'process.stdout.write(process.env.PROBE ?? "")'], {
      env: { PROBE: 'from-options' },
    });

    expect(result.stdout).toBe('from-options');
  });

  it('reports empty stdout when the output went elsewhere', async () => {
    const result = await runTool('node', ['-e', 'process.stdout.write("hi")'], {
      stdout: 'ignore',
    });

    expect(result.stdout).toBe('');
  });

  it('turns a missing binary into an instruction rather than an ENOENT', async () => {
    const failure = runTool('keyman-no-such-binary', []);

    await expect(failure).rejects.toThrow(ToolNotFoundError);
    await expect(failure).rejects.toThrow(
      '`keyman-no-such-binary` was not found on PATH. Install it and try again.'
    );
  });

  it('surfaces what the binary wrote to stderr', async () => {
    await expect(
      runTool('node', ['-e', 'process.stderr.write("no recipient\\n"); process.exit(1)'])
    ).rejects.toThrow('`node` failed: no recipient');
  });

  it('falls back to the command summary when stderr is empty', async () => {
    await expect(runTool('node', ['-e', 'process.exit(3)'])).rejects.toThrow(
      /`node` failed: .*exit code 3/
    );
  });
});
