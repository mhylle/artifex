import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The API is ESM like the rest of the workspace (ADR-0001), and its dependencies
 * — `@artifex/shared-types`, `@artifex/memory-fabric` — are ESM-only. Jest's
 * CommonJS default could not parse them without a pile of moduleNameMapper and
 * transformIgnorePatterns workarounds, so this package uses vitest like every
 * other package here. One test runner across the monorepo, no interop layer.
 *
 * The SWC plugin is not optional decoration: NestJS dependency injection reads
 * `emitDecoratorMetadata`, and vitest's default esbuild transform does not emit
 * it. Without this, every DI-constructed provider resolves to `undefined` and
 * the failure looks like a broken test rather than a missing transform.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['reflect-metadata'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
