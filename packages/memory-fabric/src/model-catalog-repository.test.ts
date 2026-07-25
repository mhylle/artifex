import type { ModelCatalogEntryInput } from '@artifex/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';
import { ModelCatalogRepository, TierNotInCatalogError } from './model-catalog-repository.js';

let db: TestDatabase;
let catalog: ModelCatalogRepository;

beforeAll(async () => {
  db = await startTestDatabase();
  catalog = new ModelCatalogRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

// `admitted` is deliberately required rather than defaulted: ADR-0002 says a
// model enters the catalog only after clearing the structured-output admission
// gate, so the caller has to say so out loud.
const qwen: ModelCatalogEntryInput = {
  logicalTier: 1,
  provider: 'ollama',
  model: 'qwen2.5:14b',
  params: { temperature: 0.2 },
  contextWindow: 32_768,
  costWeight: 1,
  capabilities: ['structured-output', 'tool-calling'],
  quantization: 'q4_K_M',
  admitted: true,
};

describe('Model Catalog — tier is data, not code (ADR-0002)', () => {
  it('resolves a logical tier to the concrete model config', async () => {
    await catalog.upsert(qwen);

    const resolved = await catalog.resolve(1);

    expect(resolved.provider).toBe('ollama');
    expect(resolved.model).toBe('qwen2.5:14b');
    expect(resolved.contextWindow).toBe(32_768);
    expect(resolved.capabilities).toEqual(['structured-output', 'tool-calling']);
  });

  /**
   * The model-router guardrail: "a missing catalog tier entry is a typed error
   * — never a silent default to some arbitrary model."
   */
  it('DISTRACTOR: raises a typed error for an unmapped tier instead of defaulting', async () => {
    await expect(catalog.resolve(3)).rejects.toBeInstanceOf(TierNotInCatalogError);
  });

  it('swaps the model for a tier without any code change', async () => {
    await catalog.upsert(qwen);
    await catalog.upsert({ ...qwen, model: 'qwen3:14b', quantization: 'q8_0' });

    const resolved = await catalog.resolve(1);

    expect(resolved.model).toBe('qwen3:14b');
    expect(resolved.quantization).toBe('q8_0');
  });

  /**
   * ADR-0002: a model enters the catalog only after passing the structured-
   * output admission gate. Until then its tier must not resolve to it — that is
   * what lets Tier-2 fall back to Claude without blocking v0.
   */
  it('DISTRACTOR: does not resolve an entry that has not passed the admission gate', async () => {
    await catalog.upsert({
      ...qwen,
      logicalTier: 2,
      model: 'qwen2.5:32b-awq',
      admitted: false,
    });

    await expect(catalog.resolve(2)).rejects.toBeInstanceOf(TierNotInCatalogError);

    await catalog.upsert({ ...qwen, logicalTier: 2, model: 'qwen2.5:32b-awq', admitted: true });
    expect((await catalog.resolve(2)).model).toBe('qwen2.5:32b-awq');
  });

  it('lists the active catalog for inspection', async () => {
    await catalog.upsert(qwen);

    const entries = await catalog.listActive();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.admitted)).toBe(true);
  });
});
