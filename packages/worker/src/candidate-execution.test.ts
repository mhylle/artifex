/**
 * Running a candidate against a bench case (ADR-0017, defect `a1288794`).
 *
 * The two seams `buildScienceLoop` has always required and nothing ever
 * supplied: a `CaseExecutor` and a `CaseJudge`. Everything else in the science
 * loop was built and tested long ago; this is what made "run a candidate"
 * undefined, and it was undefined because nobody had decided what a candidate IS.
 */
import { describe, expect, it } from 'vitest';

import { candidateExecutor, candidateJudge, criteriaOf } from './candidate-execution.js';

const CASE_CONTRACT = {
  objective: 'Write the number 3 as an English word, lowercase.',
  acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The number 3 is written as an English word.' }],
};

const CANDIDATES = new Map([
  ['hf-1', { candidateId: 'hf-1', patchedValue: 'PATCHED INSTRUCTIONS' }],
]);

describe('ADR-0017 — the executor runs the case under the candidate PATCH', () => {
  it('puts the candidate patched instructions in front of the worker', async () => {
    let saw: { roleInstructions: string; objective: string; criteria: readonly string[] } | undefined;
    const executor = candidateExecutor(CANDIDATES, {
      async answer(input) { saw = input; return { answer: 'three' }; },
    });

    const out = await executor.execute({ candidateId: 'hf-1', contract: CASE_CONTRACT });

    expect(saw, 'the generator was never called').toBeDefined();
    expect(saw!.roleInstructions).toBe('PATCHED INSTRUCTIONS');
    expect(saw!.objective).toBe('Write the number 3 as an English word, lowercase.');
    expect(saw!.criteria).toEqual(['The number 3 is written as an English word.']);
    expect(out.deliverable).toEqual({ answer: 'three' });
  });

  it('REFUSES an unknown candidate rather than running the case without the patch', async () => {
    // The most dangerous failure available here: falling back to the un-patched
    // instructions would score the BASELINE and report it under the candidate's
    // name, which looks exactly like a successful experiment.
    // `BenchCandidateRunner` counts a throw as a loss, which is the honest
    // outcome for a candidate that could not be applied.
    let called = false;
    const executor = candidateExecutor(CANDIDATES, {
      async answer() { called = true; return { answer: 'three' }; },
    });

    await expect(executor.execute({ candidateId: 'hf-missing', contract: CASE_CONTRACT }))
      .rejects.toThrow(/unknown candidate/);
    expect(called, 'the case was executed anyway, scoring the baseline as the candidate').toBe(false);
  });
});

describe('ADR-0017 — the judge asks the case own criteria, and never diffs', () => {
  it('passes when the completion judge says every criterion is met', async () => {
    const judge = candidateJudge({ async meetsAll() { return true; } });

    expect(await judge.meets({ contract: CASE_CONTRACT, deliverable: { answer: 'three' } })).toBe(true);
  });

  it('DISTRACTOR: fails when the judge says a criterion is unmet', async () => {
    // Both sides. A judge that always answered `true` would adopt every
    // candidate, and a bench that passes everything measures nothing.
    const judge = candidateJudge({ async meetsAll() { return false; } });

    expect(await judge.meets({ contract: CASE_CONTRACT, deliverable: { answer: 'four' } })).toBe(false);
  });

  it('DISTRACTOR: a differently-WORDED but correct answer is not rejected', async () => {
    // The recorded outcome is one verified answer, not the only correct one.
    // This asserts the judge is asked about the CRITERIA rather than handed the
    // recorded outcome to compare against — a string diff would fail here.
    let sawDeliverable: unknown;
    let sawCriteria: unknown;
    const judge = candidateJudge({
      async meetsAll(input) { sawDeliverable = input.deliverable; sawCriteria = input.criteria; return true; },
    });

    await judge.meets({ contract: CASE_CONTRACT, deliverable: { answer: 'Three' } });

    expect(sawCriteria).toEqual(CASE_CONTRACT.acceptanceCriteria);
    expect(sawDeliverable).toEqual({ answer: 'Three' });
  });

  it('DISTRACTOR: a case with NO criteria is a LOSS, not a vacuous pass', async () => {
    // Not hypothetical: the live sealed bench holds a dogfood stub whose whole
    // contract is `{"o": "sealed case"}`. "Every criterion was met" is
    // vacuously true of an empty list, so an empty case would hand every
    // candidate a free win on the very slice that decides adoption.
    let asked = false;
    const judge = candidateJudge({ async meetsAll() { asked = true; return true; } });

    expect(await judge.meets({ contract: { o: 'sealed case' }, deliverable: { answer: 'secret' } })).toBe(false);
    expect(asked, 'the judge was asked about a case with no criteria').toBe(false);
  });
});

describe('criteriaOf — reading a case contract that may be anything', () => {
  it('reads well-formed criteria', () => {
    expect(criteriaOf(CASE_CONTRACT)).toEqual([
      { criterionId: 'c-1', statement: 'The number 3 is written as an English word.' },
    ]);
  });

  it('DISTRACTOR: drops malformed entries instead of passing them to the judge', () => {
    // Bench contracts are `unknown` from the store's point of view, and the
    // stub proves not every row is well-formed. A half-built criterion reaching
    // the judge would be graded against a statement that is not there.
    const messy = {
      objective: 'o',
      acceptanceCriteria: [
        { criterionId: 'c-1', statement: 'good' },
        { criterionId: 'c-2' },
        'not an object',
        null,
      ],
    };

    expect(criteriaOf(messy)).toEqual([{ criterionId: 'c-1', statement: 'good' }]);
  });

  it('DISTRACTOR: a contract with no criteria array yields none, and does not throw', () => {
    expect(criteriaOf({ o: 'sealed case' })).toEqual([]);
    expect(criteriaOf(undefined)).toEqual([]);
  });
});
