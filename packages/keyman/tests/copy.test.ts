/**
 * Tests for copyKey.
 *
 * inquirer and execa are mocked so nothing touches a TTY or the real
 * clipboard; the key directories are real temp directories.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa, prompt } = vi.hoisted(() => ({ execa: vi.fn(), prompt: vi.fn() }));

vi.mock('execa', () => ({ execa }));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { copyKey } from '../src/keyman.copy.js';

describe('copyKey', () => {
  let root: string;
  let sshDir: string;
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const touch = (dir: string, file: string, contents = '') => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), contents);
  };

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  /** The choices offered by the last inquirer.prompt call. */
  const choices = () => prompt.mock.calls.at(-1)?.[0][0].choices as string[];

  /** What was piped into the clipboard command. */
  const piped = () => (execa.mock.calls.at(-1)?.[2] as { input?: string } | undefined)?.input;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-copy-')));
    sshDir = path.join(root, '.ssh');
    tmpDir = path.join(root, 'tmp');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    execa.mockResolvedValue({ stdout: '' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('warns when neither directory exists', async () => {
    await copyKey(sshDir, tmpDir);

    expect(messages(logSpy)).toContain('No SSH keys found.');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('warns when the directories hold no private keys', async () => {
    touch(sshDir, 'known_hosts');
    touch(tmpDir, 'id_prod.pub');

    await copyKey(sshDir, tmpDir);

    expect(messages(logSpy)).toContain('No SSH keys found.');
  });

  it('offers the keys from both directories without duplicates', async () => {
    touch(sshDir, 'id_prod');
    touch(sshDir, 'id_prod.pub');
    touch(tmpDir, 'id_prod');
    touch(tmpDir, 'id_stage');
    prompt.mockResolvedValue({ selectedKey: 'id_prod' });
    touch(tmpDir, 'id_prod.pub');

    await copyKey(sshDir, tmpDir);

    expect(choices()).toEqual(['id_prod', 'id_stage']);
  });

  it('copies the trimmed public key from tmp to the clipboard', async () => {
    touch(tmpDir, 'id_prod');
    touch(tmpDir, 'id_prod.pub', 'ssh-ed25519 AAAA tmp\n');
    touch(sshDir, 'id_prod.pub', 'ssh-ed25519 AAAA ssh\n');
    prompt.mockResolvedValue({ selectedKey: 'id_prod' });

    await copyKey(sshDir, tmpDir);

    expect(piped()).toBe('ssh-ed25519 AAAA tmp');
    expect(messages(logSpy)).toContain('copied to clipboard');
  });

  it('falls back to the public key in .ssh', async () => {
    touch(sshDir, 'id_prod');
    touch(sshDir, 'id_prod.pub', 'ssh-ed25519 AAAA ssh\n');
    prompt.mockResolvedValue({ selectedKey: 'id_prod' });

    await copyKey(sshDir, tmpDir);

    expect(piped()).toBe('ssh-ed25519 AAAA ssh');
  });

  it('reports a missing public key without invoking the clipboard', async () => {
    touch(sshDir, 'id_prod');
    prompt.mockResolvedValue({ selectedKey: 'id_prod' });

    await copyKey(sshDir, tmpDir);

    expect(messages(errorSpy)).toContain('Public key not found for id_prod');
    expect(execa).not.toHaveBeenCalled();
  });

  it('reports a clipboard failure instead of throwing', async () => {
    touch(sshDir, 'id_prod');
    touch(sshDir, 'id_prod.pub', 'ssh-ed25519 AAAA ssh');
    prompt.mockResolvedValue({ selectedKey: 'id_prod' });
    execa.mockRejectedValue(Object.assign(new Error('refused'), { stderr: 'no display' }));

    await expect(copyKey(sshDir, tmpDir)).resolves.toBeUndefined();
    expect(messages(errorSpy)).toContain('Failed to copy to clipboard');
  });

  it('prints the key when no clipboard command exists at all', async () => {
    touch(sshDir, 'id_prod');
    touch(sshDir, 'id_prod.pub', 'ssh-ed25519 AAAA ssh');
    prompt.mockResolvedValue({ selectedKey: 'id_prod' });
    execa.mockImplementation(async () => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    });

    await copyKey(sshDir, tmpDir);

    // The operation is "give me this public key". Without a clipboard it is still
    // answerable, and it used to be a dead end on every platform but macOS.
    expect(messages(logSpy)).toContain('ssh-ed25519 AAAA ssh');
    expect(messages(warnSpy)).toContain('No clipboard command found');
  });

  it('names the private keys it cannot manage', async () => {
    touch(sshDir, 'id_prod');
    touch(sshDir, 'id_prod.pub', 'PUBLIC');
    touch(sshDir, 'deploy_ed25519', '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n');
    prompt.mockResolvedValue({ selectedKey: 'id_prod' });

    await copyKey(sshDir, tmpDir);

    expect(choices()).toEqual(['id_prod']);
    expect(messages(logSpy)).toContain('deploy_ed25519');
    expect(messages(logSpy)).toContain('not named id_*');
  });
});
