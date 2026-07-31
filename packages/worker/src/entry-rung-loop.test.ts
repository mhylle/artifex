/**
 * R36 in the loop — the half that changes behaviour.
 *
 * `escalation.ts` decides where a failure belongs. This asserts the mission loop
 * actually GOES there, because a correct decision function nothing calls is the
 * failure shape this project has hit four times: a mechanism that is perfect and
 * a producer that is a constant, absent, or a field nobody reads.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '2a7c4e19-8b05-4d31-9f6a-1c3e5b8d0a24';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'State one fact.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The fact is stated.' }],
    boundaries: { outOfScope: ['Everything else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['Stated.'], stopTryingWhen: ['No source.'], maxAttempts: 5, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: {
      ladder: ['retry_same', 'retry_higher_tier', 'different_agent', 'agent_redesign', 're_decomposition'],
      humanAt: null,
    },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

/** Gate B always fails, with the given error class on every finding. */
function seams(errorClass: string): MissionSeams {
  return {
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: 'State it.', category: 'stating',
            acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The fact is stated.' }],
            outOfScope: ['Else.'], blastRadius: 'low' as const, effortShare: 0.9,
          }],
        };
      },
    },
    coverageJudge: {
      async assess({ parent, children }) {
        return {
          coverage: parent.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, coveredByTaskIds: children.map((k) => k.taskId),
          })),
        };
      },
    },
    intentJudge: { async assess() { return { servesIntent: true, detail: 'ok', redFlags: [] }; } },
    planJudge: {
      async audit({ children }) {
        return {
          tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          untestable: [], overlaps: [],
        };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Do it.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 5 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, met: false, detail: `failed as ${errorClass}`,
          })),
          redFlags: [],
        };
      },
    },
    reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
  };
}

const rungs = (trail: readonly { type: string; payload: Record<string, unknown> }[]) =>
  trail.filter((e) => e.type === 'escalation.rung_climbed').map((e) => String(e.payload['rung']));

describe('R36 — the loop enters the ladder where the error class says', () => {
  it('an ordinary execution failure enters at rung 1', async () => {
    // Gate B classes an unmet criterion as `execution_error`, whose entry rung
    // IS the cheapest remedy — the same place the old unconditional `+= 1`
    // landed. Deliberately kept: it pins that the common case did not regress
    // while the jumping classes were added.
    //
    // A first draft expected `retry_higher_tier` here, which was simply the
    // wrong reading of AC-1: "rung 1" is the first rung, `retry_same`. The test
    // drove a wrong expectation and was corrected at the expectation.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    expect(rungs(result.trail)[0]).toBe('retry_same');
  });

  it('records WHICH class chose the entry rung, so the jump is auditable', async () => {
    // An escalation that skipped rungs without saying why reads like a bug.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    const first = result.trail.find((e) => e.type === 'escalation.rung_climbed');
    expect(first?.payload).toHaveProperty('entryClass');
  });

  it('DISTRACTOR: the ladder never walks BACKWARDS to a cheaper rung', async () => {
    // The entry rung is chosen once. If it were recomputed every failure, a task
    // that failed at re_decomposition and then failed as an execution slip would
    // drop back to rung 1 and loop between them forever.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });
    const ladder = mission().escalationPolicy.ladder;

    const indexes = rungs(result.trail).map((r) => ladder.indexOf(r as never));
    for (let i = 1; i < indexes.length; i += 1) {
      expect(indexes[i]!, 'rungs must be non-decreasing').toBeGreaterThan(indexes[i - 1]!);
    }
  });

  it('trips the stall counter when the same attempt repeats, and says so', async () => {
    // `stallLimit` has been on every contract since P2 and was read by nothing,
    // so a task could be attempted identically until `maxAttempts` ran out.
    // The ladder here starts at `retry_same`, which by definition repeats the
    // attempt — the exact case the counter exists for.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    const stall = result.trail.find((e) => e.type === 'task.stalled');
    expect(stall, 'the repeated attempt was never recognised as a stall').toBeDefined();
    expect(String(stall?.payload['detail'])).toMatch(/same tier|repeat/i);
  });

  it('a stall SKIPS the cheap rungs — it outranks the verdict own class', async () => {
    // The whole point, and it needs an exact assertion to bite. `execution_error`
    // maps to `retry_same`, so the plain one-rung step after the first failure
    // would land on `retry_higher_tier`. The stall instead sends it to
    // `different_agent`, skipping the tier bump entirely — because the thing
    // that has failed twice identically will not be fixed by the same agent.
    //
    // A first version asserted only "not retry_same", which the plain step also
    // satisfies, so a mutant removing the override survived. Naming the rung is
    // what makes this a test rather than a reassurance.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    const climbed = rungs(result.trail);

    expect(climbed[0]).toBe('retry_same');
    expect(climbed[1]).toBe('different_agent');
    expect(climbed, 'the tier bump must be skipped, not merely reordered').not.toContain('retry_higher_tier');
  });

  it('DISTRACTOR: a mission that keeps failing still terminates', async () => {
    // The ladder must exhaust. An entry-rung jump that reset progress would let
    // a doomed task spend its whole budget cycling.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    expect(result.outcome).toBe('surrendered');
  });
});

/**
 * R28 AC-0 / defect `cb939996` — a redesign must NAME the design it replaces.
 *
 * The `agent_redesign` rung is reached (the tests above prove the ladder gets
 * there) and `staff()` is told to redesign — but `redesignFrom` was read from a
 * `let manifest;` declared INSIDE the attempt loop, so at the moment it was
 * read it was always `undefined`, and `?? null` turned that into `null`.
 *
 * `null` is not harmless here. It still forces a fresh design (no reuse), so
 * the rung looked enacted; but `parentDesignId` is `typeof redesignFrom ===
 * 'string' ? redesignFrom : null`, so every redesign registered as an ORIGIN.
 * `parent_design_id` stayed 0 rows across the whole live database, the clade
 * query had a recursive walk and no ancestry to walk, and R28 AC-0's "given a
 * design with ancestors in the registry" was unreachable.
 *
 * Found by driving, not by reading: the rung climbed on a real mission and the
 * lineage count did not move.
 */
describe('R28 AC-0 — the redesign is registered as a CHILD of the design that failed', () => {
  type Registration = { designId: string; parentDesignId: string | null };

  async function runWithRegistry() {
    const registered: Registration[] = [];
    const base = seams('execution_error');
    const result = await runMission(
      {
        ...mission(),
        // A redesign only happens once the ladder gets there, so the fixture
        // must afford the attempts. Everything else is the shared fixture.
      },
      {
        ...base,
        registry: {
          async bestForCategory() { return null; },
          async register(input: { designId: string; parentDesignId?: string | null }) {
            registered.push({ designId: input.designId, parentDesignId: input.parentDesignId ?? null });
          },
        },
      } as never,
      { now: () => AT },
    );
    return { result, registered };
  }

  it('reaches the rung at all (the given this criterion depends on)', async () => {
    const { result } = await runWithRegistry();

    expect(rungs(result.trail)).toContain('agent_redesign');
  });

  it('names the failed design as the parent — not null', async () => {
    const { result, registered } = await runWithRegistry();

    const staffedIds = result.trail
      .filter((e) => e.type === 'agent.staffed')
      .map((e) => String(e.payload['designId']));

    const withParent = registered.filter((r) => r.parentDesignId !== null);
    expect(withParent.length, 'no registration carried a parent — lineage was never born').toBeGreaterThan(0);

    // The parent must be a design that ACTUALLY RAN, not any non-null string. A
    // mutant writing `parentDesignId: 'x'` would satisfy "not null" and invent
    // an ancestor the registry never had.
    for (const r of withParent) {
      expect(staffedIds, 'the parent must be a design that was really staffed').toContain(r.parentDesignId);
    }
  });

  it('DISTRACTOR: designs staffed on the OTHER rungs stay origins', async () => {
    // Only a redesign has a parent. If every registration carried one, the
    // clade query would aggregate invented lineage as if it were real — the
    // exact thing the `register` doc comment warns about.
    const { registered } = await runWithRegistry();

    expect(registered.some((r) => r.parentDesignId === null), 'every design claimed an ancestor').toBe(true);
  });
});

/**
 * R28 AC-0 / defect `e758f460` — the ladder's budget remedy, actually produced.
 *
 * `budget_exhaustion` is the ONLY error class whose entry rung is
 * `agent_redesign`, and it is unreachable in practice by any other route: a
 * live mission's ladder gives `maxAttempts: 3`, and stepping one rung per
 * failure reaches `agent_redesign` only as the FINAL climb, after the last
 * attempt has already been spent. So the budget route is the route.
 *
 * And that route was foreclosed. Gate B's mechanical tier raises
 * `budget_exhaustion` when ONE bundle's `effortSpent` exceeds the ceiling —
 * which means the cumulative `spent` exceeds it too, always, by construction.
 * The loop's pre-attempt guard therefore broke out before the redesign could
 * ever be staffed. Proven live: a mission with `ceiling: 1` climbed to
 * `agent_redesign` and surrendered without a single design being redesigned.
 *
 * The resolution (ADR-0011) keeps BOTH halves honest rather than picking one:
 * the ceiling still stops the spend — no further attempt executes — but the
 * remedy the ladder named is still PRODUCED and registered, because a rung the
 * ledger records as climbed and never enacts is a claim the system does not
 * honour. The redesign inherits no track record and cannot be promoted without
 * harness evidence (AC-2), so it costs the registry an unproven child and gives
 * the next task in the category something cheaper to bid.
 */
describe('R28 AC-0 — budget exhaustion produces the redesign it escalated to', () => {
  function broke() {
    return {
      ...mission(),
      // Child ceiling is `parent.ceiling * effortShare` = 3.6, and the work
      // below costs 5 — so ONE execution overruns, which is the only shape that
      // raises `budget_exhaustion` at all.
      budget: { floor: 1, ceiling: 4, unit: 'effort-units' as const },
    };
  }

  async function run(overrides: Record<string, unknown> = {}) {
    const registered: { designId: string; parentDesignId: string | null }[] = [];
    const base = seams('execution_error');
    const result = await runMission(
      broke(),
      {
        ...base,
        // Every criterion MET — so the only thing wrong with this bundle is
        // what it cost. Without this the verdict carries mixed classes and the
        // test would not prove the budget route specifically.
        completionJudge: {
          async assess({ contract }: { contract: TaskContract }) {
            return {
              criteria: contract.acceptanceCriteria.map((c) => ({
                criterionId: c.criterionId, met: true, detail: 'ok',
              })),
              redFlags: [],
            };
          },
        },
        registry: {
          async bestForCategory() { return null; },
          async register(input: { designId: string; parentDesignId?: string | null }) {
            registered.push({ designId: input.designId, parentDesignId: input.parentDesignId ?? null });
          },
        },
        ...overrides,
      } as never,
      { now: () => AT },
    );
    return { result, registered };
  }

  it('escalates to agent_redesign on the FIRST failure, via the budget class', async () => {
    const { result } = await run();

    const climb = result.trail.find((e) => e.type === 'escalation.rung_climbed');
    expect(climb?.payload['rung']).toBe('agent_redesign');
    expect(climb?.payload['entryClass']).toBe('budget_exhaustion');
  });

  it('produces and registers the redesign, with the overspending design as parent', async () => {
    const { result, registered } = await run();

    const overspender = result.trail
      .filter((e) => e.type === 'agent.staffed')
      .map((e) => String(e.payload['designId']))[0];

    const child = registered.find((r) => r.parentDesignId !== null);
    expect(child, 'the ladder climbed to agent_redesign and nothing was redesigned').toBeDefined();
    expect(child?.parentDesignId).toBe(overspender);
  });

  it('records the redesign on the ledger, saying it was not run', async () => {
    // A design that appears in the registry with no ledger event explaining it
    // is anonymous, which invariant 1 and R28 both forbid.
    const { result } = await run();

    const ev = result.trail.find((e) => e.type === 'agent.redesigned');
    expect(ev, 'the redesign happened off-ledger').toBeDefined();
    expect(String(ev?.payload['detail'])).toMatch(/not run|budget/i);
  });

  it('DISTRACTOR: the ceiling still stops the spend — the redesign never EXECUTES', async () => {
    // The whole risk of this change. If producing the remedy also ran it, a
    // task would spend past a ceiling it had already blown, and invariant 7
    // would be decorative.
    const { result } = await run();

    const executions = result.trail.filter((e) => e.type === 'task.executed');
    expect(executions.length, 'the redesigned agent was allowed to run').toBe(1);
    expect(result.trail.some((e) => e.type === 'task.budget_exhausted')).toBe(true);
    expect(result.outcome).toBe('surrendered');
  });

  it('DISTRACTOR: a task that stays WITHIN its ceiling redesigns nothing', async () => {
    // The trigger is the overrun, not the surrender. A mission that fails for
    // any other reason must not mint lineage — that would attribute ancestry to
    // designs that never overspent and pollute the clade score with noise.
    const { registered } = await run({
      work: {
        async execute() {
          return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
        },
      },
    });

    expect(registered.every((r) => r.parentDesignId === null)).toBe(true);
  });
});

/**
 * The gap a mutant found, not a review.
 *
 * Deleting the `ladder[rungIndex] === 'agent_redesign'` condition — so that ANY
 * budget exhaustion mints a redesign — survived all 509 worker tests. Nothing
 * asserted that the remedy is taken only where the contract GRANTED it.
 *
 * That matters because `entryRungFor` deliberately falls back to rung 0 when the
 * ladder does not contain the mapped rung: "a contract that granted only cheap
 * remedies did not silently grant the expensive ones." Minting lineage anyway
 * would attribute ancestry on behalf of a contract that withheld the remedy, and
 * the clade score would aggregate it as real.
 */
describe('R28 AC-0 — a contract that WITHHELD the redesign rung gets no redesign', () => {
  it('exhausts its budget without minting lineage', async () => {
    const registered: { parentDesignId: string | null }[] = [];
    const base = seams('execution_error');

    const result = await runMission(
      {
        ...mission(),
        budget: { floor: 1, ceiling: 4, unit: 'effort-units' },
        // Cheap remedies only. `budget_exhaustion` maps to `agent_redesign`,
        // which is not here, so `entryRungFor` falls back to rung 0.
        escalationPolicy: { ladder: ['retry_same', 'retry_higher_tier'], humanAt: null },
      },
      {
        ...base,
        completionJudge: {
          async assess({ contract }: { contract: TaskContract }) {
            return {
              criteria: contract.acceptanceCriteria.map((c) => ({
                criterionId: c.criterionId, met: true, detail: 'ok',
              })),
              redFlags: [],
            };
          },
        },
        registry: {
          async bestForCategory() { return null; },
          async register(input: { parentDesignId?: string | null }) {
            registered.push({ parentDesignId: input.parentDesignId ?? null });
          },
        },
      } as never,
      { now: () => AT },
    );

    // The premise: it really did run out of money, so the guard really did fire.
    expect(result.trail.some((e) => e.type === 'task.budget_exhausted')).toBe(true);
    expect(registered.length, 'nothing was staffed at all — the premise is wrong').toBeGreaterThan(0);

    expect(
      registered.every((r) => r.parentDesignId === null),
      'lineage was minted under a contract that never granted the redesign rung',
    ).toBe(true);
    expect(result.trail.some((e) => e.type === 'agent.redesigned')).toBe(false);
  });
});
