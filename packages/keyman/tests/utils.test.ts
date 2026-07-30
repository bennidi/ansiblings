/**
 * Tests for extractAgePublicKey.
 *
 * Runs against real files in a temp directory: the function is a thin wrapper
 * around fs plus a regex, and faking fs would only test the fake.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractAgePublicKey, runTool } from '../src/keyman.utils.js';

describe('extractAgePublicKey', () => {
  let tmpDir: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const keyFile = (contents: string) => {
    const file = path.join(tmpDir, 'age.key');
    fs.writeFileSync(file, contents);
    return file;
  };

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-utils-')));
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the public key from a standard age key file', () => {
    const file = keyFile(
      [
        '# created: 2026-01-01T00:00:00Z',
        '# public key: age1abc123xyz',
        'AGE-SECRET-KEY-1QQQ',
      ].join('\n')
    );

    expect(extractAgePublicKey(file)).toBe('age1abc123xyz');
  });

  it('tolerates extra whitespace after the label', () => {
    const file = keyFile('# public key:    age1spaced\n');

    expect(extractAgePublicKey(file)).toBe('age1spaced');
  });

  it('returns null and reports when the file does not exist', () => {
    const missing = path.join(tmpDir, 'nope.key');

    expect(extractAgePublicKey(missing)).toBeNull();
    expect(errorSpy.mock.calls[0][0]).toContain('Age key file not found');
  });

  it('returns null when the file has no public key line', () => {
    const file = keyFile('AGE-SECRET-KEY-1QQQ\n');

    expect(extractAgePublicKey(file)).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ignores a key that is not on its own line', () => {
    const file = keyFile('prefix # public key: age1inline\n');

    expect(extractAgePublicKey(file)).toBeNull();
  });

  it('returns null and reports when the file cannot be read', () => {
    const asDirectory = path.join(tmpDir, 'age.key');
    fs.mkdirSync(asDirectory);

    expect(extractAgePublicKey(asDirectory)).toBeNull();
    expect(errorSpy.mock.calls[0][0]).toContain('Failed to read key file');
  });
});

/**
 * These spawn real processes rather than mocking execa. The whole point of
 * runTool is the shape of an execa failure, and a mock would only assert what
 * this test already assumes.
 */
describe('runTool', () => {
  it('returns the result on success', async () => {
    const result = await runTool('node', ['-e', 'process.stdout.write("hi")']);

    expect(result.stdout).toBe('hi');
  });

  it('passes options through', async () => {
    const result = await runTool('node', ['-e', 'process.stdout.write(process.env.PROBE ?? "")'], {
      env: { PROBE: 'from-options' },
    });

    expect(result.stdout).toBe('from-options');
  });

  it('reports a missing binary as an instruction rather than an ENOENT', async () => {
    await expect(runTool('keyman-no-such-binary', [])).rejects.toThrow(
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
