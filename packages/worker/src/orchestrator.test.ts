/**
 * P5 — the Orchestrator (R5).
 *
 * Two jobs: split a mission into individually-contracted atomic tasks, and fold
 * the children back into ONE reconciled result. The planner and reconciler are
 * seams so these tests are deterministic; the live model runs in the dogfood.
 */
import { TaskContractSchema, validate } from '@artifex/shared-types';
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { decompose, foldUp } from './orchestrator.js';
import type { DecompositionProposal, Planner, Reconciler } from './orchestrator.js';

const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const AT = '2026-07-30T09:00:00.000Z';

/** Task zero — the mission is a contract too (invariant #2). */
function missionContract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: MISSION_ID,
    missionId: MISSION_ID,
    parentTaskId: null,
    category: 'mission',
    depth: 0,
    objective: 'Produce a structured report answering three sub-questions with cited sources.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The report answers every sub-question.' }],
    boundaries: { outOfScope: ['Do not contact external vendors.'], siblingOwners: [] },
    inputs: { entitlements: ['The mission brief'], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['All sub-questions answered and cited.'],
      stopTryingWhen: ['No resolvable source exists.'],
      maxAttempts: 3,
      stallLimit: 2,
    },
    budget: { floor: 3, ceiling: 30, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'medium',
    autonomyDial: 'checkpointed',
    createdAt: AT,
    ...over,
  };
}

function plannerOf(proposal: DecompositionProposal): Planner {
  return { async propose() { return proposal; } };
}

const THREE_WAY: DecompositionProposal = {
  subtasks: [
    {
      objective: 'Answer sub-question 1 with cited sources.',
      category: 'research.sub-question',
      acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Every claim carries a citation.' }],
      outOfScope: ['Do not draft the final report.'],
      blastRadius: 'low',
      effortShare: 0.4,
    },
    {
      objective: 'Answer sub-question 2 with cited sources.',
      category: 'research.sub-question',
      acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Every claim carries a citation.' }],
      outOfScope: ['Do not draft the final report.'],
      blastRadius: 'low',
      effortShare: 0.4,
    },
    {
      objective: 'Answer sub-question 3 with cited sources.',
      category: 'research.sub-question',
      acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Every claim carries a citation.' }],
      outOfScope: ['Do not draft the final report.'],
      blastRadius: 'low',
      effortShare: 0.2,
    },
  ],
};

describe('R5 AC-1 — no work without a contract', () => {
  it('every leaf carries acceptance criteria, boundaries, stopping conditions and a budget', async () => {
    const children = await decompose(missionContract(), plannerOf(THREE_WAY));

    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(child.boundaries.outOfScope.length).toBeGreaterThan(0);
      expect(child.stoppingConditions.doneWhen.length).toBeGreaterThan(0);
      expect(child.stoppingConditions.stopTryingWhen.length).toBeGreaterThan(0);
      expect(child.budget.ceiling).toBeGreaterThan(0);
    }
  });

  it('every leaf validates against the shared TaskContract schema', async () => {
    const children = await decompose(missionContract(), plannerOf(THREE_WAY));

    for (const child of children) {
      const result = validate(TaskContractSchema, child);
      expect(result.ok, JSON.stringify(result.ok ? {} : result.errors)).toBe(true);
    }
  });

  it('DISTRACTOR: a proposal with no acceptance criteria is refused, not silently accepted', async () => {
    // A task nobody can grade is not a task. This must fail loudly at authoring
    // time, because by execution time the contract is the only spec that exists.
    const bad: DecompositionProposal = {
      subtasks: [{ ...THREE_WAY.subtasks[0]!, acceptanceCriteria: [] }],
    };

    await expect(decompose(missionContract(), plannerOf(bad))).rejects.toThrow(/acceptance criteria/i);
  });

  it('DISTRACTOR: the budget is DIVIDED among children, never duplicated', async () => {
    // Handing each child the parent's full ceiling multiplies spend by the fan-out
    // — the fastest way to bankrupt a mission (invariant #7).
    const parent = missionContract();
    const children = await decompose(parent, plannerOf(THREE_WAY));
    const allocated = children.reduce((sum, c) => sum + c.budget.ceiling, 0);

    expect(allocated).toBeLessThanOrEqual(parent.budget.ceiling);
    expect(children.every((c) => c.budget.ceiling < parent.budget.ceiling)).toBe(true);
  });

  it('DISTRACTOR: over-subscribed effort shares are refused', async () => {
    const greedy: DecompositionProposal = {
      subtasks: THREE_WAY.subtasks.map((s) => ({ ...s, effortShare: 0.9 })),
    };

    await expect(decompose(missionContract(), plannerOf(greedy))).rejects.toThrow(/budget|effort/i);
  });

  it('records lineage and sibling ownership so scope cannot silently overlap', async () => {
    const parent = missionContract();
    const children = await decompose(parent, plannerOf(THREE_WAY));

    for (const child of children) {
      expect(child.parentTaskId).toBe(parent.taskId);
      expect(child.missionId).toBe(parent.missionId);
      expect(child.depth).toBe(parent.depth + 1);
      // Each child must know who owns the neighbouring concerns.
      expect(child.boundaries.siblingOwners.length).toBe(children.length - 1);
    }
  });

  it('inherits the mission-level autonomy dial rather than inventing one', async () => {
    const parent = missionContract({ autonomyDial: 'supervised' });
    const children = await decompose(parent, plannerOf(THREE_WAY));

    expect(children.every((c) => c.autonomyDial === 'supervised')).toBe(true);
  });
});

describe('R5 AC-2 — fold-up reconciles, it does not concatenate', () => {
  const parent = missionContract();

  const CHILD_RESULTS = [
    { objective: 'sub-question 1', deliverable: { answer: 'Adoption reached 34% in Q1 2026.' } },
    { objective: 'sub-question 2', deliverable: { answer: 'Adoption reached 41% in Q1 2026.' } },
    { objective: 'sub-question 3', deliverable: { answer: 'Pricing was unchanged in Q1 2026.' } },
  ];

  /** A real reconciler resolves; this one records that it was asked to. */
  const reconciler: Reconciler = {
    async reconcile({ children }) {
      const answers = children.map((c) => (c.deliverable as { answer: string }).answer);
      const conflicting = answers.filter((a) => a.includes('Adoption reached'));
      return {
        deliverable: { summary: 'Adoption figures disagree between sources; pricing held flat.' },
        conflicts: conflicting.length > 1 ? ['sub-questions 1 and 2 report different adoption rates'] : [],
      };
    },
  };

  it('yields ONE reconciled deliverable from many children', async () => {
    const folded = await foldUp(parent, CHILD_RESULTS, reconciler);

    expect(folded.deliverable).toBeDefined();
    expect(Array.isArray(folded.deliverable)).toBe(false);
  });

  it('surfaces conflicts between children rather than emitting both answers', async () => {
    // The point of reconciliation: two children disagreed about the same fact,
    // and a concatenation would have shipped both as though both were true.
    const folded = await foldUp(parent, CHILD_RESULTS, reconciler);

    expect(folded.conflicts.length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: the result is not the children\'s deliverables joined together', async () => {
    const folded = await foldUp(parent, CHILD_RESULTS, reconciler);
    const serialized = JSON.stringify(folded.deliverable);

    // If fold-up were concatenation, every child answer would survive verbatim.
    const survivingVerbatim = CHILD_RESULTS.filter((c) =>
      serialized.includes((c.deliverable as { answer: string }).answer),
    );
    expect(survivingVerbatim.length).toBeLessThan(CHILD_RESULTS.length);
  });

  it('DISTRACTOR: folding zero children is refused — there is nothing to reconcile', async () => {
    await expect(foldUp(parent, [], reconciler)).rejects.toThrow(/no children|empty/i);
  });

  it('attributes the fold to its parent so the tree is reconstructable', async () => {
    const folded = await foldUp(parent, CHILD_RESULTS, reconciler);

    expect(folded.taskId).toBe(parent.taskId);
    expect(folded.childCount).toBe(CHILD_RESULTS.length);
  });
});
