/**
 * Tests for home directory resolution.
 *
 * Real directories under os.tmpdir() stand in for home directories, since the
 * whole point of the module is that it checks whether a path exists rather than
 * assuming a layout.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_USER, resolveHomeDir } from '../src/keyman.home.js';

describe('resolveHomeDir', () => {
  let homes: string;
  let originalHome: string | undefined;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const messages = () => errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    originalHome = process.env.HOME;
    homes = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keyman-homes-')));
    process.env.HOME = path.join(homes, 'alice');
    fs.mkdirSync(process.env.HOME, { recursive: true });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(homes, { recursive: true, force: true });
  });

  describe('the current user', () => {
    it('uses HOME when it is set', () => {
      expect(resolveHomeDir(CURRENT_USER)).toBe(path.join(homes, 'alice'));
    });

    it('falls back to the passwd entry when HOME is unset', () => {
      delete process.env.HOME;

      // Not asserted as a literal: what matters is that an unset HOME is no longer
      // a fatal error, which is what `process.env.HOME || ''` made it.
      expect(resolveHomeDir(CURRENT_USER)).toBe(os.userInfo().homedir);
    });

    it('reports the failure when neither is available', () => {
      delete process.env.HOME;
      vi.spyOn(os, 'userInfo').mockImplementation(() => {
        throw new Error('no passwd entry for uid');
      });

      expect(resolveHomeDir(CURRENT_USER)).toBeNull();
      expect(messages()).toContain('Unable to determine HOME directory');
    });

    it('treats an empty passwd home as no answer', () => {
      delete process.env.HOME;
      vi.spyOn(os, 'userInfo').mockReturnValue({
        ...os.userInfo(),
        homedir: '',
      });

      expect(resolveHomeDir(CURRENT_USER)).toBeNull();
    });
  });

  describe('another user', () => {
    it('looks beside the current home, whatever that directory is called', () => {
      const bob = path.join(homes, 'bob');
      fs.mkdirSync(bob);

      // The old code hardcoded /home/<user>, which is wrong on macOS — where homes
      // live in /Users — and on any host that puts them anywhere else.
      expect(resolveHomeDir('bob')).toBe(bob);
    });

    it('still tries the conventional locations with no current home to go by', () => {
      delete process.env.HOME;
      vi.spyOn(os, 'userInfo').mockImplementation(() => {
        throw new Error('no passwd entry for uid');
      });

      // Not knowing where *this* user lives is no reason to give up on another.
      expect(resolveHomeDir('nobody')).toBeNull();
      expect(messages()).toContain('/home/nobody, /Users/nobody');
      expect(messages()).not.toContain('Unable to determine HOME');
    });

    it('reports every path it tried when there is no such home', () => {
      expect(resolveHomeDir('nobody')).toBeNull();

      expect(messages()).toContain('No home directory found for nobody');
      expect(messages()).toContain(path.join(homes, 'nobody'));
      expect(messages()).toContain('/home/nobody');
      expect(messages()).toContain('/Users/nobody');
    });

    it('still checks the conventional locations when HOME is somewhere odd', () => {
      process.env.HOME = path.join(homes, 'alice');
      const conventional = process.platform === 'darwin' ? '/Users' : '/home';
      const existing = fs
        .readdirSync(conventional)
        .find((entry) =>
          fs.statSync(path.join(conventional, entry), { throwIfNoEntry: false })?.isDirectory()
        );

      // Skipped rather than asserted blind if the machine has no such user.
      if (existing) {
        expect(resolveHomeDir(existing)).toBe(path.join(conventional, existing));
      }
    });
  });
});
