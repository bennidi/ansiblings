/**
 * Tests for the manifest factories
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createManifest, manifest } from '../src/factories.js';

describe('createManifest', () => {
  it('creates manifest with basic properties', () => {
    const m = createManifest({
      id: 'test-cube',
      name: 'Test Cube',
    });

    expect(m.id).toBe('test-cube');
    expect(m.name).toBe('Test Cube');
    expect(m.schema).toBeDefined();
    expect(m.before).toEqual([]);
    expect(m.after).toEqual([]);
  });

  it('accepts schema', () => {
    const schema = z.object({
      VERSION: z.string().default('1.0'),
    });

    const m = createManifest({
      name: 'Test Cube',
      schema,
    });

    expect(m.schema).toBe(schema);
  });

  it('manifest is alias for createManifest', () => {
    expect(manifest).toBe(createManifest);
  });
});
