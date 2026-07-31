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
  open?: { questions: Array<{ criterionId: string; subject: string; question: string }> };
  stakes?: { verdicts: Array<{ index: number; stakes: 'low' | 'high' }> };
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
        ['criterionId', 'subject', 'question'],
      );
    });
  });

  it('attaches the stakes verdict from the SECOND call to the question', async () => {
    const gen = generatorReturning({
      open: { questions: [{ criterionId: 'm-1', subject: 'season', question: 'Which season?' }] },
      stakes: { verdicts: [{ index: 0, stakes: 'low' }] },
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
      open: { questions: [{ criterionId: 'm-1', subject: 'season', question: 'Which season?' }] },
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
      open: { questions: [{ criterionId: 'm-1', subject: 'a', question: 'A?' }, { criterionId: 'm-2', subject: 'b', question: 'B?' }] },
      stakes: { verdicts: [{ index: 0, stakes: 'low' }, { index: 1, stakes: 'high' }] },
    });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions.map((q) => q.stakes)).toEqual(['low', 'high']);
  });

  it('does NOT tell the model to return an empty list — that sentence suppressed everything', async () => {
    // Measured one sentence apart, same schema, same input, four runs each:
    //   WITH "return an empty list ... do not invent":  0/4 runs, 0 questions
    //   WITHOUT it:                                      4/4 runs, 15 questions
    //
    // The guard was carried over from the single-call prompt into the split and
    // re-introduced exactly the conservatism the split existed to remove. The
    // "do not invent" worry is answered by the SECOND call instead: a spurious
    // question rated low is carried rather than blocking, so an over-eager
    // question costs a carried assumption, not a stopped mission.
    //
    // This asserts PROMPT wording rather than schema shape, which is usually the
    // weaker test. Here the prompt IS the thing under test — the schema was
    // already correct and the suppression was entirely in the words.
    const gen = generatorReturning({});
    await seamsWith(gen).interrogator!.assess({ mission: mission() });

    const openPrompt = gen.prompts[0] ?? '';
    expect(openPrompt, 'CONTROL: the open-questions probe never ran').toMatch(/more than one way/i);
    expect(openPrompt).not.toMatch(/empty list/i);
    expect(openPrompt).not.toMatch(/do not invent/i);
  });
});

describe('ddcaa17d — a question carries a RESOLVED criterion id, or none at all', () => {
  it('asks for the criterion as its own field, separate from the human-readable subject', async () => {
    // The schema is the judgement. `about` was described as "the criterion id,
    // OR the name of the field", permitting two key spaces while loadBearingNow
    // handled one; the model took the option the description offered, and every
    // carried assumption came back unmatchable.
    const gen = generatorReturning({});
    await seamsWith(gen).interrogator!.assess({ mission: mission() });

    const openSchema = gen.schemas.find((s) => (s['properties'] as Record<string, unknown>)?.['questions']);
    const items = ((openSchema!['properties'] as Record<string, unknown>)['questions'] as {
      items?: { properties?: Record<string, unknown> };
    }).items;
    expect(Object.keys(items?.properties ?? {})).toEqual(['criterionId', 'subject', 'question']);
  });

  it('resolves a real criterion id and keeps it', async () => {
    const gen = generatorReturning({
      open: { questions: [{ criterionId: 'm-1', subject: 'colour', question: 'Which shade?' }] },
      stakes: { verdicts: [{ index: 0, stakes: 'low' }] },
    });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions[0]?.criterionId).toBe('m-1');
    expect(out.questions[0]?.subject).toBe('colour');
  });

  it('DISTRACTOR: an INVENTED criterion id resolves to null, and the question survives', async () => {
    // Measured before building: with one criterion the model returned a real id
    // 15 times in 16; with two criteria only 8 of 17, the rest labelled
    // "general", "Scope_Note" and the like — genuinely about the request as a
    // whole rather than one criterion.
    //
    // Forcing those onto a criterion would be false precision, and dropping them
    // would lose a real ambiguity. So the question survives with no criterion,
    // and simply never becomes load-bearing.
    const gen = generatorReturning({
      open: { questions: [{ criterionId: 'general', subject: 'scope', question: 'How broad?' }] },
      stakes: { verdicts: [{ index: 0, stakes: 'low' }] },
    });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions, 'an unresolvable question was dropped').toHaveLength(1);
    expect(out.questions[0]?.criterionId, 'an invented id was accepted as real').toBeNull();
    expect(out.questions[0]?.question).toBe('How broad?');
  });

  it('DISTRACTOR: the stakes verdict still attaches when the criterion is unresolvable', async () => {
    // The two calls key on the model's own label, which is the only thing both
    // sides of that exchange share. Resolution against the contract happens
    // after, so an unresolvable question keeps its stakes and can still be
    // carried rather than blocking.
    const gen = generatorReturning({
      open: { questions: [{ criterionId: 'general', subject: 'scope', question: 'How broad?' }] },
      stakes: { verdicts: [{ index: 0, stakes: 'low' }] },
    });

    const out = await seamsWith(gen).interrogator!.assess({ mission: mission() });

    expect(out.questions[0]?.stakes).toBe('low');
  });
});

describe('the stakes exchange is keyed per QUESTION, not per criterion', () => {
  it('gives two questions on the SAME criterion their own verdicts', () => {
    // Found live, in code this iteration introduced. Resolving `criterionId`
    // made every question about one criterion share a key, so the verdict map
    // collapsed and all but one defaulted to `high`. Measured: 16 questions
    // raised across three missions, every one `high`, every one `m-1`, and
    // `intake.assumption_flagged` did not move.
    //
    // Find-shape (k) — two sites keying on different versions of the same
    // thing — in new code, one iteration after the same shape was fixed
    // elsewhere. A criterion is not an identifier for a question.
    const gen = generatorReturning({
      open: {
        questions: [
          { criterionId: 'm-1', subject: 'shade', question: 'Which shade?' },
          { criterionId: 'm-1', subject: 'medium', question: 'Print or screen?' },
        ],
      },
      stakes: { verdicts: [{ index: 0, stakes: 'low' }, { index: 1, stakes: 'high' }] },
    });

    return seamsWith(gen).interrogator!.assess({ mission: mission() }).then((out) => {
      expect(out.questions.map((q) => q.stakes), 'both questions collapsed onto one verdict').toEqual(
        ['low', 'high'],
      );
    });
  });

  it('DISTRACTOR: the stakes schema asks by INDEX, so identity needs no judgement', async () => {
    // The schema is the judgement. Asking the model to re-state which question
    // it is rating invites it to answer with a label, and labels are not unique.
    // An index is unique by construction.
    const gen = generatorReturning({
      open: { questions: [{ criterionId: 'm-1', subject: 's', question: 'Q?' }] },
    });
    await seamsWith(gen).interrogator!.assess({ mission: mission() });

    const stakesSchema = gen.schemas.find((sc) => (sc['properties'] as Record<string, unknown>)?.['verdicts']);
    expect(stakesSchema, 'CONTROL: the stakes probe never ran').toBeDefined();
    const items = ((stakesSchema!['properties'] as Record<string, unknown>)['verdicts'] as {
      items?: { properties?: Record<string, unknown> };
    }).items;
    expect(Object.keys(items?.properties ?? {})).toEqual(['index', 'stakes']);
  });
});
