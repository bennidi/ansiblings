/**
 * Tests for cubes/dependencies module (BuildContext)
 */

import { Cube, Manifest } from '@bitsquare/nopy-cubes';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BuildContext } from '../src/cubes/dependencies.js';
import { Variables } from '../src/nopy.common.js';

// Mock VariableAssignment to avoid hanging on prompts
vi.mock('../src/nopy.prompts.js', async () => {
  const actual = await vi.importActual('../src/nopy.prompts.js');
  return {
    ...actual,
    VariableAssignment: vi.fn(),
  };
});

/**
 * Helper to create a minimal cube for testing
 */
function createTestCube(id: string, dependencies?: (vars: any) => any[]): Cube {
  const manifest = Manifest.create({
    id,
    name: `Test ${id}`,
    schema: z.object({}),
    dependencies,
  });
  return new Cube(manifest, `/test/${id}`, 'deploy.py');
}

describe('BuildContext.resolveCube', () => {
  it('resolves a single cube with no dependencies', async () => {
    const cubeA = createTestCube('cube-a');
    const cubes = { 'cube-a': cubeA };
    const vars = new Variables();
    const context = new BuildContext(cubes, vars, { cubes: [] } as any, { env: {} } as any, {
      method: 'ssh',
    });

    await context.resolveCube('cube-a', 'host1');

    expect(context.deployCalls).toHaveLength(1);
    expect(context.deployCalls[0].cube).toBe('cube-a');
    expect(context.deployCalls[0].host).toBe('host1');
  });

  it('resolves dependencies recursively', async () => {
    const cubeA = createTestCube('cube-a');
    const cubeB = createTestCube('cube-b', () => ['cube-a']);
    const cubes = { 'cube-a': cubeA, 'cube-b': cubeB };
    const vars = new Variables();
    const context = new BuildContext(cubes, vars, { cubes: [] } as any, { env: {} } as any, {
      method: 'ssh',
    });

    await context.resolveCube('cube-b', 'host1');

    expect(context.deployCalls).toHaveLength(2);
    // Dependencies should be resolved BEFORE the cube that depends on them
    expect(context.deployCalls[0].cube).toBe('cube-a');
    expect(context.deployCalls[1].cube).toBe('cube-b');
  });

  it('resolves dynamic dependencies based on variables', async () => {
    const cubeA = createTestCube('cube-a');
    const cubeB = createTestCube('cube-b');
    const cubeC = createTestCube('cube-c', (vars) => (vars.USE_A ? ['cube-a'] : ['cube-b']));

    cubeC.manifest.schema = z.object({ USE_A: z.boolean().default(true) });

    const cubes = { 'cube-a': cubeA, 'cube-b': cubeB, 'cube-c': cubeC };

    // Test with USE_A = true
    const vars1 = new Variables();
    const context1 = new BuildContext(cubes, vars1, { cubes: [] } as any, { env: {} } as any, {
      method: 'ssh',
    });
    await context1.resolveCube('cube-c', 'host1');
    expect(context1.deployCalls.map((c) => c.cube)).toEqual(['cube-a', 'cube-c']);

    // Test with USE_A = false
    const vars2 = new Variables();
    vars2.assign('cube-c', 'param', { USE_A: false });
    const context2 = new BuildContext(cubes, vars2, { cubes: [] } as any, { env: {} } as any, {
      method: 'ssh',
    });
    await context2.resolveCube('cube-c', 'host1');
    expect(context2.deployCalls.map((c) => c.cube)).toEqual(['cube-b', 'cube-c']);
  });

  it('passes variables to dependencies', async () => {
    const cubeA = createTestCube('cube-a');
    cubeA.manifest.schema = z.object({ VAR: z.string() });

    const cubeB = createTestCube('cube-b', () => [['cube-a', { VAR: 'from-b' }]]);

    const cubes = { 'cube-a': cubeA, 'cube-b': cubeB };
    const vars = new Variables();
    const context = new BuildContext(cubes, vars, { cubes: [] } as any, { env: {} } as any, {
      method: 'ssh',
    });

    await context.resolveCube('cube-b', 'host1');

    expect(context.deployCalls[0].cube).toBe('cube-a');
    expect(context.deployCalls[0].env.VAR).toBe('from-b');
  });

  it('avoids duplicate calls for the same cube on the same host', async () => {
    const cubeA = createTestCube('cube-a');
    const cubeB = createTestCube('cube-b', () => ['cube-a']);
    const cubeC = createTestCube('cube-c', () => ['cube-a', 'cube-b']);

    const cubes = { 'cube-a': cubeA, 'cube-b': cubeB, 'cube-c': cubeC };
    const vars = new Variables();
    const context = new BuildContext(cubes, vars, { cubes: [] } as any, { env: {} } as any, {
      method: 'ssh',
    });

    await context.resolveCube('cube-c', 'host1');

    // Execution order: cube-a, cube-b, cube-c
    expect(context.deployCalls.map((c) => c.cube)).toEqual(['cube-a', 'cube-b', 'cube-c']);
  });
});

describe('deploy order across several selected cubes', () => {
  // `nopy.main.ts` walks `workflow.selectedCubes` and calls `resolveCube` once
  // per entry, so the order that list arrives in is the order the loop visits.
  // Emission is post-order, though, so a declared edge is honoured whichever way
  // round the two cubes were listed — the recursion *is* the topological sort,
  // and these pin that rather than leaving it to be inferred from the one-root
  // cases above.
  async function resolveAll(cubes: Record<string, Cube>, selected: string[]): Promise<string[]> {
    const context = new BuildContext(
      cubes,
      new Variables(),
      { cubes: [] } as any,
      {
        env: {},
      } as any,
      { method: 'ssh' }
    );

    for (const id of selected) await context.resolveCube(id, 'host1');

    return context.deployCalls.map((c) => c.cube);
  }

  it('emits a dependency first even when it is selected last', async () => {
    const cubes = {
      'cube-a': createTestCube('cube-a'),
      'cube-b': createTestCube('cube-b', () => ['cube-a']),
    };

    // The list order is the inversion of the dependency: b depends on a, and a
    // is named after it. Resolving b still drags a in ahead of itself, and the
    // second visit is deduped rather than re-emitted at the tail.
    expect(await resolveAll(cubes, ['cube-b', 'cube-a'])).toEqual(['cube-a', 'cube-b']);
    expect(await resolveAll(cubes, ['cube-a', 'cube-b'])).toEqual(['cube-a', 'cube-b']);
  });

  it('interleaves an unrelated cube by list order and nothing else', async () => {
    // With no edge between them there is nothing to sort on, so `cube-z` lands
    // where the list put it. That is the whole of what selection order decides.
    const cubes = {
      'cube-a': createTestCube('cube-a'),
      'cube-b': createTestCube('cube-b', () => ['cube-a']),
      'cube-z': createTestCube('cube-z'),
    };

    expect(await resolveAll(cubes, ['cube-z', 'cube-b'])).toEqual(['cube-z', 'cube-a', 'cube-b']);
    expect(await resolveAll(cubes, ['cube-b', 'cube-z'])).toEqual(['cube-a', 'cube-b', 'cube-z']);
  });
});
