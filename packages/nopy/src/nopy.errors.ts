/**
 * The errors that are the user's to fix.
 * @module nopy.errors
 */

/**
 * A run that failed for a reason the user can act on: no config file, a cube
 * that does not exist, a required variable nothing supplied, a session file
 * that will not load.
 *
 * The point is the *presentation*, not the control flow — nothing catches this
 * to recover. A stack trace through `dist/` says nothing useful about a missing
 * `.nopyrc.json`, and printing one invites the reader to look for a bug in nopy
 * instead of a typo in their project. The CLI prints the message alone and keeps
 * the stack behind `NOPY_DEBUG`.
 *
 * Mirrors keyman's `UsageError` deliberately: the two CLIs are kept in step on
 * how they fail for the same reason their update modules are duplicated rather
 * than shared.
 */
export class NopyUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NopyUsageError';
  }
}

/**
 * Reports a failed run in as many lines as it deserves.
 *
 * A {@link NopyUsageError} prints as one line: it is something the reader can
 * fix, and three frames into `dist/` say nothing about a missing `.nopyrc.json`
 * except that it looks like a crash in nopy rather than a typo in the project.
 * Everything else keeps its stack, because an unexpected failure is exactly when
 * one is worth having. `NOPY_DEBUG` forces it for both.
 *
 * Lives here rather than in `nopy.cli.ts` because the CLI is excluded from
 * coverage — it is argv wiring, and this is a decision.
 */
export function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Error: ${message}`);

  const stack = error instanceof Error ? error.stack : undefined;
  const wanted = process.env.NOPY_DEBUG || !(error instanceof NopyUsageError);

  if (wanted && stack) console.error(stack);
  else if (!process.env.NOPY_DEBUG) console.error('Set NOPY_DEBUG=1 for the full stack trace.');
}
