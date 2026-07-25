/**
 * Programmatic migration entry point.
 *
 * The same runner serves the CLI (`npm run migrate -w packages/memory-fabric`)
 * and the integration tests, so what CI verifies is exactly what a deploy runs.
 */
import { fileURLToPath } from 'node:url';

import { runner } from 'node-pg-migrate';

export type MigrationDirection = 'up' | 'down';

/**
 * Resolved relative to this module, so it works both from `src/` under vitest
 * and from `dist/` after a build — both sit one level below the package root.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Our own bookkeeping table, namespaced away from anything else in the database. */
const MIGRATIONS_TABLE = 'artifex_migrations';

export async function runMigrations(
  connectionString: string,
  direction: MigrationDirection,
): Promise<void> {
  await runner({
    databaseUrl: connectionString,
    dir: MIGRATIONS_DIR,
    direction,
    migrationsTable: MIGRATIONS_TABLE,
    // `down` defaults to reverting a single migration; be explicit so both
    // directions mean "all the way", which is what makes `down` a real undo.
    count: Number.POSITIVE_INFINITY,
    singleTransaction: true,
    verbose: false,
  });
}
