import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: [
        'modules/strategies/**/*.ts',
        'modules/scoring/**/*.ts',
        'modules/trading/**/*.ts',
        'modules/news/**/*.ts',
        'modules/alerts/**/*.ts',
        'modules/backtest/**/*.ts',
      ],
      thresholds: {
        'modules/backtest/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'modules/strategies/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'modules/scoring/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'modules/alerts/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'modules/news/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'modules/trading/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
