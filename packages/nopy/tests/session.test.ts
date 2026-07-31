/**
 * Tests for nopy.session module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSession,
  describeSession,
  listSessions,
  loadSession,
  type NopySession,
  SESSION_VERSION,
  saveSession,
} from '../src/nopy.session.js';

describe('createSession', () => {
  it('creates session with required fields', () => {
    const session = createSession({
      cubes: [{ key: 'test', variables: {} }],
      hosts: ['localhost'],
      auth: { method: 'ssh' },
    });

    expect(session.cubes).toHaveLength(1);
    expect(session.hosts).toEqual(['localhost']);
    expect(session.auth.method).toBe('ssh');
  });

  it('includes optional name', () => {
    const session = createSession({
      name: 'My Session',
      cubes: [],
      hosts: ['localhost'],
      auth: { method: 'ssh-key' },
    });

    expect(session.name).toBe('My Session');
  });

  it('includes optional env', () => {
    const session = createSession({
      cubes: [],
      hosts: ['localhost'],
      auth: { method: 'ssh-key' },
      env: { KEY: 'value' },
    });

    expect(session.env).toEqual({ KEY: 'value' });
  });

  it('stamps the format version and a creation time', () => {
    const session = createSession({ cubes: [], hosts: ['localhost'], auth: { method: 'ssh' } });

    expect(session.version).toBe(SESSION_VERSION);
    expect(new Date(session.timestamp!).toISOString()).toBe(session.timestamp);
  });

  it('lets the caller supply the timestamp', () => {
    const session = createSession({
      cubes: [],
      hosts: ['localhost'],
      auth: { method: 'ssh' },
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(session.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('describeSession', () => {
  const at = '2026-01-01T12:30:00.000Z';

  it('names the cubes and the hosts', () => {
    const name = describeSession(
      {
        cubes: [{ key: 'apt:essentials', variables: {} }],
        hosts: ['web-1'],
        auth: { method: 'ssh' },
      },
      at
    );

    expect(name).toContain('apt:essentials');
    expect(name).toContain('web-1');
  });

  it('says so when there is no host', () => {
    const name = describeSession({ cubes: [], auth: { method: 'ssh' } }, at);

    expect(name).toContain('no host');
  });

  it('truncates a long cube list and a long host list', () => {
    const name = describeSession(
      {
        cubes: Array.from({ length: 10 }, (_, i) => ({ key: `cube-${i}`, variables: {} })),
        hosts: Array.from({ length: 10 }, (_, i) => `host-${i}`),
        auth: { method: 'ssh' },
      },
      at
    );

    expect(name).toContain('...');
    expect(name.split('→')[1]).toContain('...');
  });
});

describe('saveSession and loadSession', () => {
  let tempDir: string;
  let sessionPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-test-'));
    sessionPath = path.join(tempDir, 'test.session.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and loads session', async () => {
    const session: NopySession = {
      cubes: [{ key: 'apt:essentials', variables: { UPDATE: true } }],
      hosts: ['@docker/test'],
      auth: { method: 'ssh-key' },
    };

    saveSession(session, sessionPath);
    const loaded = await loadSession(sessionPath);

    expect(loaded.cubes).toEqual(session.cubes);
    expect(loaded.hosts).toEqual(session.hosts);
    expect(loaded.auth).toEqual(session.auth);
  });

  it('creates directory if not exists', () => {
    const nestedPath = path.join(tempDir, 'nested', 'dir', 'session.json');
    const session: NopySession = {
      cubes: [],
      hosts: ['localhost'],
      auth: { method: 'ssh' },
    };

    saveSession(session, nestedPath);

    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it('throws on missing file', async () => {
    await expect(loadSession('/nonexistent/path.json')).rejects.toThrow('Session file not found');
  });

  it('throws on invalid extension', async () => {
    const invalidPath = path.join(tempDir, 'test.txt');
    fs.writeFileSync(invalidPath, '{}');

    await expect(loadSession(invalidPath)).rejects.toThrow('Unsupported session file format');
  });

  it('validates required cubes field', async () => {
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ hosts: ['localhost'], auth: { method: 'ssh' } })
    );

    await expect(loadSession(sessionPath)).rejects.toThrow('cubes');
  });

  it('validates required auth field', async () => {
    fs.writeFileSync(sessionPath, JSON.stringify({ cubes: [], hosts: ['localhost'] }));

    await expect(loadSession(sessionPath)).rejects.toThrow('auth');
  });

  // Half of SESSION_FORMAT.md is about the MJS form, and nothing exercised it.
  // Each test needs its own filename: `import()` caches by URL, so a second
  // module written to the same path would never be read.
  it('loads a session from an MJS default export', async () => {
    const mjsPath = path.join(tempDir, 'ok.session.mjs');
    fs.writeFileSync(
      mjsPath,
      'export default { cubes: [{ key: "apt:essentials", variables: {} }], auth: { method: "ssh" } };'
    );

    await expect(loadSession(mjsPath)).resolves.toMatchObject({
      cubes: [{ key: 'apt:essentials', variables: {} }],
    });
  });

  it('rejects an MJS session with no default export', async () => {
    const mjsPath = path.join(tempDir, 'no-default.session.mjs');
    fs.writeFileSync(mjsPath, 'export const session = {};');

    await expect(loadSession(mjsPath)).rejects.toThrow('must export a default object');
  });

  it('loads a session with no version at all', async () => {
    fs.writeFileSync(sessionPath, JSON.stringify({ cubes: [], auth: { method: 'ssh' } }));
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(loadSession(sessionPath)).resolves.toMatchObject({ cubes: [] });
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('warns about an unknown version but still loads it', async () => {
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ version: '9.9.9', cubes: [], auth: { method: 'ssh' } })
    );
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(loadSession(sessionPath)).resolves.toMatchObject({ version: '9.9.9' });
    expect(warn.mock.calls[0][0]).toContain('9.9.9');

    warn.mockRestore();
  });
});

describe('listSessions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array for nonexistent directory', () => {
    const result = listSessions('/nonexistent/dir');
    expect(result).toEqual([]);
  });

  it('finds .session.json files', () => {
    fs.writeFileSync(path.join(tempDir, 'test.session.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'other.session.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'not-a-session.json'), '{}');

    const result = listSessions(tempDir);

    expect(result).toHaveLength(2);
    expect(result.some((p) => p.endsWith('test.session.json'))).toBe(true);
    expect(result.some((p) => p.endsWith('other.session.json'))).toBe(true);
  });

  it('finds .session.mjs files', () => {
    fs.writeFileSync(path.join(tempDir, 'test.session.mjs'), 'export default {}');

    const result = listSessions(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].endsWith('test.session.mjs')).toBe(true);
  });

  it('finds the documented .nopysession.* files', () => {
    // The name every example in the README uses, and the one this missed:
    // `wild.nopysession.json` does not end in `.session.json`.
    fs.writeFileSync(path.join(tempDir, 'wild.nopysession.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'wild.nopysession.mjs'), 'export default {}');
    fs.writeFileSync(path.join(tempDir, 'nopysession.json'), '{}');

    const result = listSessions(tempDir);

    expect(result).toHaveLength(2);
    expect(result.some((p) => p.endsWith('wild.nopysession.json'))).toBe(true);
    expect(result.some((p) => p.endsWith('wild.nopysession.mjs'))).toBe(true);
  });
});
