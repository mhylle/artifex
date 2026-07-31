/**
 * Defect 753bc6dd — the Knowledge Commons had no producer.
 *
 * R24 built the store correctly and nothing ever called `submit`, so it was a
 * schema with rules nobody could reach. A finding "originates inside a verified
 * task", and until R40 the only thing a verified task recorded was `{ answer }`
 * — no provenance, no evidence ids, nothing a submission needs.
 *
 * Two judgements worth stating, because both could reasonably go the other way:
 *
 * **What counts as a finding?** The verified deliverable itself, keyed to the
 * objective that produced it. A weaker producer would ask a model to extract
 * "reusable knowledge", which is a new seam, a new failure mode, and a new thing
 * to be wrong about. The store was deliberately built guilty-until-proven-useful
 * — everything lands in quarantine and only a stranger's re-derivation publishes
 * a high-impact claim — so the producer does not have to be a perfect judge of
 * reusability. A parochial claim sits harmlessly in quarantine forever.
 *
 * **Only verified work.** Gate B's pass is the admission ticket. Submitting on
 * execution would fill the commons with exactly the unreviewed output the
 * quarantine exists to keep out.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { publishedLifetimeSeconds, runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '9d4a1c72-3e5f-4b60-8a21-7c0e5d9f3b18';

function mission(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'State the boiling point of water at sea level in Celsius.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The boiling point is stated.' }],
    boundaries: { outOfScope: ['Other liquids.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['m-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

interface Script {
  readonly commons?: MissionSeams['commons'];
  readonly gateBPasses?: boolean;
  /** The blast radius the PLANNER assigns the subtask that does the work. */
  readonly childRisk?: 'low' | 'medium' | 'high';
}

function seams(script: Script = {}): MissionSeams {
  return {
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: 'State the boiling point.',
            category: 'answering',
            acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The boiling point is stated.' }],
            outOfScope: ['Other liquids.'],
            blastRadius: script.childRisk ?? ('low' as const),
            effortShare: 0.9,
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
    // R33's plan audit. Permissive here on purpose: these tests are about other
    // properties, and an explicit permissive judge in a fixture is honest in a
    // way a silently-skipped clause in production never is. The clause itself is
    // exercised in `gate-a-full.test.ts`.
    // R34's intent tier. Permissive here on purpose: these tests are about other
    // properties, and an explicit permissive judge in a fixture is honest in a
    // way a silently-absent tier in production never is. The tier itself is
    // exercised in `gate-b-full.test.ts`.
    intentJudge: {
      async assess() { return { servesIntent: true, detail: 'ok', redFlags: [] }; },
    },
    planJudge: {
      async audit({ children }: { children: readonly { taskId: string }[] }) {
        return { tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })), untestable: [], overlaps: [] };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Answer.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'State it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return {
          deliverable: { answer: '100 degrees Celsius.' },
          actions: [], consulted: [], assumptions: [], effortSpent: 5,
        };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        const met = script.gateBPasses ?? true;
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, met, detail: met ? 'ok' : 'not met',
          })),
          redFlags: [],
        };
      },
    },
    reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
    ...(script.commons === undefined ? {} : { commons: script.commons }),
  };
}

const spyCommons = () => ({ submit: vi.fn(async () => ({ entryId: 'e-1' })) });

describe('defect 753bc6dd — a verified task submits its finding to the commons', () => {
  it('submits after Gate B passes', async () => {
    const commons = spyCommons();

    await runMission(mission(), seams({ commons }), { now: () => AT });

    expect(commons.submit).toHaveBeenCalledTimes(1);
  });

  it('carries the claim and its full provenance — no anonymous knowledge', async () => {
    const commons = spyCommons();

    await runMission(mission(), seams({ commons }), { now: () => AT });

    const [entry] = commons.submit.mock.calls[0]!;
    expect(entry.claim).toContain('100 degrees Celsius');
    expect(entry.provenance.missionId).toBe(MISSION_ID);
    expect(entry.provenance.producedByDesignId).toBeTruthy();
    expect(entry.provenance.verifiedBy).toBe('gate_b');
  });

  it('cites REAL ledger event ids as evidence, so the claim can be traced back', async () => {
    // The store refuses an empty evidence array — a finding with no evidence is
    // a rumour. The ids must be ones actually in this mission's trail, not
    // placeholders, or "traceable" is a word rather than a property.
    const commons = spyCommons();

    const result = await runMission(mission(), seams({ commons }), { now: () => AT });

    const [entry] = commons.submit.mock.calls[0]!;
    const trailIds = new Set(result.trail.map((e) => e.eventId));
    expect(entry.provenance.evidence.length).toBeGreaterThan(0);
    for (const id of entry.provenance.evidence) expect(trailIds).toContain(id);
  });

  it('derives impact from the blast radius of the task that produced the claim', async () => {
    // What being wrong costs is exactly what blastRadius already says. Inventing
    // a second scale would let the two disagree.
    //
    // The CHILD's radius, not the mission's: the claim is one task's verified
    // output, and that task is what carries the risk. A first attempt at this
    // test set the radius on the mission and expected it to propagate — it does
    // not, because the planner assigns each subtask its own. The implementation
    // was right and the test was driving the wrong input; corrected here rather
    // than bent to match, and it now exercises the real path.
    const commons = spyCommons();

    await runMission(mission(), seams({ commons, childRisk: 'high' }), { now: () => AT });

    expect(commons.submit.mock.calls[0]![0].impact).toBe('high');
  });

  it('DISTRACTOR: a medium-risk task is LOW impact — the store has only two levels', async () => {
    // `impact` is a closed set of low|high in the database. Anything that is not
    // high must map to low rather than passing a third value the constraint
    // would reject at insert time, losing the finding entirely.
    const commons = spyCommons();

    await runMission(mission(), seams({ commons, childRisk: 'medium' }), { now: () => AT });

    expect(commons.submit.mock.calls[0]![0].impact).toBe('low');
  });

  it('DISTRACTOR: a FAILED Gate B submits nothing — the commons takes verified work only', async () => {
    // Submitting on execution rather than verification would fill the store with
    // precisely the unreviewed output quarantine exists to keep out.
    const commons = spyCommons();

    await runMission(mission(), seams({ commons, gateBPasses: false }), { now: () => AT });

    expect(commons.submit).not.toHaveBeenCalled();
  });

  /**
   * A stranger re-derives it (R24 AC-1, defect `913ead75`).
   *
   * `corroborate` and `publish` had no caller, and the reason a caller had never
   * been written is that it could not have worked: a claim is the objective
   * followed by the deliverable, so its identity embeds the free-text answer.
   * Measured on the live store — 56 entries, 11 designs, ZERO claims shared by
   * two designs. Two agents who independently find the same fact write different
   * words. Matching must be on the QUESTION.
   */
  const spyStranger = (strangers: Array<{ entryId: string; impact: 'low' | 'high' }> = []) => ({
    submit: vi.fn(async () => ({ entryId: 'e-new' })),
    strangersFor: vi.fn(async () => strangers),
    corroborate: vi.fn(async () => ({ entryId: 'e-1' })),
  });

  it('corroborates a stranger entry on the same question, and records it', async () => {
    const commons = spyStranger([{ entryId: 'e-old', impact: 'high' }]);

    const result = await runMission(mission(), seams({ commons }), { now: () => AT });

    expect(commons.strangersFor, 'the stranger search never ran').toHaveBeenCalled();
    expect(commons.corroborate).toHaveBeenCalledWith('e-old', expect.objectContaining({
      missionId: MISSION_ID,
    }));
    expect(result.trail.some((e) => e.type === 'knowledge.corroborated'),
      'the corroboration happened off-ledger').toBe(true);
  });

  it('searches by the QUESTION and excludes its OWN design', async () => {
    // Both halves of AC-1 in one assertion. Searching by the claim would find
    // nothing at all; searching without excluding the producer would offer the
    // design its own earlier answer, which `corroborate` then refuses — turning
    // an ordinary repeat into a thrown error on the happy path.
    const commons = spyStranger();

    await runMission(mission(), seams({ commons }), { now: () => AT });

    const [question, byDesignId] = commons.strangersFor.mock.calls[0] ?? [];
    expect(question, 'the search was not keyed on the objective').not.toContain('{');
    expect(byDesignId, 'the search did not exclude the producing design').toBeTruthy();
  });

  it('DISTRACTOR: no stranger means nothing is corroborated', async () => {
    // Both sides. A caller that corroborated unconditionally would publish
    // anything one agent asserted twice, which is the whole failure AC-1 names.
    const commons = spyStranger([]);

    const result = await runMission(mission(), seams({ commons }), { now: () => AT });

    expect(commons.corroborate).not.toHaveBeenCalled();
    expect(result.trail.some((e) => e.type === 'knowledge.corroborated')).toBe(false);
  });

  it('DISTRACTOR: a FAILED task corroborates nothing', async () => {
    // Corroboration is re-derivation by a VERIFIED task. An unverified answer
    // agreeing with a quarantined claim is two guesses, not evidence.
    const commons = spyStranger([{ entryId: 'e-old', impact: 'high' }]);

    await runMission(mission(), seams({ commons, gateBPasses: false }), { now: () => AT });

    expect(commons.corroborate).not.toHaveBeenCalled();
  });

  it('DISTRACTOR: a corroboration that THROWS does not cost the mission its work', async () => {
    const commons = {
      submit: vi.fn(async () => ({ entryId: 'e-new' })),
      strangersFor: vi.fn(async () => { throw new Error('commons is down'); }),
      corroborate: vi.fn(),
    };

    const result = await runMission(mission(), seams({ commons } as never), { now: () => AT });

    expect(result.outcome).toBe('delivered');
  });

  /**
   * Publication on corroboration (R24 AC-2, ADR-0018).
   *
   * Corroboration became live in iteration 81 and nothing published, so no entry
   * had ever expired and AC-2's decay path had never run on a real row.
   *
   * The lifetime is scaled by impact, and the SHAPE comes from AC-2's own
   * sentence: "stale certainty is worse than honest absence" is a claim about
   * cost, so where being wrong costs more, stale certainty costs more — a
   * high-impact entry expires SOONER, not later. That is the opposite of the
   * intuitive reading. The magnitudes are a policy choice recorded in ADR-0018.
   */
  const spyPublisher = (strangers: Array<{ entryId: string; impact: 'low' | 'high' }>) => ({
    submit: vi.fn(async () => ({ entryId: 'e-new' })),
    strangersFor: vi.fn(async () => strangers),
    corroborate: vi.fn(async () => ({ entryId: 'e-1' })),
    publish: vi.fn(async () => ({ entryId: 'e-1' })),
  });

  it('publishes a corroborated entry, and records it', async () => {
    const commons = spyPublisher([{ entryId: 'e-old', impact: 'low' }]);

    const result = await runMission(mission(), seams({ commons }), { now: () => AT });

    expect(commons.publish, 'a corroborated entry was never published').toHaveBeenCalled();
    expect(commons.publish.mock.calls[0]?.[0]).toBe('e-old');
    expect(result.trail.some((e) => e.type === 'knowledge.published'),
      'the publication happened off-ledger').toBe(true);
  });

  it('a HIGH-impact entry gets a SHORTER life than a low-impact one', () => {
    // The asymmetry is the whole decision, so it is asserted as a property of
    // the rule rather than left to the caller's arithmetic. Both sides, because
    // a rule returning one constant would pass a one-sided test.
    expect(publishedLifetimeSeconds('high')).toBeLessThan(publishedLifetimeSeconds('low'));
  });

  it('DISTRACTOR: both lifetimes are POSITIVE — the store refuses anything else', () => {
    // `publish` throws on a non-positive ttl. A rule that returned 0 for one
    // impact would turn every publication of that kind into a swallowed error,
    // which reads exactly like "nothing was eligible".
    expect(publishedLifetimeSeconds('low')).toBeGreaterThan(0);
    expect(publishedLifetimeSeconds('high')).toBeGreaterThan(0);
  });

  it('DISTRACTOR: an UNCORROBORATED entry is never published', async () => {
    // "Guilty until proven useful". Publishing on submission would make
    // quarantine a formality for most of the commons, and the store only
    // enforces the stranger bar for HIGH impact — so the caller must hold the
    // line for low impact itself.
    const commons = spyPublisher([]);

    const result = await runMission(mission(), seams({ commons }), { now: () => AT });

    expect(commons.publish).not.toHaveBeenCalled();
    expect(result.trail.some((e) => e.type === 'knowledge.published')).toBe(false);
  });

  it('DISTRACTOR: a publish that THROWS does not cost the mission its work', async () => {
    // Same reason submit and corroborate are swallowed: a knowledge store is a
    // side benefit, and losing verified work to a bookkeeping failure trades the
    // product for the receipt.
    const commons = {
      submit: vi.fn(async () => ({ entryId: 'e-new' })),
      strangersFor: vi.fn(async () => [{ entryId: 'e-old', impact: 'high' as const }]),
      corroborate: vi.fn(async () => ({ entryId: 'e-1' })),
      publish: vi.fn(async () => { throw new Error('commons is down'); }),
    };

    const result = await runMission(mission(), seams({ commons } as never), { now: () => AT });

    expect(result.outcome).toBe('delivered');
  });

  it('DISTRACTOR: a commons that throws does NOT cost the mission its verified work', async () => {
    // A knowledge store is a side benefit. Losing a passed deliverable because a
    // bookkeeping write failed would trade the product for the receipt.
    const commons = { submit: vi.fn(async () => { throw new Error('commons is down'); }) };

    const result = await runMission(mission(), seams({ commons }), { now: () => AT });

    expect(result.outcome).toBe('delivered');
  });

  it('DISTRACTOR: no commons seam at all still runs — every caller predates this', async () => {
    const result = await runMission(mission(), seams(), { now: () => AT });

    expect(result.outcome).toBe('delivered');
  });
});
