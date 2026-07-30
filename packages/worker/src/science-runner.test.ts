/**
 * R27's producers — the half that was missing.
 *
 * `science-loop.ts` had all four decisions built, tested and mutation-checked,
 * and nothing called them (`66356a6e`). A decision function with no caller is
 * the fourth occurrence of that shape in this project, so this file exists to
 * assert the loop actually RUNS rather than merely being correct.
 */
import { describe, expect, it, vi } from 'vitest';

import { ScienceLoop } from './science-runner.js';
import type { BenchSource, CandidateRunner, EvidenceSource } from './science-runner.js';

const report = (over: Record<string, unknown> = {}) => ({
  missionId: 'm-1',
  category: 'answering',
  gateBAttempts: 4,
  gateBPasses: 1,
  escalations: 0,
  budgetSpent: 2,
  budgetCeiling: 20,
  surrendered: false,
  ...over,
});

const evidenceSource = (reports: Array<ReturnType<typeof report>>): EvidenceSource => ({
  async evidenceFor() { return reports; },
});

const bench = (open: string[], sealed: string[]): BenchSource => ({
  async cases(slice) { return slice === 'open' ? open : sealed; },
});

describe('R27 AC-0 — mining actually runs and ranks from the ledger', () => {
  it('returns ranked weak spots for a mission history', async () => {
    const loop = new ScienceLoop({
      evidence: evidenceSource([report({ category: 'weak', gateBAttempts: 4, gateBPasses: 0 })]),
      bench: bench(['c-1'], ['s-1']),
      runner: { async run() { return true; } },
    });

    const ranked = await loop.mine(['m-1']);

    expect(ranked[0]?.category).toBe('weak');
    expect(ranked[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: a healthy history mines nothing — no invented weak spot', async () => {
    const loop = new ScienceLoop({
      evidence: evidenceSource([report({ category: 'fine', gateBAttempts: 4, gateBPasses: 4 })]),
      bench: bench(['c-1'], ['s-1']),
      runner: { async run() { return true; } },
    });

    expect(await loop.mine(['m-1'])).toEqual([]);
  });
});

describe('R27 AC-1/AC-2/AC-3 — experimentation actually runs, against the real slices', () => {
  it('runs every candidate on the OPEN bench under the same budget', async () => {
    const run = vi.fn(async () => true);
    const loop = new ScienceLoop({
      evidence: evidenceSource([]),
      bench: bench(['c-1', 'c-2'], ['s-1']),
      runner: { run },
    });

    const results = await loop.experiment(['cand-a', 'cand-b'], { totalBudget: 20, replications: 2 });

    // Two candidates x two replications, all on the open slice.
    expect(run.mock.calls.filter((c) => c[0].slice === 'open')).toHaveLength(4);
    expect(results.map((r) => r.candidateId)).toEqual(['cand-a', 'cand-b']);
    expect(run.mock.calls.every((c) => c[0].budget === 10)).toBe(true);
  });

  it('re-checks each candidate on the SEALED slice it was not tuned against', async () => {
    const run = vi.fn(async () => true);
    const loop = new ScienceLoop({
      evidence: evidenceSource([]),
      bench: bench(['c-1'], ['s-1']),
      runner: { run },
    });

    await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 });

    expect(run.mock.calls.filter((c) => c[0].slice === 'sealed')).toHaveLength(1);
  });

  it('adopts only a candidate that replicated AND held out', async () => {
    const loop = new ScienceLoop({
      evidence: evidenceSource([]),
      bench: bench(['c-1'], ['s-1']),
      runner: { async run() { return true; } },
    });

    const results = await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 });
    const decisions = loop.evaluate(results);

    expect(decisions[0]?.adopt).toBe(true);
  });

  it('DISTRACTOR: a candidate that wins the open bench but FAILS sealed is not adopted', async () => {
    // The whole point of a held-out slice, exercised through the runner rather
    // than by handing `adoptionDecision` a constructed result.
    const loop = new ScienceLoop({
      evidence: evidenceSource([]),
      bench: bench(['c-1'], ['s-1']),
      runner: { async run({ slice }) { return slice === 'open'; } },
    });

    const decisions = loop.evaluate(await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 }));

    expect(decisions[0]?.adopt).toBe(false);
    expect(decisions[0]?.reason).toMatch(/held-out|tuned/i);
  });

  it('DISTRACTOR: a runner that throws counts as a LOSS, not as a win', async () => {
    // An experiment that crashed did not succeed. Swallowing the error into a
    // pass would adopt a candidate that cannot even run.
    const loop = new ScienceLoop({
      evidence: evidenceSource([]),
      bench: bench(['c-1'], ['s-1']),
      runner: { async run() { throw new Error('candidate exploded'); } },
    });

    const results = await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 });

    expect(results[0]?.runs.every((r) => !r.won)).toBe(true);
    expect(loop.evaluate(results)[0]?.adopt).toBe(false);
  });

  it('DISTRACTOR: refuses to experiment when the open bench is empty', async () => {
    const loop = new ScienceLoop({
      evidence: evidenceSource([]),
      bench: bench([], ['s-1']),
      runner: { async run() { return true; } },
    });

    await expect(loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 }))
      .rejects.toThrow(/bench|cases/i);
  });

  it('DISTRACTOR: a candidate with no SEALED case available is not adopted', async () => {
    // No held-out slice means the candidate sat one exam. Adopting it would be
    // exactly the overfitting the sealed bench exists to catch.
    const loop = new ScienceLoop({
      evidence: evidenceSource([]),
      bench: bench(['c-1'], []),
      runner: { async run() { return true; } },
    });

    const decisions = loop.evaluate(await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 }));

    expect(decisions[0]?.adopt).toBe(false);
    expect(decisions[0]?.reason).toMatch(/held-out|never/i);
  });
});
