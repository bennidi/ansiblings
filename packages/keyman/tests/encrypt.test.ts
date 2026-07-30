/**
 * Tests for encryptKeys.
 *
 * `age` is mocked out; everything the function does to the filesystem itself
 * (creating the vault layout, copying public keys) is asserted for real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa, prompt } = vi.hoisted(() => ({ execa: vi.fn(), prompt: vi.fn() }));

vi.mock('execa', () => ({ execa }));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { encryptKeys } from '../src/keyman.encrypt.js';

describe('encryptKeys', () => {
  let root: string;
  let sshDir: string;
  let keysDir: string;
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const PUBKEY = 'age1recipient';

  const key = (dir: string, name: string, marker: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), `PRIVATE ${marker}`);
    fs.writeFileSync(path.join(dir, `${name}.pub`), `PUBLIC ${marker}`);
  };

  const choices = () => prompt.mock.calls.at(-1)?.[0][0].choices as string[];

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-encrypt-')));
    sshDir = path.join(root, '.ssh');
    keysDir = path.join(root, 'vault', 'keys');
    tmpDir = path.join(root, 'vault', 'tmp');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Stand in for `age`: record the call and write the output file.
    execa.mockImplementation(async (_binary: string, args: string[]) => {
      fs.writeFileSync(args[args.indexOf('-o') + 1], 'ENCRYPTED');
      return { exitCode: 0 };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('warns when there is nothing to encrypt', async () => {
    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    expect(messages(logSpy)).toContain('No private SSH keys found to encrypt.');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when the .ssh directory does not exist', async () => {
    fs.rmSync(sshDir, { recursive: true });

    await expect(encryptKeys(sshDir, keysDir, tmpDir, PUBKEY)).resolves.toBeUndefined();
    expect(messages(logSpy)).toContain('No private SSH keys found to encrypt.');
  });

  it('still offers the .ssh keys when the tmp directory does not exist', async () => {
    fs.rmSync(tmpDir, { recursive: true });
    key(sshDir, 'id_prod', 'ssh');
    prompt.mockResolvedValue({ selectedKeys: [] });

    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    expect(choices()).toEqual(['id_prod']);
  });

  it('reports a missing age binary rather than an ENOENT', async () => {
    key(sshDir, 'id_prod', 'ssh');
    prompt.mockResolvedValue({ selectedKeys: ['id_prod'] });
    execa.mockRejectedValue(Object.assign(new Error('spawn age ENOENT'), { code: 'ENOENT' }));

    await expect(encryptKeys(sshDir, keysDir, tmpDir, PUBKEY)).rejects.toThrow(
      '`age` was not found on PATH'
    );
  });

  it('ignores public keys and unrelated files when building the list', async () => {
    fs.writeFileSync(path.join(sshDir, 'known_hosts'), '');
    fs.writeFileSync(path.join(sshDir, 'id_orphan.pub'), 'PUBLIC');

    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    expect(messages(logSpy)).toContain('No private SSH keys found to encrypt.');
  });

  it('offers the keys from .ssh and tmp without duplicates', async () => {
    key(sshDir, 'id_prod', 'ssh');
    key(tmpDir, 'id_prod', 'tmp');
    key(tmpDir, 'id_stage', 'tmp');
    prompt.mockResolvedValue({ selectedKeys: [] });

    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    expect(choices()).toEqual(['id_prod', 'id_stage']);
  });

  it('encrypts a key from .ssh into the vault', async () => {
    key(sshDir, 'id_prod', 'ssh');
    prompt.mockResolvedValue({ selectedKeys: ['id_prod'] });

    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    const vaultPath = path.join(keysDir, 'prod');
    expect(execa).toHaveBeenCalledWith('age', [
      '-r',
      PUBKEY,
      '-o',
      path.join(vaultPath, 'id_prod.age'),
      path.join(sshDir, 'id_prod'),
    ]);
    expect(fs.readFileSync(path.join(vaultPath, 'id_prod.pub'), 'utf-8')).toBe('PUBLIC ssh');
    expect(messages(logSpy)).toContain('Encrypted and stored');
  });

  it('prefers the tmp copy when a key exists in both directories', async () => {
    key(sshDir, 'id_prod', 'ssh');
    key(tmpDir, 'id_prod', 'tmp');
    prompt.mockResolvedValue({ selectedKeys: ['id_prod'] });

    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    expect(execa.mock.calls[0][1]).toContain(path.join(tmpDir, 'id_prod'));
    expect(fs.readFileSync(path.join(keysDir, 'prod', 'id_prod.pub'), 'utf-8')).toBe('PUBLIC tmp');
  });

  it('encrypts every selected key', async () => {
    key(sshDir, 'id_prod', 'ssh');
    key(sshDir, 'id_stage', 'ssh');
    prompt.mockResolvedValue({ selectedKeys: ['id_prod', 'id_stage'] });

    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    expect(execa).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(keysDir, 'prod', 'id_prod.age'))).toBe(true);
    expect(fs.existsSync(path.join(keysDir, 'stage', 'id_stage.age'))).toBe(true);
  });

  it('does nothing when the selection is empty', async () => {
    key(sshDir, 'id_prod', 'ssh');
    prompt.mockResolvedValue({ selectedKeys: [] });

    await encryptKeys(sshDir, keysDir, tmpDir, PUBKEY);

    expect(execa).not.toHaveBeenCalled();
    expect(fs.existsSync(keysDir)).toBe(false);
  });
});
