/**
 * Tests for storeInVault, the write path encrypt and generate share.
 *
 * Its ordinary use is covered through those two callers; what is here is the
 * behaviour that is awkward to reach from either — an ssh-keygen that succeeds
 * without printing anything, and a failure over an entry that already exists.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa } = vi.hoisted(() => ({ execa: vi.fn() }));

vi.mock('execa', () => ({ execa }));

import { listVaultKeys, storeInVault } from '../src/keyman.vault.js';

describe('listVaultKeys', () => {
  let keysDir: string;

  const entry = (name: string, file = `id_${name}.age`) => {
    fs.mkdirSync(path.join(keysDir, name), { recursive: true });
    fs.writeFileSync(path.join(keysDir, name, file), 'ENCRYPTED');
  };

  beforeEach(() => {
    keysDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-vaultlist-')));
  });

  afterEach(() => {
    fs.rmSync(keysDir, { recursive: true, force: true });
  });

  it('is empty for a keys directory that was never created', () => {
    expect(listVaultKeys(path.join(keysDir, 'nope'))).toEqual([]);
  });

  it('sorts the entries rather than taking the filesystem order', () => {
    for (const name of ['stage', 'alpha', 'prod']) {
      entry(name);
    }

    expect(listVaultKeys(keysDir)).toEqual(['alpha', 'prod', 'stage']);
  });

  it('ignores a directory with no encrypted key in it', () => {
    entry('prod');
    // The shape a failed encryption used to leave behind, and a plain mistake.
    fs.mkdirSync(path.join(keysDir, 'empty'));
    entry('notes', 'README.md');

    expect(listVaultKeys(keysDir)).toEqual(['prod']);
  });

  it('ignores a loose file', () => {
    entry('prod');
    fs.writeFileSync(path.join(keysDir, 'id_stage.age'), 'ENCRYPTED');

    expect(listVaultKeys(keysDir)).toEqual(['prod']);
  });
});

describe('storeInVault', () => {
  let root: string;
  let keysDir: string;
  let keyPath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const PUBKEY = 'age1recipient';

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-vault-')));
    keysDir = path.join(root, 'keys');
    keyPath = path.join(root, 'id_prod');
    fs.writeFileSync(keyPath, 'PRIVATE');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('warns when ssh-keygen succeeds but prints no key', async () => {
    execa.mockImplementation(async (binary: string, args: string[]) => {
      if (binary === 'ssh-keygen') return { stdout: '  \n' };
      fs.writeFileSync(args[args.indexOf('-o') + 1], 'ENCRYPTED');
      return { stdout: '' };
    });

    await storeInVault(keyPath, keysDir, PUBKEY);

    // An exit code of 0 is not a public key: writing a .pub holding whitespace
    // would put a file in the vault that no host would ever accept.
    expect(fs.existsSync(path.join(keysDir, 'prod', 'id_prod.pub'))).toBe(false);
    expect(messages(warnSpy)).toContain('no public key could be derived');
    expect(fs.existsSync(path.join(keysDir, 'prod', 'id_prod.age'))).toBe(true);
  });

  it('writes the public half at the same time as the encrypted key', async () => {
    fs.writeFileSync(`${keyPath}.pub`, 'ssh-ed25519 AAAA sibling');
    execa.mockImplementation(async (_binary: string, args: string[]) => {
      fs.writeFileSync(args[args.indexOf('-o') + 1], 'ENCRYPTED');
      return { stdout: '' };
    });

    const vaultPath = await storeInVault(keyPath, keysDir, PUBKEY);

    expect(vaultPath).toBe(path.join(keysDir, 'prod'));
    expect(fs.readFileSync(path.join(vaultPath, 'id_prod.pub'), 'utf-8')).toBe(
      'ssh-ed25519 AAAA sibling'
    );
    // No ssh-keygen: the sibling was there, so nothing needed deriving.
    expect(execa.mock.calls.every((c) => c[0] === 'age')).toBe(true);
  });

  it('creates the vault entry private to the owner', async () => {
    fs.writeFileSync(`${keyPath}.pub`, 'PUBLIC');
    execa.mockImplementation(async (_binary: string, args: string[]) => {
      fs.writeFileSync(args[args.indexOf('-o') + 1], 'ENCRYPTED');
      return { stdout: '' };
    });

    await storeInVault(keyPath, keysDir, PUBKEY);

    expect(fs.statSync(path.join(keysDir, 'prod')).mode & 0o777).toBe(0o700);
  });

  describe('when age fails', () => {
    beforeEach(() => {
      fs.writeFileSync(`${keyPath}.pub`, 'PUBLIC');
      execa.mockImplementation(async (_binary: string, args: string[]) => {
        // Half-written output, the way a failing age can leave it.
        fs.writeFileSync(args[args.indexOf('-o') + 1], 'TRUNC');
        throw Object.assign(new Error('age refused'), { stderr: 'no recipient' });
      });
    });

    it('leaves no truncated key behind for decrypt to offer', async () => {
      await expect(storeInVault(keyPath, keysDir, PUBKEY)).rejects.toThrow('`age` failed');

      expect(fs.existsSync(path.join(keysDir, 'prod'))).toBe(false);
    });

    it('keeps an entry that was already there', async () => {
      const vaultPath = path.join(keysDir, 'prod');
      fs.mkdirSync(vaultPath, { recursive: true });
      fs.writeFileSync(path.join(vaultPath, 'id_prod.pub'), 'THE OLD PUBLIC KEY');

      await expect(storeInVault(keyPath, keysDir, PUBKEY)).rejects.toThrow('`age` failed');

      // Cleaning up after a failure must not take the previous key with it.
      expect(fs.readFileSync(path.join(vaultPath, 'id_prod.pub'), 'utf-8')).toBe(
        'THE OLD PUBLIC KEY'
      );
      expect(messages(logSpy)).not.toContain('Encrypted and stored');
    });
  });
});
