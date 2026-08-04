/**
 * A retry must REDO the work, not respond to the review.
 *
 * The retry channel itself works — `priorFindings` reaches the work seam and
 * the rejection is quoted back. But the instruction that followed it was "Fix
 * what is named above before anything else", and a tier-1 model read "fix" as
 * naming the DELIVERABLE. Observed live on mission `ef7b7b75`, second attempt:
 *
 *     redFlag: "The deliverable is not a workflow or algorithm itself; it is
 *               pedagogical feedback on a previous (missing) piece of content.
 *               It describes an algorithm's flaws rather than providing the
 *               actual algorithm requested."
 *
 * The reviewer had said the answer was not a computational algorithm; the retry
 * answered the reviewer instead of the task, and the operator got critique of a
 * document that was never delivered. The first attempt was wrong; the second
 * was not even the right KIND of artefact.
 *
 * **This asserts prompt wording, which is normally the weaker choice.** It is
 * the right one here because the schema is already correct — `AnswerSchema`
 * carries `answer` plus `sections`, and the model filled both; nothing about
 * the shape it was handed invited a critique. What misdirected it was the
 * instruction, so the instruction is what these tests pin.
 */
import { describe, expect, it } from 'vitest';

import { createMissionSeams } from './runtime.js';
import type { StructuredGenerator } from './runtime.js';
import type { WorkerContractView } from '@artifex/shared-types';

const ACTOR = { agentId: 'design-under-test', occurredAt: '2026-07-31T09:00:00.000Z' } as const;

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
  objective: 'Write the differentiation algorithm.',
  acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The algorithm is given as ordered stages.' }],
  boundaries: { outOfScope: ['Sourcing.'], siblingOwners: [] },
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

function recorder(): StructuredGenerator & { prompts: string[]; schemas: unknown[] } {
  const prompts: string[] = [];
  const schemas: unknown[] = [];
  return {
    prompts,
    schemas,
    async generate({ probe }: { probe: { schema: unknown; prompt: string } }) {
      prompts.push(probe.prompt);
      schemas.push(probe.schema);
      return { answer: 'ok' };
    },
  };
}

const workPrompt = (gen: { prompts: string[]; schemas: unknown[] }): string =>
  gen.prompts[gen.schemas.findIndex((s) => (s as { $id?: string }).$id === 'WorkerAnswer')] ?? '';

const REJECTION = 'The output does not serve the parent intent: it is not a computational algorithm.';

describe('a retry is told to redo the work, not to answer the review', () => {
  it('tells the worker to write the deliverable again in full', async () => {
    const gen = recorder();
    const seams = createMissionSeams(gen, MODELS);

    await seams.work.execute({
      contract: view(), restatement: 'Write it.', priorFindings: [REJECTION], ...ACTOR,
    });

    const prompt = workPrompt(gen);
    expect(prompt, 'the work probe was never sent').not.toBe('');
    // The rejection still reaches the worker — that channel is what makes a
    // retry better than a repeat, and this test must not be read as removing it.
    expect(prompt).toContain(REJECTION);
    // And the deliverable is named as the whole artefact, written fresh.
    expect(prompt.toLowerCase()).toMatch(/again|from the beginning|in full/);
  });

  it('forbids describing, critiquing or revising the previous attempt', async () => {
    const gen = recorder();
    const seams = createMissionSeams(gen, MODELS);

    await seams.work.execute({
      contract: view(), restatement: 'Write it.', priorFindings: [REJECTION], ...ACTOR,
    });

    const prompt = workPrompt(gen).toLowerCase();
    // The three things the live failure actually did.
    expect(prompt).toMatch(/do not (describe|critique|revise)/);
    // And WHY, because a bare prohibition is easier to over-apply than a reason:
    // the reader never saw the previous attempt.
    expect(prompt).toMatch(/never seen|has not seen|only what you write/);
  });

  /**
   * The distractor, and the anti-regression half. A first attempt has no prior
   * findings, and must not be handed retry framing — telling a worker not to
   * critique a previous attempt that does not exist spends prompt on a
   * confusion, and "write it again" is false on attempt one.
   */
  it('DISTRACTOR: a FIRST attempt gets no retry framing at all', async () => {
    const gen = recorder();
    const seams = createMissionSeams(gen, MODELS);

    await seams.work.execute({ contract: view(), restatement: 'Write it.', ...ACTOR });

    const prompt = workPrompt(gen);
    expect(prompt, 'the work probe was never sent').not.toBe('');
    expect(prompt).not.toContain('PREVIOUS ATTEMPT');
    expect(prompt.toLowerCase()).not.toMatch(/do not (describe|critique|revise)/);
    // The control: this fixture DOES reach the work probe and carry the task,
    // so the two absences above are absences and not an empty prompt.
    expect(prompt).toContain('Write the differentiation algorithm.');
  });

  it('DISTRACTOR: a blank finding does not trigger retry framing', async () => {
    // `priorFindings: ['']` is what an empty verdict produces. It is not a
    // rejection, and must not put the worker into redo mode.
    const gen = recorder();
    const seams = createMissionSeams(gen, MODELS);

    await seams.work.execute({
      contract: view(), restatement: 'Write it.', priorFindings: ['', '   '], ...ACTOR,
    });

    expect(workPrompt(gen)).not.toContain('PREVIOUS ATTEMPT');
  });
});
