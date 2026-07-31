/**
 * R31 AC-2 — decomposition templates against a real PostgreSQL.
 *
 * "Templates accumulate evidence and become learnable assets." That is the same
 * earned-permanence shape the design registry has, and the constraints are what
 * make it a rule rather than a habit — so every refusal here PLANTS a row and
 * watches Postgres decline it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DecompositionTemplateRepository } from './decomposition-template-repository.js';
import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;
let templates: DecompositionTemplateRepository;

let seq = 0;
const nextMission = () => `eeeeeeee-ffff-4aaa-8bbb-${(seq += 1).toString(16).padStart(12, '0')}`;

beforeAll(async () => {
  db = await startTestDatabase();
  templates = new DecompositionTemplateRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

describe('R31 AC-2 — a template is remembered and offered for its capability', () => {
  it('remembers a recipe and hands it back for that capability', async () => {
    const capability = 'comparing';
    await templates.remember({
      capability, recipe: 'One subtask per item, then one that compares them.',
      sourceMissionId: nextMission(),
    });

    const found = await templates.forCapability(capability);

    expect(found?.recipe).toBe('One subtask per item, then one that compares them.');
  });

  it('DISTRACTOR: a DIFFERENT capability gets no template', async () => {
    // Templates are per kind of work. Offering a comparison recipe to a
    // summarising task would guide the split with something irrelevant, which is
    // worse than no guidance at all.
    await templates.remember({
      capability: 'listing', recipe: 'One subtask per list entry.', sourceMissionId: nextMission(),
    });

    expect(await templates.forCapability('summarising')).toBeNull();
  });

  it('DISTRACTOR: a DEACTIVATED template is not offered, and the row survives', async () => {
    // Down-weight, never delete. The row keeps its evidence so a later decision
    // can be reconsidered against what actually happened.
    const capability = 'retired-work';
    const t = await templates.remember({
      capability, recipe: 'An old way of splitting.', sourceMissionId: nextMission(),
    });
    await templates.deactivate(t.templateId);

    expect(await templates.forCapability(capability)).toBeNull();
    const { rows } = await db.pool.query(
      'SELECT recipe FROM decomposition_template WHERE template_id = $1', [t.templateId],
    );
    expect(rows[0]?.recipe, 'the template was deleted rather than down-weighted').toBe('An old way of splitting.');
  });
});

describe('R31 AC-2 — templates ACCUMULATE evidence', () => {
  it('folds outcomes into a running mean', async () => {
    const capability = 'accumulating';
    const t = await templates.remember({
      capability, recipe: 'Split by section.', sourceMissionId: nextMission(),
    });

    await templates.recordOutcome(t.templateId, true);
    await templates.recordOutcome(t.templateId, true);
    await templates.recordOutcome(t.templateId, false);

    const after = await templates.forCapability(capability);
    expect(after?.observations).toBe(3);
    expect(after?.score).toBeCloseTo(2 / 3, 5);
  });

  it('records a FAILED split as a failure, not merely as an observation', async () => {
    // Both values, because a recorder that always wrote 1 would show three
    // observations and a perfect score — and would pass a test that only
    // counted observations.
    const capability = 'always-fails';
    const t = await templates.remember({
      capability, recipe: 'A bad way of splitting.', sourceMissionId: nextMission(),
    });

    await templates.recordOutcome(t.templateId, false);

    expect((await templates.forCapability(capability))?.score).toBe(0);
  });

  it('a second distillation does NOT overwrite the incumbent recipe', async () => {
    // The incumbent carries the evidence; the newcomer carries none. Replacing
    // it would reset the record every time the swarm split that kind of work
    // again, and no template would ever accumulate anything.
    const capability = 'stable';
    const first = await templates.remember({
      capability, recipe: 'The proven way.', sourceMissionId: nextMission(),
    });
    await templates.recordOutcome(first.templateId, true);

    const second = await templates.remember({
      capability, recipe: 'A newcomer with no record.', sourceMissionId: nextMission(),
    });

    expect(second.templateId, 'a second row was created for one capability').toBe(first.templateId);
    expect(second.recipe).toBe('The proven way.');
    expect(second.observations, 'the evidence was reset').toBe(1);
  });
});

describe('R31 AC-2 — the store enforces the rules rather than trusting the caller', () => {
  const plant = (over: Record<string, unknown> = {}) => {
    const row = {
      capability: `planted-${(seq += 1)}`,
      recipe: 'Split it somehow.',
      source_mission_id: nextMission(),
      ...over,
    };
    const cols = Object.keys(row);
    return db.pool.query(
      `INSERT INTO decomposition_template (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    );
  };

  it('REFUSES an empty recipe', async () => {
    await expect(plant({ recipe: '   ' })).rejects.toThrow(/decomposition_template_recipe_present/);
  });

  it('REFUSES a second template for the same capability', async () => {
    // Two templates for one kind of work fragment the evidence the template
    // exists to accumulate — the same failure the category taxonomy has when the
    // planner invents a name per task.
    await plant({ capability: 'duplicated' });

    await expect(plant({ capability: 'duplicated' })).rejects.toThrow(
      /decomposition_template_one_per_capability/,
    );
  });

  it('REFUSES a score outside 0..1', async () => {
    await expect(plant({ score: 1.5, observations: 1 })).rejects.toThrow(
      /decomposition_template_score_is_a_rate/,
    );
  });

  it('REFUSES a score with no observations behind it', async () => {
    // A number nobody measured. The mirror case — observations with no score —
    // is a measurement nobody recorded, and the same constraint catches it.
    await expect(plant({ score: 0.9, observations: 0 })).rejects.toThrow(
      /decomposition_template_score_needs_evidence/,
    );
  });

  it('REFUSES observations with no score', async () => {
    await expect(plant({ observations: 4 })).rejects.toThrow(
      /decomposition_template_score_needs_evidence/,
    );
  });
});
