/**
 * Tests for decryptKeys.
 *
 * age, cp and chmod are all mocked; the assertions cover which keys are
 * offered and exactly where each decrypted key is written.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa, prompt } = vi.hoisted(() => ({ execa: vi.fn(), prompt: vi.fn() }));

vi.mock('execa', () => ({ execa }));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { decryptKeys } from '../src/keyman.decrypt.js';

const LOCAL = 'Local (vault/tmp)';
const SSH = 'SSH (~/.ssh)';

describe('decryptKeys', () => {
  let root: string;
  let sshDir: string;
  let vaultDir: string;
  let keyDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const AGE_KEY = '/vault/age.key';

  /** Creates <vault>/keys/<name>/id_<name>.{age,pub}. */
  const vaultKey = (name: string) => {
    const dir = path.join(keyDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `id_${name}.age`), 'ENCRYPTED');
    fs.writeFileSync(path.join(dir, `id_${name}.pub`), 'PUBLIC');
  };

  const choices = () => prompt.mock.calls.at(-1)?.[0][0].choices as string[];

  const argsOf = (binary: string) =>
    execa.mock.calls.find((c) => c[0] === binary)?.[1] as string[] | undefined;

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-decrypt-')));
    sshDir = path.join(root, '.ssh');
    vaultDir = path.join(root, 'vault');
    keyDir = path.join(vaultDir, 'keys');
    fs.mkdirSync(keyDir, { recursive: true });
    fs.mkdirSync(sshDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    execa.mockResolvedValue({ exitCode: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('warns when the vault holds no encrypted keys', async () => {
    await decryptKeys(sshDir, vaultDir, AGE_KEY);

    expect(messages(logSpy)).toContain('No encrypted keys found.');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when the vault has no keys directory', async () => {
    fs.rmSync(keyDir, { recursive: true });

    await expect(decryptKeys(sshDir, vaultDir, AGE_KEY)).resolves.toBeUndefined();
    expect(messages(logSpy)).toContain('No encrypted keys found.');
  });

  it('reports a missing age binary rather than an ENOENT', async () => {
    vaultKey('prod');
    prompt.mockResolvedValue({ selectedKeys: ['prod'], decryptMode: LOCAL });
    execa.mockRejectedValue(Object.assign(new Error('spawn age ENOENT'), { code: 'ENOENT' }));

    await expect(decryptKeys(sshDir, vaultDir, AGE_KEY)).rejects.toThrow(
      '`age` was not found on PATH'
    );
  });

  it('offers only directories that actually contain an encrypted key', async () => {
    vaultKey('prod');
    fs.mkdirSync(path.join(keyDir, 'empty'), { recursive: true });
    fs.writeFileSync(path.join(keyDir, 'README.md'), '');
    prompt.mockResolvedValue({ selectedKeys: [], decryptMode: LOCAL });

    await decryptKeys(sshDir, vaultDir, AGE_KEY);

    expect(choices()).toEqual(['prod']);
  });

  it('decrypts into the vault tmp directory', async () => {
    vaultKey('prod');
    prompt.mockResolvedValue({ selectedKeys: ['prod'], decryptMode: LOCAL });

    await decryptKeys(sshDir, vaultDir, AGE_KEY);

    const out = path.join(vaultDir, 'tmp', 'id_prod');
    expect(argsOf('age')).toEqual([
      '-d',
      '-i',
      AGE_KEY,
      '-o',
      out,
      path.join(keyDir, 'prod', 'id_prod.age'),
    ]);
    expect(argsOf('cp')).toEqual([path.join(keyDir, 'prod', 'id_prod.pub'), `${out}.pub`]);
    expect(argsOf('chmod')).toEqual(['600', out]);
    expect(messages(logSpy)).toContain(`Decrypted: ${out}`);
  });

  it('decrypts into the .ssh directory when asked', async () => {
    vaultKey('prod');
    prompt.mockResolvedValue({ selectedKeys: ['prod'], decryptMode: SSH });

    await decryptKeys(sshDir, vaultDir, AGE_KEY);

    const out = path.join(sshDir, 'id_prod');
    expect(argsOf('age')?.[4]).toBe(out);
    expect(argsOf('cp')?.[1]).toBe(`${out}.pub`);
    expect(argsOf('chmod')).toEqual(['600', out]);
  });

  it('decrypts every selected key', async () => {
    vaultKey('prod');
    vaultKey('stage');
    prompt.mockResolvedValue({ selectedKeys: ['prod', 'stage'], decryptMode: LOCAL });

    await decryptKeys(sshDir, vaultDir, AGE_KEY);

    // age, cp and chmod for each of the two keys.
    expect(execa).toHaveBeenCalledTimes(6);
  });

  it('does nothing when the selection is empty', async () => {
    vaultKey('prod');
    prompt.mockResolvedValue({ selectedKeys: [], decryptMode: LOCAL });

    await decryptKeys(sshDir, vaultDir, AGE_KEY);

    expect(execa).not.toHaveBeenCalled();
  });
});
