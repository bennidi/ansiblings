/**
 * Tests for nopy.history module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addToHistory,
  clearHistory,
  formatHistoryList,
  getLastSession,
  getSessionById,
  HISTORY_FILE,
  type HistoryEntry,
  listHistory,
  loadHistory,
  removeFromHistory,
  type SessionHistory,
  saveHistory,
} from '../src/nopy.history.js';
import type { NopySession } from '../src/nopy.session.js';

describe('Session History', () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-history-test-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createTestSession = (cubes: string[] = ['test-cube']): NopySession => ({
    cubes: cubes.map((key) => ({ key, variables: {} })),
    hosts: ['@docker/test'],
    auth: { method: 'ssh-key' },
  });

  describe('loadHistory', () => {
    it('returns empty history when file does not exist', () => {
      const history = loadHistory();
      expect(history.entries).toEqual([]);
    });

    it('loads existing history file', () => {
      const testHistory: SessionHistory = {
        entries: [
          {
            id: 'test-id',
            name: 'Test Session',
            timestamp: new Date().toISOString(),
            session: createTestSession(),
          },
        ],
      };
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(testHistory));

      const history = loadHistory();
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].id).toBe('test-id');
    });

    it('returns empty history on invalid JSON', () => {
      fs.writeFileSync(HISTORY_FILE, 'invalid json');
      const history = loadHistory();
      expect(history.entries).toEqual([]);
    });
  });

  describe('saveHistory', () => {
    it('creates history file', () => {
      const history: SessionHistory = {
        entries: [
          {
            id: 'test-id',
            name: 'Test',
            timestamp: new Date().toISOString(),
            session: createTestSession(),
          },
        ],
      };

      saveHistory(history);

      expect(fs.existsSync(HISTORY_FILE)).toBe(true);
      const content = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      expect(content.entries).toHaveLength(1);
    });
  });

  describe('addToHistory', () => {
    it('adds session to empty history', () => {
      const session = createTestSession(['apt:essentials']);
      const entry = addToHistory(session);

      expect(entry.id).toBeDefined();
      expect(entry.session).toBe(session);

      const history = loadHistory();
      expect(history.entries).toHaveLength(1);
    });

    it('adds newest entries first', () => {
      addToHistory(createTestSession(['first']));
      addToHistory(createTestSession(['second']));

      const history = loadHistory();
      expect(history.entries[0].session.cubes[0].key).toBe('second');
      expect(history.entries[1].session.cubes[0].key).toBe('first');
    });

    it('respects max entries limit', () => {
      for (let i = 0; i < 5; i++) {
        addToHistory(createTestSession([`cube-${i}`]), 3);
      }

      const history = loadHistory();
      expect(history.entries).toHaveLength(3);
      // Should have newest entries
      expect(history.entries[0].session.cubes[0].key).toBe('cube-4');
      expect(history.entries[1].session.cubes[0].key).toBe('cube-3');
      expect(history.entries[2].session.cubes[0].key).toBe('cube-2');
    });

    it('generates descriptive name', () => {
      const session = createTestSession(['apt:essentials', 'runtime:docker']);
      const entry = addToHistory(session);

      expect(entry.name).toContain('apt:essentials');
      expect(entry.name).toContain('runtime:docker');
      expect(entry.name).toContain('@docker/test');
    });
  });

  describe('getLastSession', () => {
    it('returns undefined for empty history', () => {
      expect(getLastSession()).toBeUndefined();
    });

    it('returns most recent session', () => {
      addToHistory(createTestSession(['first']));
      addToHistory(createTestSession(['second']));

      const last = getLastSession();
      expect(last?.session.cubes[0].key).toBe('second');
    });
  });

  describe('getSessionById', () => {
    it('returns undefined for non-existent ID', () => {
      expect(getSessionById('non-existent')).toBeUndefined();
    });

    it('finds session by ID', () => {
      const entry = addToHistory(createTestSession(['test']));

      const found = getSessionById(entry.id);
      expect(found?.id).toBe(entry.id);
    });
  });

  describe('listHistory', () => {
    it('returns empty array for no history', () => {
      expect(listHistory()).toEqual([]);
    });

    it('returns all entries', () => {
      addToHistory(createTestSession(['a']));
      addToHistory(createTestSession(['b']));
      addToHistory(createTestSession(['c']));

      expect(listHistory()).toHaveLength(3);
    });
  });

  describe('clearHistory', () => {
    it('removes all entries', () => {
      addToHistory(createTestSession(['a']));
      addToHistory(createTestSession(['b']));

      clearHistory();

      expect(listHistory()).toEqual([]);
    });
  });

  describe('removeFromHistory', () => {
    it('returns false for non-existent ID', () => {
      expect(removeFromHistory('non-existent')).toBe(false);
    });

    it('removes specific entry', () => {
      const entry1 = addToHistory(createTestSession(['a']));
      const entry2 = addToHistory(createTestSession(['b']));

      const removed = removeFromHistory(entry1.id);

      expect(removed).toBe(true);
      expect(listHistory()).toHaveLength(1);
      expect(getSessionById(entry1.id)).toBeUndefined();
      expect(getSessionById(entry2.id)).toBeDefined();
    });
  });

  describe('formatHistoryList', () => {
    it('shows message for empty history', () => {
      const output = formatHistoryList([]);
      expect(output).toContain('No sessions');
    });

    it('formats entries with numbers and IDs', () => {
      const entries: HistoryEntry[] = [
        {
          id: 'abc123',
          name: 'Test Session',
          timestamp: new Date().toISOString(),
          session: createTestSession(),
        },
      ];

      const output = formatHistoryList(entries);
      expect(output).toContain('[1]');
      expect(output).toContain('Test Session');
      expect(output).toContain('abc123');
      expect(output).toContain('Total: 1');
    });

    it('marks first entry with arrow', () => {
      const entries: HistoryEntry[] = [
        {
          id: 'first',
          name: 'First',
          timestamp: new Date().toISOString(),
          session: createTestSession(),
        },
        {
          id: 'second',
          name: 'Second',
          timestamp: new Date().toISOString(),
          session: createTestSession(),
        },
      ];

      const output = formatHistoryList(entries);
      expect(output).toContain('→ [1]');
    });
  });
});
