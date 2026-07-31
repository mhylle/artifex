/**
 * R30 AC-0/AC-1 — the intake dialogue decides what blocks and what is carried.
 *
 * *"Ambiguities are surfaced as explicit open questions — never silently assumed
 * away; if the dial permits, low-stakes ambiguities may be carried into the run
 * as flagged assumptions, escalated the moment they start to matter."*
 *
 * The triage is a pure function of the questions and the dial, so the judgement
 * (which is a model call) stays separate from the policy (which is not). Same
 * split as every other decision in this package.
 */
import { describe, expect, it } from 'vitest';

import { triageQuestions } from './intake-dialogue.js';
import type { IntakeQuestion } from './intake-dialogue.js';

const q = (over: Partial<IntakeQuestion> = {}): IntakeQuestion => ({
  about: 'm-1',
  question: 'Which audience is this for?',
  stakes: 'low',
  ...over,
});

describe('R30 — what blocks the mission, and what is carried as a flagged assumption', () => {
  it('blocks on a high-stakes ambiguity under every dial', () => {
    // The clause has no exception: only LOW-stakes ambiguities may be carried.
    // Asserted across all three dials rather than one, so a rule that keyed on
    // the dial alone cannot pass.
    for (const dial of ['autonomous', 'checkpointed', 'supervised'] as const) {
      const verdict = triageQuestions([q({ stakes: 'high' })], dial);
      expect(verdict.blocking, `${dial} carried a high-stakes ambiguity`).toHaveLength(1);
      expect(verdict.flagged).toHaveLength(0);
    }
  });

  it('carries a low-stakes ambiguity when the dial permits, and blocks when it does not', () => {
    // Derived from the dial semantics this codebase already uses rather than
    // invented: `requiresRatification` asks nobody under `autonomous`, asks
    // about consequential acts under `checkpointed`, and asks about everything
    // short of reading under `supervised`. A low-stakes ambiguity is not a
    // consequential act, so the first two carry it and the third does not.
    //
    // Both sides in one test, because a rule that carried everything and a rule
    // that carried nothing each pass half of it.
    expect(triageQuestions([q()], 'autonomous').flagged).toHaveLength(1);
    expect(triageQuestions([q()], 'checkpointed').flagged).toHaveLength(1);
    expect(triageQuestions([q()], 'supervised').blocking, 'supervised carried an ambiguity').toHaveLength(1);
    expect(triageQuestions([q()], 'supervised').flagged).toHaveLength(0);
  });

  it('NEVER drops a question — every one is either blocking or flagged', () => {
    // AC-1's actual demand: "never silently resolved by assumption". A question
    // that appears in neither list has been silently resolved, which is the one
    // outcome the criterion rules out.
    const asked = [
      q({ about: 'm-1', stakes: 'low' }),
      q({ about: 'm-2', stakes: 'high' }),
      q({ about: 'scope', stakes: 'low' }),
    ];

    for (const dial of ['autonomous', 'checkpointed', 'supervised'] as const) {
      const verdict = triageQuestions(asked, dial);
      expect(
        verdict.blocking.length + verdict.flagged.length,
        `${dial} silently dropped a question`,
      ).toBe(asked.length);
    }
  });

  it('DISTRACTOR: no questions means nothing blocks and nothing is flagged', () => {
    // A well-specified request must pass straight through. A rule that always
    // produced a blocking item would stop every mission, and would still satisfy
    // "never silently assumed away".
    const verdict = triageQuestions([], 'autonomous');
    expect(verdict.blocking).toEqual([]);
    expect(verdict.flagged).toEqual([]);
  });

  it('DISTRACTOR: the question text and subject survive triage, not just the count', () => {
    // The requester has to be able to answer it. A triage that returned counts,
    // or that lost which criterion a question was about, would satisfy every
    // assertion above and be useless to the person it is addressed to.
    const verdict = triageQuestions([q({ about: 'm-2', question: 'How long?', stakes: 'high' })], 'autonomous');

    expect(verdict.blocking[0]?.about).toBe('m-2');
    expect(verdict.blocking[0]?.question).toBe('How long?');
  });
});
