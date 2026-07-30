/**
 * Tests for generateKey.
 *
 * ssh-keygen and age are mocked; the ssh-keygen mock writes the files the real
 * binary would produce so the copy-into-vault step has something to work with.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa, prompt } = vi.hoisted(() => ({ execa: vi.fn(), prompt: vi.fn() }));

vi.mock('execa', () => ({ execa }));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { generateKey } from '../src/keyman.generate.js';

describe('generateKey', () => {
  let root: string;
  let tmpDir: string;
  let keysDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const PUBKEY = 'age1recipient';

  /** Answers each prompt by the name of the question it asks. */
  const answer = (answers: Record<string, string>) => {
    prompt.mockImplementation(async (questions: { name: string }[]) => {
      const { name } = questions[0];
      return { [name]: answers[name] ?? '' };
    });
  };

  /** The question object from the prompt call for `name`. */
  const question = (name: string) =>
    prompt.mock.calls.map((c) => c[0][0]).find((q) => q.name === name);

  /** The argv of the mocked call to `binary`. */
  const argsOf = (binary: string) =>
    execa.mock.calls.find((c) => c[0] === binary)?.[1] as string[] | undefined;

  /** The options of the mocked call to `binary`. */
  const optionsOf = (binary: string) =>
    execa.mock.calls.find((c) => c[0] === binary)?.[2] as { stdio?: unknown } | undefined;

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-generate-')));
    tmpDir = path.join(root, 'tmp');
    keysDir = path.join(root, 'keys');
    fs.mkdirSync(tmpDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Stand in for the real binaries: ssh-keygen writes a key pair, age is a no-op.
    execa.mockImplementation(async (binary: string, args: string[]) => {
      if (binary === 'ssh-keygen') {
        const keyPath = args[args.indexOf('-f') + 1];
        fs.writeFileSync(keyPath, 'PRIVATE');
        fs.writeFileSync(`${keyPath}.pub`, 'ssh-ed25519 AAAA generated');
      }
      return { exitCode: 0 };
    });

    answer({ algorithm: 'ed25519', keyName: 'prod', identity: 'me@host' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('generates the key pair with the answers it collected', async () => {
    await generateKey(tmpDir, keysDir, PUBKEY);

    expect(argsOf('ssh-keygen')).toEqual([
      '-t',
      'ed25519',
      '-f',
      path.join(tmpDir, 'id_prod'),
      '-C',
      'me@host',
    ]);
    expect(messages(logSpy)).toContain('Key generated');
  });

  it('never handles the passphrase itself', async () => {
    await generateKey(tmpDir, keysDir, PUBKEY);

    // No -N, so ssh-keygen prompts and confirms; inherited stdio is what makes
    // that prompt reach the terminal. The passphrase never touches argv.
    expect(argsOf('ssh-keygen')).not.toContain('-N');
    expect(optionsOf('ssh-keygen')).toEqual({ stdio: 'inherit' });
    expect(prompt.mock.calls.map((c) => c[0][0].name)).not.toContain('password');
  });

  it('does not prefix a key name that already starts with id_', async () => {
    answer({ algorithm: 'ed25519', keyName: 'id_prod', identity: '' });

    await generateKey(tmpDir, keysDir, PUBKEY);

    expect(argsOf('ssh-keygen')).toContain(path.join(tmpDir, 'id_prod'));
  });

  it('requests a 4096 bit key for rsa', async () => {
    answer({ algorithm: 'rsa', keyName: 'prod', identity: '' });

    await generateKey(tmpDir, keysDir, PUBKEY);

    expect(argsOf('ssh-keygen')?.slice(-2)).toEqual(['-b', '4096']);
  });

  it('rejects an empty key name', async () => {
    await generateKey(tmpDir, keysDir, PUBKEY);

    const { validate } = question('keyName');
    expect(validate('   ')).toBe('Key name cannot be empty');
    expect(validate('prod')).toBe(true);
  });

  it('encrypts the new key into the vault and copies the public key', async () => {
    await generateKey(tmpDir, keysDir, PUBKEY);

    const vaultPath = path.join(keysDir, 'prod');
    expect(argsOf('age')).toEqual([
      '-r',
      PUBKEY,
      '-o',
      path.join(vaultPath, 'id_prod.age'),
      path.join(tmpDir, 'id_prod'),
    ]);
    expect(fs.readFileSync(path.join(vaultPath, 'id_prod.pub'), 'utf-8')).toBe(
      'ssh-ed25519 AAAA generated'
    );
    expect(messages(logSpy)).toContain('Encrypted and stored');
  });

  it('refuses to overwrite an existing key file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'id_prod'), 'EXISTING');

    await generateKey(tmpDir, keysDir, PUBKEY);

    expect(messages(errorSpy)).toContain('Key file id_prod already exists');
    expect(execa).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(tmpDir, 'id_prod'), 'utf-8')).toBe('EXISTING');
  });

  it('reports a failure from ssh-keygen without reaching age', async () => {
    execa.mockImplementation(async () => {
      throw Object.assign(new Error('ssh-keygen exploded'), { stderr: 'ssh-keygen exploded' });
    });

    await expect(generateKey(tmpDir, keysDir, PUBKEY)).resolves.toBeUndefined();
    expect(messages(errorSpy)).toContain('Error generating key');
    expect(argsOf('age')).toBeUndefined();
    expect(fs.existsSync(path.join(keysDir, 'prod'))).toBe(false);
  });

  it('reports a failure from age and says the key is still there to encrypt', async () => {
    execa.mockImplementation(async (binary: string, args: string[]) => {
      if (binary === 'age') {
        throw Object.assign(new Error('age exploded'), { stderr: 'age exploded' });
      }
      const keyPath = args[args.indexOf('-f') + 1];
      fs.writeFileSync(keyPath, 'PRIVATE');
      fs.writeFileSync(`${keyPath}.pub`, 'ssh-ed25519 AAAA generated');
      return { exitCode: 0 };
    });

    await generateKey(tmpDir, keysDir, PUBKEY);

    expect(messages(errorSpy)).toContain('Error encrypting key');
    // The generated key is the thing of value, and it survived.
    expect(fs.existsSync(path.join(tmpDir, 'id_prod'))).toBe(true);
    expect(messages(errorSpy)).toContain(path.join(tmpDir, 'id_prod'));
    // And no half-made vault entry was left claiming to hold it.
    expect(fs.existsSync(path.join(keysDir, 'prod'))).toBe(false);
  });
});
