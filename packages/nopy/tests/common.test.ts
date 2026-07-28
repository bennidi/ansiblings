/**
 * Tests for the Variables scope container.
 *
 * The merge order is what makes a non-interactive run configurable, so it is
 * pinned down here rather than left to the callers to demonstrate.
 */

import { describe, expect, it } from 'vitest';
import { Variables } from '../src/nopy.common.js';

describe('Variables.assign', () => {
  it('creates the scope entry on first assignment and merges afterwards', () => {
    const variables = new Variables();

    variables.assign('cube-a', 'defaults', { A: 1 });
    variables.assign('cube-a', 'defaults', { B: 2 });

    expect(variables.get('cube-a', 'defaults')).toEqual({ A: 1, B: 2 });
  });

  it('defaults to an empty assignment', () => {
    const variables = new Variables();

    variables.assign('cube-a', 'prompts');

    expect(variables.get('cube-a', 'prompts')).toEqual({});
  });

  it('keeps scopes and cubes apart', () => {
    const variables = new Variables();

    variables.assign('cube-a', 'params', { A: 1 });

    expect(variables.get('cube-a', 'prompts')).toEqual({});
    expect(variables.get('cube-b', 'params')).toEqual({});
  });
});

describe('Variables.get precedence', () => {
  it('lets global env override a schema default', () => {
    const variables = new Variables({ PORT: 2222 });
    variables.assign('cube-a', 'defaults', { PORT: 22 });

    expect(variables.get('cube-a').PORT).toBe(2222);
  });

  it('lets a prompt override global env', () => {
    const variables = new Variables({ PORT: 2222 });
    variables.assign('cube-a', 'defaults', { PORT: 22 });
    variables.assign('cube-a', 'prompts', { PORT: 8080 });

    expect(variables.get('cube-a').PORT).toBe(8080);
  });

  it('lets a dependency param override everything else', () => {
    const variables = new Variables({ PORT: 2222 });
    variables.assign('cube-a', 'defaults', { PORT: 22 });
    variables.assign('cube-a', 'prompts', { PORT: 8080 });
    variables.assign('cube-a', 'params', { PORT: 9090 });

    expect(variables.get('cube-a').PORT).toBe(9090);
  });

  it('merges keys from every scope', () => {
    const variables = new Variables({ G: 'g' });
    variables.assign('cube-a', 'defaults', { D: 'd' });
    variables.assign('cube-a', 'prompts', { P: 'p' });
    variables.assign('cube-a', 'params', { X: 'x' });

    expect(variables.get('cube-a')).toEqual({ G: 'g', D: 'd', P: 'p', X: 'x' });
  });

  it('applies global env to every cube', () => {
    const variables = new Variables({ SHARED: 'yes' });

    expect(variables.get('anything').SHARED).toBe('yes');
  });
});
