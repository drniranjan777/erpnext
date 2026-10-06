import { defineConfig } from 'vitest/config';

/**
 * test/unit: pure logic, no services needed.
 * test/e2e:  black-box HTTP against a running API (see test/e2e/helpers.ts).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
