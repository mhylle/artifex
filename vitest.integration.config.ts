import { defineConfig } from 'vitest/config';

// Integration harness runs at the repo root (not inside a workspace): it boots
// real containers via testcontainers, so timeouts are generous and it is kept
// out of the per-package `npm test` fan-out. Invoke with `npm run test:integration`.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
