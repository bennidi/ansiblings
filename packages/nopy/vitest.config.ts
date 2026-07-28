import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The workspace link points at nopy-cube's `dist`, which only exists after
      // a build. Tests read its source instead, so the gate does not depend on
      // build ordering and never runs against a stale artifact.
      '@bitsquare/nopy-cube': fileURLToPath(new URL('../nopy-cube/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks', // Use forks instead of threads to support process.chdir()
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Reached through the resolve.alias above; it has its own gate.
        '**/nopy-cube/**',
        // Pure re-export barrels: no logic to cover.
        'src/index.ts',
        'src/cubes/index.ts',
        'src/nopy.cubes.ts',
        // Commander wiring only; behaviour lives in the modules it calls.
        'src/nopy.cli.ts',
      ],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 80,
        statements: 80,
      },
    },
  },
});
