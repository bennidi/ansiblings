/**
 * Tests for the uniqid helper
 */

import { describe, expect, it } from 'vitest';
import { uniqid } from '../src/utils.js';

describe('uniqid', () => {
  it('generates string of default length (5)', () => {
    const id = uniqid();
    expect(id).toHaveLength(5);
  });

  it('generates string of specified length', () => {
    expect(uniqid(10)).toHaveLength(10);
    expect(uniqid(3)).toHaveLength(3);
    expect(uniqid(20)).toHaveLength(20);
  });

  it('generates alphanumeric characters only', () => {
    const id = uniqid(100);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('generates different values on subsequent calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(uniqid(10));
    }
    // Should have many unique values (some collisions possible but unlikely)
    expect(ids.size).toBeGreaterThan(90);
  });

  it('handles edge case of length 1', () => {
    const id = uniqid(1);
    expect(id).toHaveLength(1);
    expect(id).toMatch(/^[A-Za-z0-9]$/);
  });

  it('handles edge case of length 0', () => {
    const id = uniqid(0);
    expect(id).toBe('');
  });
});
