/**
 * The science loop's composition, asserted.
 *
 * Six times now a mechanism has been correct and unreachable. This file exists
 * so the seventh is caught here rather than three iterations later.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildScienceLoop } from './science-seams.js';

const benchCase = (caseId: string) => ({
  caseId,
  contract: { objective: 'State it.', acceptanceCriteria: [{ criterionId: 'c-1', statement: 'Stated.' }] },
  inputs: {},
  verifiedOutcome: { answer: 'x' },
});

function deps(overrides: Record<string, unknown> = {}) {
  return {
    index: { async listMissions() { return []; } },
    reader: { async replay() { return []; } },
    bench: {
      async list(filter?: { slice?: 'open' | 'sealed' }) {
        return filter?.slice === 'sealed' ? [benchCase('s-1')] : [benchCase('c-1')];
      },
    },
    executor: { async execute() { return { deliverable: { answer: 'x' } }; } },
    judge: { async meets() { return true; } },
    ...overrides,
  } as never;
}

describe('buildScienceLoop — the wiring a missing adapter would silently disable', () => {
  it('experiments against the OPEN slice and re-checks on the SEALED one', async () => {
    const loop = buildScienceLoop(deps());

    const results = await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 });

    expect(results[0]?.runs).toHaveLength(2);
    expect(results[0]?.heldOut?.slice).toBe('sealed');
  });

  it('adopts only when both bars clear, end to end through the real composition', async () => {
    const loop = buildScienceLoop(deps());

    expect(loop.evaluate(await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 }))[0]?.adopt)
      .toBe(true);
  });

  it('DISTRACTOR: the executor actually receives the case CONTRACT, not a placeholder', async () => {
    // The adapter's whole job. A store that returned empty contracts would
    // still "run" every case and report a clean win.
    const execute = vi.fn(async () => ({ deliverable: {} }));
    const loop = buildScienceLoop(deps({ executor: { execute } }));

    await loop.experiment(['cand-a'], { totalBudget: 10, replications: 1 });

    expect(execute.mock.calls[0]?.[0].contract).toMatchObject({ objective: 'State it.' });
  });

  it('DISTRACTOR: a candidate failing the sealed slice is not adopted', async () => {
    const loop = buildScienceLoop(deps({
      judge: { async meets({ contract }: { contract: { objective?: string } }) { void contract; return true; } },
      executor: { async execute() { return { deliverable: {} }; } },
      bench: {
        async list(filter?: { slice?: 'open' | 'sealed' }) {
          // No sealed case at all — the held-out exam cannot be sat.
          return filter?.slice === 'sealed' ? [] : [benchCase('c-1')];
        },
      },
    }));

    const decisions = loop.evaluate(await loop.experiment(['cand-a'], { totalBudget: 10, replications: 2 }));

    expect(decisions[0]?.adopt).toBe(false);
    expect(decisions[0]?.reason).toMatch(/held-out|never/i);
  });
});
