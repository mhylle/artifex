/**
 * The planner is graded on a rule nobody tells it.
 *
 * Gate A rejects any leaf that is not atomic — `reviewer.ts` states the bar as
 * "exactly one responsibility with one verifiable outcome" — and the planner's
 * prompts ask only for subtasks that are INDEPENDENT, DISTINCT, and together
 * COVER the objective. Those are different properties: a split can be perfectly
 * distinct and perfectly covering while every leaf bundles three jobs.
 *
 * Observed live on mission `ef7b7b75`, twice in a row, including the re-split
 * that was given the first rejection verbatim:
 *
 *     "Task …c196 is not atomic: The task requires both researching/identifying
 *      chemical concentrations and writing the pseudocode. Researching data and
 *      composing a document are two distinct responsibilities."
 *
 *     "…it functions as a 'research and define' compound task rather than a
 *      single unit of work."
 *
 * The mission surrendered without executing a task. Find-shape (v): a gate that
 * says no, where the rule that would make it say yes is stated only on the
 * judging side.
 *
 * The COUNT probe matters as much as the outline. It decides granularity, and a
 * model that does not know leaves must be single-responsibility picks too few.
 *
 * Prompt wording again — legitimate here for the same reason as the retry
 * framing: the schemas are already right (`SubtaskCount` takes a number,
 * `SubtaskOutline` takes objectives), and what is missing is a constraint, not
 * a shape.
 */
import { describe, expect, it } from 'vitest';

import { createStepwisePlanner } from './planner.js';

function recordingPlanner(count: number) {
  const prompts: { id: string; prompt: string }[] = [];
  const generator = {
    async generate({ probe }: { probe: { schema: unknown; prompt: string } }) {
      const id = (probe.schema as { $id?: string }).$id ?? '';
      prompts.push({ id, prompt: probe.prompt });
      if (id === 'SubtaskCount') return { count };
      if (id === 'SubtaskOutline') return { objectives: ['Alpha piece.', 'Beta piece.'] };
      if (id === 'SingleSubtask') return { objective: 'Gamma piece.' };
      return {};
    },
  };
  const planner = createStepwisePlanner({
    generator, provider: 'ollama', model: 'w',
  } as never);
  return { planner, prompts };
}

const promptFor = (prompts: { id: string; prompt: string }[], id: string): string =>
  prompts.find((p) => p.id === id)?.prompt ?? '';

const CONTRACT = {
  objective: 'Write the differentiation algorithm.',
  // Two criteria, because `propose` partitions them across children when there
  // is more than one — a single-criterion fixture would skip that whole branch
  // and never reach the probes under test.
  acceptanceCriteria: [
    { criterionId: 'c-1', statement: 'The algorithm is given as numbered stages.' },
    { criterionId: 'c-2', statement: 'Each stage names its advance signal.' },
  ],
};

/** "one responsibility" / "single responsibility" / "one verifiable outcome". */
const ATOMICITY = /(one|single) responsibilit|one verifiable outcome/i;

describe('the planner is told the atomicity bar it will be judged against', () => {
  it('states it when asking HOW MANY subtasks', async () => {
    const { planner, prompts } = recordingPlanner(2);

    await planner.propose({ contract: CONTRACT } as never);

    const prompt = promptFor(prompts, 'SubtaskCount');
    expect(prompt, 'the count probe was never sent').not.toBe('');
    expect(prompt).toMatch(ATOMICITY);
  });

  it('states it when asking WHICH subtasks', async () => {
    const { planner, prompts } = recordingPlanner(2);

    await planner.propose({ contract: CONTRACT } as never);

    const prompt = promptFor(prompts, 'SubtaskOutline');
    expect(prompt, 'the outline probe was never sent').not.toBe('');
    expect(prompt).toMatch(ATOMICITY);
  });

  /**
   * The distractor. The existing constraints are what stop the planner
   * returning N restatements of the parent, and a rewrite that swapped one rule
   * for the other would trade this defect for that one.
   */
  it('DISTRACTOR: keeps the distinct-and-covering constraints', async () => {
    const { planner, prompts } = recordingPlanner(2);

    await planner.propose({ contract: CONTRACT } as never);

    const outline = promptFor(prompts, 'SubtaskOutline');
    expect(outline).toMatch(/distinct/i);
    expect(outline).toMatch(/cover/i);
    expect(outline).toMatch(/not a restatement of the whole/i);
  });

  it('DISTRACTOR: still carries the rejection on a re-split', async () => {
    // The atomicity bar is added ALONGSIDE `rejectedBecause`, not instead of
    // it. Losing that would re-open defect `2e79255f`.
    const { planner, prompts } = recordingPlanner(2);

    await planner.propose({
      contract: CONTRACT,
      rejectedBecause: ['Task X is not atomic: it bundles research and writing.'],
    } as never);

    expect(promptFor(prompts, 'SubtaskOutline')).toContain('bundles research and writing');
  });
});
