/**
 * Integration tests for cubes/loader module
 */

import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fs } from 'zx';
import { loadCubes } from '../src/cubes/loader.js';

describe('loadCubes (Integration)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nopy-test-'));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  it('recursively discovers cubes in a nested hierarchy', async () => {
    await fs.writeFile('.npcubes', '');
    await fs.writeJson('.nopyrc.json', { cubeDirs: ['./'] });

    await fs.mkdirp('apt/base');
    await fs.mkdirp('apt/essentials');

    await fs.writeFile(
      'apt/base/manifest.mjs',
      `
      export default {
        id: 'apt-base',
        name: 'Apt Base'
      }
    `
    );
    await fs.writeFile('apt/base/deploy.py', '# deploy');

    await fs.writeFile(
      'apt/essentials/manifest.mjs',
      `
      export default {
        id: 'apt:essentials',
        name: 'Apt Essentials',
        dependencies: () => ['apt-base']
      }
    `
    );
    await fs.writeFile('apt/essentials/deploy.py', '# deploy');

    const { cubes, errors } = await loadCubes();

    expect(errors).toHaveLength(0);
    expect(Object.keys(cubes)).toContain('apt-base');
    expect(Object.keys(cubes)).toContain('apt:essentials');

    expect(cubes['apt-base'].name).toBe('Apt Base');
    expect(cubes['apt-base'].deployScript).toBe('deploy.py');
    expect(cubes['apt:essentials'].manifest.dependencies!({})).toContain('apt-base');
    expect(cubes['apt:essentials'].deployScript).toBe('deploy.py');
  });

  it('handles relaxed naming conventions (*.manifest.mjs and *.deploy.py)', async () => {
    await fs.writeFile('.npcubes', '');
    await fs.writeJson('.nopyrc.json', { cubeDirs: ['./'] });

    await fs.mkdirp('custom');
    await fs.writeFile(
      'custom/my.manifest.mjs',
      `
      export default { id: 'custom-cube', name: 'Custom Name' }
    `
    );
    await fs.writeFile('custom/my.deploy.py', '# deploy');

    const { cubes, errors } = await loadCubes();

    expect(errors).toHaveLength(0);
    expect(Object.keys(cubes)).toContain('custom-cube');
    expect(cubes['custom-cube'].name).toBe('Custom Name');
    expect(cubes['custom-cube'].deployScript).toBe('my.deploy.py');
  });

  it('ignores directories without both manifest and deploy files', async () => {
    await fs.writeFile('.npcubes', '');
    await fs.writeJson('.nopyrc.json', { cubeDirs: ['./'] });

    await fs.mkdirp('only-manifest');
    await fs.writeFile(
      'only-manifest/manifest.mjs',
      'export default { id: "only-manifest", name: "test" }'
    );

    await fs.mkdirp('only-deploy');
    await fs.writeFile('only-deploy/deploy.py', '# deploy');

    const { cubes } = await loadCubes();

    expect(Object.keys(cubes)).not.toContain('only-manifest');
    expect(Object.keys(cubes)).not.toContain('only-deploy');
  });

  it('loads manifest schema and getDefaults', async () => {
    await fs.writeFile('.npcubes', '');
    await fs.writeJson('.nopyrc.json', { cubeDirs: ['./'] });

    await fs.mkdirp('test-schema');
    await fs.writeFile(
      'test-schema/manifest.mjs',
      `
      import { z } from 'zod';
      export default {
        id: 'test-schema',
        name: 'Test Schema Cube',
        schema: z.object({
          PORT: z.string().default('3000'),
          HOST: z.string().default('localhost'),
        })
      }
    `
    );
    await fs.writeFile('test-schema/deploy.py', '# deploy');

    const { cubes, errors } = await loadCubes();

    expect(errors).toHaveLength(0);
    expect(cubes['test-schema']).toBeDefined();
    expect(cubes['test-schema'].getDefaults()).toEqual({
      PORT: '3000',
      HOST: 'localhost',
    });
  });
});
