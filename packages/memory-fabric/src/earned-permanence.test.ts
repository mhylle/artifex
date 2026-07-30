/**
 * R28 — earned permanence: clade scores, Pareto sets, and the harness rule.
 *
 * "Promotion tracks the performance of a design's whole lineage, not one lucky
 * audition. The Learning Agent keeps Pareto sets per category rather than single
 * champions, down-weights instead of deleting, and a design without a validation
 * harness cannot earn permanence, by rule."
 *
 * The registry's `clade_score` column has carried the comment *"how this LINEAGE
 * has performed, not one audition"* since P6 — but the schema had no ancestry at
 * all, so it was a per-design running mean. Not one lucky audition, certainly;
 * not a clade either. That gap is what this closes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetRegistryRepository } from './asset-registry-repository.js';
import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;
let registry: AssetRegistryRepository;

const CATEGORY = 'permanence.category';
let seq = 0;
const nextId = () => `cccccccc-dddd-4eee-8fff-${(seq += 1).toString(16).padStart(12, '0')}`;
const EVIDENCE = ['22222222-3333-4444-8555-666666666666'];
const HARNESS = { checks: ['[ac-1] It is answered.'] };

beforeAll(async () => {
  db = await startTestDatabase();
  registry = new AssetRegistryRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

/** Registers a design and folds `runs` outcomes into it. */
async function design(opts: {
  parentDesignId?: string;
  harness?: { checks: string[] } | null;
  category?: string;
  runs?: Array<{ score: number; effort: number }>;
}) {
  const designId = nextId();
  await registry.upsert({
    designId,
    category: opts.category ?? CATEGORY,
    roleInstructions: 'Do the work.',
    capabilities: ['text'],
    ...(opts.parentDesignId === undefined ? {} : { parentDesignId: opts.parentDesignId }),
    // `undefined` means "not supplied"; `null` means "explicitly unmeasurable".
    ...(opts.harness === undefined ? { validationHarness: HARNESS } : { validationHarness: opts.harness }),
  });
  for (const run of opts.runs ?? []) {
    await registry.recordOutcome(designId, run.score, run.effort);
  }
  return designId;
}

describe('R28 AC-0 — promotion reads the LINEAGE, not one audition', () => {
  it('aggregates a descendant’s score with its ancestors’', async () => {
    // An ancestor with a long, mediocre record and a descendant with one lucky
    // perfect run. The clade is the whole line, so it lands between them rather
    // than at the descendant's flattering figure.
    const ancestor = await design({ runs: [{ score: 0.2, effort: 5 }, { score: 0.2, effort: 5 }, { score: 0.2, effort: 5 }] });
    const child = await design({ parentDesignId: ancestor, runs: [{ score: 1, effort: 5 }] });

    const clade = await registry.cladeScoreFor(child);

    expect(clade.observations, 'the clade rests on every run in the lineage').toBe(4);
    // (0.2*3 + 1*1) / 4 = 0.4
    expect(clade.score).toBeCloseTo(0.4, 5);
  });

  it('DISTRACTOR: the descendant’s OWN score still reads as its own — the clade does not overwrite it', async () => {
    // Both figures have to survive: the clade decides promotion, the individual
    // score is what a later delta is measured against. Collapsing them would
    // make a design's own record unreadable.
    const ancestor = await design({ runs: [{ score: 0.2, effort: 5 }, { score: 0.2, effort: 5 }, { score: 0.2, effort: 5 }] });
    const child = await design({ parentDesignId: ancestor, runs: [{ score: 1, effort: 5 }] });

    expect((await registry.findById(child))?.cladeScore).toBe(1);
    expect((await registry.cladeScoreFor(child)).score).toBeCloseTo(0.4, 5);
  });

  it('DISTRACTOR: a rootless design’s clade is simply itself — not null, not zero', async () => {
    const orphan = await design({ runs: [{ score: 0.75, effort: 2 }, { score: 0.75, effort: 2 }] });

    const clade = await registry.cladeScoreFor(orphan);

    expect(clade.score).toBeCloseTo(0.75, 5);
    expect(clade.observations).toBe(2);
  });

  it('DISTRACTOR: observation-weighted, so one run cannot outvote a long record', async () => {
    // A plain mean of the two designs' means would give (0.2 + 1) / 2 = 0.6 and
    // let a single run count as much as thirty. Weighting by observations is the
    // difference between a track record and an anecdote.
    const ancestor = await design({ runs: Array.from({ length: 30 }, () => ({ score: 0.2, effort: 5 })) });
    const child = await design({ parentDesignId: ancestor, runs: [{ score: 1, effort: 5 }] });

    const clade = await registry.cladeScoreFor(child);

    expect(clade.score).toBeLessThan(0.3);
    expect(clade.observations).toBe(31);
  });

  it('DISTRACTOR: a lineage cycle terminates instead of hanging', async () => {
    // Ancestry is model-adjacent data. A cycle must degrade to a finite answer,
    // never spin a recursive CTE forever inside a mission.
    const a = await design({ runs: [{ score: 0.5, effort: 1 }] });
    const b = await design({ parentDesignId: a, runs: [{ score: 0.5, effort: 1 }] });
    await registry.reparent(a, b); // a -> b -> a

    const clade = await registry.cladeScoreFor(b);

    expect(clade.observations).toBeGreaterThan(0);
    expect(clade.score).toBeCloseTo(0.5, 5);
  });
});

describe('R28 AC-1 — a Pareto set, not a single champion', () => {
  it('keeps a cheaper-but-adequate design alongside a costlier better one', async () => {
    const category = 'pareto.tradeoff';
    const cheap = await design({ category, runs: [{ score: 0.6, effort: 1 }, { score: 0.6, effort: 1 }] });
    const good = await design({ category, runs: [{ score: 0.9, effort: 9 }, { score: 0.9, effort: 9 }] });

    const front = await registry.paretoFor(category);
    const ids = front.map((d) => d.designId);

    expect(ids, 'the cheap one is not evicted by the better one').toContain(cheap);
    expect(ids, 'the better one is not evicted by the cheaper one').toContain(good);
  });

  it('DISTRACTOR: a design worse on BOTH axes is dominated and excluded', async () => {
    // Without this, "keep everything" would satisfy the test above while making
    // the Pareto set meaningless.
    const category = 'pareto.dominated';
    const good = await design({ category, runs: [{ score: 0.9, effort: 1 }, { score: 0.9, effort: 1 }] });
    const worse = await design({ category, runs: [{ score: 0.4, effort: 8 }, { score: 0.4, effort: 8 }] });

    const ids = (await registry.paretoFor(category)).map((d) => d.designId);

    expect(ids).toContain(good);
    expect(ids, 'cheaper AND better on both axes dominates it').not.toContain(worse);
  });

  it('DISTRACTOR: an UNPROVEN design is not on the front — it is unmeasured, not efficient', async () => {
    const category = 'pareto.unproven';
    const proven = await design({ category, runs: [{ score: 0.5, effort: 4 }] });
    const unproven = await design({ category });

    const ids = (await registry.paretoFor(category)).map((d) => d.designId);

    expect(ids).toContain(proven);
    expect(ids).not.toContain(unproven);
  });

  it('DISTRACTOR: the front is per CATEGORY — a design cannot dominate work it never did', async () => {
    const excellent = await design({ category: 'pareto.alpha', runs: [{ score: 1, effort: 1 }] });
    const modest = await design({ category: 'pareto.beta', runs: [{ score: 0.3, effort: 7 }] });

    const beta = (await registry.paretoFor('pareto.beta')).map((d) => d.designId);

    expect(beta).toContain(modest);
    expect(beta).not.toContain(excellent);
  });
});

describe('R28 AC-2 — no validation harness, no permanence', () => {
  it('refuses to promote a design that carries no harness', async () => {
    const unmeasurable = await design({ harness: null, runs: [{ score: 0.9, effort: 1 }] });

    await expect(
      registry.proposeDelta({
        designId: unmeasurable,
        changes: [{ field: 'roleInstructions', to: 'Even better.' }],
        justifiedBy: EVIDENCE,
        candidateScore: 1,
      }),
    ).rejects.toThrow(/harness/i);
  });

  it('DISTRACTOR: it is refused however WELL it appeared to do', async () => {
    // The rule is about measurability, not performance. A perfect score from an
    // unmeasurable design is precisely the case the rule exists for: the number
    // cannot be trusted, so it must not buy permanence.
    const unmeasurable = await design({ harness: null, runs: [{ score: 1, effort: 1 }, { score: 1, effort: 1 }, { score: 1, effort: 1 }] });

    await expect(
      registry.proposeDelta({
        designId: unmeasurable,
        changes: [{ field: 'roleInstructions', to: 'Flawless.' }],
        justifiedBy: EVIDENCE,
        candidateScore: 1,
      }),
    ).rejects.toThrow(/harness/i);

    expect((await registry.findById(unmeasurable))?.roleInstructions).toBe('Do the work.');
  });

  it('DISTRACTOR: a design WITH a harness is promoted normally — the rule is not "refuse everything"', async () => {
    const measurable = await design({ runs: [{ score: 0.3, effort: 1 }] });

    const result = await registry.proposeDelta({
      designId: measurable,
      changes: [{ field: 'roleInstructions', to: 'Sharper.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.9,
    });

    expect(result.outcome).toBe('adopted');
  });
});
