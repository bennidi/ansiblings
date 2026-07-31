/**
 * Tests for nopy.errors — how a failed run is presented.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NopyUsageError, reportError } from '../src/nopy.errors.js';

let out: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

/** Everything written to stderr by the last call, as one string. */
const stderr = () => err.mock.calls.map((call) => String(call[0])).join('\n');

beforeEach(() => {
  out = vi.spyOn(console, 'log').mockImplementation(() => {});
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.NOPY_DEBUG;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportError', () => {
  it('prints a usage error as one line and points at the debug switch', () => {
    reportError(new NopyUsageError('No .nopyrc.json found'));

    expect(stderr()).toContain('Error: No .nopyrc.json found');
    expect(stderr()).not.toContain('nopy.errors');
    expect(stderr()).toContain('NOPY_DEBUG=1');
  });

  it('keeps the stack for anything unexpected', () => {
    reportError(new TypeError('cannot read properties of undefined'));

    expect(stderr()).toContain('Error: cannot read properties of undefined');
    expect(stderr()).toContain('TypeError: cannot read properties of undefined\n    at ');
    expect(stderr()).not.toContain('NOPY_DEBUG=1');
  });

  it('prints the stack of a usage error under NOPY_DEBUG', () => {
    process.env.NOPY_DEBUG = '1';

    reportError(new NopyUsageError('No .nopyrc.json found'));

    expect(stderr()).toContain('NopyUsageError: No .nopyrc.json found\n    at ');
    expect(stderr()).not.toContain('NOPY_DEBUG=1 for');
  });

  it('reports a thrown non-error', () => {
    reportError('just a string');

    expect(stderr()).toContain('Error: just a string');
    expect(stderr()).toContain('NOPY_DEBUG=1');
  });

  it('says nothing on stdout', () => {
    reportError(new NopyUsageError('No .nopyrc.json found'));

    expect(out).not.toHaveBeenCalled();
  });
});
