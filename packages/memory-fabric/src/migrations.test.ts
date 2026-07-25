import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';
import { runMigrations } from './migrate.js';

// Boots WITHOUT migrations so this file can drive them itself.
let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase({ migrate: false });
});

afterAll(async () => {
  await db?.stop();
});

async function tableExists(name: string): Promise<boolean> {
  const result = await db.pool.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists',
    [name],
  );
  return result.rows[0]?.exists ?? false;
}

describe('migrations are reversible', () => {
  it('creates the fabric tables on up and removes them on down', async () => {
    expect(await tableExists('ledger_event')).toBe(false);

    await runMigrations(db.connectionString, 'up');
    expect(await tableExists('ledger_event')).toBe(true);
    expect(await tableExists('model_catalog')).toBe(true);

    await runMigrations(db.connectionString, 'down');
    expect(await tableExists('ledger_event')).toBe(false);
    expect(await tableExists('model_catalog')).toBe(false);
  });

  it('is idempotent — running up twice is a no-op, not an error', async () => {
    await runMigrations(db.connectionString, 'up');
    await expect(runMigrations(db.connectionString, 'up')).resolves.not.toThrow();
    expect(await tableExists('ledger_event')).toBe(true);
  });
});
