/**
 * The variable form, on a terminal that reports no size.
 *
 * This is the one case that cannot be tested from inside a vitest worker: there
 * is no TTY there for enquirer to misread, so the mocked tests in
 * `prompts.test.ts` prove only that `rows` is *passed*, never that passing it
 * matters. Here a real pty is opened at 0x0 — `pty.fork()`'s own default, and
 * what `script -q` and some CI terminals report — and a real form is answered
 * through it.
 *
 * Measured both ways while writing this: with `terminalSize()` removed from
 * `nopy.prompts.ts`, the form never renders and the driver times out with
 * nothing on the wire.
 *
 * Needs `python3` for the pty; skipped, loudly, where there is none.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const EXPECT_PY = fileURLToPath(new URL('../../../scripts/expect.py', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const PROBE = fileURLToPath(new URL('./fixtures/form-probe.ts', import.meta.url));

const hasPython = spawnSync('python3', ['--version']).status === 0;

/** Down arrow — how the form moves from one field to the next. */
const DOWN = '\u001b[B';

// Waits for the *description*, not the key. The probe schema is written
// `.describe(…).default(…)` — the order that used to lose the label — so this
// step also witnesses the zod-wrapper unwrapping through a real enquirer render
// rather than through the mocked Form in `prompts.test.ts`.
const STEPS = [
  { expect: 'First value', send: 'alpha-typed', settle: 0.6 },
  { send: DOWN, settle: 0.4 },
  { send: 'beta-typed', settle: 0.4 },
  { send: '\r', settle: 1.2 },
];

describe.skipIf(!hasPython)('variable form over a pty', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-pty-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Answers the probe form on a pty of the given size; returns what it assigned. */
  const answerForm = (rows: number, cols: number) => {
    const stepsPath = path.join(tmpDir, 'steps.json');
    const logPath = path.join(tmpDir, 'session.log');
    fs.writeFileSync(stepsPath, JSON.stringify(STEPS));

    execFileSync('python3', [EXPECT_PY, stepsPath, '--', TSX, PROBE], {
      env: {
        ...process.env,
        PTY_ROWS: String(rows),
        PTY_COLS: String(cols),
        EXPECT_TIMEOUT: '60',
        EXPECT_LOG: logPath,
      },
      stdio: 'pipe',
    });

    const transcript = fs.readFileSync(logPath, 'utf-8').replace(/\r/g, '');
    const line = transcript.split('\n').find((l) => l.startsWith('NOPY_PROBE '));
    return line ? JSON.parse(line.slice('NOPY_PROBE '.length)) : undefined;
  };

  it('collects every field on a terminal reporting 0x0', () => {
    expect(answerForm(0, 0)).toEqual({ ALPHA: 'alpha-typed', BETA: 'beta-typed' });
  }, 90_000);
});
