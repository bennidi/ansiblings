/**
 * Tests for listKeys.
 *
 * listKeys is pure filesystem inspection plus console output, so it runs
 * against real temp directories and the assertions are made on what it prints.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listKeys } from '../src/keyman.list.js';

describe('listKeys', () => {
  let root: string;
  let sshDir: string;
  let vaultDir: string;
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  /** The single output line describing `name`, without padding noise. */
  const row = (name: string) =>
    logSpy.mock.calls
      .map((c) => c.join(' '))
      .find((line) => line.includes(`${name} `) || line.includes(`${name}(`))
      ?.replace(/ +/g, ' ');

  const output = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  const touch = (dir: string, file: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), '');
  };

  /** Creates a vault entry: <vault>/<name>/id_<name>.age */
  const vaultKey = (name: string) => touch(path.join(vaultDir, name), `id_${name}.age`);

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-list-')));
    sshDir = path.join(root, '.ssh');
    vaultDir = path.join(root, 'keys');
    tmpDir = path.join(root, 'tmp');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports the directories it inspected', async () => {
    await listKeys(sshDir, vaultDir, tmpDir);

    expect(output()).toContain(sshDir);
    expect(output()).toContain(vaultDir);
    expect(output()).toContain(tmpDir);
  });

  it('warns when none of the directories exist', async () => {
    await listKeys(sshDir, vaultDir, tmpDir);

    expect(output()).toContain('No SSH keys found.');
    expect(output()).not.toContain('SSH Keys:');
  });

  it('warns when the directories exist but hold no id_ files', async () => {
    fs.mkdirSync(sshDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'known_hosts'), '');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(output()).toContain('No SSH keys found.');
  });

  it('marks a key present in the vault and in .ssh as managed', async () => {
    touch(sshDir, 'id_prod');
    vaultKey('prod');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_prod')).toContain('✅');
    expect(row('id_prod')).toContain('[✓] [ ] [✓]');
  });

  it('marks a key decrypted into tmp as decrypted', async () => {
    touch(tmpDir, 'id_stage');
    vaultKey('stage');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_stage')).toContain('🔓');
    expect(row('id_stage')).toContain('[✓] [✓] [ ]');
  });

  it('marks a key only present in the vault as encrypted', async () => {
    vaultKey('cold');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_cold')).toContain('🔒');
    expect(row('id_cold')).toContain('[✓] [ ] [ ]');
  });

  it('marks a key missing from the vault as unmanaged', async () => {
    touch(sshDir, 'id_loose');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_loose')).toContain('⚠️');
    expect(row('id_loose')).toContain('[ ] [ ] [✓]');
  });

  it('shows a .pub indicator for a public key found in .ssh', async () => {
    touch(sshDir, 'id_prod');
    touch(sshDir, 'id_prod.pub');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_prod')).toContain('id_prod (.pub)');
  });

  it('shows a .pub indicator for a public key found in tmp', async () => {
    touch(tmpDir, 'id_prod');
    touch(tmpDir, 'id_prod.pub');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_prod')).toContain('id_prod (.pub)');
  });

  it('lists a public key with no matching private key', async () => {
    touch(sshDir, 'id_orphan.pub');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_orphan')).toContain('id_orphan (.pub)');
    // No private key anywhere, so every column stays blank.
    expect(row('id_orphan')).toContain('[ ] [ ] [ ]');
  });

  it('lists a tmp public key with no matching private key', async () => {
    touch(tmpDir, 'id_orphan.pub');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_orphan')).toContain('id_orphan (.pub)');
  });

  it('merges the same key seen in .ssh, tmp and the vault', async () => {
    touch(sshDir, 'id_shared');
    touch(tmpDir, 'id_shared');
    touch(tmpDir, 'id_shared.pub');
    vaultKey('shared');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_shared')).toContain('[✓] [✓] [✓]');
    // Vault plus .ssh wins over the decrypted-to-tmp status.
    expect(row('id_shared')).toContain('✅');
  });

  it('ignores files in the .ssh directory that are not keys', async () => {
    touch(sshDir, 'config');
    touch(sshDir, 'known_hosts');
    touch(sshDir, 'id_real');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(output()).not.toContain('known_hosts');
    expect(row('id_real')).toBeDefined();
  });

  it('ignores vault directories with no encrypted key inside', async () => {
    fs.mkdirSync(path.join(vaultDir, 'empty'), { recursive: true });
    vaultKey('real');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_empty')).toBeUndefined();
    expect(row('id_real')).toBeDefined();
  });

  it('keeps listing when the vault holds a dangling symlink', async () => {
    vaultKey('real');
    fs.symlinkSync(path.join(root, 'gone'), path.join(vaultDir, 'broken'));

    await expect(listKeys(sshDir, vaultDir, tmpDir)).resolves.toBeUndefined();
    expect(row('id_real')).toBeDefined();
  });

  it('follows a symlink pointing at a real vault directory', async () => {
    const elsewhere = path.join(root, 'elsewhere', 'prod');
    touch(elsewhere, 'id_prod.age');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.symlinkSync(elsewhere, path.join(vaultDir, 'prod'));

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(row('id_prod')).toBeDefined();
  });

  it('ignores loose files sitting next to the vault directories', async () => {
    vaultKey('real');
    fs.writeFileSync(path.join(vaultDir, 'README.md'), '');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(output()).not.toContain('id_README');
  });

  it('sorts keys by name', async () => {
    touch(sshDir, 'id_charlie');
    touch(sshDir, 'id_alpha');
    touch(sshDir, 'id_bravo');

    await listKeys(sshDir, vaultDir, tmpDir);

    const names = output()
      .split('\n')
      .filter((line) => line.includes('id_'))
      .map((line) => line.match(/id_\w+/)?.[0]);
    expect(names).toEqual(['id_alpha', 'id_bravo', 'id_charlie']);
  });

  it('prints the legend once keys are listed', async () => {
    touch(sshDir, 'id_prod');

    await listKeys(sshDir, vaultDir, tmpDir);

    expect(output()).toContain('Legend:');
  });
});
