/**
 * R31 — the decompose-or-delegate gate.
 *
 * "Atomization is a weapon to aim, not a reflex. At every node the Orchestrator
 * applies the decompose-or-delegate gate: work that is inherently sequential and
 * constraint-entangled is measurably damaged by splitting (−39% to −70% in
 * controlled studies), so such subtrees are deliberately kept whole and handed
 * to a single agent with a larger budget. The gate's decision — split or keep —
 * is itself recorded, reviewable, and learnable."
 *
 * Until now the Orchestrator always split. The decision existed only as an
 * implicit fallback: if the planner could produce nothing but the parent's own
 * objective, the parent became its own single child. That is the right reading
 * of "this does not decompose", but it is a side effect rather than a judgement,
 * and nothing in the trail says a choice was ever made.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { DecompositionGate, MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

/** Two criteria, so the mission is genuinely splittable — the gate has a real choice. */
function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Draft a contract clause and reconcile it with the rest of the agreement.',
    acceptanceCriteria: [
      { criterionId: 'm-1', statement: 'The clause is drafted.' },
      { criterionId: 'm-2', statement: 'It is consistent with the other clauses.' },
    ],
    boundaries: { outOfScope: ['No legal advice.'], siblingOwners: [] },
    inputs: { entitlements: ['mission-brief'], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['both met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'different_agent', 'human_review'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

interface Script {
  readonly gate?: DecompositionGate;
  readonly onWork?: (contract: TaskContract) => void;
}

function seams(script: Script = {}): MissionSeams {
  return {
    planner: {
      async propose({ contract }) {
        return {
          subtasks: contract.acceptanceCriteria.map((criterion, i) => ({
            objective: `Handle ${criterion.criterionId}.`,
            category: 'drafting',
            acceptanceCriteria: [criterion],
            outOfScope: [`Not ${i === 0 ? 'the second' : 'the first'} part.`],
            blastRadius: 'low' as const,
            effortShare: 0.4,
          })),
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
    // R33's plan audit. Permissive here on purpose: these tests are about other
    // properties, and an explicit permissive judge in a fixture is honest in a
    // way a silently-skipped clause in production never is. The clause itself is
    // exercised in `gate-a-full.test.ts`.
    planJudge: {
      async audit({ children }: { children: readonly { taskId: string }[] }) {
        return { tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })), untestable: [], overlaps: [] };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Do the work.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do the work.', ambiguities: [] }; } },
    work: {
      async execute({ contract }) {
        script.onWork?.(contract);
        return { deliverable: { answer: `done: ${contract.objective}` }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({ criterionId: c.criterionId, met: true, detail: 'ok' })),
          redFlags: [],
        };
      },
    },
    reconciler: {
      async reconcile({ children }) {
        return { deliverable: { summary: `reconciled ${children.length}` }, conflicts: [] };
      },
    },
    ...(script.gate === undefined ? {} : { decompositionGate: script.gate }),
  };
}

const gateSaying = (keepWhole: boolean, rationale: string): DecompositionGate => ({
  async assess() { return { keepWhole, rationale }; },
});

const decisions = (trail: readonly { type: string; payload: Record<string, unknown> }[]) =>
  trail.filter((e) => e.type === 'decomposition.decided');

describe('R31 AC-0 — the decision is explicit and recorded', () => {
  it('records the gate decision with its rationale when the node is split', async () => {
    const result = await runMission(
      mission(),
      seams({ gate: gateSaying(false, 'Two independent clauses; splitting loses nothing.') }),
      { now: () => AT },
    );

    const decided = decisions(result.trail);
    expect(decided).toHaveLength(1);
    expect(decided[0]?.payload['decision']).toBe('split');
    expect(decided[0]?.payload['rationale']).toBe('Two independent clauses; splitting loses nothing.');
  });

  it('records it just the same when the node is kept whole', async () => {
    const result = await runMission(
      mission(),
      seams({ gate: gateSaying(true, 'Drafting and reconciling are constraint-entangled.') }),
      { now: () => AT },
    );

    const decided = decisions(result.trail);
    expect(decided).toHaveLength(1);
    expect(decided[0]?.payload['decision']).toBe('keep_whole');
    expect(decided[0]?.payload['rationale']).toBe('Drafting and reconciling are constraint-entangled.');
  });

  it('DISTRACTOR: the decision is recorded even with NO gate configured, so it is always auditable', async () => {
    // "The choice to split is as auditable as the split itself." A default that
    // recorded nothing would leave every mission in the current codebase
    // claiming a decision it never made — which is the shape of the defects
    // this project has shipped five times.
    const result = await runMission(mission(), seams(), { now: () => AT });

    const decided = decisions(result.trail);
    expect(decided).toHaveLength(1);
    expect(decided[0]?.payload['decision']).toBe('split');
    expect(String(decided[0]?.payload['rationale'])).toMatch(/no .*gate|default/i);
  });

  it('DISTRACTOR: the decision event is filed against the node being decided, not the mission', async () => {
    // A decision recorded against the mission for every node would be
    // unreviewable the moment a tree is more than one level deep.
    const result = await runMission(mission(), seams({ gate: gateSaying(false, 'split it') }), { now: () => AT });

    expect(decisions(result.trail)[0]).toMatchObject({ taskId: MISSION_ID, family: 'decision' });
  });
});

describe('R31 AC-1 — kept whole means ONE agent with the FULL budget', () => {
  it('does not decompose, and staffs a single agent', async () => {
    const result = await runMission(
      mission(),
      seams({ gate: gateSaying(true, 'Sequential and entangled.') }),
      { now: () => AT },
    );

    expect(result.outcome).toBe('delivered');
    const types = result.trail.map((e) => e.type);
    expect(types.filter((t) => t === 'task.contracted'), 'no children may be contracted').toHaveLength(0);
    expect(types.filter((t) => t === 'agent.staffed'), 'exactly one agent').toHaveLength(1);
  });

  it('the single agent gets the parent’s WHOLE ceiling, not a divided share', async () => {
    // The larger budget is derived, not invented: an unsplit node simply keeps
    // its own ceiling instead of dividing it by effortShare. A split child here
    // would have received 0.4 x 20 = 8.
    const kept = await runMission(
      mission(),
      seams({ gate: gateSaying(true, 'entangled') }),
      { now: () => AT },
    );
    const split = await runMission(
      mission(),
      seams({ gate: gateSaying(false, 'independent') }),
      { now: () => AT },
    );

    const ceilingOf = (r: typeof kept) =>
      r.trail.find((e) => e.type === 'task.executed')?.payload['ceiling'];

    expect(ceilingOf(kept)).toBe(20);
    expect(Number(ceilingOf(kept))).toBeGreaterThan(Number(ceilingOf(split)));
  });

  it('DISTRACTOR: a kept-whole node carrying SEVERAL criteria is not re-decomposed one level down', async () => {
    // The trap: "keep whole" that produces a single child identical to the
    // parent, which is then found non-atomic and split anyway. The gate would
    // appear to work while changing nothing.
    let workedOn: string[] = [];
    const result = await runMission(
      mission(),
      seams({
        gate: gateSaying(true, 'entangled'),
        onWork: (c) => { workedOn = [...workedOn, c.objective]; },
      }),
      { now: () => AT },
    );

    expect(result.outcome).toBe('delivered');
    // One agent did the whole job, against the parent's own objective.
    expect(workedOn).toEqual(['Draft a contract clause and reconcile it with the rest of the agreement.']);
  });

  it('DISTRACTOR: the gate is consulted, not assumed — split still splits', async () => {
    // Without this, "always keep whole" would pass every test above.
    const result = await runMission(
      mission(),
      seams({ gate: gateSaying(false, 'independent') }),
      { now: () => AT },
    );

    expect(result.trail.filter((e) => e.type === 'task.contracted')).toHaveLength(2);
    expect(result.trail.filter((e) => e.type === 'agent.staffed')).toHaveLength(2);
  });

  it('DISTRACTOR: a kept-whole node is still VERIFIED — skipping the split does not skip the gate', async () => {
    // Keeping work whole changes who does it, never whether it is checked.
    const result = await runMission(
      mission(),
      seams({ gate: gateSaying(true, 'entangled') }),
      { now: () => AT },
    );

    const verdicts = result.trail.filter((e) => e.type === 'gate_b.verdict_issued');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.payload['outcome']).toBe('pass');
  });
});
