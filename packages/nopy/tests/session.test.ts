/**
 * Tests for nopy.session module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type NopySession,
  createSession,
  filterInternalVariables,
  listSessions,
  loadSession,
  saveSession,
  separateEnvAndCubeVariables,
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
});

describe('filterInternalVariables', () => {
  it('removes customize key', () => {
    const input = { customize: true, VAR_A: 'a', VAR_B: 'b' };
    const result = filterInternalVariables(input);

    expect(result).toEqual({ VAR_A: 'a', VAR_B: 'b' });
    expect('customize' in result).toBe(false);
  });

  it('returns empty object for internal-only input', () => {
    const result = filterInternalVariables({ customize: true });
    expect(result).toEqual({});
  });

  it('preserves all non-internal keys', () => {
    const input = { A: 1, B: 'two', C: true };
    const result = filterInternalVariables(input);
    expect(result).toEqual(input);
  });
});

describe('separateEnvAndCubeVariables', () => {
  it('separates env variables from cube variables', () => {
    const allVars = { ENV_VAR: 'env', CUBE_VAR: 'cube' };
    const envVars = { ENV_VAR: 'original' };

    const result = separateEnvAndCubeVariables(allVars, envVars);

    expect(result.env).toEqual({ ENV_VAR: 'env' });
    expect(result.cubeVars).toEqual({ CUBE_VAR: 'cube' });
  });

  it('handles all env variables', () => {
    const allVars = { A: 1, B: 2 };
    const envVars = { A: 0, B: 0 };

    const result = separateEnvAndCubeVariables(allVars, envVars);

    expect(result.env).toEqual({ A: 1, B: 2 });
    expect(result.cubeVars).toEqual({});
  });

  it('handles all cube variables', () => {
    const allVars = { A: 1, B: 2 };
    const envVars = {};

    const result = separateEnvAndCubeVariables(allVars, envVars);

    expect(result.env).toEqual({});
    expect(result.cubeVars).toEqual({ A: 1, B: 2 });
  });
});
