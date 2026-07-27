import { defineConfig } from 'vitest/config';

export default defineConfig({
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
        // Pure re-export barrel: no logic to cover.
        'src/index.ts',
        // Argv wiring only; behaviour lives in the modules it calls.
        'src/keyman.cli.ts',
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
