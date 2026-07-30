/**
 * Argv parsing for the keyman CLI.
 *
 * Separate from `keyman.cli.ts` because that file is excluded from coverage: it
 * is meant to be wiring, and *which flag takes a value* and *which channel names
 * are legal* are behaviour. The old inline `indexOf` reader accepted
 * `--channel --force`, which reached the registry as a dist-tag that cannot
 * exist and reported an unreachable registry instead of a bad flag.
 */

import type { Channel } from './keyman.update.js';

/** The channels `--channel` accepts, in the order the error message lists them */
export const CHANNELS: readonly Channel[] = ['latest', 'next', 'main'];

/** Flags that consume the next token, or the suffix of a `--flag=value` */
const VALUE_FLAGS: readonly string[] = ['--channel', '--registry'];

/** Flags that stand alone, short aliases included */
const BOOLEAN_FLAGS: readonly string[] = [
  '--help',
  '-h',
  '--version',
  '-V',
  '--print-config',
  '--self-update',
  '--dry-run',
  '-n',
  '--force',
  '-f',
];

/**
 * Flags that only mean anything to `self-update`. Named so that using one on its
 * own is an error rather than a silent no-op.
 */
const SELF_UPDATE_ONLY: readonly string[] = [
  '--channel',
  '--registry',
  '--dry-run',
  '-n',
  '--force',
  '-f',
];

/** Every flag the parser accepts — the list `helpText()` is checked against */
export const KNOWN_FLAGS: readonly string[] = [...BOOLEAN_FLAGS, ...VALUE_FLAGS];

const SUBCOMMANDS: readonly string[] = ['self-update', 'upgrade'];

export type ParsedArgs =
  | { command: 'help' }
  | { command: 'version' }
  | { command: 'print-config' }
  | { command: 'interactive' }
  | {
      command: 'self-update';
      dryRun: boolean;
      force: boolean;
      channel?: Channel;
      registry?: string;
    };

/**
 * A mistake in the invocation. Carries a message meant for the user, so the CLI
 * can print one line instead of a stack trace.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * Turns argv (already sliced past `node` and the script) into one command.
 *
 * @throws {UsageError} on an unknown flag or command, a value flag with no
 *   value, a boolean flag given one, or a channel that is not a real channel
 */
export function parseArgs(argv: string[]): ParsedArgs {
  // Before tokenising, so that help answers a line it could not otherwise parse.
  // Exact tokens only: `--registry=--help` is a (bad) registry, not a request.
  if (argv.some((token) => token === '--help' || token === '-h')) {
    return { command: 'help' };
  }

  const flags = new Set<string>();
  const values = new Map<string, string>();
  let subcommand: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    if (!token.startsWith('-')) {
      if (!SUBCOMMANDS.includes(token)) {
        throw new UsageError(`Unknown command: ${token}`);
      }
      if (subcommand) {
        throw new UsageError(`Unexpected argument: ${token}`);
      }
      subcommand = token;
      continue;
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);

    if (VALUE_FLAGS.includes(name)) {
      // A value that looks like a flag is a forgotten value, not a value —
      // unless it was written as --flag=-value and therefore meant.
      const inline = equals === -1 ? undefined : token.slice(equals + 1);
      const value = inline ?? argv[++index];
      if (!value || (inline === undefined && value.startsWith('-'))) {
        throw new UsageError(`${name} expects a value`);
      }
      values.set(name, value);
      continue;
    }

    if (!BOOLEAN_FLAGS.includes(name)) {
      throw new UsageError(`Unknown flag: ${name}`);
    }
    if (equals !== -1) {
      throw new UsageError(`${name} does not take a value`);
    }
    flags.add(name);
  }

  const given = (...names: string[]) => names.some((name) => flags.has(name));

  const isSelfUpdate = subcommand !== undefined || flags.has('--self-update');

  if (!isSelfUpdate) {
    const stray = [...values.keys(), ...flags].find((name) => SELF_UPDATE_ONLY.includes(name));
    if (stray) {
      throw new UsageError(`${stray} is only valid with \`keyman self-update\``);
    }
  }

  if (flags.has('--print-config')) {
    return { command: 'print-config' };
  }

  if (given('--version', '-V')) {
    return { command: 'version' };
  }

  if (isSelfUpdate) {
    const channel = values.get('--channel');
    if (channel !== undefined && !CHANNELS.includes(channel as Channel)) {
      throw new UsageError(`Unknown channel: ${channel} (expected ${CHANNELS.join(', ')})`);
    }
    return {
      command: 'self-update',
      dryRun: given('--dry-run', '-n'),
      force: given('--force', '-f'),
      channel: channel as Channel | undefined,
      registry: values.get('--registry'),
    };
  }

  return { command: 'interactive' };
}

/**
 * What `--help` prints.
 *
 * Hand-written rather than generated from the flag tables, so that adding a flag
 * to the parser without documenting it fails a test instead of shipping.
 */
export function helpText(): string {
  return `keyman — SSH key management and an age-encrypted key vault

Usage
  keyman                             start the interactive menu
  keyman self-update                 update keyman itself (alias: upgrade)

Flags
  -h, --help                         print this help and exit
  -V, --version                      print the version and exit
      --print-config                 print the resolved vault paths as JSON and exit
      --self-update                  same as the self-update subcommand

Flags for self-update
      --channel <${CHANNELS.join('|')}>   channel to update from
                                     (default: derived from the running version)
      --registry <url>               registry to query instead of the configured one
  -n, --dry-run                      print the install command without running it
  -f, --force                        reinstall even when already up to date

Environment
  VAULT_ROOT                         overrides vaultRoot from .keymanrc.json
  KEYMAN_REGISTRY                    registry for the update check and self-update
  KEYMAN_REGISTRY_TOKEN              bearer token for a private registry
  KEYMAN_NO_UPDATE_CHECK             set to 1 to skip the once-a-day update check
                                     (also skipped whenever CI is set)
  KEYMAN_PACKAGE_MANAGER             npm | pnpm | yarn | bun for the install command

Configuration is read from .keymanrc.json, merged from the current directory
upwards and then from ~/.keymanrc.json.
`;
}
