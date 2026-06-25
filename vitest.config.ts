import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10_000,
    hookTimeout: 5_000,
    reporters: ['verbose'],
    benchmark: {
      include: ['bench/**/*.bench.ts'],
    },
  },
});
