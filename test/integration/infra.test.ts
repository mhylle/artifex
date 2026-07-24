import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Proves the local infra substrate boots and is reachable: the Memory Fabric
// (Postgres, same pgvector image as docker-compose) and the Job Queue (Redis).
// This is P0 plumbing — connectivity only, no schema and no business logic.
let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;

beforeAll(async () => {
  [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg17').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
});

afterAll(async () => {
  await Promise.all([postgres?.stop(), redis?.stop()]);
});

describe('local infra harness', () => {
  it('boots Postgres and runs a query', async () => {
    const client = new Client({ connectionString: postgres.getConnectionUri() });
    await client.connect();
    try {
      const result = await client.query<{ ok: number }>('SELECT 1 AS ok');
      expect(result.rows[0]?.ok).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('has the pgvector extension available', async () => {
    const client = new Client({ connectionString: postgres.getConnectionUri() });
    await client.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      const result = await client.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname = 'vector'",
      );
      expect(result.rows[0]?.extname).toBe('vector');
    } finally {
      await client.end();
    }
  });

  it('boots Redis and responds to PING', async () => {
    const client = new Redis(redis.getConnectionUrl());
    try {
      expect(await client.ping()).toBe('PONG');
    } finally {
      client.disconnect();
    }
  });
});
