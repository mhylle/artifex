/**
 * R19 — the four remaining lenses.
 *
 * "One dashboard, five ways of looking at the same ledger — switchable per
 * mission, shareable as links, **identical truth underneath**."
 *
 * That last clause is the design constraint, and it is why every lens here is a
 * pure function of the same event list rather than its own query. Two lenses
 * cannot disagree if neither has its own source.
 */
import { describe, expect, it } from 'vitest';

import { buildLedgerView, buildLearningView, buildTimeline, buildWorkforce } from './lenses';
import type { LedgerEventView } from './mission-tree';

const MISSION = 'm-1';
let seq = 0;
const ev = (
  type: string,
  taskId: string | null,
  payload: Record<string, unknown> = {},
  family = 'execution',
  occurredAt = '2026-07-30T09:00:00.000Z',
): LedgerEventView & { occurredAt: string } =>
  ({ seq: (seq += 1), eventId: `e-${seq}`, missionId: MISSION, taskId, family, type, payload, occurredAt });

const trail = () => {
  seq = 0;
  return [
    ev('mission.started', MISSION, { objective: 'Root' }, 'contract', '2026-07-30T09:00:00.000Z'),
    ev('task.contracted', 't-a', { objective: 'Part A', category: 'research' }, 'contract', '2026-07-30T09:00:01.000Z'),
    ev('task.contracted', 't-b', { objective: 'Part B', category: 'writing' }, 'contract', '2026-07-30T09:00:02.000Z'),
    ev('agent.staffed', 't-a', { designId: 'analyst', version: 3, logicalTier: 2 }, 'staffing', '2026-07-30T09:00:03.000Z'),
    ev('task.executed', 't-a', { effortSpent: 2 }, 'execution', '2026-07-30T09:00:08.000Z'),
    ev('gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }, 'verification', '2026-07-30T09:00:09.000Z'),
    ev('agent.staffed', 't-b', { designId: 'writer', version: 1, logicalTier: 1 }, 'staffing', '2026-07-30T09:00:10.000Z'),
    ev('task.executed', 't-b', { effortSpent: 1 }, 'execution', '2026-07-30T09:00:12.000Z'),
    ev('gate_b.verdict_issued', 't-b', {
      outcome: 'fail',
      findings: [{ criterionId: 'ac-1', detail: 'no citation', errorClass: 'incomplete' }],
    }, 'verification', '2026-07-30T09:00:13.000Z'),
  ];
};

describe('R19 — workforce lens', () => {
  it('lists every staffed specialist with its design, version, tier and held task', () => {
    const agents = buildWorkforce(trail());

    const analyst = agents.find((a) => a.designId === 'analyst');
    expect(analyst?.version).toBe(3);
    expect(analyst?.logicalTier).toBe(2);
    expect(analyst?.taskId).toBe('t-a');
    expect(analyst?.category).toBe('research');
  });

  it('derives a live compliance rate from that agent\'s own verdicts', () => {
    const agents = buildWorkforce(trail());

    // analyst passed its one verdict; writer failed its one.
    expect(agents.find((a) => a.designId === 'analyst')?.complianceRate).toBe(1);
    expect(agents.find((a) => a.designId === 'writer')?.complianceRate).toBe(0);
  });

  it('reports how long the agent has been on its task', () => {
    const agents = buildWorkforce(trail());

    // staffed 09:00:03, last event for t-a at 09:00:09 -> 6 seconds.
    expect(agents.find((a) => a.designId === 'analyst')?.runtimeSeconds).toBe(6);
  });

  it('DISTRACTOR: an agent with no verdict yet has an UNKNOWN rate, not 0%', () => {
    // Reporting "0% compliant" for an agent nobody has judged would defame it
    // with a number the ledger never supported.
    const partial = trail().slice(0, 4);

    expect(buildWorkforce(partial)[0]?.complianceRate).toBeNull();
  });

  it('DISTRACTOR: two agents on different tasks are not merged into one', () => {
    const agents = buildWorkforce(trail());

    expect(agents).toHaveLength(2);
    expect(new Set(agents.map((a) => a.taskId)).size).toBe(2);
  });
});

describe('R19 — timeline lens', () => {
  it('gives each task a lane of its events in time order', () => {
    const lanes = buildTimeline(trail());

    const laneA = lanes.find((l) => l.taskId === 't-a');
    expect(laneA?.entries.map((e) => e.type)).toEqual([
      'task.contracted', 'agent.staffed', 'task.executed', 'gate_b.verdict_issued',
    ]);
  });

  it('exposes the wait before a task started, which is where stalls show up', () => {
    const lanes = buildTimeline(trail());

    // t-b was contracted at 09:00:02 and not staffed until 09:00:10.
    expect(lanes.find((l) => l.taskId === 't-b')?.waitedSeconds).toBe(8);
  });

  it('DISTRACTOR: lanes carry only their own task\'s events', () => {
    const lanes = buildTimeline(trail());

    for (const lane of lanes) {
      expect(lane.entries.every((e) => e.taskId === lane.taskId)).toBe(true);
    }
  });

  it('DISTRACTOR: a task never staffed reports no runtime rather than a negative one', () => {
    const lanes = buildTimeline(trail().slice(0, 3));

    expect(lanes.every((l) => (l.ranSeconds ?? 0) >= 0)).toBe(true);
  });
});

describe('R19 — ledger explorer lens', () => {
  it('returns the raw trail when nothing is filtered', () => {
    expect(buildLedgerView(trail(), {})).toHaveLength(9);
  });

  it('filters by event family', () => {
    const rows = buildLedgerView(trail(), { family: 'verification' });

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.family === 'verification')).toBe(true);
  });

  it('filters by error class, which is how an investigation starts', () => {
    const rows = buildLedgerView(trail(), { errorClass: 'incomplete' });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe('t-b');
  });

  it('filters by agent, so "what did this specialist do" is one query', () => {
    const rows = buildLedgerView(trail(), { agent: 'analyst' });

    expect(rows.every((r) => r.taskId === 't-a')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('filters by criterion', () => {
    const rows = buildLedgerView(trail(), { criterionId: 'ac-1' });

    expect(rows).toHaveLength(1);
  });

  it('DISTRACTOR: filters COMBINE rather than replace one another', () => {
    // Two filters that each match must narrow to their intersection; treating
    // the last one as the only one would quietly widen every investigation.
    const rows = buildLedgerView(trail(), { family: 'verification', errorClass: 'incomplete' });

    expect(rows).toHaveLength(1);
  });

  it('DISTRACTOR: an unmatched filter yields nothing, not everything', () => {
    expect(buildLedgerView(trail(), { errorClass: 'no-such-class' })).toHaveLength(0);
  });
});

describe('R19 AC-2 — learning observatory lens', () => {
  /**
   * REWRITTEN IN PLACE, not replaced. The buckets — experiments, adoptions,
   * reverts, petitions — were always the right vocabulary. The SOURCES were
   * wrong: the lens read `learning.experiment_started`, `learning.adopted`,
   * `learning.reverted` and `learning.amendment_petitioned`, and **not one of
   * those event types is emitted by anything in the system**. A grep across the
   * worker and API finds no producer, and the live ledger holds none of them.
   * The lens rendered four empty lists and would have forever.
   *
   * The earlier test said so honestly — "R26/R27 are unbuilt, so this lens has
   * no experiments to display" — and that comment is now stale in the way that
   * matters: both loops ARE built and emitting, under different names.
   *
   * What the system actually records:
   *   `fast_loop.hot_fix_applied`   an experiment, carrying `bounds` and
   *                                 `predictedEffect` — declared BEFORE the
   *                                 outcome, which is what makes them
   *                                 PRE-REGISTERED rather than reported.
   *   `fast_loop.hot_fix_resolved`  `kept` or `reverted` — the ratchet.
   *   `learning.proposal_emitted`   the propose-only emitter's petitions.
   *   `decomposition.template_learned`  library growth.
   */
  const applied = (hotFixId: string, over: Record<string, unknown> = {}) =>
    ev('fast_loop.hot_fix_applied', MISSION, {
      hotFixId,
      category: 'summarising',
      criterionId: 'c-1',
      bounds: { windowObservations: 4 },
      predictedEffect: { baselineFailureRate: 0.75, predictedFailureRate: 0.1, basis: 'peer_criteria' },
      ...over,
    }, 'learning', '2026-07-30T09:01:00.000Z');

  const resolved = (hotFixId: string, outcome: 'kept' | 'reverted') =>
    ev('fast_loop.hot_fix_resolved', MISSION, {
      hotFixId, outcome, reason: 'window closed',
    }, 'learning', '2026-07-30T09:02:00.000Z');

  it('shows an experiment IN FLIGHT with its pre-registered metrics', () => {
    const view = buildLearningView([...trail(), applied('hf-1')]);

    expect(view.experiments, 'a live experiment was not surfaced').toHaveLength(1);
    const e = view.experiments[0]!;
    expect(e.preRegistered.baselineFailureRate).toBeCloseTo(0.75, 5);
    expect(e.preRegistered.predictedFailureRate).toBeCloseTo(0.1, 5);
    expect(e.preRegistered.basis).toBe('peer_criteria');
    expect(e.preRegistered.windowObservations).toBe(4);
  });

  it('an experiment is IN FLIGHT only until it resolves', () => {
    // "Experiments in flight" is the criterion's own wording. A resolved
    // experiment still happened, but showing it as running would make the lens
    // claim work is underway that finished.
    const view = buildLearningView([...trail(), applied('hf-1'), resolved('hf-1', 'kept')]);

    expect(view.experiments.filter((e) => e.outcome === null), 'a resolved experiment still reads as in flight').toHaveLength(0);
    expect(view.experiments[0]?.outcome).toBe('kept');
  });

  it('adoptions and reverts appear on the ratchet, each as itself', () => {
    // BOTH values, because a projection that bucketed everything as an adoption
    // would pass a test that only counted resolutions — and the fast loop's
    // whole claim is that it undoes itself.
    const view = buildLearningView([
      ...trail(),
      applied('hf-1'), resolved('hf-1', 'kept'),
      applied('hf-2'), resolved('hf-2', 'reverted'),
    ]);

    expect(view.adoptions).toHaveLength(1);
    expect(view.reverts).toHaveLength(1);
  });

  it('DISTRACTOR: an amendment petition is a PROPOSAL, never an adoption', () => {
    // Invariant #4: the learner proposes and never ratifies. A lens that showed
    // a petition as a change would misrepresent the constitution, and the
    // separation belongs in the projection rather than in a CSS class.
    const view = buildLearningView([
      ...trail(),
      ev('learning.proposal_emitted', null, { title: 'loosen the reviewer rubric', targets: 'constitution' }, 'learning'),
    ]);

    expect(view.petitions).toHaveLength(1);
    expect(view.adoptions, 'a petition was rendered as an applied change').toHaveLength(0);
    expect(view.reverts).toHaveLength(0);
  });

  it('DISTRACTOR: a resolution with no matching experiment is not invented into one', () => {
    // Resolutions can arrive for an experiment applied in an earlier mission,
    // and this lens is scoped to one trail. Fabricating a parent experiment
    // would show pre-registered metrics nobody registered.
    const view = buildLearningView([...trail(), resolved('hf-orphan', 'reverted')]);

    expect(view.experiments).toHaveLength(0);
    expect(view.reverts, 'the resolution itself is still real and still shown').toHaveLength(1);
  });

  it('reports honestly that there is nothing to show when the loops have not run', () => {
    // Kept from the original. An empty ledger must still render as empty —
    // inventing content would be the dashboard asserting something the ledger
    // cannot justify.
    const view = buildLearningView(trail());

    expect(view.experiments).toEqual([]);
    expect(view.adoptions).toEqual([]);
    expect(view.reverts).toEqual([]);
    expect(view.petitions).toEqual([]);
  });

  /**
   * The sealed verdict beside the petition it judges (defect `78e4e5cf`).
   *
   * The petition path records TWO events: `learning.proposal_emitted`, which is
   * what the Learning Agent ARGUED, and `learning.petition_evaluated`, which is
   * what the sealed bench ANSWERED. The lens rendered only the first, so an
   * operator deciding ratification saw the learner's own case and not the
   * independent evidence the sealed slice exists to provide — which inverts what
   * that slice is for.
   *
   * They stay separate events on the ledger deliberately: collapsing them would
   * let a reader mistake the learner's own filing for a judgement made against
   * evidence it never chose. Pairing them belongs in the PROJECTION, which is
   * exactly how `experiments` already pairs with its resolution.
   */
  const evaluated = (petitionId: string, verdict: string, supported: number, evaluatedCount: number) =>
    ev('learning.petition_evaluated', null, {
      petitionId, verdict, supported, evaluated: evaluatedCount, slice: 'sealed',
    }, 'learning', '2026-07-30T09:03:00.000Z');

  it('pairs a petition with the sealed-bench verdict that judged it', () => {
    const petition = ev('learning.proposal_emitted', null,
      { title: 'loosen budget enforcement', targets: 'constitution' }, 'learning');
    const view = buildLearningView([...trail(), petition, evaluated(petition.eventId, 'supported', 1, 1)]);

    expect(view.petitions).toHaveLength(1);
    expect(view.petitions[0]!.verdict).toBe('supported');
    expect(view.petitions[0]!.supported).toBe(1);
    expect(view.petitions[0]!.evaluated).toBe(1);
  });

  it('reports UNSUPPORTED as itself, not as an absence', () => {
    // Both sides of the discriminator. A projection that only ever surfaced
    // `supported` would read as "no verdict yet" for the case where the bench
    // actively argued AGAINST amending, which is the outcome that most needs to
    // reach the person deciding.
    const petition = ev('learning.proposal_emitted', null, { title: 't' }, 'learning');
    const view = buildLearningView([...trail(), petition, evaluated(petition.eventId, 'unsupported', 1, 3)]);

    expect(view.petitions[0]!.verdict).toBe('unsupported');
    expect(view.petitions[0]!.supported).toBe(1);
    expect(view.petitions[0]!.evaluated).toBe(3);
  });

  it('an UNJUDGED petition reads as null, never as supported', () => {
    // The petition is filed before the verdict is appended, so this state is
    // real and momentary. Defaulting it to `supported` would show an operator a
    // green light nobody gave.
    const petition = ev('learning.proposal_emitted', null, { title: 't' }, 'learning');
    const view = buildLearningView([...trail(), petition]);

    expect(view.petitions).toHaveLength(1);
    expect(view.petitions[0]!.verdict).toBeNull();
  });

  it('DISTRACTOR: a verdict for a DIFFERENT petition does not attach to this one', () => {
    // Two petitions in one trail is ordinary — a mission can raise more than one
    // weak spot over its life. Matching on the petition id rather than on
    // "the most recent verdict" is what keeps them apart.
    const mine = ev('learning.proposal_emitted', null, { title: 'mine' }, 'learning');
    const theirs = ev('learning.proposal_emitted', null, { title: 'theirs' }, 'learning');
    const view = buildLearningView([
      ...trail(), mine, theirs, evaluated(theirs.eventId, 'supported', 2, 2),
    ]);

    const forMine = view.petitions.find((p) => (p.event.payload as { title?: string }).title === 'mine');
    const forTheirs = view.petitions.find((p) => (p.event.payload as { title?: string }).title === 'theirs');
    expect(forMine!.verdict, 'a verdict leaked onto the wrong petition').toBeNull();
    expect(forTheirs!.verdict).toBe('supported');
  });

  it('DISTRACTOR: an orphan verdict does not invent a petition to attach to', () => {
    // The same rule the resolutions already follow: an evaluation can arrive for
    // a petition filed in an earlier mission, and this lens is scoped to one
    // trail. Fabricating a parent would show a petition nobody filed.
    const view = buildLearningView([...trail(), evaluated('e-orphan', 'supported', 1, 1)]);

    expect(view.petitions).toEqual([]);
  });

  it('surfaces library growth as templates are learned', () => {
    // Named in the requirement's own description of this lens ("library
    // growth"), and now a thing the system actually does (R31 AC-2).
    const view = buildLearningView([
      ...trail(),
      ev('decomposition.template_learned', MISSION, { templateId: 'tpl-1', capability: 'comparing' }, 'learning'),
    ]);

    expect(view.libraryGrowth).toHaveLength(1);
  });
});

describe('R19 AC-4 DISTRACTOR — the lenses agree, because they share one source', () => {
  it('the workforce lens counts exactly the agents the trail staffed', () => {
    const events = trail();
    const staffed = events.filter((e) => e.type === 'agent.staffed').length;

    expect(buildWorkforce(events)).toHaveLength(staffed);
  });

  it('the timeline covers exactly the tasks the trail contracted', () => {
    const events = trail();
    const contracted = new Set(events.filter((e) => e.type === 'task.contracted').map((e) => e.taskId));

    expect(new Set(buildTimeline(events).map((l) => l.taskId))).toEqual(contracted);
  });

  it('the unfiltered explorer holds every event the other lenses drew from', () => {
    const events = trail();

    expect(buildLedgerView(events, {})).toHaveLength(events.length);
  });
});
