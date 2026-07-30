/**
 * Tests for rotation and retirement.
 *
 * ssh-keygen and age are mocked; the ssh-keygen stand-in writes the pair the real
 * binary would, so the vault write is a real one. Everything the operations claim
 * about the filesystem is asserted against the filesystem.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa, prompt } = vi.hoisted(() => ({ execa: vi.fn(), prompt: vi.fn() }));

vi.mock('execa', () => ({ execa }));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { nextRotationName, retireKey, rotateKey, supersededBy } from '../src/keyman.rotate.js';

describe('nextRotationName', () => {
  it('starts a series at 2, so the first key keeps its plain name', () => {
    expect(nextRotationName('prod', ['prod'])).toBe('prod-2');
  });

  it('continues an existing series', () => {
    expect(nextRotationName('prod-2', ['prod', 'prod-2'])).toBe('prod-3');
  });

  it('skips past a version that already exists', () => {
    // Rotating the original again after prod-2 and prod-3 exist: -2 is taken.
    expect(nextRotationName('prod', ['prod', 'prod-2', 'prod-3'])).toBe('prod-4');
  });

  it('ignores other series', () => {
    expect(nextRotationName('prod', ['prod', 'stage-7', 'prod-backup'])).toBe('prod-2');
  });

  it('treats a name that ends in a number as its own series', () => {
    // `web2` is a host name, not a version — the separator is what makes a series.
    expect(nextRotationName('web2', ['web2'])).toBe('web2-2');
  });

  it('keeps a hyphenated base intact', () => {
    expect(nextRotationName('build-agent', ['build-agent'])).toBe('build-agent-2');
    expect(nextRotationName('build-agent-2', ['build-agent-2'])).toBe('build-agent-3');
  });
});

describe('supersededBy', () => {
  it('finds the replacement of a key', () => {
    expect(supersededBy('prod', ['prod', 'prod-2'])).toBe('prod-2');
  });

  it('answers with the latest one', () => {
    expect(supersededBy('prod', ['prod', 'prod-2', 'prod-3'])).toBe('prod-3');
  });

  it('says nothing supersedes the newest key in a series', () => {
    expect(supersededBy('prod-3', ['prod', 'prod-2', 'prod-3'])).toBeNull();
  });

  it('does not count an unrelated key', () => {
    expect(supersededBy('prod', ['prod', 'stage-9'])).toBeNull();
  });
});

describe('rotateKey', () => {
  let root: string;
  let sshDir: string;
  let keysDir: string;
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const PUBKEY = 'age1recipient';

  /** Creates <keysDir>/<name>/id_<name>.{age,pub}. */
  const vaultKey = (name: string, comment = 'me@host') => {
    const dir = path.join(keysDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `id_${name}.age`), `ENCRYPTED ${name}`);
    fs.writeFileSync(path.join(dir, `id_${name}.pub`), `ssh-ed25519 AAAA${name} ${comment}\n`);
  };

  /** Answers each prompt by the name of the question it asks. */
  const answer = (answers: Record<string, unknown>) => {
    prompt.mockImplementation(async (questions: { name: string }[]) => {
      const { name } = questions[0];
      return { [name]: answers[name] };
    });
  };

  const question = (name: string) =>
    prompt.mock.calls.map((c) => c[0][0]).find((q) => q.name === name);

  const argsOf = (binary: string) =>
    execa.mock.calls.find((c) => c[0] === binary)?.[1] as string[] | undefined;

  const messages = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-rotate-')));
    sshDir = path.join(root, '.ssh');
    keysDir = path.join(root, 'vault', 'keys');
    tmpDir = path.join(root, 'vault', 'tmp');
    fs.mkdirSync(keysDir, { recursive: true });
    fs.mkdirSync(sshDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    execa.mockImplementation(async (binary: string, args: string[]) => {
      if (binary === 'ssh-keygen') {
        const keyPath = args[args.indexOf('-f') + 1];
        fs.writeFileSync(keyPath, 'PRIVATE');
        fs.writeFileSync(`${keyPath}.pub`, `ssh-ed25519 NEWKEY ${args[args.indexOf('-C') + 1]}\n`);
      }
      if (binary === 'age') {
        // Written, not just recorded: what the vault ends up holding is the thing
        // under test, and a later listing has to see the new entry.
        fs.writeFileSync(args[args.indexOf('-o') + 1], 'ENCRYPTED');
      }
      return { exitCode: 0 };
    });

    answer({ key: 'prod', algorithm: 'ed25519', identity: 'me@host' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('says there is nothing to rotate on an empty vault', async () => {
    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(messages(logSpy)).toContain('No encrypted keys to rotate');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('offers the vault keys', async () => {
    vaultKey('stage');
    vaultKey('prod');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(question('key').choices).toEqual(['prod', 'stage']);
  });

  it('generates the replacement into the tmp directory under the next name', async () => {
    vaultKey('prod');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(argsOf('ssh-keygen')).toEqual([
      '-t',
      'ed25519',
      '-f',
      path.join(tmpDir, 'id_prod-2'),
      '-C',
      'me@host',
    ]);
  });

  it('leaves the rotated key untouched in the vault', async () => {
    vaultKey('prod');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    // The whole point of rotating this way: both keys are in the vault, and the
    // one that is deployed is byte for byte what it was.
    expect(fs.readFileSync(path.join(keysDir, 'prod', 'id_prod.age'), 'utf-8')).toBe(
      'ENCRYPTED prod'
    );
    expect(fs.existsSync(path.join(keysDir, 'prod-2', 'id_prod-2.age'))).toBe(true);
  });

  it('encrypts the replacement to the vault recipient', async () => {
    vaultKey('prod');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(argsOf('age')).toEqual([
      '-r',
      PUBKEY,
      '-o',
      path.join(keysDir, 'prod-2', 'id_prod-2.age'),
      path.join(tmpDir, 'id_prod-2'),
    ]);
  });

  it('offers the comment of the key being replaced', async () => {
    vaultKey('prod', 'deploy@prod');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(question('identity').default).toBe('deploy@prod');
  });

  it('offers no comment when the stored public key has none', async () => {
    vaultKey('prod');
    fs.writeFileSync(path.join(keysDir, 'prod', 'id_prod.pub'), 'ssh-ed25519 AAAAprod\n');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(question('identity').default).toBeUndefined();
  });

  it('rotates a key whose public half was never stored', async () => {
    vaultKey('prod');
    fs.rmSync(path.join(keysDir, 'prod', 'id_prod.pub'));

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(question('identity').default).toBeUndefined();
    // Reported rather than printed as a blank line, since the user needs it to
    // know what to remove from the host afterwards.
    expect(messages(logSpy)).toContain('none stored at');
    expect(fs.existsSync(path.join(keysDir, 'prod-2', 'id_prod-2.age'))).toBe(true);
  });

  it('prints both public keys and what to do with them', async () => {
    vaultKey('prod', 'deploy@prod');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    const output = messages(logSpy);
    expect(output).toContain('ssh-ed25519 AAAAprod deploy@prod');
    expect(output).toContain('ssh-ed25519 NEWKEY me@host');
    // Deploy-then-retire, in that order: the reverse locks you out.
    expect(output).toContain('Add the replacement public key');
    expect(output).toContain('retire');
  });

  it('skips a name taken by a plaintext key outside the vault', async () => {
    vaultKey('prod');
    fs.writeFileSync(path.join(sshDir, 'id_prod-2'), 'PRIVATE');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    // Generating id_prod-2 would have refused, or worse asked ssh-keygen to
    // overwrite a private key that is in use.
    expect(argsOf('ssh-keygen')).toContain(path.join(tmpDir, 'id_prod-3'));
    expect(fs.readFileSync(path.join(sshDir, 'id_prod-2'), 'utf-8')).toBe('PRIVATE');
  });

  it('skips a name taken by an earlier rotation still in tmp', async () => {
    vaultKey('prod');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'id_prod-2'), 'PRIVATE');

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(argsOf('ssh-keygen')).toContain(path.join(tmpDir, 'id_prod-3'));
  });

  it('requests a 4096 bit key for rsa', async () => {
    vaultKey('prod');
    answer({ key: 'prod', algorithm: 'rsa', identity: '' });

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(argsOf('ssh-keygen')?.slice(-2)).toEqual(['-b', '4096']);
  });

  it('stops at a failure from ssh-keygen without touching the vault', async () => {
    vaultKey('prod');
    execa.mockImplementation(async () => {
      throw Object.assign(new Error('ssh-keygen exploded'), { stderr: 'ssh-keygen exploded' });
    });

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(messages(errorSpy)).toContain('Error generating key');
    expect(fs.existsSync(path.join(keysDir, 'prod-2'))).toBe(false);
  });

  it('reports a failure from age and says where the replacement is', async () => {
    vaultKey('prod');
    execa.mockImplementation(async (binary: string, args: string[]) => {
      if (binary === 'age') {
        throw Object.assign(new Error('age exploded'), { stderr: 'age exploded' });
      }
      const keyPath = args[args.indexOf('-f') + 1];
      fs.writeFileSync(keyPath, 'PRIVATE');
      fs.writeFileSync(`${keyPath}.pub`, 'ssh-ed25519 NEWKEY me@host\n');
      return { exitCode: 0 };
    });

    await rotateKey(sshDir, keysDir, tmpDir, PUBKEY);

    expect(messages(errorSpy)).toContain('Error encrypting the replacement');
    expect(messages(errorSpy)).toContain(path.join(tmpDir, 'id_prod-2'));
    // No summary: nothing was stored, so there is nothing to deploy yet.
    expect(messages(logSpy)).not.toContain('Add the replacement public key');
  });
});

describe('retireKey', () => {
  let root: string;
  let sshDir: string;
  let keysDir: string;
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const vaultKey = (name: string) => {
    const dir = path.join(keysDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `id_${name}.age`), `ENCRYPTED ${name}`);
    fs.writeFileSync(path.join(dir, `id_${name}.pub`), `PUBLIC ${name}`);
  };

  const answer = (answers: Record<string, unknown>) => {
    prompt.mockImplementation(async (questions: { name: string }[]) => {
      const { name } = questions[0];
      return { [name]: answers[name] };
    });
  };

  const question = (name: string) =>
    prompt.mock.calls.map((c) => c[0][0]).find((q) => q.name === name);

  const messages = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-retire-')));
    sshDir = path.join(root, '.ssh');
    keysDir = path.join(root, 'vault', 'keys');
    tmpDir = path.join(root, 'vault', 'tmp');
    fs.mkdirSync(keysDir, { recursive: true });
    fs.mkdirSync(sshDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    answer({ key: 'prod', confirmed: true, typed: 'prod' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('says there is nothing to retire on an empty vault', async () => {
    await retireKey(sshDir, keysDir, tmpDir);

    expect(messages()).toContain('No encrypted keys in the vault');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('removes the vault entry and its directory', async () => {
    vaultKey('prod');
    vaultKey('prod-2');

    await retireKey(sshDir, keysDir, tmpDir);

    expect(fs.existsSync(path.join(keysDir, 'prod'))).toBe(false);
    // Only the one that was named.
    expect(fs.existsSync(path.join(keysDir, 'prod-2', 'id_prod-2.age'))).toBe(true);
  });

  it('removes the plaintext copies as well', async () => {
    vaultKey('prod');
    vaultKey('prod-2');
    for (const dir of [sshDir, tmpDir]) {
      fs.writeFileSync(path.join(dir, 'id_prod'), 'PRIVATE');
      fs.writeFileSync(path.join(dir, 'id_prod.pub'), 'PUBLIC');
    }

    await retireKey(sshDir, keysDir, tmpDir);

    expect(fs.readdirSync(sshDir)).toEqual([]);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('lists every path before asking, and asks with a no default', async () => {
    vaultKey('prod');
    vaultKey('prod-2');
    fs.writeFileSync(path.join(sshDir, 'id_prod'), 'PRIVATE');

    await retireKey(sshDir, keysDir, tmpDir);

    expect(messages()).toContain(path.join(keysDir, 'prod', 'id_prod.age'));
    expect(messages()).toContain(path.join(sshDir, 'id_prod'));
    expect(question('confirmed')).toMatchObject({ type: 'confirm', default: false });
    expect(question('confirmed').message).toContain('3 files');
  });

  it('counts one file as one file', async () => {
    vaultKey('prod-2');
    fs.mkdirSync(path.join(keysDir, 'prod'));
    fs.writeFileSync(path.join(keysDir, 'prod', 'id_prod.age'), 'ENCRYPTED');

    await retireKey(sshDir, keysDir, tmpDir);

    expect(question('confirmed').message).toContain('1 file?');
    expect(fs.existsSync(path.join(keysDir, 'prod'))).toBe(false);
  });

  it('says what supersedes the key it is about to delete', async () => {
    vaultKey('prod');
    vaultKey('prod-2');

    await retireKey(sshDir, keysDir, tmpDir);

    expect(messages()).toContain('prod-2 is in the vault and supersedes prod');
    expect(question('typed')).toBeUndefined();
  });

  it('keeps everything when the confirmation is declined', async () => {
    vaultKey('prod');
    vaultKey('prod-2');
    answer({ key: 'prod', confirmed: false });

    await retireKey(sshDir, keysDir, tmpDir);

    expect(fs.existsSync(path.join(keysDir, 'prod', 'id_prod.age'))).toBe(true);
    expect(messages()).toContain('Nothing was deleted');
  });

  describe('a key nothing replaces', () => {
    beforeEach(() => {
      vaultKey('prod');
    });

    it('warns that this is the only copy', async () => {
      await retireKey(sshDir, keysDir, tmpDir);

      expect(messages()).toContain('Nothing in the vault supersedes prod');
    });

    it('asks for the name to be typed out, and deletes when it matches', async () => {
      await retireKey(sshDir, keysDir, tmpDir);

      // A y/n is one keystroke from an irreversible deletion; this is not.
      expect(question('typed')).toBeDefined();
      expect(fs.existsSync(path.join(keysDir, 'prod'))).toBe(false);
    });

    it('deletes nothing when the typed name does not match', async () => {
      answer({ key: 'prod', confirmed: true, typed: 'prodd' });

      await retireKey(sshDir, keysDir, tmpDir);

      expect(fs.existsSync(path.join(keysDir, 'prod', 'id_prod.age'))).toBe(true);
      expect(messages()).toContain('Name did not match');
    });

    it('accepts the name with stray whitespace', async () => {
      answer({ key: 'prod', confirmed: true, typed: ' prod ' });

      await retireKey(sshDir, keysDir, tmpDir);

      expect(fs.existsSync(path.join(keysDir, 'prod'))).toBe(false);
    });
  });

  it('keeps a vault directory that holds something else', async () => {
    vaultKey('prod');
    vaultKey('prod-2');
    fs.mkdirSync(path.join(keysDir, 'prod', 'notes'));

    await retireKey(sshDir, keysDir, tmpDir);

    // The .age and .pub are gone; the directory stays, and says why.
    expect(fs.existsSync(path.join(keysDir, 'prod', 'id_prod.age'))).toBe(false);
    expect(fs.existsSync(path.join(keysDir, 'prod', 'notes'))).toBe(true);
    expect(messages()).toContain('it still holds other files');
  });
});
