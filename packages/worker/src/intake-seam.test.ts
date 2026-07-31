/**
 * Defect `bf766244` — the interrogator asks in TWO calls, not one.
 *
 * The seam produced questions and their stakes in a single probe, and the
 * production prompt told the model to *"ask only about things the request leaves
 * genuinely open"*. Measured over eight requests, that combination raised
 * **zero** questions about anything minor, so `stakes: 'low'` never occurred,
 * `intake.assumption_flagged` stayed at 0 across the whole ledger, and R30 AC-2's
 * given was unreachable in practice.
 *
 * **Both hypotheses were separated before anything changed.** Asked broadly —
 * "anything a reasonable person could interpret in more than one way, however
 * small" — the same model raised **14 questions** on the same three trivial
 * requests. Asked for stakes alone on plainly minor questions, it answered
 * **3 low / 0 high**. So the questions exist and `low` is reachable; one call
 * asking for both made a materiality judgement suppress the very thing the
 * stakes field was there to classify.
 *
 * Splitting them is the same reasoning `AssumptionsSchema` already applies to
 * the worker: a second judgement in one probe competes with the first, so
 * eliciting it separately costs a call and stops it corrupting the answer.
 */
import { describe, expect, it } from 'vitest';

import { createMissionSeams } from './runtime.js';
import type { StructuredGenerator } from './runtime.js';

const MODELS = {
  worker: { provider: 'ollama', model: 'w' },
  evaluator: { provider: 'ollama', model: 'e' },
};

const mission = () => ({
  taskId: '11111111-2222-4333-8444-555555555555',
  missionId: '11111111-2222-4333-8444-555555555555',
  parentTaskId: null, category: 'mission', depth: 0,
  objective: 'Write a haiku about rain',
  acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Produces a haiku about rain' }],
  boundaries: { outOfScope: [], siblingOwners: [] },
  inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
  dependencies: { consumesTaskIds: [], mayRequest: [] },
  stoppingConditions: { doneWhen: ['x'], stopTryingWhen: ['y'], maxAttempts: 3, stallLimit: 2 },
  budget: { floor: 1, ceiling: 10, unit: 'model_calls' },
  escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
  verificationPlan: { depth: 'single', requiredAgreement: null },
  blastRadius: 'low', autonomyDial: 'autonomous', createdAt: '2026-07-31T09:00:00.000Z',
}) as never;

/** Replies per probe, and records the schemas so the SHAPE can be asserted. */
function generatorReturning(replies: {
  open?: { questions: Array<{ about: string; question: string }> };
  stakes?: { verdicts: Array<{ about: string; stakes: 'low' | 'high' }> };
}): StructuredGenerator & { schemas: Array<Record<string, unknown>>; prompts: string[] } {
  const schemas: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];
  return {
    schemas,
    prompts,
    async generate({ probe }: { probe: { schema: unknown; prompt: string } }) {
      const schema = probe.schema as { properties?: Record<string, unknown> };
      schemas.push(schema as Record<string, unknown>);
      prompts.push(probe.prompt);
      if (schema.properties?.['questions'] !== undefined) return replies.open ?? { questions: [] };
      if (schema.properties?.['verdicts'] !== undefined) return replies.stakes ?? { verdicts: [] };
      return {};
    },
  };
}

const seamsWith = (gen: StructuredGenerator) => createMissionSeams(gen, MODELS);

describe('bf766244 — what is open and what it costs are asked separately', () => {
  it('asks for the open questions WITHOUT mentioning stakes in that schema', () => {
    // The heart of it. A `stakes` field alongside the questions is what made the
    // model pre-filter for materiality and answer with nothing at all.
    const gen = generatorReturning({});
    void seamsWith(gen);

    // The schema is inspected rather than the prompt: a field the model is
    // handed is a judgement it will make, whatever the wording says.
    return seamsWith(gen).interrogator!.assess({ mission: mission() }).then(() => {
      const openSchema = gen.schemas.find((s) => (s['properties'] as Record<string, unknown>)?.['questions']);
      expect(openSchema, 'the seam never asked what is open').toBeDefined();
      const props = (openSchema!['properties'] as Record<string, unknown>)['questions'] as {
        items?: { properties?: Record<string, unknown> };
      };
      expect(Object.keys(props.items?.properties ?? {}), 'stakes rode along with the questions').toEqual(
        ['about', 'question'],
      );
    });
  });

  it('attaches the stakes verdict from the SECOND call to the question', async () => {
    const gen = generatorReturning({
      open: { questions: [{ about: 'm-1', question: 'Which season?' }] },
      stakes: { verdicts: [{ about: 'm-1', stakes: 'low' }] },
    });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]?.stakes, 'the stakes verdict never reached the question').toBe('low');
    expect(out.questions[0]?.question).toBe('Which season?');
  });

  it('DISTRACTOR: a question the stakes call did not rule on defaults to HIGH', async () => {
    // Safe direction. An unrated question carried as a low-stakes assumption
    // would be the system assuming away something nobody classified — which is
    // exactly what AC-1 forbids. Blocking is recoverable; silence is not.
    const gen = generatorReturning({
      open: { questions: [{ about: 'm-1', question: 'Which season?' }] },
      stakes: { verdicts: [] },
    });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions[0]?.stakes).toBe('high');
  });

  it('DISTRACTOR: no open questions means the stakes call is never made', async () => {
    // The common case is a well-specified request, and it must not pay for a
    // second probe that has nothing to rule on.
    const gen = generatorReturning({ open: { questions: [] } });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions).toEqual([]);
    expect(
      gen.schemas.some((s) => (s['properties'] as Record<string, unknown>)?.['verdicts']),
      'the stakes probe ran with nothing to rate',
    ).toBe(false);
  });

  it('DISTRACTOR: both verdicts are reachable — the field is not collapsed', async () => {
    // Measured live before this change: 2 questions ever raised, both `high`.
    // The seam must be able to carry either, or `low` is a name with no
    // behaviour however the prompt is worded.
    const gen = generatorReturning({
      open: { questions: [{ about: 'm-1', question: 'A?' }, { about: 'm-2', question: 'B?' }] },
      stakes: { verdicts: [{ about: 'm-1', stakes: 'low' }, { about: 'm-2', stakes: 'high' }] },
    });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions.map((q) => q.stakes)).toEqual(['low', 'high']);
  });
});
