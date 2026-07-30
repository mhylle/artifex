/**
 * Defect `890cdea5` — the decompose-or-delegate gate must be repeatedly
 * confident before it collapses a task graph into one agent.
 *
 * Mission `8dd66596` ("Describe five hand tools…", five criteria, as separable
 * as work gets) came back **keep_whole**, with a rationale that argued the
 * opposite: *"five independent descriptions of distinct objects. There is no
 * shared reasoning…"*. Nothing was contracted, one agent took all five
 * descriptions, bounced, escalated, and the mission surrendered.
 *
 * The schema was already biased correctly — `keepWhole` rather than `split`, so
 * a malformed answer fails toward splitting. This was a well-formed, confident,
 * wrong answer, and no schema can catch that.
 *
 * The fix follows two guards this codebase already uses: the admission gate
 * SAMPLES and requires unanimity (`d678cd8c`), and the reflection pass discards
 * output that contradicts its own reasoning (`cd677737`). Splitting is the safe
 * default, so keeping whole must be unanimous — one dissent and the plan splits.
 */
import { describe, expect, it } from 'vitest';

import { sampledDecompositionGate } from './runtime.js';
import type { DecompositionGate } from './mission-loop.js';

const CONTRACT = {
  objective: 'Describe five hand tools.',
  acceptanceCriteria: [
    { criterionId: 'm-1', statement: 'Describes the hammer.' },
    { criterionId: 'm-2', statement: 'Describes the screwdriver.' },
  ],
} as unknown as Parameters<DecompositionGate['assess']>[0]['contract'];

/** A gate scripted answer-by-answer, so disagreement can be staged exactly. */
function scripted(answers: Array<{ keepWhole: boolean; rationale: string }>) {
  let call = 0;
  const calls = { count: 0 };
  const inner: DecompositionGate = {
    async assess() {
      calls.count += 1;
      const answer = answers[Math.min(call, answers.length - 1)]!;
      call += 1;
      return answer;
    },
  };
  return { inner, calls };
}

describe('the gate must be UNANIMOUS to keep work whole', () => {
  it('keeps whole when every sample agrees', async () => {
    const { inner, calls } = scripted([
      { keepWhole: true, rationale: 'Rhyme and metre constrain each other.' },
      { keepWhole: true, rationale: 'One continuous line of reasoning.' },
      { keepWhole: true, rationale: 'Entangled throughout.' },
    ]);

    const verdict = await sampledDecompositionGate(inner, 3).assess({ contract: CONTRACT });

    expect(verdict.keepWhole).toBe(true);
    expect(calls.count).toBe(3);
  });

  it('SPLITS on a single dissent — the defect this exists for', async () => {
    // Exactly the shape of `890cdea5`: mostly confident, once not. Splitting is
    // recoverable; collapsing five independent tasks into one agent was not.
    const { inner } = scripted([
      { keepWhole: true, rationale: 'Looks entangled.' },
      { keepWhole: false, rationale: 'Five independent descriptions of distinct objects.' },
      { keepWhole: true, rationale: 'Looks entangled.' },
    ]);

    const verdict = await sampledDecompositionGate(inner, 3).assess({ contract: CONTRACT });

    expect(verdict.keepWhole).toBe(false);
  });

  it('carries the dissenting rationale, so the trail says WHY it split', async () => {
    // The recorded reason has to be the one that decided the outcome. Reporting
    // the majority's rationale beside a split decision would make the ledger
    // explain something that did not happen.
    const { inner } = scripted([
      { keepWhole: true, rationale: 'Looks entangled.' },
      { keepWhole: false, rationale: 'Five independent descriptions of distinct objects.' },
      { keepWhole: true, rationale: 'Looks entangled.' },
    ]);

    const verdict = await sampledDecompositionGate(inner, 3).assess({ contract: CONTRACT });

    expect(verdict.rationale).toContain('Five independent descriptions');
    expect(verdict.rationale).toMatch(/1 of 3|dissent/i);
  });

  it('DISTRACTOR: splits when every sample says split, without pretending to be unanimous about keeping whole', async () => {
    const { inner } = scripted([
      { keepWhole: false, rationale: 'Unrelated parts.' },
      { keepWhole: false, rationale: 'Unrelated parts.' },
      { keepWhole: false, rationale: 'Unrelated parts.' },
    ]);

    const verdict = await sampledDecompositionGate(inner, 3).assess({ contract: CONTRACT });

    expect(verdict.keepWhole).toBe(false);
    expect(verdict.rationale).toContain('Unrelated parts.');
  });

  it('DISTRACTOR: a sample that THROWS counts as a dissent, not as agreement', async () => {
    // A gate call that failed did not vote to keep whole. Treating an error as
    // assent would let a flaky backend collapse a task graph.
    let call = 0;
    const flaky: DecompositionGate = {
      async assess() {
        call += 1;
        if (call === 2) throw new Error('backend timed out');
        return { keepWhole: true, rationale: 'Entangled.' };
      },
    };

    const verdict = await sampledDecompositionGate(flaky, 3).assess({ contract: CONTRACT });

    expect(verdict.keepWhole).toBe(false);
  });

  it('DISTRACTOR: one sample means one call — sampling is configurable, not hard-coded', async () => {
    const { inner, calls } = scripted([{ keepWhole: true, rationale: 'Entangled.' }]);

    await sampledDecompositionGate(inner, 1).assess({ contract: CONTRACT });

    expect(calls.count).toBe(1);
  });
});
