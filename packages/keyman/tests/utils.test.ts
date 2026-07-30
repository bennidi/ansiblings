/**
 * Tests for extractAgePublicKey.
 *
 * Real files in a temp directory, but a mocked execa: the recipient is now
 * derived by spawning `age-keygen -y`, and the gate cannot depend on age being
 * installed on the machine running it. runTool itself is tested against real
 * processes in tool.test.ts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa } = vi.hoisted(() => ({ execa: vi.fn() }));

vi.mock('execa', () => ({ execa }));

import { extractAgePublicKey } from '../src/keyman.utils.js';

const DERIVED = 'age1derivedfromthesecretkey';
const IN_COMMENT = 'age1fromthecomment';

describe('extractAgePublicKey', () => {
  let tmpDir: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const keyFile = (contents: string) => {
    const file = path.join(tmpDir, 'age.key');
    fs.writeFileSync(file, contents);
    return file;
  };

  /** A well-formed identity file, whose comment can be made to disagree */
  const identity = (comment = DERIVED) =>
    keyFile(
      ['# created: 2026-01-01T00:00:00Z', `# public key: ${comment}`, 'AGE-SECRET-KEY-1QQQ'].join(
        '\n'
      )
    );

  /**
   * Makes age-keygen unavailable, the one case that falls back to the comment.
   *
   * Throws from an implementation rather than using mockRejectedValue: that
   * builds its rejected promise when the mock is configured, and configuring it
   * in a beforeEach leaves the rejection unhandled for a tick.
   */
  const noAgeKeygen = () => {
    execa.mockImplementation(async () => {
      throw Object.assign(new Error('spawn age-keygen ENOENT'), { code: 'ENOENT' });
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-utils-')));
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    execa.mockResolvedValue({ stdout: `${DERIVED}\n` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('derives the recipient from the secret key with age-keygen', async () => {
    const file = identity();

    await expect(extractAgePublicKey(file)).resolves.toBe(DERIVED);
    expect(execa).toHaveBeenCalledWith('age-keygen', ['-y', file]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('prefers the derived key over a comment that disagrees', async () => {
    // §2.3: the comment is editable text, and this is what makes it not matter.
    const file = identity('age1staleorforged');

    await expect(extractAgePublicKey(file)).resolves.toBe(DERIVED);
  });

  it('returns null and reports when the file does not exist', async () => {
    const missing = path.join(tmpDir, 'nope.key');

    await expect(extractAgePublicKey(missing)).resolves.toBeNull();
    expect(errorSpy.mock.calls[0][0]).toContain('Age key file not found');
    expect(execa).not.toHaveBeenCalled();
  });

  it('returns null when age-keygen refuses the file, without trusting the comment', async () => {
    const file = identity(IN_COMMENT);
    execa.mockRejectedValue(
      Object.assign(new Error('failed'), { exitCode: 1, stderr: 'age-keygen: error: malformed' })
    );

    await expect(extractAgePublicKey(file)).resolves.toBeNull();
    expect(errorSpy.mock.calls[0][0]).toContain('malformed');
  });

  it('returns null when age-keygen prints something that is not a recipient', async () => {
    const file = identity();
    execa.mockResolvedValue({ stdout: 'Public key: (none)\n' });

    await expect(extractAgePublicKey(file)).resolves.toBeNull();
    expect(errorSpy.mock.calls[0][0]).toContain('derived no public key');
  });

  describe('without age-keygen installed', () => {
    beforeEach(noAgeKeygen);

    it('falls back to the comment, warning that it is unverified', async () => {
      const file = identity(IN_COMMENT);

      await expect(extractAgePublicKey(file)).resolves.toBe(IN_COMMENT);
      expect(warnSpy.mock.calls[0][0]).toContain('unverified');
    });

    it('tolerates extra whitespace after the label', async () => {
      const file = keyFile('# public key:    age1spaced\n');

      await expect(extractAgePublicKey(file)).resolves.toBe('age1spaced');
    });

    it('returns null when the file has no public key line', async () => {
      const file = keyFile('AGE-SECRET-KEY-1QQQ\n');

      await expect(extractAgePublicKey(file)).resolves.toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('ignores a key that is not on its own line', async () => {
      const file = keyFile('prefix # public key: age1inline\n');

      await expect(extractAgePublicKey(file)).resolves.toBeNull();
    });

    it('returns null and reports when the file cannot be read', async () => {
      const asDirectory = path.join(tmpDir, 'age.key');
      fs.mkdirSync(asDirectory);

      await expect(extractAgePublicKey(asDirectory)).resolves.toBeNull();
      expect(errorSpy.mock.calls[0][0]).toContain('Failed to read key file');
    });
  });
});
