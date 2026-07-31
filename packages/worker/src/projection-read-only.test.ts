/**
 * The WIRED learning projection is read-only (R11 AC-0), proved behaviourally.
 *
 * R11's criterion says: "given the LearningStore projection, when it attempts to
 * write to the ledger, then it has no write capability." `LearningProjection`
 * proves that about itself, and its own test makes the right argument — it hands
 * the projection an object that DOES have `append` and asserts it is never
 * called, because "a type annotation is a promise; an unused capability is
 * evidence."
 *
 * But `LearningProjection` has no production caller (defect `635b7a9f`). The
 * projection the running system actually learns from is `LedgerEvidenceSource`,
 * wired in `index.ts` and in `buildScienceLoop`, and nothing proved the same
 * property about it. A boundary demonstrated only on the component nobody runs
 * is the shape this project keeps finding.
 *
 * So the same argument is made where it now matters. Deliberately behavioural
 * rather than structural: the interfaces already omit `append`, and a test that
 * only checked the types would pass against a source that reached for a wider
 * capability at runtime — which is exactly what a learner that could manufacture
 * its own evidence would do.
 */
import { describe, expect, it } from 'vitest';

import { LedgerEvidenceSource } from './ledger-evidence.js';

const AT = '2026-07-31T09:00:00.000Z';

let seq = 0;
const ev = (type: string, taskId: string, payload: Record<string, unknown>) => ({
  seq: (seq += 1), eventId: `e-${seq}`, missionId: 'm-1', taskId,
  family: 'execution', type, actor: { kind: 'worker', id: 'w', displayName: null },
  payload, occurredAt: AT,
});

/**
 * A ledger that is FULLY capable — append, update, delete — handed to a
 * component that should touch none of them.
 */
function capableLedger() {
  const called: string[] = [];
  return {
    called,
    ledger: {
      async listMissions() {
        called.push('listMissions');
        return [{ missionId: 'm-1', status: 'delivered' as const, escalations: 1 }];
      },
      async replay() {
        called.push('replay');
        return [
          ev('task.contracted', 't-1', { category: 'answering', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-1', { designId: 'd-1', capability: 'answering' }),
          ev('task.executed', 't-1', { deliverable: { answer: 'x' }, effortSpent: 2 }),
          ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
        ];
      },
      // The capabilities a learner must not reach for. Present and working.
      async append() { called.push('append'); },
      async update() { called.push('update'); },
      async delete() { called.push('delete'); },
    },
    designs: {
      async findById() { called.push('findById'); return { category: 'answering' }; },
      async upsert() { called.push('upsert'); return { version: 1 }; },
      async recordOutcome() { called.push('recordOutcome'); },
    },
  };
}

describe('R11 AC-0 — the projection the system actually runs cannot write', () => {
  it('never calls append, update or delete while producing evidence', async () => {
    const { called, ledger, designs } = capableLedger();

    const evidence = await new LedgerEvidenceSource(
      ledger as never, ledger as never, designs as never,
    ).evidenceFor();

    // It must have DONE something, or "no writes" is vacuously true of a
    // component that never ran. This is the control the assertion below rests on.
    expect(evidence.length, 'the projection produced nothing, so the test proves nothing').toBeGreaterThan(0);
    expect(called, 'the projection never read the ledger').toContain('replay');

    expect(called).not.toContain('append');
    expect(called).not.toContain('update');
    expect(called).not.toContain('delete');
  });

  it('does not write to the ASSET REGISTRY either, only reads a design', async () => {
    // The registry is the other store within reach, and it is the one whose
    // rows decide reuse. A learner that could advance a design's version would
    // be grading its own homework in a second place.
    // FIXTURE NOTE: this first reused the shared trail, whose `agent.staffed`
    // carries a `capability` — so the ladder's first rung answered and the
    // design lookup was never reached. The control assertion below caught it,
    // and without that guard the two `not.toContain` checks would have passed
    // against a store nobody touched. The capability is dropped here so the
    // lookup actually runs; the test was wrong, not the source.
    const { called, ledger, designs } = capableLedger();
    const noCapability = {
      ...ledger,
      async replay() {
        called.push('replay');
        return [
          ev('task.contracted', 't-1', { category: 'answering', contract: { budget: { ceiling: 10 } } }),
          ev('agent.staffed', 't-1', { designId: 'd-1' }),
          ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [] }),
        ];
      },
    };

    await new LedgerEvidenceSource(ledger as never, noCapability as never, designs as never).evidenceFor();

    expect(called, 'the design lookup was never used, so this proves nothing').toContain('findById');
    expect(called).not.toContain('upsert');
    expect(called).not.toContain('recordOutcome');
  });

  it('DISTRACTOR: the capable ledger really would record a write if one happened', async () => {
    // Without this, every assertion above would pass against a stub whose
    // `append` was never wired to the recorder — the tracker would be measuring
    // nothing and reporting silence as proof.
    const { called, ledger } = capableLedger();

    await ledger.append();

    expect(called).toContain('append');
  });
});
