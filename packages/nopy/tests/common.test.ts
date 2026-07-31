/**
 * Tests for Variable and Variables.
 *
 * Two things are pinned down here rather than left to the callers to
 * demonstrate: the precedence between origins, which is what makes a
 * non-interactive run configurable, and the tie-break between two assignments
 * sharing an origin, which is what keeps a losing dependency visible instead of
 * overwritten.
 */

import { describe, expect, it } from 'vitest';
import { MASK, Variable, Variables } from '../src/nopy.common.js';

describe('Variable ordering', () => {
  it('is born with its first assignment', () => {
    const variable = new Variable('cube-a', 'PORT', { value: 22, origin: 'default' });

    expect(variable.value).toBe(22);
    expect(variable.origin).toBe('default');
    expect(variable.assignments).toHaveLength(1);
  });

  it('lets a higher origin win however late it arrives', () => {
    const variable = new Variable('cube-a', 'PORT', { value: 22, origin: 'default' });

    variable.assign({ value: 8080, origin: 'param' });
    variable.assign({ value: 2222, origin: 'env' });

    expect(variable.value).toBe(8080);
    expect(variable.origin).toBe('param');
  });

  it('keeps the newest of two assignments sharing an origin', () => {
    const variable = new Variable('cube-a', 'PORT', { value: 1, origin: 'param' });

    variable.assign({ value: 2, origin: 'param' });

    expect(variable.value).toBe(2);
    // The displaced one is still on record — that is the whole point of the
    // trace, and a sort that broke ties by rank alone would lose it.
    expect(variable.ordered.map((a) => a.value)).toEqual([2, 1]);
  });

  it('keeps the raw trace in assignment order, newest first', () => {
    const variable = new Variable('cube-a', 'PORT', { value: 22, origin: 'default' });

    variable.assign({ value: 8080, origin: 'param' });
    variable.assign({ value: 2222, origin: 'env' });

    expect(variable.assignments.map((a) => a.origin)).toEqual(['env', 'param', 'default']);
    expect(variable.ordered.map((a) => a.origin)).toEqual(['param', 'env', 'default']);
  });

  it('ranks every origin', () => {
    const variable = new Variable('cube-a', 'PORT', { value: 'd', origin: 'default' });

    variable.assign({ value: 'e', origin: 'env' });
    expect(variable.value).toBe('e');
    variable.assign({ value: 's', origin: 'session' });
    expect(variable.value).toBe('s');
    variable.assign({ value: 'p', origin: 'prompt' });
    expect(variable.value).toBe('p');
    variable.assign({ value: 'x', origin: 'param' });
    expect(variable.value).toBe('x');
  });

  it('never yields the value of a redacted variable when serialised', () => {
    const variable = new Variable('cube-a', 'PASSWORD', { value: 'hunter2', origin: 'prompt' });
    variable.redacted = true;

    expect(JSON.parse(JSON.stringify(variable))).toEqual({
      cube: 'cube-a',
      name: 'PASSWORD',
      value: MASK,
      origin: 'prompt',
    });
  });
});

describe('Variables.assign', () => {
  it('creates a variable on first assignment and appends afterwards', () => {
    const variables = new Variables();

    variables.assign('cube-a', 'default', { A: 1 });
    variables.assign('cube-a', 'prompt', { A: 2 });

    expect(variables.of('cube-a', 'A')?.assignments).toHaveLength(2);
    expect(variables.get('cube-a')).toEqual({ A: 2 });
  });

  it('tolerates an empty assignment', () => {
    const variables = new Variables();

    variables.assign('cube-a', 'prompt');

    expect(variables.get('cube-a')).toEqual({});
  });

  it('keeps cubes apart', () => {
    const variables = new Variables();

    variables.assign('cube-a', 'param', { A: 1 });

    expect(variables.get('cube-b')).toEqual({});
    expect(variables.of('cube-b', 'A')).toBeUndefined();
  });
});

describe('Variables precedence', () => {
  it('lets config env override a schema default', () => {
    const variables = new Variables({ PORT: 2222 });
    variables.assign('cube-a', 'default', { PORT: 22 });

    expect(variables.get('cube-a').PORT).toBe(2222);
    expect(variables.of('cube-a', 'PORT')?.origin).toBe('env');
  });

  it('lets a prompt override config env', () => {
    const variables = new Variables({ PORT: 2222 });
    variables.assign('cube-a', 'default', { PORT: 22 });
    variables.assign('cube-a', 'prompt', { PORT: 8080 });

    expect(variables.get('cube-a').PORT).toBe(8080);
  });

  it('lets a replayed session value override config env', () => {
    const variables = new Variables({ PORT: 2222 });
    variables.assign('cube-a', 'default', { PORT: 22 });
    variables.assign('cube-a', 'session', { PORT: 3000 });

    expect(variables.get('cube-a').PORT).toBe(3000);
  });

  it('lets a dependency param override everything else', () => {
    const variables = new Variables({ PORT: 2222 });
    variables.assign('cube-a', 'default', { PORT: 22 });
    variables.assign('cube-a', 'prompt', { PORT: 8080 });
    variables.assign('cube-a', 'param', { PORT: 9090 });

    expect(variables.get('cube-a').PORT).toBe(9090);
  });

  it('merges keys from every origin', () => {
    const variables = new Variables({ G: 'g' });
    variables.assign('cube-a', 'default', { D: 'd' });
    variables.assign('cube-a', 'prompt', { P: 'p' });
    variables.assign('cube-a', 'param', { X: 'x' });

    expect(variables.get('cube-a')).toEqual({ G: 'g', D: 'd', P: 'p', X: 'x' });
  });

  it('applies config env to every cube it is asked about', () => {
    const variables = new Variables({ SHARED: 'yes' });

    variables.assign('cube-a', 'default', {});
    variables.assign('cube-b', 'default', {});

    expect(variables.get('cube-a').SHARED).toBe('yes');
    expect(variables.get('cube-b').SHARED).toBe('yes');
    expect(variables.of('cube-a', 'SHARED')?.origin).toBe('env');
  });
});

describe('Variables secrets', () => {
  it('excludes a declared secret from what a session records', () => {
    const variables = new Variables();
    variables.declareSecrets('cube-a', ['PASSWORD']);
    variables.assign('cube-a', 'prompt', { USER: 'bob', PASSWORD: 'hunter2' });

    expect(variables.get('cube-a')).toEqual({ USER: 'bob', PASSWORD: 'hunter2' });
    expect(variables.persistable('cube-a')).toEqual({ USER: 'bob' });
  });

  it('marks values that arrived before the declaration', () => {
    const variables = new Variables();
    variables.assign('cube-a', 'prompt', { PASSWORD: 'hunter2' });

    variables.declareSecrets('cube-a', ['PASSWORD']);

    expect(variables.of('cube-a', 'PASSWORD')?.redacted).toBe(true);
    expect(variables.persistable('cube-a')).toEqual({});
  });

  it('redacts a secret supplied through config env', () => {
    const variables = new Variables({ PASSWORD: 'from-env' });
    variables.declareSecrets('cube-a', ['PASSWORD']);

    variables.assign('cube-a', 'default', {});

    expect(variables.get('cube-a').PASSWORD).toBe('from-env');
    expect(variables.persistable('cube-a')).toEqual({});
  });

  it('keeps secret declarations per cube', () => {
    const variables = new Variables();
    variables.declareSecrets('cube-a', ['PASSWORD']);
    variables.assign('cube-a', 'prompt', { PASSWORD: 'a' });
    variables.assign('cube-b', 'prompt', { PASSWORD: 'b' });

    expect(variables.persistable('cube-a')).toEqual({});
    expect(variables.persistable('cube-b')).toEqual({ PASSWORD: 'b' });
  });

  it('excludes a declared secret from the env a session records', () => {
    const variables = new Variables({ PASSWORD: 'hunter2', KEY_DIR: './vault' }, ['PASSWORD']);

    expect(variables.persistableEnv()).toEqual({ KEY_DIR: './vault' });
  });

  it('records an env with no secrets in it whole', () => {
    const variables = new Variables({ KEY_DIR: './vault' }, ['PASSWORD']);

    expect(variables.persistableEnv()).toEqual({ KEY_DIR: './vault' });
  });
});

describe('Variables globally declared secrets', () => {
  /** `env` carrying a key that cube-a declares secret and cube-b knows nothing of. */
  const withLeakyEnv = () => {
    const variables = new Variables({ PASSWORD: 'wildpass123', KEY_DIR: '/vault' }, ['PASSWORD']);
    variables.declareSecrets('cube-a', ['PASSWORD']);
    variables.declareSchema('cube-a', ['USER', 'PASSWORD']);
    variables.declareSchema('cube-b', ['PORT']);
    return variables;
  };

  it('does not seed a secret onto a cube that does not declare it', () => {
    const variables = withLeakyEnv();
    variables.assign('cube-b', 'default', { PORT: 22 });

    expect(variables.get('cube-b')).not.toHaveProperty('PASSWORD');
    expect(variables.of('cube-b', 'PASSWORD')).toBeUndefined();
  });

  it('still seeds it onto a cube whose schema declares it', () => {
    const variables = withLeakyEnv();
    variables.assign('cube-a', 'default', {});

    expect(variables.get('cube-a').PASSWORD).toBe('wildpass123');
    expect(variables.of('cube-a', 'PASSWORD')?.origin).toBe('env');
    expect(variables.persistable('cube-a')).not.toHaveProperty('PASSWORD');
  });

  it('keeps broadcasting an undeclared key that is not a secret', () => {
    // ssh:keyman reads KEY_DIR off host.data without declaring it in its schema.
    const variables = withLeakyEnv();
    variables.assign('cube-b', 'default', {});

    expect(variables.get('cube-b').KEY_DIR).toBe('/vault');
  });

  it('redacts a global secret on a cube whose own manifest forgot to list it', () => {
    const variables = new Variables({}, ['PASSWORD']);
    variables.assign('cube-b', 'prompt', { PASSWORD: 'typed' });

    expect(variables.of('cube-b', 'PASSWORD')?.redacted).toBe(true);
    expect(variables.persistable('cube-b')).toEqual({});
  });

  it('treats a cube that declared no schema as declaring nothing', () => {
    const variables = new Variables({ PASSWORD: 'p' }, ['PASSWORD']);
    variables.assign('cube-z', 'default', {});

    expect(variables.get('cube-z')).toEqual({});
  });
});
