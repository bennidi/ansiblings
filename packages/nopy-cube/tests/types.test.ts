/**
 * Tests for the Cube runtime wrapper: default extraction and the required-key
 * check that `--use-defaults` relies on.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Cube, Manifest } from '../src/types.js';
import { foreignZodSchema } from './helpers/foreign-zod.js';

const cube = (schema: z.ZodObject<any>) =>
  new Cube(Manifest.create({ id: 'c', name: 'C', schema }), '/cubes/c', 'deploy.py');

describe('Cube', () => {
  it('reads id and name off the manifest', () => {
    const c = cube(z.object({}));

    expect(c.id).toBe('c');
    expect(c.name).toBe('C');
  });

  it('defaults its source to its own directory', () => {
    // What the loader overrides when a cube arrives from a package; a cube
    // built by hand still has to answer the question.
    expect(cube(z.object({})).source).toEqual({ type: 'dir', dir: '/cubes/c' });
  });

  it('keeps the source it was constructed with', () => {
    const source = { type: 'package' as const, packageName: '@acme/cubes-net', dir: '/pkg/cubes' };
    const c = new Cube(
      Manifest.create({ id: 'c', name: 'C' }),
      '/pkg/cubes/c',
      'deploy.py',
      source
    );

    expect(c.source).toBe(source);
  });
});

describe('Cube.getDefaults', () => {
  it('resolves every default when the whole schema parses', () => {
    const c = cube(
      z.object({
        PORT: z.number().default(8080),
        NAME: z.string().default('svc'),
      })
    );

    expect(c.getDefaults()).toEqual({ PORT: 8080, NAME: 'svc' });
  });

  it('keeps the declared defaults when one field has none', () => {
    const c = cube(
      z.object({
        SSID: z.string(),
        PRIORITY: z.number().default(10),
        HIDDEN: z.boolean().default(false),
      })
    );

    expect(c.getDefaults()).toEqual({ PRIORITY: 10, HIDDEN: false });
  });

  it('unwraps a default sitting under optional or nullable', () => {
    const c = cube(
      z.object({
        REQUIRED: z.string(),
        A: z.number().default(1).optional(),
        B: z.number().default(2).nullable(),
        C: z.number().optional().default(3),
      })
    );

    expect(c.getDefaults()).toEqual({ A: 1, B: 2, C: 3 });
  });

  it('evaluates a lazily declared default', () => {
    const c = cube(
      z.object({ REQUIRED: z.string(), TOKEN: z.string().default(() => 'generated') })
    );

    expect(c.getDefaults()).toEqual({ TOKEN: 'generated' });
  });

  it('omits an optional field that declares no default', () => {
    const c = cube(z.object({ REQUIRED: z.string(), MAYBE: z.string().optional() }));

    expect(c.getDefaults()).toEqual({});
  });

  it('returns an empty object for an empty schema', () => {
    expect(cube(z.object({})).getDefaults()).toEqual({});
  });

  it('reads defaults off a schema built by a different copy of zod', () => {
    // The per-field fallback reads zod's internals directly. Under `instanceof`
    // a foreign schema yields no defaults at all, without erroring.
    const c = cube(
      foreignZodSchema(
        z.object({
          REQUIRED: z.string(),
          PRIORITY: z.number().default(10),
          NESTED: z.number().default(2).optional(),
        })
      )
    );

    expect(c.getDefaults()).toEqual({ PRIORITY: 10, NESTED: 2 });
  });
});

describe('Cube.requiredKeys', () => {
  it('lists the fields with neither a default nor optionality', () => {
    const c = cube(
      z.object({
        SSID: z.string(),
        PASSWORD: z.string(),
        PRIORITY: z.number().default(10),
        NOTE: z.string().optional(),
      })
    );

    expect(c.requiredKeys()).toEqual(['SSID', 'PASSWORD']);
  });

  it('treats a nullable field without a default as required', () => {
    const c = cube(z.object({ MAYBE: z.string().nullable() }));

    expect(c.requiredKeys()).toEqual(['MAYBE']);
  });

  it('is empty when every field can fill itself in', () => {
    const c = cube(z.object({ A: z.string().default('a'), B: z.string().optional() }));

    expect(c.requiredKeys()).toEqual([]);
  });
});

describe('Cube.secrets', () => {
  it('is empty when the manifest declares none', () => {
    const c = cube(z.object({ PASSWORD: z.string().default('x') }));

    expect(c.secrets).toEqual([]);
    // No name-based guessing: only what the manifest says.
    expect(c.isSecret('PASSWORD')).toBe(false);
  });

  it('reports what the manifest declared', () => {
    const c = new Cube(
      Manifest.create({
        id: 'c',
        name: 'C',
        schema: z.object({ USER: z.string(), PASSWORD: z.string() }),
        secrets: ['PASSWORD'],
      }),
      '/cubes/c',
      'deploy.py'
    );

    expect(c.secrets).toEqual(['PASSWORD']);
    expect(c.isSecret('PASSWORD')).toBe(true);
    expect(c.isSecret('USER')).toBe(false);
  });

  it('defaults to an empty list on a manifest built by hand', () => {
    const c = new Cube({ id: 'c', name: 'C', schema: z.object({}) }, '/cubes/c', 'deploy.py');

    expect(c.secrets).toEqual([]);
  });
});
