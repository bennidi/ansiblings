/**
 * Tests for the clipboard layer.
 *
 * The platform is passed in rather than stubbed, so every branch is reachable from
 * the one machine the suite runs on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execa } = vi.hoisted(() => ({ execa: vi.fn() }));

vi.mock('execa', () => ({ execa }));

import { clipboardTools, copyToClipboard } from '../src/keyman.clipboard.js';

describe('clipboardTools', () => {
  it.each([
    ['darwin', ['pbcopy']],
    ['win32', ['clip']],
    ['linux', ['wl-copy', 'xclip', 'xsel']],
    // Anything unrecognised gets the X11/Wayland list rather than nothing: a BSD
    // running the same desktop stack is closer to linux than to no answer.
    ['freebsd', ['wl-copy', 'xclip', 'xsel']],
  ])('offers the right commands on %s', (platform, expected) => {
    expect(clipboardTools(platform).map((t) => t.binary)).toEqual(expected);
  });

  it('passes the clipboard selection to the X11 tools', () => {
    const byBinary = new Map(clipboardTools('linux').map((t) => [t.binary, t.args]));

    // Without these, xclip and xsel write to the primary selection, which is not
    // the clipboard a paste reads from.
    expect(byBinary.get('xclip')).toEqual(['-selection', 'clipboard']);
    expect(byBinary.get('xsel')).toEqual(['--clipboard', '--input']);
  });
});

describe('copyToClipboard', () => {
  const notFound = () =>
    execa.mockImplementation(async () => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    });

  beforeEach(() => {
    vi.clearAllMocks();
    execa.mockResolvedValue({ stdout: '' });
  });

  it('pipes the text to the first available command', async () => {
    const tool = await copyToClipboard('ssh-ed25519 AAAA', 'darwin');

    expect(tool).toBe('pbcopy');
    expect(execa).toHaveBeenCalledWith('pbcopy', [], { input: 'ssh-ed25519 AAAA' });
  });

  it('moves on from a command that is not installed', async () => {
    execa.mockImplementation(async (binary: string) => {
      if (binary !== 'xclip') {
        throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      }
      return { stdout: '' };
    });

    expect(await copyToClipboard('key', 'linux')).toBe('xclip');
    expect(execa.mock.calls.map((c) => c[0])).toEqual(['wl-copy', 'xclip']);
  });

  it('reports that nothing was available rather than throwing', async () => {
    notFound();

    expect(await copyToClipboard('key', 'linux')).toBeNull();
    expect(execa).toHaveBeenCalledTimes(3);
  });

  it('surfaces a command that ran and refused', async () => {
    execa.mockImplementation(async () => {
      throw Object.assign(new Error('failed'), { stderr: 'Error: No protocol specified' });
    });

    // A tool with an opinion is not an absent tool: trying the next one would
    // hide a real problem behind a second failure.
    await expect(copyToClipboard('key', 'linux')).rejects.toThrow('No protocol specified');
    expect(execa).toHaveBeenCalledTimes(1);
  });
});
