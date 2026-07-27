/**
 * P3.5 — admission is granted TO A TIER, not in the abstract.
 *
 * P3 probed every candidate with `Verdict` and `CapabilityManifest`. Both are
 * meta-agent artifacts — a Verdict is Reviewer output (Tier 2–3), a manifest is
 * Agent Creator output (Tier 2). ADR-0002 puts a small local model at Tier 1,
 * "the bulk of atomic worker tasks", which never emits either. The gate was
 * refusing Tier-1 candidates for failing a job they would never be given.
 */
import { describe, expect, it } from 'vitest';

import { NoProbesForTierError } from './errors.js';
import { probesForTier, runAdmissionGate } from './admission-gate.js';

const echoSample = { async generate({ probe }: { probe: { sample: () => unknown } }) { return probe.sample(); } };

describe('P3.5 — probes are selected by the tier applied for', () => {
  it('Tier 1 is judged on worker output, not on meta-agent artifacts', () => {
    const names = probesForTier(1).map((p) => p.name);

    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('verdict');
    expect(names).not.toContain('capability-manifest');
  });

  it('Tier 2 keeps the meta-agent probes — that IS its job', () => {
    const names = probesForTier(2).map((p) => p.name);

    expect(names).toContain('verdict');
    expect(names).toContain('capability-manifest');
  });

  it('DISTRACTOR: the tiers genuinely differ — this is not one list returned twice', () => {
    const tier1 = probesForTier(1).map((p) => p.name).sort();
    const tier2 = probesForTier(2).map((p) => p.name).sort();

    expect(tier1).not.toEqual(tier2);
  });

  it('every probe declares the tier it belongs to', () => {
    for (const tier of [1, 2, 3] as const) {
      for (const probe of probesForTier(tier)) {
        expect(probe.logicalTier, `probe "${probe.name}" is filed under the wrong tier`).toBe(tier);
      }
    }
  });
});

describe('P3.5 — a tier with no probes must never silently admit', () => {
  it('Tier 0 raises rather than returning admitted:true', async () => {
    // Tier 0 is no-LLM by definition, so it has no probes. "Admitted after zero
    // probes" would be exactly the rubber stamp ADR-0008 exists to prevent.
    await expect(
      runAdmissionGate({
        candidate: { provider: 'ollama', model: 'anything' },
        logicalTier: 0,
        backend: echoSample,
      }),
    ).rejects.toBeInstanceOf(NoProbesForTierError);
  });

  it('DISTRACTOR: an explicitly empty probe list also raises, rather than vacuously passing', async () => {
    await expect(
      runAdmissionGate({
        candidate: { provider: 'ollama', model: 'anything' },
        logicalTier: 1,
        probes: [],
        backend: echoSample,
      }),
    ).rejects.toBeInstanceOf(NoProbesForTierError);
  });
});

describe('P3.5 — Tier-1 admission tests instruction-following', () => {
  it('admits a candidate that returns a coherent worker deliverable', async () => {
    const result = await runAdmissionGate({
      candidate: { provider: 'ollama', model: 'good-worker' },
      logicalTier: 1,
      backend: echoSample,
    });

    expect(result.admitted).toBe(true);
    expect(result.logicalTier).toBe(1);
  });

  it('DISTRACTOR: refuses schema-valid output that ignored the instruction', async () => {
    // The prompt names the field the deliverable must carry. Constrained
    // decoding will happily emit a well-shaped bundle that answers nothing.
    const result = await runAdmissionGate({
      candidate: { provider: 'ollama', model: 'shape-only' },
      logicalTier: 1,
      backend: {
        async generate({ probe }) {
          const sample = probe.sample() as Record<string, unknown>;
          return { ...sample, deliverable: {} };
        },
      },
    });

    expect(result.admitted).toBe(false);
    expect(result.failures[0]!.errors[0]!.keyword).toBe('semantic');
  });
});
