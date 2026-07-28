/**
 * Tests for cube hooks using BuildContext
 */

import { Cube, Manifest } from '@bitsquare/nopy-cube';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BuildContext } from '../src/cubes/dependencies.js';
import { Variables } from '../src/nopy.common.js';

describe('Cube Hooks', () => {
  const createMockCube = (id: string, name: string, manifest: Partial<Manifest> = {}): Cube => {
    const m = Manifest.create({
      id,
      name,
      schema: z.object({}),
      ...manifest,
    });
    return new Cube(m, `/tmp/${id}`, 'deploy.py');
  };

  it('should execute hooks in the correct order', async () => {
    const order: string[] = [];

    const cubes: Record<string, Cube> = {
      main: createMockCube('main', 'Main Cube', {
        before: [
          async ({ exec }) => {
            order.push('main:before');
            await exec('before-hook', {});
          },
        ],
        after: [
          async ({ exec }) => {
            order.push('main:after');
            await exec('after-hook', {});
          },
        ],
        dependencies: () => ['dep'],
      }),
      'before-hook': createMockCube('before-hook', 'Before Hook'),
      'after-hook': createMockCube('after-hook', 'After Hook'),
      dep: createMockCube('dep', 'Dependency'),
    };

    // Note: buildDeployCall also records the main cube execution
    // We can't easily spy on buildDeployCall, but we can see the resulting deployCalls order

    const vars = new Variables();
    const context = new BuildContext(
      cubes,
      vars,
      { hosts: ['host1'], cubes: [] } as any,
      { env: {} } as any,
      { method: 'ssh' }
    );

    await context.resolveCube('main', 'host1');

    const callOrder = context.deployCalls.map((c) => c.cube);

    // Expected order:
    // 1. main:before (hook runs)
    // 2. before-hook (resolved via exec in before hook)
    // 3. dep (dependency of main)
    // 4. main (the cube itself)
    // 5. main:after (hook runs)
    // 6. after-hook (resolved via exec in after hook)

    expect(order).toEqual(['main:before', 'main:after']);
    expect(callOrder).toEqual(['before-hook', 'dep', 'main', 'after-hook']);
  });
});
