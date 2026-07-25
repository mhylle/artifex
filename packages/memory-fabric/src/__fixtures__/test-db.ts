/**
 * Boots a real PostgreSQL for the integration tests.
 *
 * The behaviours under test — the append-only trigger, the monotonic id, the
 * NOTIFY on append — are database guarantees. A mock would only assert that the
 * mock was written correctly, so every test in this package uses a real server,
 * on the same pgvector image as `docker-compose.yml`.
 *
 * Excluded from the build (see tsconfig.json) — test support only.
 */
import { randomUUID } from 'node:crypto';

import type { LedgerEventInput } from '@artifex/shared-types';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

import { runMigrations } from '../migrate.js';

/** Same image as docker-compose.yml — testing against a different server would prove less. */
const POSTGRES_IMAGE = 'pgvector/pgvector:pg17';

export interface TestDatabase {
  connectionString: string;
  pool: Pool;
  stop: () => Promise<void>;
}

export async function startTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const connectionString = container.getConnectionUri();

  if (options.migrate !== false) {
    await runMigrations(connectionString, 'up');
  }

  const pool = new Pool({ connectionString });

  return {
    connectionString,
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

/** A schema-valid ledger event; `overrides` lets a test bend exactly one thing. */
export function makeEvent(overrides: Partial<LedgerEventInput> = {}): LedgerEventInput {
  return {
    eventId: randomUUID(),
    missionId: randomUUID(),
    taskId: randomUUID(),
    family: 'execution',
    type: 'worker.deliverable_produced',
    actor: { kind: 'worker', id: randomUUID(), displayName: null },
    payload: { note: 'fixture' },
    occurredAt: '2026-07-25T09:00:00.000Z',
    ...overrides,
  };
}

/** Waits for the first notification, failing loudly instead of hanging the suite. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out waiting for ${label} after ${ms}ms`)), ms),
    ),
  ]);
}
