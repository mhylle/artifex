/**
 * R22 — audience scoping.
 *
 * "The same substrate, scoped per audience." One ledger, three ways of being
 * allowed to look at it — and, crucially, three different sets of things you
 * may DO. The scoping is a pure function so that "what may this audience do"
 * has exactly one answer, rather than one answer per template that renders a
 * button and another where the action is sent.
 *
 * This is not authn/authz. Identity stays out of scope until the security
 * boundary is lifted; this is view scoping and available actions.
 */
import { describe, expect, it } from 'vitest';

import { mayAct, scopeFor } from './audience';
import { buildRequesterView } from './requester-view';
import type { LedgerEventView } from './mission-tree';

const MISSION = 'm-1';
let seq = 0;
const ev = (type: string, taskId: string | null, payload: Record<string, unknown> = {}, family = 'execution'): LedgerEventView =>
  ({ seq: (seq += 1), eventId: `e-${seq}`, missionId: MISSION, taskId, family, type, payload });

describe('scopeFor — who sees what', () => {
  it('the operator sees everything and may issue every cockpit action', () => {
    const scope = scopeFor('operator');

    expect(scope.missions).toBe('all');
    expect(scope.lenses).toEqual(['canvas', 'workforce', 'timeline', 'learning', 'ledger']);
    expect(scope.rawLedger).toBe(true);
    expect(scope.attentionQueue).toBe(true);
    for (const action of ['pause', 'resume', 'cancel', 'grant_budget', 'turn_dial', 'annotate', 'decide'] as const) {
      expect(mayAct('operator', action), `operator should be able to ${action}`).toBe(true);
    }
  });

  it('the requester is scoped to their own mission and to the three things intake promised them', () => {
    const scope = scopeFor('requester');

    expect(scope.missions).toBe('own');
    // Answer questions, approve budget extensions, adjust their own dial.
    expect([...scope.actions].sort()).toEqual(['decide', 'grant_budget', 'turn_dial']);
  });

  it('DISTRACTOR: the requester may not steer the machinery — only their own mission', () => {
    // Pausing, cancelling and annotating are operator controls over HOW the
    // work is done. A requester who could cancel a task would be reaching past
    // their contract into the execution the operator is accountable for.
    for (const action of ['pause', 'resume', 'cancel', 'annotate'] as const) {
      expect(mayAct('requester', action), `requester should NOT be able to ${action}`).toBe(false);
    }
  });

  it('DISTRACTOR: the learning observer is read-only across every mission — no action at all', () => {
    const scope = scopeFor('observer');

    // The point of the restriction: an observer who could act could steer the
    // system they are measuring, and the measurement would stop meaning
    // anything. Read-only is the whole role.
    expect(scope.missions).toBe('all');
    expect(scope.actions).toEqual([]);
    for (const action of ['pause', 'resume', 'cancel', 'grant_budget', 'turn_dial', 'annotate', 'decide'] as const) {
      expect(mayAct('observer', action), `observer must NOT be able to ${action}`).toBe(false);
    }
  });

  it('DISTRACTOR: the observer sees the observatory, not the whole cockpit', () => {
    // "Read-only" is not the same as "everything, greyed out". An observer who
    // could open the ledger explorer would be reading operator material.
    const scope = scopeFor('observer');

    expect(scope.lenses).toEqual(['learning']);
    expect(scope.rawLedger).toBe(false);
    expect(scope.attentionQueue).toBe(false);
  });

  it('DISTRACTOR: no audience is granted an action by default — an unknown action is refused', () => {
    // Guards that default to "allow" fail open, and this one gates every
    // write the cockpit can make.
    expect(mayAct('requester', 'demolish' as never)).toBe(false);
    expect(mayAct('operator', 'demolish' as never)).toBe(false);
  });
});

/**
 * The requester's view of their own mission.
 *
 * The binding phrase in the criterion is "progress against the mission
 * contract's criteria (NOT internal task counts)". A requester asked for three
 * things; how many tasks Artifex needed, how often it retried, and which tier
 * it escalated to are its business, not theirs.
 */
describe('buildRequesterView', () => {
  /**
   * Three mission criteria, partitioned across three tasks. The switch task is
   * bounced and retried — extra internal activity that must NOT surface as
   * extra progress.
   */
  const trail = () => {
    seq = 0;
    return [
      ev('mission.intake_accepted', MISSION, {
        objective: 'Explain three things about lamps.',
        budget: { unit: 'effort-units', floor: 1, ceiling: 40 },
        contract: {
          acceptanceCriteria: [
            { criterionId: 'm-1', statement: 'Explains what a light bulb does.' },
            { criterionId: 'm-2', statement: 'Explains what a light switch does.' },
            { criterionId: 'm-3', statement: 'Explains what a lampshade is for.' },
          ],
        },
      }, 'contract'),
      ev('mission.started', MISSION, { objective: 'Explain three things about lamps.' }, 'contract'),
      ev('task.contracted', 't-a', { objective: 'Bulbs', acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Explains what a light bulb does.' }] }, 'contract'),
      ev('task.contracted', 't-b', { objective: 'Switches', acceptanceCriteria: [{ criterionId: 'm-2', statement: 'Explains what a light switch does.' }] }, 'contract'),
      ev('task.contracted', 't-c', { objective: 'Shades', acceptanceCriteria: [{ criterionId: 'm-3', statement: 'Explains what a lampshade is for.' }] }, 'contract'),
      ev('task.executed', 't-a', { effortSpent: 2 }),
      ev('gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }, 'verification'),
      ev('task.executed', 't-b', { effortSpent: 1 }),
      ev('gate_b.verdict_issued', 't-b', { outcome: 'fail', findings: [{ criterionId: 'm-2', detail: 'no mechanism given' }] }, 'verification'),
      ev('escalation.rung_climbed', 't-b', { rung: 'retry_higher_tier', reason: 'bounced' }, 'escalation'),
      ev('task.executed', 't-b', { effortSpent: 4 }),
      ev('gate_b.verdict_issued', 't-b', { outcome: 'pass', findings: [] }, 'verification'),
    ];
  };

  it('reports progress against the MISSION contract criteria, by their own ids', () => {
    const view = buildRequesterView(trail());

    expect(view.criteria.map((c) => c.criterionId)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(view.criteria.map((c) => c.state)).toEqual(['met', 'met', 'unknown']);
    expect(view.criteria[0]!.statement).toBe('Explains what a light bulb does.');
  });

  it('DISTRACTOR: it exposes NO internal task counts, tiers or attempt numbers', () => {
    const view = buildRequesterView(trail());
    const serialized = JSON.stringify(view);

    // The switch criterion took two attempts and an escalation. The requester
    // asked for three things and must see three things.
    expect(view.criteria).toHaveLength(3);
    expect(serialized).not.toContain('t-a');
    expect(serialized).not.toContain('logicalTier');
    expect(serialized).not.toContain('attempt');
    expect(serialized).not.toContain('rung_climbed');
  });

  it('DISTRACTOR: a criterion whose last verdict FAILED reads unmet, not met', () => {
    // Taking "the task produced a verdict" as success would report a mission
    // that failed as delivered — the single most damaging thing this view could
    // get wrong.
    const events = trail().slice(0, 9); // stops right after t-b's failing verdict
    const view = buildRequesterView(events);

    expect(view.criteria.find((c) => c.criterionId === 'm-2')!.state).toBe('unmet');
    expect(view.criteria.find((c) => c.criterionId === 'm-2')!.detail).toBe('no mechanism given');
  });

  it('shows budget consumed against budget granted', () => {
    const view = buildRequesterView(trail());

    expect(view.budget.granted).toBe(40);
    // Last reported spend per task: 2 (t-a) + 4 (t-b). t-c never executed.
    expect(view.budget.consumed).toBe(6);
  });

  it('counts an operator budget grant into what was granted', () => {
    const events = [...trail(), ev('operator.budget_granted', 't-b', { amount: 10 }, 'operator')];

    expect(buildRequesterView(events).budget.granted).toBe(50);
  });

  it('lists questions addressed to a human, with the context needed to answer', () => {
    const events = [...trail(), ev('escalation.awaiting_human', 't-c', {
      objective: 'Shades', rung: 'human_review', findings: ['no authoritative source'],
    }, 'escalation')];

    const view = buildRequesterView(events);
    expect(view.questions).toHaveLength(1);
    expect(view.questions[0]!.objective).toBe('Shades');
    expect(view.questions[0]!.findings).toEqual(['no authoritative source']);
  });

  it('reports the mission outcome in the requester\'s terms', () => {
    expect(buildRequesterView(trail()).outcome).toBe('running');
    expect(buildRequesterView([...trail(), ev('mission.folded', MISSION, {}, 'contract')]).outcome).toBe('delivered');
  });

  it('reports a KEPT-WHOLE delivery as delivered — it never folds (defect dd2e9d18)', () => {
    // The third site keying on `mission.folded` alone. A requester whose
    // mission was kept whole would have been told it was still running long
    // after they had the answer.
    const delivered = [...trail(), ev('mission.delivered', MISSION, {}, 'contract')];

    expect(buildRequesterView(delivered).outcome).toBe('delivered');
  });

  it('reports a swept mission as abandoned, and a revived one as running again', () => {
    // Both sides. A requester whose mission died in a worker crash is told so;
    // if it later runs, they are told that too rather than left on a stale
    // obituary.
    const swept = [...trail(), ev('mission.abandoned', MISSION, {}, 'contract')];
    const revived = [...swept, ev('mission.started', MISSION, {}, 'contract')];

    expect(buildRequesterView(swept).outcome).toBe('abandoned');
    expect(buildRequesterView(revived).outcome).toBe('running');
  });

  it('reports a surrendered-then-resumed mission by its LAST outcome', () => {
    const resumed = [
      ...trail(),
      ev('mission.surrendered', MISSION, {}, 'contract'),
      ev('mission.delivered', MISSION, {}, 'contract'),
    ];
    // ...and the other side, so this cannot pass by always preferring delivery.
    const takenBack = [
      ...trail(),
      ev('mission.delivered', MISSION, {}, 'contract'),
      ev('mission.surrendered', MISSION, {}, 'contract'),
    ];

    expect(buildRequesterView(resumed).outcome).toBe('delivered');
    expect(buildRequesterView(takenBack).outcome).toBe('surrendered');
  });

  it('DISTRACTOR: flagged assumptions are reported as UNAVAILABLE, never as "none"', () => {
    // No event in the vocabulary carries them: the evidence bundle defines an
    // `assumptions` field but `task.executed` records only `{answer}`, so
    // nothing reaches the ledger. R30 (intake dialogue) and R40 (the worker
    // contract ritual) are the producers, and neither is built.
    //
    // Rendering an empty list would tell the requester "nothing was assumed",
    // which is a claim the ledger cannot support and precisely the kind of
    // invented reassurance this project has been burned by.
    const view = buildRequesterView(trail());

    expect(view.assumptions).toBeNull();
  });
});

/**
 * R22 AC-1 — flagged assumptions reach the requester.
 *
 * This was unsatisfiable until R40: the evidence bundle declared `assumptions`
 * but `task.executed` recorded only `{ answer }`, so the view had no honest
 * choice but `null`. R40 made the worker declare them and the mission loop
 * record them, so the producer now exists and the view must read it.
 *
 * The `null`-means-unavailable distinction survives — it is the whole point of
 * the field — but it now means "this trail carries none", not "nothing ever can".
 */
describe('R22 AC-1 — assumptions reach the requester once the ledger carries them', () => {
  const executed = (payload: Record<string, unknown>) => [
    { id: 1, taskId: 't-1', type: 'mission.intake_accepted', payload: { objective: 'Boil an egg.' } },
    { id: 2, taskId: 't-1', type: 'task.executed', payload },
  ];

  it('surfaces the assumptions the worker declared', () => {
    const view = buildRequesterView(
      executed({ deliverable: { answer: '5' }, assumptions: ['Assumed a medium egg from the fridge.'] }) as never,
    );

    expect(view.assumptions).toEqual(['Assumed a medium egg from the fridge.']);
  });

  it('DISTRACTOR: an explicitly EMPTY list is "none declared", not "unavailable"', () => {
    // These are different claims and the requester acts differently on each.
    // A worker that was asked and had nothing to declare is a real answer.
    const view = buildRequesterView(executed({ deliverable: { answer: '5' }, assumptions: [] }) as never);

    expect(view.assumptions).toEqual([]);
    expect(view.assumptions).not.toBeNull();
  });

  it('DISTRACTOR: a trail with no executed task still reports UNAVAILABLE', () => {
    // The original reason for `null`. Nothing was asked, so claiming "none were
    // assumed" would be invented reassurance.
    const view = buildRequesterView([
      { id: 1, taskId: 't-1', type: 'mission.intake_accepted', payload: { objective: 'Boil an egg.' } },
    ] as never);

    expect(view.assumptions).toBeNull();
  });

  it('DISTRACTOR: assumptions from EVERY executed task are shown, not just the first', () => {
    // A multi-task mission's premises are the union. Showing one task's and
    // calling it the mission's is the same silent-omission failure as `[]`.
    const view = buildRequesterView([
      { id: 1, taskId: 'm', type: 'mission.intake_accepted', payload: { objective: 'Cook.' } },
      { id: 2, taskId: 't-1', type: 'task.executed', payload: { deliverable: {}, assumptions: ['A.'] } },
      { id: 3, taskId: 't-2', type: 'task.executed', payload: { deliverable: {}, assumptions: ['B.'] } },
    ] as never);

    expect(view.assumptions).toEqual(['A.', 'B.']);
  });
});
