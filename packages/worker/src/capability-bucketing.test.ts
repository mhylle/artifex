/**
 * The ranker and the registry keyed on different things (defect `340aa7de`).
 *
 * MEASURED against the live ledger before anything was built. Over the same
 * tasks, `task.contracted` carries **31 distinct raw categories** while the
 * designs they staffed carry **22 resolved capabilities**. The collapses are not
 * marginal:
 *
 *     scientific terminology  <- scientific definitions | Scientific Definitions |
 *                                Scientific Terminology | scientific writing |
 *                                Scientific Writing        (5 raw names)
 *     hand tools overview     <- Hand Tool Education | Hand Tools |
 *                                Hand Tools Overview | Woodworking Tools  (4)
 *
 * `staff()` merges those with `resolveCapability`. `LedgerEvidenceSource` then
 * re-splits them, because it buckets on the raw `task.contracted` category. Five
 * buckets of one observation each, where the registry has one design with ten —
 * which is exactly why weak spots report `observations: 1` while the registry
 * has plenty of evidence, and why R29's budget-outlier trigger has never fired.
 *
 * Two sites keying on different versions of the same thing. The fix is to record
 * the RESOLVED capability where the resolution happens, and bucket on that.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { staff } from './agent-creator.js';

const AT = '2026-07-31T09:00:00.000Z';

function contract(category: string): TaskContract {
  return {
    taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
    missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
    parentTaskId: null,
    category, depth: 1,
    objective: 'Define a term.',
    acceptanceCriteria: [{ criterionId: 'c-1', statement: 'It is defined.' }],
    boundaries: { outOfScope: ['Else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['Done.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

const author = { async design() { return { roleInstructions: 'Do it.', capabilities: ['text'] }; } };

const registryKnowing = (known: string[]) => ({
  async bestForCategory() { return null; },
  async register() { return { version: 1 }; },
  async knownCapabilities() { return known; },
});

describe('340aa7de — the manifest reports the RESOLVED capability', () => {
  it('reports what the proposal resolved TO, not what the planner typed', async () => {
    // `staff()` computed `capability` via `resolveCapability` and then put
    // `contract.category` on the manifest — the raw name, discarding the very
    // resolution it had just performed.
    const manifest = await staff({
      contract: contract('Scientific Writing'),
      registry: registryKnowing(['scientific terminology']) as never,
      author,
    });

    expect(manifest.category, 'the manifest carries the raw name, so the resolution is lost').toBe(
      'scientific terminology',
    );
  });

  it('DISTRACTOR: an UNRELATED proposal keeps its own capability', async () => {
    // The rule must not collapse everything. A manifest that always reported the
    // best-known capability would merge genuinely different work into one bucket
    // — the opposite failure, and a worse one, because it would hide real weak
    // spots rather than merely scatter them.
    const manifest = await staff({
      contract: contract('fire safety training'),
      registry: registryKnowing(['scientific terminology']) as never,
      author,
    });

    expect(manifest.category).toBe('fire safety training');
  });

  it('DISTRACTOR: with an EMPTY registry the normalised proposal stands', async () => {
    // A cold registry is the ordinary state of a young system. The manifest must
    // still carry a usable capability rather than nothing.
    const manifest = await staff({
      contract: contract('Scientific Writing'),
      registry: registryKnowing([]) as never,
      author,
    });

    expect(manifest.category).toBe('scientific writing');
  });
});

/**
 * The composition — the resolved capability reaches the ledger and the ranker.
 *
 * `staff()` returning the right value changes nothing on its own: the evidence
 * source reads the LEDGER, and `agent.staffed` recorded a design id and no
 * capability at all (find-shape g — what, but not which). So the capability is
 * now on the event, and the ranker buckets on it.
 *
 * Historical events carry no capability, and there are thousands of them. The
 * fallback to the raw `task.contracted` category is therefore load-bearing, not
 * defensive: without it this change would silently drop every mission recorded
 * before today out of the ranking.
 *
 * NOTE ON THE FIXTURES: the first version of these tests drove a one-argument
 * constructor and a `history()` method. `LedgerEvidenceSource` takes
 * (index, reader) and exposes `evidenceFor()`. They failed against correct code
 * — the tests were wrong, and are corrected here rather than the source.
 */
describe('340aa7de — the capability reaches the ledger and the ranker', () => {
  it('records the resolved capability on agent.staffed', async () => {
    const { runMission } = await import('./mission-loop.js');
    const { seams, mission } = await import('./__fixtures__/calibration-fixture.js');

    const result = await runMission(mission(), seams({}), { now: () => AT });

    const staffed = result.trail.find((e) => e.type === 'agent.staffed');
    expect(staffed?.payload['capability'], 'the ledger records WHICH design but not which capability').toBeTruthy();
  });

  it('the evidence source buckets on the capability when the event carries one', async () => {
    const { LedgerEvidenceSource } = await import('./ledger-evidence.js');

    const source = new LedgerEvidenceSource({
      async listMissions() {
        return [{ missionId: 'm-1', status: 'delivered' as const }];
      },
    } as never, {
      async replay() {
        return [
          ev('task.contracted', 't-1', { category: 'Scientific Writing', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-1', { designId: 'd-1', capability: 'scientific terminology' }),
          ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
          ev('task.contracted', 't-2', { category: 'Scientific Definitions', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-2', { designId: 'd-1', capability: 'scientific terminology' }),
          ev('gate_b.verdict_issued', 't-2', { outcome: 'fail', findings: [] }),
        ] as never;
      },
    } as never);

    const evidence = await source.evidenceFor();

    // ONE bucket, two attempts — not two buckets of one, which is what the raw
    // names would give and what makes every weak spot look like a singleton.
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.category).toBe('scientific terminology');
    expect(evidence[0]?.gateBAttempts).toBe(2);
  });

  it('DISTRACTOR: HISTORICAL events with no capability still rank, on the raw category', async () => {
    // Thousands of events predate this field. Dropping them would empty the
    // ranking to fix its resolution — trading all the evidence for cleaner
    // buckets.
    const { LedgerEvidenceSource } = await import('./ledger-evidence.js');

    const source = new LedgerEvidenceSource({
      async listMissions() {
        return [{ missionId: 'm-1', status: 'delivered' as const }];
      },
    } as never, {
      async replay() {
        return [
          ev('task.contracted', 't-1', { category: 'legacy work', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-1', { designId: 'd-1' }),
          ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
        ] as never;
      },
    } as never);

    const evidence = await source.evidenceFor();

    expect(evidence, 'pre-existing history was dropped from the ranking').toHaveLength(1);
    expect(evidence[0]?.category).toBe('legacy work');
  });

  it('DISTRACTOR: a VERIFIER staffing must not re-bucket the task it verifies', async () => {
    // Checked against the live ledger, because it is a real trap and not a
    // hypothetical: a task carries TWO staffings, and both are keyed on the
    // SAME task id. `categoryOf` is last-write-wins, so if verifier staffing
    // were read here, every verified task would land in a `verification.*`
    // bucket and production evidence would vanish.
    //
    // It does not, because the loop records verifier staffing under its own
    // `verifier.staffed` type. Pinned rather than assumed: nothing else stops a
    // future reader from widening the match to any staffing event.
    const { LedgerEvidenceSource } = await import('./ledger-evidence.js');

    const source = new LedgerEvidenceSource({
      async listMissions() {
        return [{ missionId: 'm-1', status: 'delivered' as const }];
      },
    } as never, {
      async replay() {
        return [
          ev('task.contracted', 't-1', { category: 'scientific writing', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-1', { designId: 'd-1', capability: 'scientific terminology' }),
          ev('verifier.staffed', 't-1', { designId: 'd-2', capability: 'verification.scientific terminology' }),
          ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
        ] as never;
      },
    } as never);

    const evidence = await source.evidenceFor();

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.category, 'the verifier stole the producer bucket').toBe('scientific terminology');
  });

  it('DISTRACTOR: genuinely different capabilities stay in separate buckets', async () => {
    // The opposite failure, and the worse one: collapsing everything would hide
    // real weak spots rather than merely scatter them.
    const { LedgerEvidenceSource } = await import('./ledger-evidence.js');

    const source = new LedgerEvidenceSource({
      async listMissions() {
        return [{ missionId: 'm-1', status: 'delivered' as const }];
      },
    } as never, {
      async replay() {
        return [
          ev('task.contracted', 't-1', { category: 'a', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-1', { designId: 'd-1', capability: 'scientific terminology' }),
          ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
          ev('task.contracted', 't-2', { category: 'b', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-2', { designId: 'd-2', capability: 'fire safety training' }),
          ev('gate_b.verdict_issued', 't-2', { outcome: 'fail', findings: [] }),
        ] as never;
      },
    } as never);

    expect(await source.evidenceFor()).toHaveLength(2);
  });
});

let evSeq = 0;
const ev = (type: string, taskId: string, payload: Record<string, unknown>) => ({
  seq: (evSeq += 1), eventId: `e-${evSeq}`, missionId: 'm-1', taskId,
  family: 'execution', type, actor: { kind: 'worker', id: 'w', displayName: null },
  payload, occurredAt: AT,
});
