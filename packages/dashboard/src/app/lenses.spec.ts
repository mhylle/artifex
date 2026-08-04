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

import { buildLedgerView, buildLearningView, buildTimeline, buildWorkforce, hasLearningOutput } from './lenses';
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

  /**
   * The SLOW loop's half of the ratchet (defect `b916a540`).
   *
   * R19 AC-2 says the observatory shows "adoptions and reverts on the ratchet".
   * `buildLearningView` sourced both from `fast_loop.hot_fix_resolved` only,
   * which was right when the fast loop was the only ratchet. Since the science
   * loop was wired it also decides adoptions — `learning.candidate_evaluated`
   * carries `adopt`, a reason and the evidence — and none of it reached the
   * lens. Find-shape (c): the panel claimed to show the ratchet and showed half.
   *
   * The weak-spot ranking is the same shape one level up: it is the Learning
   * Agent's primary output and the input to the petition path, and the learning
   * lens said nothing about it.
   */
  const decided = (candidateId: string, adopt: boolean, over: Record<string, unknown> = {}) =>
    ev('learning.candidate_evaluated', null, {
      adopt, reason: adopt ? 'replicated and held out' : 'won 0 time(s)',
      evidence: { candidateId, wins: adopt ? 2 : 0, losses: adopt ? 0 : 2, heldOutWon: adopt },
      ...over,
    }, 'learning', '2026-07-30T09:04:00.000Z');

  const ranked = (count: number) =>
    ev('learning.weak_spots_ranked', null, {
      ranked: count,
      top: [{ category: 'technical writing', severity: 9.5, observations: 3, reasons: ['compliance is 1/4'] }],
    }, 'learning', '2026-07-30T09:05:00.000Z');

  it('surfaces the science loop decisions with their evidence', () => {
    const view = buildLearningView([...trail(), decided('hf-1', false)]);

    expect(view.candidateDecisions).toHaveLength(1);
    expect(view.candidateDecisions[0]!.candidateId).toBe('hf-1');
    expect(view.candidateDecisions[0]!.adopt).toBe(false);
    expect(view.candidateDecisions[0]!.wins).toBe(0);
    expect(view.candidateDecisions[0]!.losses).toBe(2);
    expect(view.candidateDecisions[0]!.heldOutWon).toBe(false);
  });

  /**
   * The OTHER half of the same ratchet, and the half that actually changes a
   * design. `learning.candidate_evaluated` says a candidate won its bench;
   * `learning.design_delta_proposed` says whether the REGISTRY accepted it
   * against the incumbent — a different question with a different answer, and
   * the only one that moves a design's version.
   *
   * The event is new because nothing used to reach `proposeDelta` at all
   * (find-shape (l)). Adding the lens in the same change so the result does not
   * land on the ledger with nothing to show it — find-shape (o).
   */
  const proposed = (designId: string, outcome: string, over: Record<string, unknown> = {}) =>
    ev('learning.design_delta_proposed', null, {
      designId, candidateId: 'hf-1', candidateScore: 0.75,
      justifiedBy: ['evt-1'], outcome, reason: `${outcome} by the ratchet`,
      toVersion: outcome === 'adopted' ? 4 : null,
      ...over,
    }, 'learning', '2026-07-30T09:06:00.000Z');

  it('shows whether the registry accepted a delta, not just whether the bench liked it', () => {
    const view = buildLearningView([...trail(), proposed('design-7', 'adopted')]);

    expect(view.deltas).toHaveLength(1);
    expect(view.deltas[0]!.designId).toBe('design-7');
    expect(view.deltas[0]!.adopted).toBe(true);
    expect(view.deltas[0]!.toVersion).toBe(4);
    expect(view.deltas[0]!.candidateScore).toBeCloseTo(0.75);
  });

  it('shows a REVERTED delta as evidence, not as an absence', () => {
    // The ratchet writes a row either way, and a refusal is the more
    // informative one: it says the candidate beat its bench and still did not
    // beat the incumbent.
    const view = buildLearningView([...trail(), proposed('design-7', 'reverted')]);

    expect(view.deltas).toHaveLength(1);
    expect(view.deltas[0]!.adopted).toBe(false);
    expect(view.deltas[0]!.toVersion).toBeNull();
  });

  it('DISTRACTOR: a delta the ratchet REFUSED to run does not read as adopted', () => {
    // `refused` is the degrade-open outcome the worker records when
    // `proposeDelta` throws — most often R28 AC-2, a design with no validation
    // harness. It is not an adoption and must never render as one.
    const view = buildLearningView([...trail(), proposed('design-7', 'refused', { toVersion: null })]);

    expect(view.deltas[0]!.adopted).toBe(false);
  });

  it('a delta ALONE is learning output', () => {
    // The mutant that leaves `deltas` out of the sum: a mission whose only
    // learning result was a registry decision would render "nothing to show"
    // while holding the most consequential event the loop produces.
    expect(hasLearningOutput(buildLearningView([...trail(), proposed('design-7', 'adopted')]))).toBe(true);
  });

  it('DISTRACTOR: a REJECTED candidate is shown, not filtered out', () => {
    // Every live decision so far is a rejection. A panel that showed only
    // adoptions would render empty and read as "the science loop has done
    // nothing", which is false. `AdoptionDecision`'s own comment makes the
    // argument: a rejected candidate is a measurement, and knowing it failed the
    // held-out slice is the most useful thing about it.
    const view = buildLearningView([...trail(), decided('hf-rejected', false)]);

    expect(view.candidateDecisions.map((d) => d.candidateId)).toContain('hf-rejected');
  });

  it('DISTRACTOR: an ADOPTED candidate reads as adopted — both sides', () => {
    const view = buildLearningView([...trail(), decided('hf-a', true), decided('hf-b', false)]);

    const a = view.candidateDecisions.find((d) => d.candidateId === 'hf-a');
    const b = view.candidateDecisions.find((d) => d.candidateId === 'hf-b');
    expect(a!.adopt).toBe(true);
    expect(b!.adopt).toBe(false);
  });

  it('DISTRACTOR: a science decision is NOT folded into the fast loop ratchet', () => {
    // The two loops run at different speeds against different evidence, and a
    // reader who could not tell them apart would think a bench-verified adoption
    // and an in-mission hot-fix carried the same weight.
    const view = buildLearningView([...trail(), decided('hf-1', true)]);

    expect(view.adoptions, 'a science decision leaked into the fast-loop ratchet').toHaveLength(0);
    expect(view.reverts).toHaveLength(0);
  });

  it('surfaces the weak-spot ranking the whole loop is aimed at', () => {
    const view = buildLearningView([...trail(), ranked(52)]);

    expect(view.rankings).toHaveLength(1);
    expect(view.rankings[0]!.ranked).toBe(52);
    expect(view.rankings[0]!.top[0]!.category).toBe('technical writing');
    expect(view.rankings[0]!.top[0]!.observations).toBe(3);
  });

  it('DISTRACTOR: a mission with no learning output reports empty, not invented', () => {
    const view = buildLearningView(trail());

    expect(view.candidateDecisions).toEqual([]);
    expect(view.rankings).toEqual([]);
  });

  it('DISTRACTOR: a decision with NO adopt flag reads as NOT adopted', () => {
    // Defaulting the other way would show an unrecorded decision as a change the
    // swarm made to itself. Every other fixture sets `adopt` explicitly, so the
    // mutant that flipped `=== true` to `!== false` survived until this existed.
    const view = buildLearningView([
      ...trail(),
      ev('learning.candidate_evaluated', null,
        { reason: 'payload lost the flag', evidence: { candidateId: 'hf-x', wins: 0, losses: 1 } },
        'learning', '2026-07-30T09:04:00.000Z'),
    ]);

    expect(view.candidateDecisions[0]!.adopt).toBe(false);
  });

  it('DISTRACTOR: an ABSENT held-out result is null, not "lost"', () => {
    // Two different findings. `heldOutWon: false` means the candidate FAILED the
    // sealed slice; `null` means no sealed case existed to try it against. The
    // science loop returns null in exactly that case and says so. Collapsing
    // them would report "could not check" as "did not transfer".
    const view = buildLearningView([
      ...trail(),
      ev('learning.candidate_evaluated', null,
        { adopt: false, reason: 'no sealed case', evidence: { candidateId: 'hf-y', wins: 1, losses: 0 } },
        'learning', '2026-07-30T09:04:00.000Z'),
    ]);

    expect(view.candidateDecisions[0]!.heldOutWon).toBeNull();
  });

  it('a mission whose ONLY learning output is a candidate decision is not "nothing to show"', () => {
    const view = buildLearningView([
      ...trail(),
      ev('learning.candidate_evaluated', null,
        { adopt: false, reason: 'r', evidence: { candidateId: 'hf-z', wins: 0, losses: 2, heldOutWon: false } },
        'learning', '2026-07-30T09:04:00.000Z'),
    ]);

    expect(hasLearningOutput(view)).toBe(true);
  });

  it('DISTRACTOR: a mission with no learning output at all IS "nothing to show"', () => {
    // Both sides. A predicate that always returned true would pass the test
    // above and make the empty state unreachable.
    expect(hasLearningOutput(buildLearningView(trail()))).toBe(false);
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
