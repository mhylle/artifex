/**
 * R34 — Gate B in full: two tiers, depth scaled to blast radius, red flags.
 *
 * Gate B ran ONE tier and carried two of its declared inputs without using them:
 * `verificationPlan.depth` was copied into the verdict and ignored, so a
 * `redundant` plan verified exactly once; and `redFlags` were collected and
 * copied, so a verdict with red flags and no findings still passed — precisely
 * the case AC-2 names.
 *
 * The two tiers do different jobs and fail differently:
 *
 *   mechanical — deterministic checks on the CONTRACT and the BUNDLE. No model.
 *                Its failures are facts: the deliverable is empty, the effort
 *                exceeded the ceiling, a task with tool entitlements produced no
 *                actions. A judge cannot be trusted to notice these reliably and
 *                should not be asked to.
 *   semantic   — does the output serve the PARENT'S INTENT, not merely the
 *                letter of the criteria? A deliverable can meet every stated
 *                criterion and still miss what was wanted, which is the failure
 *                mode acceptance criteria are structurally bad at catching.
 */
import type { EvidenceBundle, TaskContract } from '@artifex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { gateB } from './reviewer.js';
import type { CompletionJudge, IntentJudge } from './reviewer.js';

const AT = '2026-07-30T09:00:00.000Z';
const META = { verdictId: 'v-1', reviewerId: 'reviewer', issuedAt: AT };

function contract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
    missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
    parentTaskId: null,
    category: 'doing', depth: 1,
    objective: 'State the boiling point of water at sea level.',
    acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The boiling point is stated in Celsius.' }],
    boundaries: { outOfScope: ['Other liquids.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['Stated.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

function bundle(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    bundleId: 'b-1',
    taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
    agentId: 'agent-1',
    deliverable: { answer: '100 degrees Celsius.' },
    actions: [],
    consulted: [],
    assumptions: [],
    reflection: null,
    effortSpent: 5,
    producedAt: AT,
    ...over,
  };
}

/** Every criterion met, nothing flagged. */
const metAll = (): CompletionJudge => ({
  async assess({ contract: c }) {
    return {
      criteria: c.acceptanceCriteria.map((x) => ({ criterionId: x.criterionId, met: true, detail: 'ok' })),
      redFlags: [],
    };
  },
});

/** The output serves the parent's intent. */
const intentOk = (): IntentJudge => ({
  async assess() {
    return { servesIntent: true, detail: 'answers what was actually wanted', redFlags: [] };
  },
});

describe('R34 AC-0 — both tiers run', () => {
  it('runs the SEMANTIC intent tier, not only the criteria tier', async () => {
    const intent = { assess: vi.fn(async () => ({ servesIntent: true, detail: 'ok', redFlags: [] })) };

    await gateB(contract(), bundle(), metAll(), intent, META);

    expect(intent.assess).toHaveBeenCalledTimes(1);
  });

  it('fails work that meets every criterion but does NOT serve the parent intent', async () => {
    // The failure acceptance criteria are structurally bad at catching: a
    // deliverable can satisfy every sentence and still miss what was wanted.
    const intent: IntentJudge = {
      async assess() {
        return {
          servesIntent: false,
          detail: 'gives the temperature in Fahrenheit converted at the end, burying the answer asked for',
          redFlags: [],
        };
      },
    };

    const verdict = await gateB(contract(), bundle(), metAll(), intent, META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.failingStep).join(' ')).toMatch(/intent/i);
  });

  it('MECHANICAL tier fails an empty deliverable, without asking a model', async () => {
    // A judge asked "does this meet the criteria" will sometimes say yes to
    // nothing at all. This is a fact, not a judgement, so it is checked as one.
    const verdict = await gateB(contract(), bundle({ deliverable: null }), metAll(), intentOk(), META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.failingStep).join(' ')).toMatch(/mechanical/i);
  });

  it('MECHANICAL tier fails effort above the contract ceiling', async () => {
    const verdict = await gateB(contract(), bundle({ effortSpent: 99 }), metAll(), intentOk(), META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.detail).join(' ')).toMatch(/ceiling/i);
  });

  it('MECHANICAL tier fails a task that was entitled to tools and used none', async () => {
    // "Missing work products" from AC-2, decided mechanically: a contract that
    // granted tools and came back with no actions did not do the work it was
    // equipped for, whatever the prose claims.
    const withTools = contract({
      inputs: {
        entitlements: [],
        toolEntitlements: [{ tool: 'search', scope: 'read' } as never],
        pinnedDecisions: [],
      },
    });

    const verdict = await gateB(withTools, bundle(), metAll(), intentOk(), META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.detail).join(' ')).toMatch(/tool/i);
  });

  it('DISTRACTOR: a task with NO tool entitlements is not faulted for taking no actions', async () => {
    // Most tasks are pure reasoning. Demanding actions from them would fail
    // nearly every task in the system.
    const verdict = await gateB(contract(), bundle(), metAll(), intentOk(), META);

    expect(verdict.outcome).toBe('pass');
  });

  it('DISTRACTOR: the mechanical tier runs even when the judge says everything is met', async () => {
    // The tiers are independent. If the mechanical checks only ran on a semantic
    // failure they would never run at all in the case that matters.
    const verdict = await gateB(contract(), bundle({ effortSpent: 99 }), metAll(), intentOk(), META);

    expect(verdict.outcome).toBe('fail');
  });
});

describe('R34 AC-1 — redundant depth means independent repeated verification', () => {
  const redundant = () =>
    contract({ verificationPlan: { depth: 'redundant', requiredAgreement: 2 } });

  it('verifies more than once when the plan says redundant', async () => {
    const judge = {
      assess: vi.fn(async ({ contract: c }: { contract: TaskContract }) => ({
        criteria: c.acceptanceCriteria.map((x) => ({ criterionId: x.criterionId, met: true, detail: 'ok' })),
        redFlags: [] as string[],
      })),
    };

    await gateB(redundant(), bundle(), judge, intentOk(), META);

    expect(judge.assess.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a LUCKY pass is not a pass — disagreeing runs fail', async () => {
    // The whole point of redundancy. One run saying yes and another saying no
    // means the verification is not reproducible, and an unreproducible pass is
    // indistinguishable from a coin landing well.
    let call = 0;
    const flaky: CompletionJudge = {
      async assess({ contract: c }) {
        call += 1;
        const met = call === 1;
        return {
          criteria: c.acceptanceCriteria.map((x) => ({ criterionId: x.criterionId, met, detail: met ? 'ok' : 'no' })),
          redFlags: [],
        };
      },
    };

    const verdict = await gateB(redundant(), bundle(), flaky, intentOk(), META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.detail).join(' ')).toMatch(/agree|disagree/i);
  });

  it('DISTRACTOR: runs that AGREE on a pass do pass — redundancy is not a penalty', async () => {
    const verdict = await gateB(redundant(), bundle(), metAll(), intentOk(), META);

    expect(verdict.outcome).toBe('pass');
  });

  it('DISTRACTOR: a SINGLE-depth plan verifies exactly once — redundancy is not free', async () => {
    // Every task paying for redundant verification would multiply the cost of
    // the whole system for the tasks that never needed it.
    const judge = {
      assess: vi.fn(async ({ contract: c }: { contract: TaskContract }) => ({
        criteria: c.acceptanceCriteria.map((x) => ({ criterionId: x.criterionId, met: true, detail: 'ok' })),
        redFlags: [] as string[],
      })),
    };

    await gateB(contract(), bundle(), judge, intentOk(), META);

    expect(judge.assess).toHaveBeenCalledTimes(1);
  });

  it('records the depth it ACTUALLY ran, so the trail is not a claim about intent', async () => {
    const verdict = await gateB(redundant(), bundle(), metAll(), intentOk(), META);

    expect(verdict.verificationDepth).toBe('redundant');
  });
});

describe('R34 AC-2 — a red flag discards work that technically passed', () => {
  const flagging = (): CompletionJudge => ({
    async assess({ contract: c }) {
      return {
        criteria: c.acceptanceCriteria.map((x) => ({ criterionId: x.criterionId, met: true, detail: 'ok' })),
        redFlags: ['the answer restates the acceptance criterion verbatim rather than answering it'],
      };
    },
  });

  it('fails despite every criterion being met', async () => {
    const verdict = await gateB(contract(), bundle(), flagging(), intentOk(), META);

    expect(verdict.outcome).toBe('fail');
  });

  it('keeps the flag in the verdict, so the operator sees WHY it was discarded', async () => {
    const verdict = await gateB(contract(), bundle(), flagging(), intentOk(), META);

    expect(verdict.redFlags.join(' ')).toMatch(/restates the acceptance criterion/);
  });

  it('a red flag from the INTENT tier also discards', async () => {
    const suspicious: IntentJudge = {
      async assess() {
        return { servesIntent: true, detail: 'fine', redFlags: ['suspiciously exact fit to the stated numbers'] };
      },
    };

    const verdict = await gateB(contract(), bundle(), metAll(), suspicious, META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.redFlags.join(' ')).toMatch(/suspiciously exact/);
  });

  it('DISTRACTOR: no red flags means no red-flag failure — the flag must be raised, not assumed', async () => {
    const verdict = await gateB(contract(), bundle(), metAll(), intentOk(), META);

    expect(verdict.outcome).toBe('pass');
    expect(verdict.redFlags).toEqual([]);
  });
});

/**
 * `budget_exhaustion` becomes emittable (defect `e758f460`).
 *
 * It is the ONLY error class `escalation.ts` maps to the `agent_redesign` rung,
 * and nothing in the running system ever assigned it — so the rung was dead, and
 * with it `parent_design_id`, design lineage, and R28 AC-0.
 *
 * The mechanical tier already refuses a bundle that overran its ceiling; it
 * simply called that `verification_failure`. Overrunning a budget IS a budget
 * exhaustion, and no other finding in the system means that.
 *
 * Deliberately NOT done until `effortSpent` became a real measurement — while it
 * was a hardcoded 1 no task could exceed any ceiling, so reclassing would have
 * created a second route that never fires, which is how the first dead route
 * came to exist.
 */
describe('R34 / e758f460 — overrunning the ceiling is a BUDGET EXHAUSTION', () => {
  it('classes the over-ceiling finding as budget_exhaustion', async () => {
    const verdict = await gateB(contract(), bundle({ effortSpent: 99 }), metAll(), intentOk(), META);

    const overrun = verdict.findings.find((f) => /ceiling/i.test(f.detail));
    expect(overrun?.errorClass).toBe('budget_exhaustion');
  });

  it('DISTRACTOR: the OTHER mechanical failures stay verification_failure', async () => {
    // Only the budget finding is a budget exhaustion. Reclassing the whole tier
    // would send an empty deliverable to `agent_redesign`, which redesigns an
    // agent over a fault that had nothing to do with the design.
    const verdict = await gateB(contract(), bundle({ deliverable: null }), metAll(), intentOk(), META);

    const empty = verdict.findings.find((f) => /empty/i.test(f.detail));
    expect(empty?.errorClass).toBe('verification_failure');
  });

  it('DISTRACTOR: work WITHIN its ceiling raises no budget finding at all', async () => {
    const verdict = await gateB(contract(), bundle({ effortSpent: 2 }), metAll(), intentOk(), META);

    expect(verdict.findings.some((f) => f.errorClass === 'budget_exhaustion')).toBe(false);
  });
});
