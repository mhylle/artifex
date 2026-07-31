/**
 * The weak-spot ranking's category, resolved down a STRICT-EVIDENCE ladder
 * (defect `ad116ead`, after its first proposed fix was measured and rejected).
 *
 * The ranking buckets by category. Since `340aa7de`, new events carry the
 * resolved `capability` on `agent.staffed`, but the thousands of events recorded
 * before that fall back to the planner's raw phrasing, so the live ranking still
 * reports 60 buckets with top observations of 1 and 2 — a fragmented signal that
 * nothing downstream can accumulate against.
 *
 * The obvious fix was measured and is NOT built here. Running the historical
 * fallback through `resolveCapability` cuts 105 raw categories to 57, but
 * listing the merges rather than the count shows what those buckets contain:
 *
 *     hand tools overview     <- Rail Travel Overview, Kitchen Tools - Whisk
 *     mechanical engineering  <- Marine Engineering / Sailing Basics
 *     maintenance analysis    <- Complex Analysis / Analytic Number Theory,
 *                                Comparative Analysis / Culinary Logic
 *
 * Merging on the tokens `overview`, `engineering`, `analysis`. That bias is
 * right at STAFFING time — one proposal at a time, with a wrong reuse caught
 * downstream by the evidence bar — and wrong here, because the ranking's entire
 * output is a claim about which capability is weak. A bucket holding hand tools
 * and rail travel makes that claim meaningless, and it would have arrived
 * looking like a 46% improvement.
 *
 * So every rung uses something the system actually RECORDED, and a guess is not
 * a rung:
 *
 *   1. the `capability` on `agent.staffed`  — what staffing resolved, recorded
 *   2. the registered category of `designId` — what staffing resolved, looked up
 *   3. `capabilityOf(raw)`                   — normalisation, not inference
 *
 * Rung 2 is the find-shape (a) catch: `agent.staffed` has carried `designId`
 * since P0 and the ranker never read it. Its reach is bounded and the bound is
 * measured — 140 of 220 historical staffings have no registry row (100 distinct
 * design ids in the ledger against 37 rows), every orphan first seen
 * 2026-07-30 under the old `designIdFor` scheme that mixed in the task id. Rung
 * 3 catches those.
 */
import { describe, expect, it } from 'vitest';

import { LedgerEvidenceSource } from './ledger-evidence.js';

const AT = '2026-07-31T09:00:00.000Z';

let evSeq = 0;
const ev = (type: string, taskId: string, payload: Record<string, unknown>) => ({
  seq: (evSeq += 1), eventId: `e-${evSeq}`, missionId: 'm-1', taskId,
  family: 'execution', type, actor: { kind: 'worker', id: 'w', displayName: null },
  payload, occurredAt: AT,
});

const index = {
  async listMissions() {
    return [{ missionId: 'm-1', status: 'delivered' as const, escalations: 0 }];
  },
};

const readerOf = (events: unknown[]) => ({ async replay() { return events as never; } });

/** The registry rung: design ids the registry knows, and one it does not. */
const designs = {
  async findById(designId: string) {
    return designId === 'd-known' ? { category: 'scientific terminology' } : null;
  },
};

/**
 * NOTE ON THE HELPER: the first version of this returned the SOURCE and every
 * test then asserted `.length` on it, failing with "expected
 * LedgerEvidenceSource{} to have property 'length'". That is a shape a RED run
 * must never be accepted on — it fails for the helper's mistake, not for the
 * missing behaviour. It awaits the query now; the tests were wrong, not the
 * source.
 */
function evidenceOver(events: unknown[]) {
  return new LedgerEvidenceSource(
    index as never, readerOf(events) as never, designs as never,
  ).evidenceFor();
}

describe('ad116ead — the category is resolved down a strict-evidence ladder', () => {
  it('rung 2: falls back to the DESIGN\'s registered category when the event has no capability', async () => {
    // `agent.staffed` has carried `designId` since P0 and the ranker never read
    // it — a declared input carried but never read.
    const evidence = await evidenceOver([
      ev('task.contracted', 't-1', { category: 'Scientific Definitions', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-known' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.category).toBe('scientific terminology');
  });

  it('rung 2 merges two historical tasks the raw names kept apart', async () => {
    // The whole point: two differently-phrased contracts that were staffed by
    // the SAME design are one bucket with two observations, not two singletons.
    const evidence = await evidenceOver([
      ev('task.contracted', 't-1', { category: 'Scientific Definitions', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-known' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
      ev('task.contracted', 't-2', { category: 'Scientific Writing', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-2', { designId: 'd-known' }),
      ev('gate_b.verdict_issued', 't-2', { outcome: 'fail', findings: [] }),
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.gateBAttempts).toBe(2);
  });

  it('rung 2 NORMALISES what the registry stored, so the rungs cannot disagree', async () => {
    // Found live: the ladder returned `Technical Description / Instructional
    // Content` verbatim, because old registry rows predate normalisation. Rung 3
    // normalises and rung 2 did not, so the SAME capability could occupy two
    // buckets depending on which rung reached it — the two-sites-keying-on-
    // different-versions shape, introduced by the ladder itself.
    const stored = {
      async findById() { return { category: 'Technical Description / Instructional Content' }; },
    };
    const events = [
      ev('task.contracted', 't-1', { category: 'raw', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-old' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
    ];

    const evidence = await new LedgerEvidenceSource(
      index as never, readerOf(events) as never, stored as never,
    ).evidenceFor();

    expect(evidence[0]?.category).toBe('technical description');
  });

  it('rung 1 OUTRANKS rung 2 — the recorded capability wins over the lookup', async () => {
    // Withheld case: the design row says something else. The event's own
    // capability is the more direct evidence and must not be overridden by a
    // registry row that may have been re-categorised since.
    const evidence = await evidenceOver([
      ev('task.contracted', 't-1', { category: 'raw name', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-known', capability: 'recorded capability' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
    ]);

    expect(evidence[0]?.category).toBe('recorded capability');
  });

  it('rung 3: an ORPHANED design id normalises the raw name rather than dropping the task', async () => {
    // 140 of 220 live staffings have no registry row. Dropping them would empty
    // the ranking to improve its resolution.
    const evidence = await evidenceOver([
      ev('task.contracted', 't-1', { category: 'Hand Tools Overview', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-orphan' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.category).toBe('hand tools overview');
  });

  it('rung 3 merges pure CASE variants, which is normalisation and not inference', async () => {
    const evidence = await evidenceOver([
      ev('task.contracted', 't-1', { category: 'Hand Tools Overview', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-orphan' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
      ev('task.contracted', 't-2', { category: 'hand tools overview', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-2', { designId: 'd-orphan' }),
      ev('gate_b.verdict_issued', 't-2', { outcome: 'fail', findings: [] }),
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.gateBAttempts).toBe(2);
  });

  it('DISTRACTOR: the ladder never INFERS — two capabilities sharing a token stay apart', async () => {
    // This is the rejected fix, asserted as a property rather than described in
    // a comment. `resolveCapability` would merge these on the token `overview`.
    // If a future change adds it as a rung, this test fails.
    const evidence = await evidenceOver([
      ev('task.contracted', 't-1', { category: 'Hand Tools Overview', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-orphan' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
      ev('task.contracted', 't-2', { category: 'Rail Travel Overview', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-2', { designId: 'd-orphan' }),
      ev('gate_b.verdict_issued', 't-2', { outcome: 'fail', findings: [] }),
    ]);

    expect(evidence.map((e) => e.category).sort()).toEqual(['hand tools overview', 'rail travel overview']);
  });

  it('DISTRACTOR: a task with no staffing at all still ranks on its normalised raw name', async () => {
    // A task can be contracted and fail Gate A before anything is staffed. That
    // is exactly the kind of weak spot the ranking exists to surface, so it must
    // not vanish for lack of an `agent.staffed` event.
    const evidence = await evidenceOver([
      ev('task.contracted', 't-1', { category: 'Technical Writing / Tool Identification', contract: { budget: { ceiling: 10 } } }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.category).toBe('technical writing');
  });

  it('DISTRACTOR: the registry is consulted ONCE per design id, not once per event', async () => {
    // The lookup is a database round-trip inside a loop over every event of
    // every finished mission. Without memoisation this turns the learning pass
    // into an N-query scan that grows with the ledger.
    let calls = 0;
    const counting = {
      async findById() { calls += 1; return { category: 'scientific terminology' }; },
    };
    const events = [
      ev('task.contracted', 't-1', { category: 'a', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-1', { designId: 'd-known' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
      ev('task.contracted', 't-2', { category: 'b', contract: { budget: { ceiling: 10 } } }),
      ev('agent.staffed', 't-2', { designId: 'd-known' }),
      ev('gate_b.verdict_issued', 't-2', { outcome: 'fail', findings: [] }),
    ];

    await new LedgerEvidenceSource(index as never, readerOf(events) as never, counting as never).evidenceFor();

    expect(calls).toBe(1);
  });
});
