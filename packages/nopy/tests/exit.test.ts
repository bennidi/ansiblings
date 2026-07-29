/**
 * Tests for nopy.exit.
 *
 * The handlers are invoked by calling the listener `installGracefulExit`
 * registered, not by `process.emit()`-ing the event: vitest listens for
 * `unhandledRejection` and `uncaughtException` itself and would report a
 * synthetic one as a failure of the test file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANCELLED_EXIT_CODE,
  exitWithFarewell,
  FAREWELL,
  installGracefulExit,
  isCancellation,
  restoreTerminal,
} from '../src/nopy.exit.js';

let exit: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

/** Pretends stdin/stdout are the terminal a prompt would have taken over. */
function fakeTerminal(opts: { isTTY: boolean; isRaw?: boolean }) {
  const setRawMode = vi.fn();
  const original = {
    isTTY: process.stdin.isTTY,
    isRaw: process.stdin.isRaw,
    setRawMode: process.stdin.setRawMode,
    outTTY: process.stdout.isTTY,
  };

  Object.defineProperty(process.stdin, 'isTTY', { value: opts.isTTY, configurable: true });
  Object.defineProperty(process.stdin, 'isRaw', { value: opts.isRaw ?? false, configurable: true });
  Object.defineProperty(process.stdin, 'setRawMode', { value: setRawMode, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: opts.isTTY, configurable: true });

  const restore = () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: original.isTTY, configurable: true });
    Object.defineProperty(process.stdin, 'isRaw', { value: original.isRaw, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: original.setRawMode,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: original.outTTY, configurable: true });
  };

  return { setRawMode, restore };
}

/** The listener `installGracefulExit` most recently added for `event`. */
const lastListener = (event: string) =>
  process.listeners(event as 'SIGINT').at(-1) as (reason?: unknown) => void;

beforeEach(() => {
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isCancellation', () => {
  it('recognises enquirer tearing down a readline node already closed', () => {
    const err = Object.assign(new Error('readline was closed'), { code: 'ERR_USE_AFTER_CLOSE' });

    expect(isCancellation(err)).toBe(true);
  });

  it('recognises the inquirer cancellations', () => {
    const exitPrompt = Object.assign(new Error('User force closed the prompt'), {
      name: 'ExitPromptError',
    });
    const cancelPrompt = Object.assign(new Error('Prompt was canceled'), {
      name: 'CancelPromptError',
    });

    expect(isCancellation(exitPrompt)).toBe(true);
    expect(isCancellation(cancelPrompt)).toBe(true);
  });

  it('recognises the bare values enquirer rejects a cancelled prompt with', () => {
    expect(isCancellation('')).toBe(true);
    expect(isCancellation('\x03')).toBe(true);
  });

  it('leaves a genuine failure alone', () => {
    expect(isCancellation(new Error('pyinfra exited 1'))).toBe(false);
    expect(isCancellation(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(false);
    expect(isCancellation('boom')).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
    expect(isCancellation(null)).toBe(false);
    expect(isCancellation(7)).toBe(false);
  });
});

describe('restoreTerminal', () => {
  it('leaves raw mode and shows the cursor again', () => {
    const terminal = fakeTerminal({ isTTY: true, isRaw: true });

    restoreTerminal();

    expect(terminal.setRawMode).toHaveBeenCalledWith(false);
    expect(process.stdout.write).toHaveBeenCalledWith('\x1B[?25h');
    terminal.restore();
  });

  it('touches nothing when the output is not a terminal', () => {
    const terminal = fakeTerminal({ isTTY: false });

    restoreTerminal();

    expect(terminal.setRawMode).not.toHaveBeenCalled();
    expect(process.stdout.write).not.toHaveBeenCalled();
    terminal.restore();
  });

  it('survives a stdin that refuses to leave raw mode', () => {
    const terminal = fakeTerminal({ isTTY: true, isRaw: true });
    terminal.setRawMode.mockImplementation(() => {
      throw new Error('stdin destroyed');
    });

    expect(() => restoreTerminal()).not.toThrow();
    terminal.restore();
  });
});

describe('exitWithFarewell', () => {
  it('says goodbye on stderr and exits 130', () => {
    exitWithFarewell();

    expect(stderr).toHaveBeenCalledWith(`\n${FAREWELL}\n`);
    expect(exit).toHaveBeenCalledWith(CANCELLED_EXIT_CODE);
  });

  it('accepts a different exit code', () => {
    exitWithFarewell(0);

    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('installGracefulExit', () => {
  let dispose: () => void;

  beforeEach(() => {
    dispose = installGracefulExit();
  });

  afterEach(() => {
    dispose();
  });

  it('says goodbye on SIGINT', () => {
    lastListener('SIGINT')();

    expect(stderr).toHaveBeenCalledWith(`\n${FAREWELL}\n`);
    expect(exit).toHaveBeenCalledWith(CANCELLED_EXIT_CODE);
  });

  it('says goodbye for the rejection nothing is awaiting', () => {
    // The shape of the real crash: enquirer's Ctrl-C teardown, which leaves
    // `prompt.run()` pending forever, so no `catch` in nopy.prompts sees it.
    lastListener('unhandledRejection')(
      Object.assign(new Error('readline was closed'), { code: 'ERR_USE_AFTER_CLOSE' })
    );

    expect(stderr).toHaveBeenCalledWith(`\n${FAREWELL}\n`);
    expect(exit).toHaveBeenCalledWith(CANCELLED_EXIT_CODE);
  });

  it('still reports a real crash, loudly, and exits 1', () => {
    const boom = new Error('everything is on fire');

    lastListener('uncaughtException')(boom);

    expect(stderr).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(boom.stack);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports a thrown non-error too', () => {
    lastListener('uncaughtException')('just a string');

    expect(console.error).toHaveBeenCalledWith('just a string');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports an error with no stack by its message', () => {
    const stackless = new Error('no stack here');
    stackless.stack = undefined;

    lastListener('uncaughtException')(stackless);

    expect(console.error).toHaveBeenCalledWith('no stack here');
  });

  it('hands the process back on dispose', () => {
    const before = {
      SIGINT: process.listenerCount('SIGINT'),
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
    };

    dispose();

    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT - 1);
    expect(process.listenerCount('uncaughtException')).toBe(before.uncaughtException - 1);
    expect(process.listenerCount('unhandledRejection')).toBe(before.unhandledRejection - 1);

    // The afterEach disposer runs a second time; make it a no-op.
    dispose = () => {};
  });
});
