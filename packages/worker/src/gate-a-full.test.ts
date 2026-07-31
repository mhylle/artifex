/**
 * R33 — Gate A in full: the task graph is the first deliverable.
 *
 * Gate A already audited TWO of the six clauses the dossier names — coverage
 * (the exhaustive half of boundaries) and dependency cycles. This adds the rest.
 *
 * The split between deterministic and judged is the design:
 *
 *   deterministic — stopping conditions present, boundaries non-overlapping,
 *                   pinned decisions where siblings must fit together, sane use
 *                   of the decompose-or-delegate gate. None needs a model, and a
 *                   check that needs no model must not cost one.
 *   judged        — atomicity, and testability of each criterion AS WRITTEN.
 *                   Both are semantic. The judge is a REQUIRED parameter rather
 *                   than optional: an absent judge would leave two clauses
 *                   silently unaudited while the gate still reported a pass,
 *                   which is the failure Gate A exists to prevent.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { gateA } from './reviewer.js';
import type { CoverageJudge, PlanJudge } from './reviewer.js';

const AT = '2026-07-30T09:00:00.000Z';
const META = { verdictId: 'v-1', reviewerId: 'reviewer', issuedAt: AT };

function contract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
    missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
    parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Do the thing.',
    acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The thing is done.' }],
    boundaries: { outOfScope: ['Everything else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['c-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

const child = (n: number, over: Partial<TaskContract> = {}): TaskContract =>
  contract({
    taskId: `bbbbbbbb-0000-4000-8000-00000000000${n}`,
    parentTaskId: 'aaaaaaaa-0000-4000-8000-000000000001',
    category: 'doing', depth: 1,
    objective: `Sub-objective ${n}.`,
    acceptanceCriteria: [{ criterionId: `c-${n}`, statement: `Part ${n} is done.` }],
    ...over,
  });

/** Covers every parent criterion by the first child — the happy shape. */
const coverAll = (): CoverageJudge => ({
  async assess({ parent, children }) {
    return {
      coverage: parent.acceptanceCriteria.map((c, i) => ({
        criterionId: c.criterionId,
        coveredByTaskIds: [children[Math.min(i, children.length - 1)]!.taskId],
      })),
    };
  },
});

/** A judge that finds everything atomic and every criterion testable. */
const cleanPlan = (): PlanJudge => ({
  async audit({ children }) {
    return {
      tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'one responsibility' })),
      untestable: [],
      overlaps: [],
    };
  },
});

const parentOf = (kids: readonly TaskContract[]) =>
  contract({ acceptanceCriteria: kids.map((k) => k.acceptanceCriteria[0]!) });

const clauses = (v: { findings: readonly { failingStep: string }[] }) =>
  v.findings.map((f) => f.failingStep);

describe('R33 AC-0 — Gate A audits every clause the dossier names', () => {
  it('passes a plan that satisfies all of them', async () => {
    const kids = [child(1), child(2)];

    const verdict = await gateA(parentOf(kids), kids, coverAll(), cleanPlan(), META);

    expect(verdict.outcome).toBe('pass');
  });

  it('fails a NON-ATOMIC task — a leaf carrying more than one responsibility', async () => {
    const kids = [child(1), child(2)];
    const judge: PlanJudge = {
      async audit({ children }) {
        return {
          tasks: children.map((c, i) => ({
            taskId: c.taskId,
            atomic: i !== 0,
            detail: i === 0 ? 'this task both researches AND writes' : 'fine',
          })),
          untestable: [],
          overlaps: [],
        };
      },
    };

    const verdict = await gateA(parentOf(kids), kids, coverAll(), judge, META);

    expect(verdict.outcome).toBe('fail');
    expect(clauses(verdict).join(' ')).toMatch(/atomic/i);
  });

  it('fails a criterion the DECOMPOSITION introduced that is not testable as written', async () => {
    // "as written" is the point: a criterion that means something testable but
    // does not say it is still untestable, because the grader reads the words.
    //
    // The criterion here is one the planner INVENTED (`sub-1`, absent from the
    // parent), which is the only kind this clause can act on — see the
    // distractor below.
    const kids = [child(1, {
      acceptanceCriteria: [{ criterionId: 'sub-1', statement: 'The output is good.' }],
    })];
    const parent = contract({ acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The thing is done.' }] });
    const judge: PlanJudge = {
      async audit() {
        return {
          tasks: kids.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          untestable: [{ taskId: kids[0]!.taskId, criterionId: 'sub-1', detail: '"good" names no observable outcome' }],
          overlaps: [],
        };
      },
    };
    const covering: CoverageJudge = {
      async assess({ children }) {
        return { coverage: [{ criterionId: 'c-1', coveredByTaskIds: [children[0]!.taskId] }] };
      },
    };

    const verdict = await gateA(parent, kids, covering, judge, META);

    expect(verdict.outcome).toBe('fail');
    expect(clauses(verdict).join(' ')).toMatch(/testab/i);
  });

  it('DISTRACTOR: an INHERITED criterion is not failed for testability — the planner cannot reword it', async () => {
    // Criteria are partitioned, never invented: a child carries the parent's
    // `criterionId` and wording through unchanged. Failing one produces a
    // rejection no re-split can repair, because the thing to fix is upstream.
    //
    // Observed live on mission d55b7f62: the gate rejected "Stopping power is
    // compared" — the requester's own words from intake — twice, and the mission
    // surrendered. Untestable intake is R30's job ("interrogate until testable,
    // then flag what remains"); catching it here grades the wrong agent for a
    // decision it never made.
    const kids = [child(1, {
      acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The output is good.' }],
    })];
    const judge: PlanJudge = {
      async audit() {
        return {
          tasks: kids.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          untestable: [{ taskId: kids[0]!.taskId, criterionId: 'c-1', detail: '"good" names no observable outcome' }],
          overlaps: [],
        };
      },
    };

    const verdict = await gateA(parentOf(kids), kids, coverAll(), judge, META);

    expect(verdict.outcome).toBe('pass');
  });

  it('fails when a task has NO STOPPING CONDITIONS — work with no end is not a task', async () => {
    const kids = [child(1, {
      stoppingConditions: { doneWhen: [], stopTryingWhen: [], maxAttempts: 3, stallLimit: 2 },
    }), child(2)];

    const verdict = await gateA(parentOf(kids), kids, coverAll(), cleanPlan(), META);

    expect(verdict.outcome).toBe('fail');
    expect(clauses(verdict).join(' ')).toMatch(/stopping/i);
  });

  it('fails OVERLAPPING boundaries — two siblings doing the same work', async () => {
    // Exhaustive was already checked (coverage). This is the other half.
    //
    // This was first written as a DETERMINISTIC check — two children owning the
    // same parent criterion — and the existing suite rejected it immediately,
    // correctly. A criterion is routinely met JOINTLY: two tasks each doing part
    // of it is ordinary partitioning, not duplication. Shared coverage says
    // nothing about overlap, because overlap is about scope of WORK, which the
    // coverage map cannot express. So it is judged, like atomicity.
    const kids = [child(1), child(2)];
    const overlapping: PlanJudge = {
      async audit({ children }) {
        return {
          tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          untestable: [],
          overlaps: [{
            taskIds: kids.map((k) => k.taskId),
            detail: 'both tasks write the summary section',
          }],
        };
      },
    };

    const verdict = await gateA(parentOf(kids), kids, coverAll(), overlapping, META);

    expect(verdict.outcome).toBe('fail');
    expect(clauses(verdict).join(' ')).toMatch(/overlap/i);
  });

  it('DISTRACTOR: two siblings CONTRIBUTING to one criterion is not overlap', async () => {
    // The failure mode the deterministic version had. A parent criterion met
    // jointly by two children is the most ordinary decomposition there is, and
    // rejecting it would fail almost every real plan.
    const kids = [child(1), child(2)];
    const jointly: CoverageJudge = {
      async assess({ parent }) {
        return {
          coverage: parent.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId,
            coveredByTaskIds: kids.map((k) => k.taskId),
          })),
        };
      },
    };

    const verdict = await gateA(parentOf(kids), kids, jointly, cleanPlan(), META);

    expect(verdict.outcome).toBe('pass');
  });

  it('fails when COUPLED siblings share no pinned decision', async () => {
    // Siblings that must fit together and were told nothing about how will each
    // pick a reasonable convention, and the conventions will not match. That is
    // discovered at fold-up, after both have been paid for.
    const kids = [
      child(1),
      child(2, { dependencies: { consumesTaskIds: ['bbbbbbbb-0000-4000-8000-000000000001'], mayRequest: [] } }),
    ];

    const verdict = await gateA(parentOf(kids), kids, coverAll(), cleanPlan(), META);

    expect(verdict.outcome).toBe('fail');
    expect(clauses(verdict).join(' ')).toMatch(/pinned/i);
  });

  it('DISTRACTOR: INDEPENDENT siblings need no pinned decision', async () => {
    // The clause is "wherever siblings must fit together". Demanding pinned
    // decisions from tasks that never meet would fail almost every valid plan.
    const kids = [child(1), child(2)];

    const verdict = await gateA(parentOf(kids), kids, coverAll(), cleanPlan(), META);

    expect(verdict.outcome).toBe('pass');
  });

  it('DISTRACTOR: coupled siblings WITH a pinned decision pass', async () => {
    const kids = [
      child(1, { inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: ['ISO-8601 dates'] } }),
      child(2, {
        dependencies: { consumesTaskIds: ['bbbbbbbb-0000-4000-8000-000000000001'], mayRequest: [] },
        inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: ['ISO-8601 dates'] },
      }),
    ];

    const verdict = await gateA(parentOf(kids), kids, coverAll(), cleanPlan(), META);

    expect(verdict.outcome).toBe('pass');
  });

  it('names WHICH TASK failed WHICH clause — a verdict you can act on (AC-1)', async () => {
    const kids = [child(1, {
      stoppingConditions: { doneWhen: [], stopTryingWhen: [], maxAttempts: 3, stallLimit: 2 },
    }), child(2)];

    const verdict = await gateA(parentOf(kids), kids, coverAll(), cleanPlan(), META);

    const finding = verdict.findings.find((f) => /stopping/i.test(f.failingStep));
    expect(finding?.detail).toContain(kids[0]!.taskId);
  });

  it('DISTRACTOR: every failure is a specification_fault, never an execution error', async () => {
    // The class picks the escalation rung. Retrying a task that was SPECIFIED
    // wrong burns budget rehearsing the same mistake — a spec fault must jump
    // straight to re-decomposition.
    const kids = [child(1, {
      stoppingConditions: { doneWhen: [], stopTryingWhen: [], maxAttempts: 3, stallLimit: 2 },
    })];

    const verdict = await gateA(parentOf(kids), kids, coverAll(), cleanPlan(), META);

    expect(verdict.findings.every((f) => f.errorClass === 'specification_fault')).toBe(true);
  });
});

/**
 * The SIXTH clause — "sane use of the decompose-or-delegate gate" (R33 AC-0).
 *
 * Written, REVERTED once, and now built on a different footing. The revert is
 * worth keeping in view because the second attempt is shaped by it.
 *
 * The check is clear: a "split" producing exactly ONE child is the gate's
 * decision made incoherently — it pays a planning round-trip and a fold-up to
 * hand the same work to the same single agent. Whatever the right call was, keep
 * whole or split for real, this is neither.
 *
 * The first implementation applied it unconditionally and broke 32 fixtures. The
 * loop's documented default when NO gate is wired is "always split", so a
 * single-criterion mission with no gate splits into exactly one child — and the
 * clause failed a configuration the loop deliberately supports. Right for
 * production, wrong for a supported default.
 *
 * The fix is NOT to change R31's default, which is a separate question the
 * defect (`bf62266d`) was explicit about. It is to scope the clause to plans
 * where a gate ACTUALLY DECIDED. The loop already records `decomposition.decided`
 * on both paths; what it did not record was WHO decided, so the two cases were
 * distinguishable only by matching rationale prose. `decidedBy` makes that
 * structural, and Gate A audits the gate's use only where the gate was used.
 */
describe('R33 AC-0 — sane use of the decompose-or-delegate gate', () => {
  const oneChild = [child(1)];

  it('faults a GATE decision to split that produced exactly one child', async () => {
    const verdict = await gateA(parentOf(oneChild), oneChild, coverAll(), cleanPlan(), META, {
      decomposition: { decidedBy: 'gate', keepWhole: false },
    });

    expect(verdict.outcome).toBe('fail');
    expect(clauses(verdict).join(' ')).toMatch(/decompose-or-delegate|gate/i);
  });

  it('names what was incoherent, not merely that something was', async () => {
    // R33 AC-1: a rejection returns a structured verdict naming which clause
    // failed, so the Orchestrator can re-split from it rather than retry blind.
    const verdict = await gateA(parentOf(oneChild), oneChild, coverAll(), cleanPlan(), META, {
      decomposition: { decidedBy: 'gate', keepWhole: false },
    });

    const finding = verdict.findings.find((f) => /gate/i.test(f.failingStep));
    expect(String(finding?.detail)).toMatch(/one child|single child|exactly one/i);
  });

  it('DISTRACTOR: the DEFAULT split into one child is not faulted', async () => {
    // The configuration that forced the revert. With no gate wired the loop
    // splits by design and records that it did; faulting the planner for the
    // loop's own default would reject a supported setup — and it is what broke
    // 32 fixtures the first time.
    const verdict = await gateA(parentOf(oneChild), oneChild, coverAll(), cleanPlan(), META, {
      decomposition: { decidedBy: 'default', keepWhole: false },
    });

    expect(verdict.outcome, 'the no-gate default was faulted as an incoherent gate decision').toBe('pass');
  });

  it('DISTRACTOR: a caller supplying NO decomposition decision is not faulted', async () => {
    // Every caller predating this clause, including the 32 fixtures. Absent is
    // not the same as "a gate decided" — Gate A cannot audit a decision nobody
    // told it about, and inventing one would be the opposite of this criterion.
    const verdict = await gateA(parentOf(oneChild), oneChild, coverAll(), cleanPlan(), META);

    expect(verdict.outcome).toBe('pass');
  });

  it('DISTRACTOR: a GATE split into SEVERAL children is sane and passes', async () => {
    // The rule must be able to say yes. A clause that faulted every gate
    // decision would make the gate unusable rather than audited.
    const many = [child(1), child(2)];

    const verdict = await gateA(parentOf(many), many, coverAll(), cleanPlan(), META, {
      decomposition: { decidedBy: 'gate', keepWhole: false },
    });

    expect(verdict.outcome).toBe('pass');
  });

  it('faults a plan that SPLIT when the gate said keep whole', async () => {
    // The other direction of "sane use", and a real one: the loop enforces
    // keep-whole by running the parent as a leaf, so a multi-child plan carrying
    // a keep-whole decision means the plan and the decision disagree. Auditing
    // only the one-child case would leave the gate's decision unenforced in the
    // direction where it actually withholds work.
    const many = [child(1), child(2)];

    const verdict = await gateA(parentOf(many), many, coverAll(), cleanPlan(), META, {
      decomposition: { decidedBy: 'gate', keepWhole: true },
    });

    expect(verdict.outcome).toBe('fail');
    expect(clauses(verdict).join(' ')).toMatch(/gate/i);
  });

  it('DISTRACTOR: keep-whole with ONE child is the gate being honoured, not defied', async () => {
    // A kept-whole parent runs as a single leaf. Faulting that would reject the
    // gate working exactly as intended — and it is the shape a naive "one child
    // is always wrong" rule gets backwards.
    const verdict = await gateA(parentOf(oneChild), oneChild, coverAll(), cleanPlan(), META, {
      decomposition: { decidedBy: 'gate', keepWhole: true },
    });

    expect(verdict.outcome, 'the gate being honoured was faulted').toBe('pass');
  });
});
