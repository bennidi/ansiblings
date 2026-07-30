/**
 * Tests for keyman's argv parsing.
 *
 * The old inline reader in keyman.cli.ts turned three different mistakes into
 * silence or into a wrong diagnosis, so the interesting cases here are the
 * rejections rather than the happy paths.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS, helpText, KNOWN_FLAGS, parseArgs, UsageError } from '../src/keyman.args.js';

describe('parseArgs', () => {
  it('defaults to the interactive session', () => {
    expect(parseArgs([])).toEqual({ command: 'interactive' });
  });

  it.each([
    [['--help'], 'help'],
    [['-h'], 'help'],
    [['--version'], 'version'],
    [['-V'], 'version'],
    [['--print-config'], 'print-config'],
  ] as const)('%s selects %s', (argv, command) => {
    expect(parseArgs([...argv])).toEqual({ command });
  });

  it('answers --help even when the rest of the line is wrong', () => {
    expect(parseArgs(['--bogus', '--help'])).toEqual({ command: 'help' });
    expect(parseArgs(['--help', '--channel'])).toEqual({ command: 'help' });
  });

  describe('self-update', () => {
    it.each(['self-update', 'upgrade'])('is selected by the %s subcommand', (subcommand) => {
      expect(parseArgs([subcommand])).toEqual({
        command: 'self-update',
        dryRun: false,
        force: false,
        channel: undefined,
        registry: undefined,
      });
    });

    it('is selected by --self-update', () => {
      expect(parseArgs(['--self-update'])).toMatchObject({ command: 'self-update' });
    });

    it('collects its flags, long and short', () => {
      expect(parseArgs(['self-update', '--dry-run', '--force'])).toMatchObject({
        dryRun: true,
        force: true,
      });
      expect(parseArgs(['self-update', '-n', '-f'])).toMatchObject({
        dryRun: true,
        force: true,
      });
    });

    it.each(['--channel main', '--channel=main'])('accepts %s', (form) => {
      expect(parseArgs(['self-update', ...form.split(' ')])).toMatchObject({ channel: 'main' });
    });

    it('accepts every real channel', () => {
      for (const channel of CHANNELS) {
        expect(parseArgs(['self-update', '--channel', channel])).toMatchObject({ channel });
      }
    });

    it('reads a registry in either form', () => {
      expect(parseArgs(['self-update', '--registry', 'https://r.example'])).toMatchObject({
        registry: 'https://r.example',
      });
      expect(parseArgs(['self-update', '--registry=https://r.example'])).toMatchObject({
        registry: 'https://r.example',
      });
    });

    it('keeps a value that starts with a dash when it was written inline', () => {
      expect(parseArgs(['self-update', '--registry=-weird'])).toMatchObject({
        registry: '-weird',
      });
    });
  });

  describe('rejections', () => {
    const reject = (argv: string[]) => () => parseArgs(argv);

    it('rejects a channel that is not a channel', () => {
      expect(reject(['self-update', '--channel', 'stable'])).toThrow(UsageError);
      expect(reject(['self-update', '--channel', 'stable'])).toThrow(
        'Unknown channel: stable (expected latest, next, main)'
      );
    });

    it('rejects the next flag being eaten as a value', () => {
      // The bug this whole module exists for: --channel --force used to set the
      // channel to "--force" and report an unreachable registry.
      expect(reject(['self-update', '--channel', '--force'])).toThrow('--channel expects a value');
    });

    it('rejects a value flag with nothing after it', () => {
      expect(reject(['self-update', '--channel'])).toThrow('--channel expects a value');
      expect(reject(['self-update', '--registry='])).toThrow('--registry expects a value');
    });

    it('rejects a boolean flag given a value', () => {
      expect(reject(['--dry-run=yes'])).toThrow('--dry-run does not take a value');
    });

    it('rejects unknown flags and commands', () => {
      expect(reject(['--vault', 'foo'])).toThrow('Unknown flag: --vault');
      expect(reject(['-x'])).toThrow('Unknown flag: -x');
      expect(reject(['encrypt'])).toThrow('Unknown command: encrypt');
      expect(reject(['self-update', 'upgrade'])).toThrow('Unexpected argument: upgrade');
    });

    it.each(['--channel', '--registry', '--dry-run', '-n', '--force', '-f'])(
      'rejects %s without self-update rather than ignoring it',
      (flag) => {
        const argv = flag === '--channel' || flag === '--registry' ? [flag, 'main'] : [flag];
        expect(reject(argv)).toThrow('is only valid with `keyman self-update`');
      }
    );

    it('rejects a self-update flag alongside another command', () => {
      expect(reject(['--print-config', '--force'])).toThrow('--force is only valid');
    });
  });
});

describe('helpText', () => {
  it('documents every flag the parser accepts', () => {
    const text = helpText();
    for (const flag of KNOWN_FLAGS) {
      expect(text, `${flag} is missing from --help`).toContain(flag);
    }
  });

  it('names both subcommands, every channel, and the environment variables', () => {
    const text = helpText();
    expect(text).toContain('self-update');
    expect(text).toContain('upgrade');
    for (const channel of CHANNELS) {
      expect(text).toContain(channel);
    }
    for (const variable of [
      'VAULT_ROOT',
      'KEYMAN_REGISTRY',
      'KEYMAN_REGISTRY_TOKEN',
      'KEYMAN_NO_UPDATE_CHECK',
      'KEYMAN_PACKAGE_MANAGER',
    ]) {
      expect(text).toContain(variable);
    }
  });
});
