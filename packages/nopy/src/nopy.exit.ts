/**
 * What happens when the user walks out of the TUI instead of finishing it.
 * @module nopy.exit
 */

/** Parting words. Printed whenever a run ends because the user asked it to. */
export const FAREWELL = 'Bye Bye HoneyPy';

/** Conventional exit code for "terminated by SIGINT" — 128 + 2. */
export const CANCELLED_EXIT_CODE = 130;

/** ETX: the byte a raw-mode terminal delivers for Ctrl-C. */
const ETX = '\x03';

/** Undoes `ansi.cursor.hide()`, which every enquirer prompt writes on start. */
const SHOW_CURSOR = '\x1B[?25h';

/**
 * Error names the two prompt libraries use for "the user called it off".
 *
 * `ExitPromptError` is what `@inquirer/core` rejects with on Ctrl-C;
 * `CancelPromptError` is the same thing reached from outside the prompt.
 */
const CANCEL_ERROR_NAMES = new Set(['ExitPromptError', 'CancelPromptError']);

/**
 * Whether a thrown value is the user cancelling rather than something failing.
 *
 * Three shapes, one per way out of a prompt:
 *
 * - `ERR_USE_AFTER_CLOSE` — enquirer's teardown exploding. Ctrl-C in raw mode
 *   reaches *both* node's readline, which closes the interface because it has
 *   no `SIGINT` listener, and enquirer's own keypress queue, which then cancels
 *   the prompt and calls `rl.pause()` on the interface node has already closed.
 *   Node >= 22 throws there rather than ignoring it. The throw happens inside
 *   `Prompt.close()`, i.e. *before* `emit('cancel')`, so `prompt.run()` never
 *   settles and the `try/catch` around it in `nopy.prompts` never runs — the
 *   rejection surfaces with nothing awaiting it, which is why this has to be
 *   caught at the process level.
 * - `ExitPromptError` — inquirer, which does reject cleanly and whose rejection
 *   travels up the normal call chain.
 * - a bare `''` or an ETX byte — enquirer rejecting a cancelled prompt with the
 *   keypress that cancelled it, on the runs where the teardown does not throw.
 */
export function isCancellation(error: unknown): boolean {
  if (error === '' || error === ETX) return true;
  if (typeof error !== 'object' || error === null) return false;

  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    code === 'ERR_USE_AFTER_CLOSE' || (typeof name === 'string' && CANCEL_ERROR_NAMES.has(name))
  );
}

/**
 * Puts the terminal back the way it was found.
 *
 * A prompt owns the terminal while it runs: stdin is in raw mode and the cursor
 * is hidden. Exiting from under it leaves the shell with no cursor and no echo,
 * so this runs on every abnormal exit, cancelled or crashed. Best-effort by
 * design — a destroyed stdin throws on `setRawMode`, and a failure to tidy up
 * must not replace the message explaining why we are leaving.
 */
export function restoreTerminal(): void {
  try {
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
    if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR);
  } catch {
    // Nothing useful to do about a terminal that will not be restored.
  }
}

/**
 * Says goodbye and leaves.
 *
 * The farewell goes to **stderr**, for the same reason the update hint does:
 * `--json` and `--print-only` stay machine-readable no matter how the run ends.
 *
 * `process.exit` rather than letting the loop drain, because the prompt that
 * was cancelled is still holding stdin — after the teardown above threw, its
 * promise is pending forever and nothing else will end the process.
 */
export function exitWithFarewell(code: number = CANCELLED_EXIT_CODE): never {
  restoreTerminal();
  process.stderr.write(`\n${FAREWELL}\n`);
  return process.exit(code) as never;
}

/**
 * Reports a genuine crash, having first handed the terminal back.
 *
 * Deliberately as loud as node's own default — the stack, not a summary. The
 * only thing being taken over is *when* it prints, so that {@link
 * restoreTerminal} gets to run first.
 */
function reportFatal(error: unknown): never {
  restoreTerminal();
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  return process.exit(1) as never;
}

/**
 * Installs the process-level handlers that turn a Ctrl-C into {@link FAREWELL}.
 *
 * Two entry points, because Ctrl-C arrives differently depending on who owns
 * the terminal. During a prompt, stdin is in raw mode: the process gets no
 * `SIGINT` at all, the keypress goes to the prompt library, and the failure
 * comes back as an unhandled rejection. Everywhere else — cube loading, a
 * pyinfra run — the signal arrives normally.
 *
 * Returns a disposer, which the CLI ignores and the tests do not.
 */
export function installGracefulExit(): () => void {
  const onSignal = () => exitWithFarewell();
  const onFatal = (reason: unknown) => {
    if (isCancellation(reason)) {
      exitWithFarewell();
      return;
    }
    reportFatal(reason);
  };

  process.on('SIGINT', onSignal);
  process.on('uncaughtException', onFatal);
  process.on('unhandledRejection', onFatal);

  return () => {
    process.off('SIGINT', onSignal);
    process.off('uncaughtException', onFatal);
    process.off('unhandledRejection', onFatal);
  };
}
