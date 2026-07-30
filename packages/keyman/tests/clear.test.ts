/**
 * Tests for the plaintext hygiene helpers: the vault .gitignore and the
 * clear-decrypted-keys operation.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prompt } = vi.hoisted(() => ({ prompt: vi.fn() }));

vi.mock('inquirer', () => ({ default: { prompt } }));

import { clearDecryptedKeys, writeVaultGitignore } from '../src/keyman.clear.js';

describe('writeVaultGitignore', () => {
  let vaultRoot: string;

  const read = () => fs.readFileSync(path.join(vaultRoot, '.gitignore'), 'utf-8');

  beforeEach(() => {
    vaultRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-ignore-')));
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('ignores the identity and the decrypted keys, not the encrypted ones', () => {
    writeVaultGitignore(vaultRoot, path.join(vaultRoot, 'tmp'), path.join(vaultRoot, 'age.key'));

    const contents = read();
    expect(contents).toContain('age.key\n');
    expect(contents).toContain('age.key.pub');
    expect(contents).toContain('tmp/');
    // The encrypted keys are the thing worth committing.
    expect(contents).not.toContain('keys/');
  });

  it('uses the configured names', () => {
    writeVaultGitignore(
      vaultRoot,
      path.join(vaultRoot, 'plain'),
      path.join(vaultRoot, 'identity.age')
    );

    expect(read()).toContain('plain/');
    expect(read()).toContain('identity.age');
  });

  it('says nothing about a directory outside the vault', () => {
    writeVaultGitignore(vaultRoot, '/elsewhere/tmp', path.join(vaultRoot, 'age.key'));

    // A .gitignore cannot speak for a path above itself, and pretending otherwise
    // would read as protection that is not there.
    expect(read()).not.toContain('elsewhere');
    expect(read()).toContain('age.key');
  });

  it('never overwrites an existing file', () => {
    fs.writeFileSync(path.join(vaultRoot, '.gitignore'), 'mine\n');

    writeVaultGitignore(vaultRoot, path.join(vaultRoot, 'tmp'), path.join(vaultRoot, 'age.key'));

    expect(read()).toBe('mine\n');
  });

  it('creates it private to the owner', () => {
    writeVaultGitignore(vaultRoot, path.join(vaultRoot, 'tmp'), path.join(vaultRoot, 'age.key'));

    expect(fs.statSync(path.join(vaultRoot, '.gitignore')).mode & 0o777).toBe(0o600);
  });
});

describe('clearDecryptedKeys', () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const messages = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  const decrypted = (name: string) => {
    fs.writeFileSync(path.join(tmpDir, name), 'PRIVATE');
    fs.writeFileSync(path.join(tmpDir, `${name}.pub`), 'PUBLIC');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-clear-')));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    prompt.mockResolvedValue({ confirmed: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('says so when there is nothing to clear', async () => {
    await clearDecryptedKeys(tmpDir);

    expect(messages()).toContain('Nothing decrypted');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('does not mind a tmp directory that was never created', async () => {
    fs.rmSync(tmpDir, { recursive: true });

    await expect(clearDecryptedKeys(tmpDir)).resolves.toBeUndefined();
  });

  it('removes each key and its public half', async () => {
    decrypted('id_prod');
    decrypted('id_stage');

    await clearDecryptedKeys(tmpDir);

    expect(fs.readdirSync(tmpDir)).toEqual([]);
    expect(messages()).toContain('Removed id_prod');
  });

  it('lists what it is about to delete before asking', async () => {
    decrypted('id_prod');

    await clearDecryptedKeys(tmpDir);

    const askedAt = messages().indexOf('id_prod');
    expect(askedAt).toBeGreaterThanOrEqual(0);
    expect(prompt.mock.calls[0][0][0]).toMatchObject({ type: 'confirm', default: false });
  });

  it('keeps everything when the confirmation is declined', async () => {
    decrypted('id_prod');
    prompt.mockResolvedValue({ confirmed: false });

    await clearDecryptedKeys(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, 'id_prod'))).toBe(true);
    expect(messages()).toContain('Nothing was deleted');
  });

  it('leaves files that are not keys alone', async () => {
    decrypted('id_prod');
    fs.writeFileSync(path.join(tmpDir, 'notes.md'), 'mine');

    await clearDecryptedKeys(tmpDir);

    expect(fs.readdirSync(tmpDir)).toEqual(['notes.md']);
  });

  it('does not fail on a key whose public half is missing', async () => {
    fs.writeFileSync(path.join(tmpDir, 'id_prod'), 'PRIVATE');

    await clearDecryptedKeys(tmpDir);

    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});
