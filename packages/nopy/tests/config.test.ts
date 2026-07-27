/**
 * Tests for nopy.config module
 */

import { describe, expect, it } from 'vitest';
import { type LogConfig, logConfigToFlags } from '../src/nopy.config.js';

describe('logConfigToFlags', () => {
  it('returns empty array for silent verbosity', () => {
    const flags = logConfigToFlags({ verbosity: 'silent' });
    expect(flags).toEqual([]);
  });

  it('returns empty array for undefined config', () => {
    const flags = logConfigToFlags(undefined);
    expect(flags).toEqual([]);
  });

  it('returns empty array for empty config', () => {
    const flags = logConfigToFlags({});
    expect(flags).toEqual([]);
  });

  it('returns -v for info verbosity', () => {
    const flags = logConfigToFlags({ verbosity: 'info' });
    expect(flags).toEqual(['-v']);
  });

  it('returns -vv for verbose verbosity', () => {
    const flags = logConfigToFlags({ verbosity: 'verbose' });
    expect(flags).toEqual(['-vv']);
  });

  it('returns -vvv for trace verbosity', () => {
    const flags = logConfigToFlags({ verbosity: 'trace' });
    expect(flags).toEqual(['-vvv']);
  });

  it('adds --debug when debug is true', () => {
    const flags = logConfigToFlags({ debug: true });
    expect(flags).toContain('--debug');
  });

  it('combines verbosity and debug', () => {
    const flags = logConfigToFlags({ verbosity: 'verbose', debug: true });
    expect(flags).toContain('-vv');
    expect(flags).toContain('--debug');
    expect(flags).toHaveLength(2);
  });

  it('does not add --debug when debug is false', () => {
    const flags = logConfigToFlags({ verbosity: 'info', debug: false });
    expect(flags).toEqual(['-v']);
  });
});
