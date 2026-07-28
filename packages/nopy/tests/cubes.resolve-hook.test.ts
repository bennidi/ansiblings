/**
 * Tests for the manifest resolve hook.
 *
 * Every case runs in a child `node` process. Vitest resolves a dynamic import
 * through vite, which finds `zod` from the project root whether or not the hook
 * is installed — so a test run inside the worker passes either way and proves
 * nothing. Only real Node resolution can tell the two apart.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CUBES_SRC = fileURLToPath(new URL('../src/cubes', import.meta.url));
const HOOK = pathToFileURL(path.join(CUBES_SRC, 'resolve-hook.mjs')).href;
// Only ever handed to createRequire, which wants a path inside the package and
// never opens it. This is the same URL loader.ts registers with.
const FROM = pathToFileURL(path.join(CUBES_SRC, 'loader.ts')).href;

describe('resolve-hook', () => {
  let tmpDir: string;

  /** Runs `manifest.mjs` in a fresh Node process and returns its default export. */
  const importManifest = (source: string, { withHook } = { withHook: true }) => {
    fs.writeFileSync(path.join(tmpDir, 'manifest.mjs'), source);
    const manifest = pathToFileURL(path.join(tmpDir, 'manifest.mjs')).href;

    const script = [
      withHook ? "import module from 'node:module';" : '',
      withHook
        ? `module.register(${JSON.stringify(HOOK)}, ${JSON.stringify(FROM)}, ` +
          `{ data: { from: ${JSON.stringify(FROM)} } });`
        : '',
      `const loaded = await import(${JSON.stringify(manifest)})`,
      '  .then((m) => m.default, (err) => ({ failed: err.code ?? String(err) }));',
      'console.log(JSON.stringify(loaded));',
    ]
      .filter(Boolean)
      .join('\n');

    return JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf-8' })
    );
  };

  beforeEach(() => {
    // Under os.tmpdir() precisely because nothing above it links zod: this is a
    // cube in a directory the user pointed `cubeDirs` at, nothing more.
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nopy-hook-')));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cannot import zod from a bare directory without the hook', () => {
    const result = importManifest("import 'zod';\nexport default { ok: true };", {
      withHook: false,
    });

    expect(result).toEqual({ failed: 'ERR_MODULE_NOT_FOUND' });
  });

  it('resolves zod from the running CLI', () => {
    const result = importManifest(
      "import { z } from 'zod';\nexport default { ok: typeof z.object === 'function' };"
    );

    expect(result).toEqual({ ok: true });
  });

  it('resolves a subpath of a covered package', () => {
    const result = importManifest(
      "import pkg from '@bitsquare/nopy/package.json' with { type: 'json' };\n" +
        'export default { name: pkg.name };'
    );

    expect(result).toEqual({ name: '@bitsquare/nopy' });
  });

  it('leaves anything else to fail as it would have', () => {
    const result = importManifest("import 'no-such-package';\nexport default { ok: true };");

    expect(result).toEqual({ failed: 'ERR_MODULE_NOT_FOUND' });
  });

  it('prefers a copy the cube can already see', () => {
    // The whole point of trying normal resolution first: a consumer with its
    // own zod keeps it, so the hook can never introduce version skew.
    const stub = path.join(tmpDir, 'node_modules', 'zod');
    fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(
      path.join(stub, 'package.json'),
      JSON.stringify({ name: 'zod', version: '0.0.0', type: 'module', main: 'index.js' })
    );
    fs.writeFileSync(path.join(stub, 'index.js'), "export const z = { from: 'the cube' };");

    const result = importManifest(
      "import { z } from 'zod';\nexport default { from: z.from ?? 'the CLI' };"
    );

    expect(result).toEqual({ from: 'the cube' });
  });
});
