/**
 * Tests for private key discovery.
 *
 * Real files, because the classification is a bounded read of a real header.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportSkippedKeys, scanPrivateKeys } from '../src/keyman.keys.js';

const OPENSSH = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n';
const RSA_PEM = '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n';
const PKCS8 = '-----BEGIN PRIVATE KEY-----\nMIIB\n';

describe('scanPrivateKeys', () => {
  let dir: string;

  const write = (name: string, contents: string) =>
    fs.writeFileSync(path.join(dir, name), contents);

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-keys-')));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(scanPrivateKeys(path.join(dir, 'nope'))).toEqual({ keys: [], skipped: [] });
  });

  it('offers the id_ keys and not their public halves', () => {
    write('id_prod', OPENSSH);
    write('id_prod.pub', 'ssh-ed25519 AAAA');

    expect(scanPrivateKeys(dir)).toEqual({ keys: ['id_prod'], skipped: [] });
  });

  it('sorts the keys, so the menu order does not come from the filesystem', () => {
    for (const name of ['id_stage', 'id_alpha', 'id_prod']) {
      write(name, OPENSSH);
    }

    expect(scanPrivateKeys(dir).keys).toEqual(['id_alpha', 'id_prod', 'id_stage']);
  });

  it('offers an id_ file without checking what is in it', () => {
    // Unchanged from before the scan existed: whatever was offered still is.
    write('id_prod', 'not a key at all');

    expect(scanPrivateKeys(dir).keys).toEqual(['id_prod']);
  });

  it.each([
    ['an OpenSSH key', OPENSSH],
    ['an encrypted PEM key', RSA_PEM],
    ['a PKCS#8 key', PKCS8],
  ])('reports %s that is not named id_*', (_label, contents) => {
    write('deploy_ed25519', contents);

    expect(scanPrivateKeys(dir)).toEqual({ keys: [], skipped: ['deploy_ed25519'] });
  });

  it('ignores the other files a .ssh directory is full of', () => {
    write('known_hosts', 'github.com ssh-ed25519 AAAA');
    write('config', 'Host *\n  AddKeysToAgent yes\n');
    write('authorized_keys', 'ssh-ed25519 AAAA');
    fs.mkdirSync(path.join(dir, 'sockets'));

    expect(scanPrivateKeys(dir)).toEqual({ keys: [], skipped: [] });
  });

  it('ignores a path it cannot read', () => {
    // A dangling symlink, not a 0o000 file: root reads a 0o000 file happily, so
    // the mode-based version of this passed here and failed on the CI runner,
    // which is a container running as root. ENOENT nobody can override.
    fs.symlinkSync(path.join(dir, 'gone'), path.join(dir, 'secret'));

    // Reported as not-a-key rather than crashing the menu it was building.
    expect(scanPrivateKeys(dir).skipped).toEqual([]);
  });

  it('does not read past the header', () => {
    // The marker is in the first line; a mention further down is not a key.
    write('decoy', `${'x'.repeat(200)}\nPRIVATE KEY-----\n`);

    expect(scanPrivateKeys(dir).skipped).toEqual([]);
  });
});

describe('reportSkippedKeys', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const messages = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says nothing when nothing was skipped', () => {
    reportSkippedKeys([], '/home/alice/.ssh');

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('names the keys, the directory and the reason', () => {
    reportSkippedKeys(['deploy_ed25519', 'backup_rsa'], '/home/alice/.ssh');

    expect(messages()).toContain('deploy_ed25519, backup_rsa');
    expect(messages()).toContain('/home/alice/.ssh');
    expect(messages()).toContain('2 private keys');
    // Without the reason the message is a complaint rather than an instruction.
    expect(messages()).toContain('rename');
  });

  it('says key, singular, for one of them', () => {
    reportSkippedKeys(['deploy_ed25519'], '/home/alice/.ssh');

    expect(messages()).toContain('1 private key ');
  });
});
