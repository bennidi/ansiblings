/**
 * Tests for decryptKeys.
 *
 * Only `age` is mocked, and its stand-in writes the output file the way age
 * would: the copy and the chmod are now real fs calls, so the assertions are on
 * what ends up on disk and at what mode rather than on which binaries were
 * spawned.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa, prompt } = vi.hoisted(() => ({ execa: vi.fn(), prompt: vi.fn() }));

vi.mock('execa', () => ({ execa }));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { decryptKeys } from '../src/keyman.decrypt.js';

const LOCAL = 'local';
const SSH = 'ssh';

describe('decryptKeys', () => {
  let root: string;
  let sshDir: string;
  let vaultDir: string;
  let keysDir: string;
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const AGE_KEY = '/vault/age.key';

  /** Creates <vault>/keys/<name>/id_<name>.{age,pub}. */
  const vaultKey = (name: string) => {
    const dir = path.join(keysDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `id_${name}.age`), `ENCRYPTED ${name}`);
    fs.writeFileSync(path.join(dir, `id_${name}.pub`), `PUBLIC ${name}`);
  };

  /** Answers the selection prompt, then every overwrite confirmation. */
  const answers = (selectedKeys: string[], decryptMode = LOCAL, overwrite = false) => {
    prompt.mockImplementation(async (questions: { name: string }[]) =>
      questions[0].name === 'selectedKeys' ? { selectedKeys, decryptMode } : { overwrite }
    );
  };

  const choices = () => prompt.mock.calls[0]?.[0][0].choices as string[];

  const argsOf = (binary: string) =>
    execa.mock.calls.find((c) => c[0] === binary)?.[1] as string[] | undefined;

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  const modeOf = (file: string) => fs.statSync(file).mode & 0o777;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-decrypt-')));
    sshDir = path.join(root, '.ssh');
    vaultDir = path.join(root, 'vault');
    keysDir = path.join(vaultDir, 'keys');
    tmpDir = path.join(vaultDir, 'tmp');
    fs.mkdirSync(keysDir, { recursive: true });
    fs.mkdirSync(sshDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Stand in for `age -d`: write the plaintext to -o, 0644 as age does.
    execa.mockImplementation(async (_binary: string, args: string[]) => {
      const out = args[args.indexOf('-o') + 1];
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, 'PLAINTEXT', { mode: 0o644 });
      return { exitCode: 0 };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('warns when the vault holds no encrypted keys', async () => {
    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    expect(messages(logSpy)).toContain('No encrypted keys found.');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when the vault has no keys directory', async () => {
    fs.rmSync(keysDir, { recursive: true });

    await expect(decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY)).resolves.toBeUndefined();
    expect(messages(logSpy)).toContain('No encrypted keys found.');
  });

  it('reports a missing age binary rather than an ENOENT', async () => {
    vaultKey('prod');
    answers(['prod']);
    execa.mockImplementation(async () => {
      throw Object.assign(new Error('spawn age ENOENT'), { code: 'ENOENT' });
    });

    await expect(decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY)).rejects.toThrow(
      '`age` was not found on PATH'
    );
  });

  it('offers only directories that actually contain an encrypted key', async () => {
    vaultKey('prod');
    fs.mkdirSync(path.join(keysDir, 'empty'), { recursive: true });
    fs.writeFileSync(path.join(keysDir, 'README.md'), '');
    answers([]);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    expect(choices()).toEqual(['prod']);
  });

  it('decrypts into the vault tmp directory', async () => {
    vaultKey('prod');
    answers(['prod']);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    const out = path.join(tmpDir, 'id_prod');
    expect(argsOf('age')).toEqual([
      '-d',
      '-i',
      AGE_KEY,
      '-o',
      out,
      path.join(keysDir, 'prod', 'id_prod.age'),
    ]);
    expect(fs.readFileSync(out, 'utf-8')).toBe('PLAINTEXT');
    expect(fs.readFileSync(`${out}.pub`, 'utf-8')).toBe('PUBLIC prod');
    expect(messages(logSpy)).toContain(`Decrypted: ${out}`);
  });

  it('decrypts into the .ssh directory when asked', async () => {
    vaultKey('prod');
    answers(['prod'], SSH);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    const out = path.join(sshDir, 'id_prod');
    expect(argsOf('age')?.[4]).toBe(out);
    expect(fs.readFileSync(`${out}.pub`, 'utf-8')).toBe('PUBLIC prod');
  });

  it('creates the .ssh directory when it does not exist, private to the owner', async () => {
    fs.rmSync(sshDir, { recursive: true });
    vaultKey('prod');
    answers(['prod'], SSH);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    expect(modeOf(sshDir)).toBe(0o700);
    expect(fs.existsSync(path.join(sshDir, 'id_prod'))).toBe(true);
  });

  it('leaves the private key at 0600, never observable at what age wrote', async () => {
    vaultKey('prod');
    answers(['prod']);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    expect(modeOf(path.join(tmpDir, 'id_prod'))).toBe(0o600);
  });

  it('decrypts every selected key with one spawn each', async () => {
    vaultKey('prod');
    vaultKey('stage');
    answers(['prod', 'stage']);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    // One age per key: the cp and chmod spawns are gone.
    expect(execa).toHaveBeenCalledTimes(2);
    expect(execa.mock.calls.every((c) => c[0] === 'age')).toBe(true);
  });

  it('does nothing when the selection is empty', async () => {
    vaultKey('prod');
    answers([]);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    expect(execa).not.toHaveBeenCalled();
  });

  it('writes the private key even when the vault entry has no public key', async () => {
    vaultKey('prod');
    fs.rmSync(path.join(keysDir, 'prod', 'id_prod.pub'));
    answers(['prod']);

    await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

    expect(fs.existsSync(path.join(tmpDir, 'id_prod'))).toBe(true);
    expect(messages(logSpy)).toContain('has no public key in the vault');
  });

  describe('when the target already exists', () => {
    const existing = (dir: string, name = 'id_prod') => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), 'PRECIOUS EXISTING KEY');
      return path.join(dir, name);
    };

    it('keeps the existing key by default', async () => {
      vaultKey('prod');
      const target = existing(tmpDir);
      answers(['prod']);

      await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

      expect(fs.readFileSync(target, 'utf-8')).toBe('PRECIOUS EXISTING KEY');
      expect(execa).not.toHaveBeenCalled();
      expect(messages(logSpy)).toContain('Skipped prod');
    });

    it('asks before overwriting, defaulting to no', async () => {
      vaultKey('prod');
      existing(tmpDir);
      answers(['prod']);

      await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

      const confirm = prompt.mock.calls.at(-1)?.[0][0];
      expect(confirm).toMatchObject({ type: 'confirm', default: false });
      expect(confirm.message).toContain(path.join(tmpDir, 'id_prod'));
    });

    it('overwrites once confirmed', async () => {
      vaultKey('prod');
      const target = existing(tmpDir);
      answers(['prod'], LOCAL, true);

      await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

      expect(fs.readFileSync(target, 'utf-8')).toBe('PLAINTEXT');
    });

    it('asks about an existing public key too', async () => {
      vaultKey('prod');
      existing(tmpDir, 'id_prod.pub');
      answers(['prod']);

      await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

      expect(execa).not.toHaveBeenCalled();
      expect(prompt.mock.calls.at(-1)?.[0][0].message).toContain('id_prod.pub');
    });

    it('protects a key in .ssh the same way', async () => {
      vaultKey('prod');
      const target = existing(sshDir);
      answers(['prod'], SSH);

      await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

      expect(fs.readFileSync(target, 'utf-8')).toBe('PRECIOUS EXISTING KEY');
    });

    it('settles every collision before decrypting anything', async () => {
      vaultKey('prod');
      vaultKey('stage');
      existing(tmpDir);
      answers(['prod', 'stage']);

      await decryptKeys(sshDir, keysDir, tmpDir, AGE_KEY);

      // stage is written, prod is kept — and the question about prod was asked
      // before either was touched.
      expect(fs.existsSync(path.join(tmpDir, 'id_stage'))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, 'id_prod'), 'utf-8')).toBe('PRECIOUS EXISTING KEY');
      expect(execa).toHaveBeenCalledTimes(1);
    });
  });
});
