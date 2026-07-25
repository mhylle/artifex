import { defineConfig } from 'vitest/config';

// Every test in this package talks to a real PostgreSQL booted via
// testcontainers — the append-only trigger and LISTEN/NOTIFY behaviour are
// database guarantees, and mocking them would prove nothing. So this package
// has no unit-test script at all; it is integration-only by nature.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One container is shared across the suite; keep files sequential so the
    // monotonic-id assertions aren't racing each other.
    fileParallelism: false,
  },
});
