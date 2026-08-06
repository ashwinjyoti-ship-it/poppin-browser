import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/smoke/**/*.test.ts'],
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});

