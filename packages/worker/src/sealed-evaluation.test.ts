/**
 * A petition is evaluated against the SEALED bench (R29 AC-0, second clause).
 *
 * The criterion has two halves. "Carries the ledger evidence it is argued from"
 * has been true and proven live since iteration 73 — a real petition carried 20
 * event ids from its own mission's trail. "And is evaluated against the sealed
 * bench rather than any slice the learner could have optimized against" was not:
 * `evaluateOnSealedBench` had no production caller at all.
 *
 * `evaluateOnSealedBench` already decides the hard parts and is not touched
 * here: it THROWS if handed a non-sealed case, requires UNANIMOUS support, and
 * returns `unevaluated` for an empty set rather than the arithmetic 100% that
 * zero-of-zero would give. What was missing is the thing that decides, for one
 * sealed case, whether it supports the petition.
 *
 * **That decision is DERIVED, not judged by a model.** Today's only petition
 * kind is the budget-versus-value outlier, and a sealed case supports it when
 * that case's own source task spent at or over `NEAR_CEILING` of its contract's
 * ceiling — the same bar the weak-spot ranking uses. Nothing is invented, and no
 * model is asked a question whose answer could not be checked.
 *
 * **The bound, stated because it is real:** this rule is specific to the budget
 * petition. `petitionFromWeakSpots` returns null for every other shape today, so
 * that is the whole population — but a second petition kind would need its own
 * support rule, and silently reusing this one would score it against a
 * criterion it is not about.
 */
import { describe, expect, it } from 'vitest';

import { supportsBudgetPetition } from './sealed-evaluation.js';

/** A sealed case whose source task spent `spent` against ceiling `ceiling`. */
const sealedCase = (caseId: string, spent: number, ceiling: number, capability = 'technical writing') => ({
  caseId,
  slice: 'sealed' as const,
  capability,
  contract: { budget: { floor: 1, ceiling, unit: 'effort-units' } },
  verifiedOutcome: { answer: 'x' },
  effortSpent: spent,
});

describe('R29 AC-0 — what makes a sealed case support a budget petition', () => {
  it('supports when the case ran AT its ceiling', () => {
    expect(supportsBudgetPetition(sealedCase('c-1', 2, 2))).toBe(true);
  });

  it('supports when the case ran OVER its ceiling', () => {
    expect(supportsBudgetPetition(sealedCase('c-1', 4, 2))).toBe(true);
  });

  it('DISTRACTOR: does NOT support when the case ran cheaply', () => {
    // Both sides asserted. A rule that answered `true` for everything would make
    // every petition unanimously supported, which is the same as having no
    // sealed bench at all.
    expect(supportsBudgetPetition(sealedCase('c-1', 1, 100))).toBe(false);
  });

  it('DISTRACTOR: does NOT support just UNDER the bar', () => {
    // 0.89 is not 0.9. Pins that the shared NEAR_CEILING was not quietly
    // loosened to make an evaluation succeed.
    expect(supportsBudgetPetition(sealedCase('c-1', 89, 100))).toBe(false);
  });

  it('DISTRACTOR: the DOGFOOD STUB cannot support anything', () => {
    // `fbb74ae1` is really in the live sealed slice: its whole contract is
    // `{"o": "sealed case"}` with outcome `{"answer": "secret"}`. It has no
    // budget and no recorded spend, and it is deliberately NOT deleted. A rule
    // that treated a missing ceiling as "spent everything" would let a stub cast
    // a unanimous vote to amend the Constitution.
    const stub = {
      caseId: 'fbb74ae1', slice: 'sealed' as const, capability: 'answering',
      contract: { o: 'sealed case' }, verifiedOutcome: { answer: 'secret' },
      effortSpent: undefined,
    };

    expect(supportsBudgetPetition(stub)).toBe(false);
  });

  it('DISTRACTOR: a case with a ceiling but NO recorded spend does not support', () => {
    // Absent spend is not zero spend and it is certainly not full spend. The
    // honest answer for an unmeasured case is that it does not argue either way.
    const unmeasured = { ...sealedCase('c-1', 0, 10), effortSpent: undefined };

    expect(supportsBudgetPetition(unmeasured)).toBe(false);
  });

  it('DISTRACTOR: a spend that is a STRING does not support, even though it would coerce', () => {
    // The `typeof` guard is not redundant with JavaScript's arithmetic. An
    // absent spend already fails, because `undefined / n` is NaN and every NaN
    // comparison is false — dropping the guard survived that test. A string
    // does NOT fail that way: `'9' / 10` is 0.9, which clears the bar exactly.
    // Payloads arrive from JSON, so a producer writing a string is a real
    // possibility, and it must not be able to cast a vote to amend.
    const stringy = { ...sealedCase('c-1', 0, 10), effortSpent: '9' as unknown as number };

    expect(supportsBudgetPetition(stringy)).toBe(false);
  });

  it('DISTRACTOR: a ZERO ceiling does not support, and does not divide by zero', () => {
    expect(supportsBudgetPetition(sealedCase('c-1', 5, 0))).toBe(false);
  });
});

/**
 * The composition. `supportsBudgetPetition` is pure, so its own tests cannot see
 * whether the petition path calls it — the shape that has produced six dead
 * mechanisms in this repo.
 */
describe('R29 AC-0 — the petition path evaluates against the sealed slice', () => {
  it('scores only cases matching the petition CATEGORY, on the sealed slice', async () => {
    const { evaluatePetition } = await import('./sealed-evaluation.js');

    const evaluation = await evaluatePetition(
      { title: 'Budget enforcement blocks remedy in "technical writing"', category: 'technical writing' },
      {
        async sealedCases() {
          return [
            sealedCase('match-1', 2, 2, 'technical writing'),
            sealedCase('match-2', 3, 3, 'technical writing'),
            // A different capability: not what this petition argues about.
            sealedCase('other', 2, 2, 'answering'),
          ];
        },
      },
    );

    expect(evaluation.evaluated).toBe(2);
    expect(evaluation.supported).toBe(2);
    expect(evaluation.verdict).toBe('supported');
  });

  it('one dissenting sealed case makes the verdict UNSUPPORTED', async () => {
    // ADR-0010's unanimity, in the direction that preserves the status quo: the
    // conservative outcome for an amendment is not to amend.
    const { evaluatePetition } = await import('./sealed-evaluation.js');

    const evaluation = await evaluatePetition(
      { title: 't', category: 'technical writing' },
      {
        async sealedCases() {
          return [sealedCase('a', 2, 2), sealedCase('b', 1, 100)];
        },
      },
    );

    expect(evaluation.verdict).toBe('unsupported');
  });

  it('NO matching sealed case is UNEVALUATED, never supported', async () => {
    // The live state today: the sealed bench covers capabilities the petitions
    // are not about. Zero of zero is 100% by arithmetic and nothing by evidence.
    const { evaluatePetition } = await import('./sealed-evaluation.js');

    const evaluation = await evaluatePetition(
      { title: 't', category: 'technical writing' },
      { async sealedCases() { return [sealedCase('other', 2, 2, 'answering')]; } },
    );

    expect(evaluation.evaluated).toBe(0);
    expect(evaluation.verdict).toBe('unevaluated');
  });

  it('DISTRACTOR: an OPEN case reaching the evaluator is refused, not filtered', async () => {
    // `evaluateOnSealedBench` throws on a non-sealed case, and that refusal must
    // reach the caller rather than being swallowed into a smaller count. The
    // whole point of the criterion is that the learner cannot choose the slice.
    const { evaluatePetition } = await import('./sealed-evaluation.js');

    await expect(evaluatePetition(
      { title: 't', category: 'technical writing' },
      {
        async sealedCases() {
          return [{ ...sealedCase('leaked', 2, 2), slice: 'open' as const }];
        },
      },
    )).rejects.toThrow(/sealed/i);
  });
});
