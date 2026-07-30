/**
 * R40 AC-1 at the REAL seam — the producer, not the plumbing.
 *
 * `contract-ritual.test.ts` proved the mission loop carries an evidence bundle
 * into the ledger. That test injects the bundle. This one asks the opposite
 * question: does the seam Artifex actually runs ever PRODUCE one?
 *
 * It did not. `createMissionSeams` asked the worker model for `{ answer }` and
 * hardcoded `assumptions: []`, so "what it assumed" was structurally empty on
 * every real mission — the field was present and permanently unpopulated,
 * exactly the inert shape logged against the Knowledge Commons. A live mission
 * on 2026-07-30 confirmed it: `task.executed` carried `assumptions: []` for a
 * physics explanation that plainly rests on assumptions.
 *
 * That is why R22 AC-1 ("the requester sees what was assumed") could not be
 * satisfied by plumbing alone, and why defect d0d555db needed a producer.
 *
 * The elicitation is a SECOND probe, not a second field, so that asking for
 * provenance can never cost the deliverable. These tests pin the property "the
 * seam asks, and carries what comes back", never "it asks in one call".
 */
import { describe, expect, it } from 'vitest';

import { createMissionSeams } from './runtime.js';
import type { StructuredGenerator } from './runtime.js';
import type { WorkerContractView } from '@artifex/shared-types';

const MODELS = {
  worker: { provider: 'ollama', model: 'w' },
  evaluator: { provider: 'ollama', model: 'e' },
};

const view = (): WorkerContractView => ({
  taskId: '11111111-2222-4333-8444-555555555555',
  missionId: '11111111-2222-4333-8444-555555555555',
  parentTaskId: null,
  category: 'mission',
  depth: 0,
  objective: 'Explain why a bicycle bell rings.',
  acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The mechanism is explained.' }],
  boundaries: { outOfScope: ['History.'], siblingOwners: [] },
  inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
  dependencies: { consumesTaskIds: [], mayRequest: [] },
  stoppingConditions: {
    doneWhen: ['c-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2,
  },
  budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
  escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
  blastRadius: 'low',
  autonomyDial: 'autonomous',
  createdAt: '2026-07-30T09:00:00.000Z',
});

/**
 * Captures every schema the seam asks for, and replies per schema.
 *
 * Keyed by the schema's `$id` rather than by call order: the point under test is
 * that the seam ASKS for assumptions, not that it asks in a particular
 * position, and an order-keyed double would have to be rewritten every time the
 * seam adds a probe.
 */
function generatorReturning(
  replies: Record<string, unknown>,
): StructuredGenerator & { schemas: unknown[]; prompts: string[] } {
  const schemas: unknown[] = [];
  const prompts: string[] = [];
  return {
    schemas,
    prompts,
    async generate({ probe }) {
      schemas.push(probe.schema);
      prompts.push(probe.prompt);
      const id = (probe.schema as { $id?: string }).$id ?? '';
      return replies[id] ?? {};
    },
  };
}

const ANSWER = 'WorkerAnswer';
const ASSUMPTIONS = 'WorkerAssumptions';

/** The prompt sent alongside a given schema, whichever call it was. */
const promptFor = (gen: { schemas: unknown[]; prompts: string[] }, id: string) =>
  gen.prompts[gen.schemas.findIndex((sc) => (sc as { $id?: string }).$id === id)] ?? '';

const propsOf = (schema: unknown) =>
  Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {});

describe('R40 AC-1 — the real work seam asks the worker what it assumed', () => {
  it('requests assumptions from the model, not just an answer', async () => {
    const gen = generatorReturning({ [ANSWER]: { answer: 'It vibrates.' } });
    const seams = createMissionSeams(gen, MODELS);

    await seams.work.execute({ contract: view(), restatement: 'Explain the ringing.' });

    const asked = gen.schemas.find((sc) => (sc as { $id?: string }).$id === ASSUMPTIONS);
    expect(asked, 'the seam never asked the worker what it assumed').toBeDefined();
    expect(propsOf(asked)).toContain('assumptions');
  });

  it('carries the declared assumptions into the bundle', async () => {
    const gen = generatorReturning({
      [ANSWER]: { answer: 'It vibrates.' },
      [ASSUMPTIONS]: { assumptions: ['Assumed a conventional dome bell rather than an electric one.'] },
    });
    const seams = createMissionSeams(gen, MODELS);

    const out = await seams.work.execute({ contract: view(), restatement: 'Explain the ringing.' });

    expect(out.assumptions).toEqual(['Assumed a conventional dome bell rather than an electric one.']);
  });

  it('tells the worker what an assumption IS — an unasked question it answered for itself', async () => {
    // Without this the field fills with restatements of the task. The prompt has
    // to DEFINE the thing being asked for, or the model returns polite noise.
    //
    // Asserting only that the word "assum" appears was too weak: a mutant that
    // deleted the definition and left the "do not invent assumptions" caveat
    // behind still passed. Fifth surviving mutant to expose an untested claim —
    // the describe promised the prompt teaches the concept, the assertion only
    // checked it mentioned it. So pin both halves: the label the field is
    // returned under, AND the gloss that says what belongs in it.
    const gen = generatorReturning({ [ANSWER]: { answer: 'x' } });
    const seams = createMissionSeams(gen, MODELS);

    await seams.work.execute({ contract: view(), restatement: 'r' });

    expect(promptFor(gen, ASSUMPTIONS)).toMatch(/ASSUMPTIONS/);
    expect(promptFor(gen, ASSUMPTIONS)).toMatch(/left open .*answered/is);
  });

  it('DISTRACTOR: a worker that genuinely assumed nothing reports an empty list, not a fabricated one', async () => {
    // The opposite failure to the empty field: a prompt that demands assumptions
    // gets invented ones, which is worse than silence because they look verified.
    const gen = generatorReturning({ [ANSWER]: { answer: 'x' }, [ASSUMPTIONS]: { assumptions: [] } });
    const seams = createMissionSeams(gen, MODELS);

    const out = await seams.work.execute({ contract: view(), restatement: 'r' });

    expect(out.assumptions).toEqual([]);
  });

  it('DISTRACTOR: the answer still comes through — asking for assumptions must not cost the deliverable', async () => {
    const gen = generatorReturning({
      [ANSWER]: { answer: 'It vibrates.' },
      [ASSUMPTIONS]: { assumptions: ['a'] },
    });
    const seams = createMissionSeams(gen, MODELS);

    const out = await seams.work.execute({ contract: view(), restatement: 'r' });

    expect(out.deliverable).toEqual({ answer: 'It vibrates.' });
  });

  it('DISTRACTOR: eliciting assumptions leaves the answer schema untouched', async () => {
    // The property is isolation: the deliverable's contract with the model must
    // not change because the swarm wants provenance alongside it.
    //
    // This test was first written claiming the single-field schema FIXED tier-1
    // JSON leakage. That was false, and is corrected here rather than deleted: the
    // same corruption reproduced on the single-field schema, so the leak tracks the
    // objective, not the schema width. A test that encodes a wrong cause is worse
    // than no test — it would have shut down the real investigation.
    const gen = generatorReturning({ [ANSWER]: { answer: 'x' } });
    const seams = createMissionSeams(gen, MODELS);

    await seams.work.execute({ contract: view(), restatement: 'r' });

    const answerSchema = gen.schemas.find((sc) => (sc as { $id?: string }).$id === ANSWER);
    expect(propsOf(answerSchema)).toEqual(['answer']);
  });

  it('DISTRACTOR: a model that omits the field is tolerated, not crashed on', async () => {
    // Tier-1 models drop optional fields. Losing the whole deliverable because
    // the assumptions list went missing would trade a real answer for a nicety.
    const gen = generatorReturning({ [ANSWER]: { answer: 'It vibrates.' } });
    const seams = createMissionSeams(gen, MODELS);

    const out = await seams.work.execute({ contract: view(), restatement: 'r' });

    expect(out.deliverable).toEqual({ answer: 'It vibrates.' });
    expect(out.assumptions).toEqual([]);
  });
});
