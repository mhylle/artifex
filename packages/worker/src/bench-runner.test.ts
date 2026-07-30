/**
 * R27 AC-1/AC-2/AC-3's missing runner — a candidate actually replayed.
 *
 * `ScienceLoop.experiment` was correct and had nothing to run. A bench case
 * carries its full contract, its inputs and the outcome a VERIFIED run produced
 * (R25), so replaying one is: re-contract it, execute under the candidate, and
 * judge the result against that case's own acceptance criteria.
 *
 * Judging rather than diffing is the point. The recorded outcome is one verified
 * answer, not the only correct one — a candidate that says "100 degrees Celsius"
 * where the case recorded "100C" has not regressed, and a string comparison
 * would call that a loss and reject a real improvement.
 */
import { describe, expect, it, vi } from 'vitest';

import { BenchCandidateRunner } from './bench-runner.js';
import type { BenchCaseStore, CaseExecutor, CaseJudge } from './bench-runner.js';

const CASE = {
  caseId: 'c-1',
  contract: { objective: 'State the boiling point.', acceptanceCriteria: [{ criterionId: 'c-1', statement: 'Stated.' }] },
  inputs: {},
  verifiedOutcome: { answer: '100C' },
};

const store = (cases: Array<typeof CASE>): BenchCaseStore => ({
  async load(ids) { return cases.filter((c) => ids.includes(c.caseId)); },
});

const executor = (deliverable: unknown = { answer: '100 degrees Celsius' }): CaseExecutor => ({
  async execute() { return { deliverable }; },
});

const judge = (meets: boolean): CaseJudge => ({ async meets() { return meets; } });

describe('R27 — a candidate is replayed against real bench cases', () => {
  it('wins when the candidate meets every case criteria', async () => {
    const runner = new BenchCandidateRunner(store([CASE]), executor(), judge(true));

    expect(await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1'], budget: 10 })).toBe(true);
  });

  it('loses when the candidate fails a case', async () => {
    const runner = new BenchCandidateRunner(store([CASE]), executor(), judge(false));

    expect(await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1'], budget: 10 })).toBe(false);
  });

  it('re-contracts the case, so the candidate faces the ORIGINAL task', async () => {
    // Executing anything other than the recorded contract would score the
    // candidate on a different exam than the one the ground truth came from.
    const execute = vi.fn(async () => ({ deliverable: {} }));
    const runner = new BenchCandidateRunner(store([CASE]), { execute }, judge(true));

    await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1'], budget: 10 });

    expect(execute.mock.calls[0]?.[0].contract).toEqual(CASE.contract);
    expect(execute.mock.calls[0]?.[0].candidateId).toBe('cand-a');
  });

  it('judges against the case CRITERIA, not against the recorded string', async () => {
    // The recorded outcome is one verified answer, not the only correct one.
    // A candidate answering "100 degrees Celsius" where the case recorded "100C"
    // has not regressed, and a string comparison would reject a real improvement.
    const meets = vi.fn(async () => true);
    const runner = new BenchCandidateRunner(store([CASE]), executor({ answer: 'one hundred C' }), { meets });

    const won = await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1'], budget: 10 });

    expect(won).toBe(true);
    expect(meets.mock.calls[0]?.[0].contract).toEqual(CASE.contract);
  });

  it('DISTRACTOR: ALL cases must pass — one failure is a loss', async () => {
    // A candidate that fixes one case and breaks another has not improved the
    // system. Scoring on a majority would adopt changes that trade one failure
    // for a different one.
    const second = { ...CASE, caseId: 'c-2' };
    let call = 0;
    const runner = new BenchCandidateRunner(
      store([CASE, second]),
      executor(),
      { async meets() { call += 1; return call === 1; } },
    );

    expect(await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1', 'c-2'], budget: 10 })).toBe(false);
  });

  it('DISTRACTOR: an executor that THROWS is a loss, not a skipped case', async () => {
    // A candidate that cannot run has not passed. Treating a crash as "no
    // evidence" would let a broken candidate through on the cases it survived.
    const runner = new BenchCandidateRunner(
      store([CASE]),
      { async execute() { throw new Error('candidate exploded'); } },
      judge(true),
    );

    expect(await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1'], budget: 10 })).toBe(false);
  });

  it('DISTRACTOR: a JUDGE that throws is a loss too — an unjudged run is not a pass', async () => {
    const runner = new BenchCandidateRunner(
      store([CASE]),
      executor(),
      { async meets() { throw new Error('judge unavailable'); } },
    );

    expect(await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1'], budget: 10 })).toBe(false);
  });

  it('DISTRACTOR: a case the store cannot load is a loss, not a silent skip', async () => {
    // Scoring a candidate on the cases that happened to load would make the
    // score depend on the store's availability.
    const runner = new BenchCandidateRunner(store([]), executor(), judge(true));

    expect(await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1'], budget: 10 })).toBe(false);
  });

  it('DISTRACTOR: NO cases is a loss — an empty exam is not a perfect score', async () => {
    // The failure R27 AC-1 already guards at the planning layer, guarded again
    // here: zero cases would otherwise vacuously satisfy "every case passed".
    const runner = new BenchCandidateRunner(store([]), executor(), judge(true));

    expect(await runner.run({ candidateId: 'cand-a', slice: 'open', cases: [], budget: 10 })).toBe(false);
  });

  it('spends no more than its budget allows', async () => {
    // The fixed evaluation budget is what makes heterogeneous candidates
    // comparable (AC-1). A runner that ignored it would let one candidate buy
    // more attempts than another.
    const execute = vi.fn(async () => ({ deliverable: {} }));
    const many = ['c-1', 'c-2', 'c-3'].map((caseId) => ({ ...CASE, caseId }));
    const runner = new BenchCandidateRunner(store(many), { execute }, judge(true));

    await runner.run({ candidateId: 'cand-a', slice: 'open', cases: ['c-1', 'c-2', 'c-3'], budget: 2 });

    expect(execute).toHaveBeenCalledTimes(2);
  });
});
