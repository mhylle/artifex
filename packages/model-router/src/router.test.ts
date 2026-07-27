/**
 * P3 — Model Router & structured-output admission gate (R3).
 *
 * One test per acceptance criterion, each with a distractor. The gate is
 * exercised here against a scripted backend so the failure modes are
 * deterministic; the *live* model run is the dogfood step, not a unit test.
 */
import type { ModelCatalogEntry } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { ADMISSION_PROBES, probesForTier, runAdmissionGate } from './admission-gate.js';
import { NoModelForTierError } from './errors.js';
import { ModelRouter } from './router.js';
import type { CatalogResolver } from './router.js';

function entry(over: Partial<ModelCatalogEntry> & Pick<ModelCatalogEntry, 'logicalTier'>): ModelCatalogEntry {
  return {
    provider: 'ollama',
    model: 'qwen3:8b',
    params: { temperature: 0.2 },
    contextWindow: 32_768,
    costWeight: 1,
    capabilities: ['structured-output'],
    quantization: null,
    admitted: true,
    version: 1,
    updatedAt: '2026-07-26T09:00:00.000Z',
    ...over,
  };
}

/**
 * Stands in for memory-fabric's ModelCatalogRepository — structural, not imported.
 *
 * `null` means "no admitted model for this tier"; a *throw* means the catalog
 * itself failed. Keeping those distinct is what stops a database outage from
 * quietly resolving as "fall back to Claude".
 */
function catalogOf(entries: ReadonlyArray<ModelCatalogEntry>): CatalogResolver {
  return {
    async resolve(logicalTier) {
      return entries.find((e) => e.logicalTier === logicalTier && e.admitted) ?? null;
    },
  };
}

const CLAUDE = entry({ logicalTier: 3, provider: 'anthropic', model: 'claude-opus-5', params: {} });

describe('R3 AC-1 — a logical tier resolves to the catalog entry, with its declared params', () => {
  it('dispatches tier 1 to the catalogued local model', async () => {
    const router = new ModelRouter({ catalog: catalogOf([entry({ logicalTier: 1 })]) });

    const resolved = await router.resolveTier(1);

    expect(resolved.provider).toBe('ollama');
    expect(resolved.model).toBe('qwen3:8b');
    expect(resolved.params).toEqual({ temperature: 0.2 });
    expect(resolved.fallback).toBeNull();
  });

  it('DISTRACTOR: carries the catalogued params, not defaults of its own', async () => {
    // Tier is data. A router that invents params has stopped being neutral.
    const router = new ModelRouter({
      catalog: catalogOf([entry({ logicalTier: 1, params: { temperature: 0.9, top_p: 0.4 } })]),
    });

    expect((await router.resolveTier(1)).params).toEqual({ temperature: 0.9, top_p: 0.4 });
  });

  it('DISTRACTOR: a non-admitted entry is not usable — the gate is not decorative', async () => {
    const router = new ModelRouter({
      catalog: catalogOf([entry({ logicalTier: 1, admitted: false })]),
    });

    await expect(router.resolveTier(1)).rejects.toBeInstanceOf(NoModelForTierError);
  });
});

describe('R3 AC-2 — the admission gate refuses a model that cannot hold a real schema', () => {
  it('refuses a candidate returning schema-invalid output', async () => {
    const result = await runAdmissionGate({
      candidate: { provider: 'ollama', model: 'tiny-liar' },
      logicalTier: 2,
      probes: probesForTier(2),
      // Returns something plausible-looking but not schema-valid.
      backend: { async generate() { return { nope: true }; } },
    });

    expect(result.admitted).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0]!.errors.length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: a candidate returning schema-valid output passes', async () => {
    const result = await runAdmissionGate({
      candidate: { provider: 'ollama', model: 'honest' },
      logicalTier: 2,
      probes: probesForTier(2),
      backend: { async generate({ probe }) { return probe.sample(); } },
    });

    expect(result.admitted).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('DISTRACTOR: a backend that throws is a failure, not an admission', async () => {
    // A crashed probe must never read as "no failures recorded".
    const result = await runAdmissionGate({
      candidate: { provider: 'ollama', model: 'exploder' },
      logicalTier: 2,
      probes: probesForTier(2),
      backend: { async generate() { throw new Error('connection refused'); } },
    });

    expect(result.admitted).toBe(false);
  });

  it('refuses schema-valid but INCOHERENT output — constrained decoding guarantees shape, not sense', async () => {
    // Observed live: a 2B model emitted a valid Verdict with outcome "fail" and
    // an empty findings array. Shape-only validation would have admitted it.
    const result = await runAdmissionGate({
      candidate: { provider: 'ollama', model: 'shape-only' },
      logicalTier: 2,
      probes: probesForTier(2),
      backend: {
        async generate({ probe }) {
          const sample = probe.sample() as Record<string, unknown>;
          return probe.name === 'verdict' ? { ...sample, findings: [] } : sample;
        },
      },
    });

    expect(result.admitted).toBe(false);
    expect(result.failures[0]!.errors[0]!.keyword).toBe('semantic');
  });

  it('probes against the REAL shared schemas, not a toy one', async () => {
    // The guardrail: a gate that passes on a toy schema proves nothing about
    // whether a model can emit a TaskContract.
    expect(ADMISSION_PROBES.length).toBeGreaterThan(0);
    for (const probe of ADMISSION_PROBES) {
      expect(probe.schema.$id, `probe "${probe.name}" must use a published shared schema`).toBeTruthy();
    }
  });
});

describe('R3 AC-3 — Tier-2 falls back to Claude, explicitly and never silently', () => {
  it('falls back to the frontier tier when no local Tier-2 model is admitted', async () => {
    const router = new ModelRouter({ catalog: catalogOf([entry({ logicalTier: 1 }), CLAUDE]) });

    const resolved = await router.resolveTier(2);

    expect(resolved.provider).toBe('anthropic');
    expect(resolved.model).toBe('claude-opus-5');
  });

  it('reports the fallback so it can be logged — an unreported fallback is a silent default', async () => {
    const router = new ModelRouter({ catalog: catalogOf([CLAUDE]) });

    const resolved = await router.resolveTier(2);

    expect(resolved.fallback).not.toBeNull();
    expect(resolved.fallback!.from).toBe(2);
    expect(resolved.fallback!.reason).toMatch(/./);
  });

  it('DISTRACTOR: prefers an admitted local Tier-2 model over the fallback', async () => {
    // Proves the fallback is conditional, not a shortcut that always picks Claude.
    const local32b = entry({ logicalTier: 2, model: 'qwen3:32b' });
    const router = new ModelRouter({ catalog: catalogOf([local32b, CLAUDE]) });

    const resolved = await router.resolveTier(2);

    expect(resolved.model).toBe('qwen3:32b');
    expect(resolved.fallback).toBeNull();
  });

  it('DISTRACTOR: a missing tier raises a typed error rather than substituting a model', async () => {
    const router = new ModelRouter({ catalog: catalogOf([entry({ logicalTier: 1 })]) });

    // Tier 3 is unmapped and there is nothing above it to fall back to.
    await expect(router.resolveTier(3)).rejects.toBeInstanceOf(NoModelForTierError);
  });

  it('DISTRACTOR: Tier-2 with neither a local model nor Claude raises, never guesses', async () => {
    const router = new ModelRouter({ catalog: catalogOf([entry({ logicalTier: 1 })]) });

    await expect(router.resolveTier(2)).rejects.toBeInstanceOf(NoModelForTierError);
  });
});
