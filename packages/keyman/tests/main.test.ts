/**
 * Tests for the keyman() menu loop.
 *
 * Every operation it dispatches to has its own suite, so they are all mocked
 * here: what is under test is path resolution, dispatch and the loop itself.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prompt,
  loadConfig,
  resolveConfigPaths,
  listKeys,
  copyKey,
  generateKey,
  encryptKeys,
  decryptKeys,
  extractAgePublicKey,
} = vi.hoisted(() => ({
  prompt: vi.fn(),
  loadConfig: vi.fn(),
  resolveConfigPaths: vi.fn(),
  listKeys: vi.fn(),
  copyKey: vi.fn(),
  generateKey: vi.fn(),
  encryptKeys: vi.fn(),
  decryptKeys: vi.fn(),
  extractAgePublicKey: vi.fn(),
}));

vi.mock('inquirer', () => ({ default: { prompt } }));
vi.mock('../src/keyman.config.js', () => ({ loadConfig, resolveConfigPaths }));
vi.mock('../src/keyman.list.js', () => ({ listKeys }));
vi.mock('../src/keyman.copy.js', () => ({ copyKey }));
vi.mock('../src/keyman.generate.js', () => ({ generateKey }));
vi.mock('../src/keyman.encrypt.js', () => ({ encryptKeys }));
vi.mock('../src/keyman.decrypt.js', () => ({ decryptKeys }));
vi.mock('../src/keyman.utils.js', () => ({ extractAgePublicKey }));

import { keyman } from '../src/keyman.main.js';

describe('keyman', () => {
  let root: string;
  let paths: { vaultRoot: string; keysDir: string; tmpDir: string; keyPath: string };
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  /** Answers the leading `user` prompt, then walks the given menu choices. */
  const menu = (categories: string[], user = '@current') => {
    const queue = [...categories, 'quit'];
    prompt.mockImplementation(async (questions: { name: string }[]) => {
      const { name } = questions[0];
      if (name === 'user') return { user };
      return { category: queue.shift() };
    });
  };

  const output = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    originalHome = process.env.HOME;
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-main-')));
    process.env.HOME = path.join(root, 'home');

    paths = {
      vaultRoot: path.join(root, 'vault'),
      keysDir: path.join(root, 'vault', 'keys'),
      tmpDir: path.join(root, 'vault', 'tmp'),
      keyPath: path.join(root, 'vault', 'age.key'),
    };
    loadConfig.mockReturnValue({
      vaultRoot: 'vault',
      keysDir: 'keys',
      tmpDir: 'tmp',
      ageKeyFile: 'age.key',
    });
    resolveConfigPaths.mockReturnValue(paths);
    extractAgePublicKey.mockResolvedValue('age1recipient');

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    menu([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('prints the resolved paths and creates the vault directories', async () => {
    await keyman();

    expect(output()).toContain(paths.vaultRoot);
    expect(output()).toContain(paths.keysDir);
    expect(output()).toContain(paths.keyPath);
    expect(fs.existsSync(paths.vaultRoot)).toBe(true);
    expect(fs.existsSync(paths.tmpDir)).toBe(true);
    // keysDir too: decrypt reads it, and nothing created it before the first
    // encrypt, so a fresh vault could not be decrypted from.
    expect(fs.existsSync(paths.keysDir)).toBe(true);
  });

  it('creates the vault directories private to the owner', async () => {
    await keyman();

    for (const dir of [paths.vaultRoot, paths.keysDir, paths.tmpDir]) {
      expect(fs.statSync(dir).mode & 0o777, dir).toBe(0o700);
    }
  });

  it('quits without running any operation', async () => {
    await keyman();

    expect(output()).toContain('Goodbye!');
    expect(listKeys).not.toHaveBeenCalled();
  });

  it('offers every operation in the menu', async () => {
    await keyman();

    const menuQuestion = prompt.mock.calls.at(-1)?.[0][0] as { choices: { value: string }[] };
    expect(menuQuestion.choices.map((c) => c.value)).toEqual([
      'list',
      'copy',
      'generate',
      'encrypt',
      'decrypt',
      'clear',
      'quit',
    ]);
  });

  it('lists keys against the .ssh directory of the current user', async () => {
    menu(['list']);

    await keyman();

    expect(listKeys).toHaveBeenCalledWith(
      path.join(process.env.HOME as string, '.ssh'),
      paths.keysDir,
      paths.tmpDir
    );
  });

  it('copies a public key', async () => {
    menu(['copy']);

    await keyman();

    expect(copyKey).toHaveBeenCalledWith(
      path.join(process.env.HOME as string, '.ssh'),
      paths.tmpDir
    );
  });

  it('generates a key with the age recipient from the key file', async () => {
    menu(['generate']);

    await keyman();

    expect(extractAgePublicKey).toHaveBeenCalledWith(paths.keyPath);
    expect(generateKey).toHaveBeenCalledWith(paths.tmpDir, paths.keysDir, 'age1recipient');
  });

  it('encrypts keys into the configured keys directory', async () => {
    menu(['encrypt']);

    await keyman();

    expect(encryptKeys).toHaveBeenCalledWith(
      path.join(process.env.HOME as string, '.ssh'),
      paths.keysDir,
      paths.tmpDir,
      'age1recipient'
    );
  });

  it('decrypts from the configured keys directory using the age identity file', async () => {
    menu(['decrypt']);

    await keyman();

    expect(decryptKeys).toHaveBeenCalledWith(
      path.join(process.env.HOME as string, '.ssh'),
      paths.keysDir,
      paths.tmpDir,
      paths.keyPath
    );
  });

  describe('without an age recipient', () => {
    beforeEach(() => {
      extractAgePublicKey.mockResolvedValue(null);
    });

    it.each([
      ['generate', generateKey],
      ['encrypt', encryptKeys],
    ])('refuses %s with a remedy instead of passing null to age', async (choice, operation) => {
      menu([choice]);

      await keyman();

      expect(operation).not.toHaveBeenCalled();
      const reported = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(reported).toContain(`age-keygen -o ${paths.keyPath}`);
      // The whole point: the loop survives and quit is still reached.
      expect(output()).toContain('Goodbye!');
    });

    it('still allows the operations that need no recipient', async () => {
      menu(['list', 'decrypt']);

      await keyman();

      expect(listKeys).toHaveBeenCalled();
      expect(decryptKeys).toHaveBeenCalled();
    });

    it('retries the lookup, so creating the identity mid-session works', async () => {
      extractAgePublicKey.mockResolvedValueOnce(null).mockResolvedValueOnce('age1later');
      menu(['generate', 'generate']);

      await keyman();

      expect(extractAgePublicKey).toHaveBeenCalledTimes(2);
      expect(generateKey).toHaveBeenCalledTimes(1);
      expect(generateKey).toHaveBeenCalledWith(paths.tmpDir, paths.keysDir, 'age1later');
    });
  });

  it('resolves the recipient once for repeated operations', async () => {
    menu(['generate', 'encrypt']);

    await keyman();

    expect(extractAgePublicKey).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the menu until the user quits', async () => {
    menu(['list', 'copy', 'list']);

    await keyman();

    expect(listKeys).toHaveBeenCalledTimes(2);
    expect(copyKey).toHaveBeenCalledTimes(1);
  });

  it('targets another user home directory when a user is named', async () => {
    // A real sibling of the current HOME, because resolveHomeDir checks that the
    // directory exists rather than assuming a layout.
    const deployHome = path.join(root, 'deploy');
    fs.mkdirSync(deployHome, { recursive: true });
    menu(['list'], 'deploy');

    await keyman();

    expect(listKeys).toHaveBeenCalledWith(
      path.join(deployHome, '.ssh'),
      paths.keysDir,
      paths.tmpDir
    );
  });

  it('aborts when the named user has no home directory', async () => {
    menu(['list'], 'nobody-at-all');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    await expect(keyman()).rejects.toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0][0]).toContain('No home directory found');
  });

  it('writes a .gitignore next to the vault so it cannot be committed', async () => {
    await keyman();

    const contents = fs.readFileSync(path.join(paths.vaultRoot, '.gitignore'), 'utf-8');
    // The README used to ask the user to do this by hand.
    expect(contents).toContain('age.key');
    expect(contents).toContain('tmp/');
  });

  it('clears the decrypted keys on request', async () => {
    fs.mkdirSync(paths.tmpDir, { recursive: true });
    fs.writeFileSync(path.join(paths.tmpDir, 'id_prod'), 'PRIVATE');
    // Not the `menu` helper: this one has to answer the confirmation too.
    const queue = ['clear', 'quit'];
    prompt.mockImplementation(async (questions: { name: string }[]) => {
      const { name } = questions[0];
      if (name === 'user') return { user: '@current' };
      if (name === 'confirmed') return { confirmed: true };
      return { category: queue.shift() };
    });

    await keyman();

    expect(fs.existsSync(path.join(paths.tmpDir, 'id_prod'))).toBe(false);
  });
});
