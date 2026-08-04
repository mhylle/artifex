/**
 * The bench must sit the SAME exam as production.
 *
 * `experimentPlan` already refuses an uneven split because "a different bench
 * is a different exam". The output-token bound is part of that exam: when the
 * production work probe was raised to a deliverable-sized bound and the bench
 * candidate probe was left on the default, every candidate was being graded on
 * answers truncated at a length production would never truncate at — and the
 * resulting score decides which design earns permanence.
 *
 * Found by the compiler, not by a test: the bound was added to
 * `createCandidateSeams`' generator helper and the production probe lives in
 * `createMissionSeams`, so the raise had been applied to the wrong one of the
 * two. Find-shape (c) — a mechanism attached to only one of several paths.
 */
import { describe, expect, it } from 'vitest';
import { createCandidateSeams, DELIVERABLE_TOKENS } from './runtime.js';

/** Captures what each probe asked the router for. */
function recordingGenerator() {
  const calls: { prompt: string; maxOutputTokens?: number }[] = [];
  return {
    calls,
    generate: async (input: {
      probe: { prompt: string };
      maxOutputTokens?: number;
    }): Promise<unknown> => {
      calls.push({ prompt: input.probe.prompt, maxOutputTokens: input.maxOutputTokens });
      return { answer: 'ok', criteria: [] };
    },
  };
}

const MODELS = {
  worker: { provider: 'ollama', model: 'w' },
  evaluator: { provider: 'ollama', model: 'e' },
};

describe('createCandidateSeams token bounds', () => {
  it('grades candidates with the same room production gets', async () => {
    const gen = recordingGenerator();
    const seams = createCandidateSeams(gen as never, MODELS as never);

    await seams.generator.answer({
      roleInstructions: 'You are a careful analyst.',
      objective: 'Write the differentiation protocol.',
      criteria: ['at least three stages'],
    });

    expect(gen.calls, 'the answer probe never called the router').toHaveLength(1);
    expect(
      gen.calls[0]?.maxOutputTokens,
      'the bench answered under a tighter bound than production, so its scores are not comparable',
    ).toBe(DELIVERABLE_TOKENS);
  });

  /**
   * The distractor. Raising the bound everywhere would trade one fault for
   * another: on a judge, the tight default is what converts a small model's
   * runaway into a fast attributable failure instead of an expensive crash.
   */
  it('leaves the judge on the tight default', async () => {
    const gen = recordingGenerator();
    const seams = createCandidateSeams(gen as never, MODELS as never);

    await seams.judge.meetsAll({
      objective: 'Write the differentiation protocol.',
      criteria: [{ criterionId: 'c1', statement: 'at least three stages' }],
      deliverable: { answer: 'ok' },
    });

    expect(gen.calls, 'the judge probe never called the router').toHaveLength(1);
    expect(gen.calls[0]?.maxOutputTokens, 'the judge was given deliverable-sized room').toBeUndefined();
  });
});
