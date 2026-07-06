import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Only run source tests. Without this, a prior `tsc` build can leave compiled
    // *.test.js in dist/ that vitest would run a second time, colliding on the shared DB.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
