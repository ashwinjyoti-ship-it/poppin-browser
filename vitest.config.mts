import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/smoke/**', 'node_modules/**', '.webpack/**', 'out/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});

