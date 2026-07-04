import { defineConfig } from 'vitest/config';

const isCoverageRun = process.argv.includes('--coverage');

export default defineConfig({
  resolve: {
    alias: {
      '@kastral/kra-core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    testTimeout: 15000,
    fileParallelism: !isCoverageRun,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      thresholds: {
        statements: 83,
        branches: 72,
        functions: 86,
        lines: 84,
        'packages/cli/src/commands/interactive-actions.ts': {
          statements: 55,
          branches: 45,
          functions: 60,
          lines: 55,
        },
        'packages/cli/src/commands/interactive-add.ts': {
          statements: 70,
          branches: 45,
          functions: 80,
          lines: 80,
        },
        'packages/cli/src/prompts/search-multiselect.ts': {
          statements: 65,
          branches: 60,
          functions: 80,
          lines: 65,
        },
      },
    },
  },
});
