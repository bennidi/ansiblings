/**
 * End-to-end over the configured vault layout.
 *
 * Everything except `age` and the prompts is real here — the config loader, the
 * path resolution, encrypt and list all run — because the bug this covers lived
 * in the seam between them: encrypt wrote to `vaultRoot` while list read from
 * `keysDir`, so with the defaults (`keysDir: 'keys'`) an encrypted key was
 * invisible to the very next listing. Every unit suite passed throughout, since
 * each was told which directory to use.
 *
 * Non-default names on purpose: `keys`/`tmp` would also pass against a function
 * that ignored the config entirely.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execa, prompt } = vi.hoisted(() => ({ execa: vi.fn(), prompt: vi.fn() }));

vi.mock('execa', () => ({ execa }));
vi.mock('inquirer', () => ({ default: { prompt } }));

import { keyman } from '../src/keyman.main.js';

describe('the configured vault layout', () => {
  let root: string;
  let project: string;
  let home: string;
  let sshDir: string;
  let vaultRoot: string;
  let cwd: string;
  let env: NodeJS.ProcessEnv;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const output = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  /** The one line of the listing table describing `name`. */
  const listingRow = (name: string) =>
    output()
      .split('\n')
      .find((line) => line.includes(name) && line.includes('['));

  beforeEach(() => {
    vi.clearAllMocks();
    cwd = process.cwd();
    env = { ...process.env };

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-layout-')));
    project = path.join(root, 'project');
    home = path.join(root, 'home');
    sshDir = path.join(home, '.ssh');
    vaultRoot = path.join(project, 'vault');

    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'id_prod'), 'PRIVATE');
    fs.writeFileSync(path.join(sshDir, 'id_prod.pub'), 'PUBLIC');

    fs.writeFileSync(
      path.join(project, '.keymanrc.json'),
      JSON.stringify({ vaultRoot: 'vault', keysDir: 'encrypted', tmpDir: 'plain' })
    );

    // HOME also redirects os.homedir(), so the real ~/.keymanrc.json cannot
    // reach the loader and make this test depend on the machine it runs on.
    process.env.HOME = home;
    delete process.env.VAULT_ROOT;
    process.chdir(project);

    // The age identity has to exist before extractAgePublicKey will shell out.
    fs.mkdirSync(vaultRoot, { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, 'age.key'), 'AGE-SECRET-KEY-1');

    execa.mockImplementation(async (binary: string, args: string[]) => {
      if (binary === 'age-keygen') {
        return { stdout: 'age1recipient' };
      }
      fs.writeFileSync(args[args.indexOf('-o') + 1], 'ENCRYPTED');
      return { stdout: '' };
    });

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(cwd);
    process.env = env;
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Walks the menu, answering encrypt's key selection along the way. */
  const run = (categories: string[]) => {
    const queue = [...categories, 'quit'];
    prompt.mockImplementation(async (questions: { name: string }[]) => {
      switch (questions[0].name) {
        case 'user':
          return { user: '@current' };
        case 'selectedKeys':
          return { selectedKeys: ['id_prod'] };
        default:
          return { category: queue.shift() };
      }
    });
    return keyman();
  };

  it('encrypts into the configured keys directory, where the listing looks', async () => {
    await run(['encrypt', 'list']);

    expect(fs.existsSync(path.join(vaultRoot, 'encrypted', 'prod', 'id_prod.age'))).toBe(true);
    // ✅ is reachable only via inVault && inSsh, and the columns are
    // [vault] [tmp] [.ssh] — either alone would pass on a blank vault column.
    expect(listingRow('id_prod')).toContain('✅');
    expect(listingRow('id_prod')).toMatch(/\[✓]\s+\[ ]\s+\[✓]/);
  });

  it('honours the configured directory names for every path it prints', async () => {
    await run([]);

    expect(output()).toContain(path.join(vaultRoot, 'encrypted'));
    expect(output()).toContain(path.join(vaultRoot, 'plain'));
  });
});
