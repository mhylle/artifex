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

/**
 * R28 AC-0, the DECISION half — defect `e4b171c1`.
 *
 * `cladeScoreFor` was correct, thoroughly tested, and called by NOTHING. The
 * ninth "name in the vocabulary with no behaviour" this project has found.
 * `bestForCategory` — the one place a design's standing decides anything —
 * filtered and ordered on the design's OWN `clade_score` column, so the clade
 * walk existed beside the decision rather than inside it.
 *
 * That is not a cosmetic gap. AC-0 reads: "when its promotion is CONSIDERED,
 * then the DECISION uses a clade score aggregating how its whole lineage
 * performed — not the outcome of one lucky audition." A query nobody calls
 * considers nothing.
 *
 * Measured on the live database before the fix: the first redesigned child ever
 * produced (`6934528b`, parent `6e25f754`) carried `clade_score NULL,
 * observations 0` and was filtered out of every bid — while the walk over its
 * real lineage returned `score 0.452` across `42` observations.
 *
 * ON DISCOUNTING BY GENERATION (ADR-0012): an inherited score is used at FULL
 * weight, with no decay term. The observation weighting already IS the discount,
 * and it is derived from evidence rather than chosen: a child with one run
 * barely moves a parent's thirty-run mean, and as the child earns its own record
 * the mean shifts toward it in proportion to the evidence behind it. A
 * generation-distance factor would be a constant with nothing behind it.
 */
describe('R28 AC-0 — the DECISION uses the clade, not the design own column', () => {
  it('refuses the lucky audition: a flattering short record loses to a better lineage', async () => {
    // The criterion's own words, made into a discriminator. `lucky` has a
    // perfect 3-run audition on top of a lineage that has performed badly 30
    // times; `steady` has a merely decent record and no ancestors.
    //
    // Judged on the OWN column, `lucky` wins outright at 1.0 vs 0.5.
    // Judged on the CLADE, `lucky` is (0.2*30 + 1.0*3)/33 = 0.27 and loses.
    const category = 'clade.decision.lucky';
    const poorLine = await design({ category, runs: Array.from({ length: 30 }, () => ({ score: 0.2, effort: 5 })) });
    const lucky = await design({
      category, parentDesignId: poorLine,
      runs: [{ score: 1, effort: 5 }, { score: 1, effort: 5 }, { score: 1, effort: 5 }],
    });
    const steady = await design({
      category,
      runs: [{ score: 0.5, effort: 5 }, { score: 0.5, effort: 5 }, { score: 0.5, effort: 5 }, { score: 0.5, effort: 5 }],
    });

    const winner = await registry.bestForCategory(category);

    expect(winner?.designId, 'the lucky audition was promoted over the better lineage').toBe(steady);
    expect(winner?.designId).not.toBe(lucky);
  });

  it('a strong lineage carries a design whose own short record understates it', async () => {
    // The same rule in the direction that PRESERVES a design rather than
    // rejecting one. `heir`'s own 3 runs read 0.7; its lineage reads
    // (0.95*30 + 0.7*3)/33 = 0.927 and beats an unrelated 0.8.
    //
    // The ancestor is RETIRED, and that is load-bearing rather than decoration.
    // A first version left it active, and the test passed before any fix — the
    // ancestor simply won on its own 0.95 column and the heir's lineage was
    // never consulted. Retiring it removes it from the bid while leaving its
    // record in the lineage, so the heir can only win by inheriting. Fixed at
    // the fixture, which was the thing that was wrong.
    const category = 'clade.decision.heir';
    const strongLine = await design({ category, runs: Array.from({ length: 30 }, () => ({ score: 0.95, effort: 5 })) });
    await registry.deactivate(strongLine);
    const heir = await design({
      category, parentDesignId: strongLine,
      runs: [{ score: 0.7, effort: 5 }, { score: 0.7, effort: 5 }, { score: 0.7, effort: 5 }],
    });
    const unrelated = await design({
      category,
      runs: [{ score: 0.8, effort: 5 }, { score: 0.8, effort: 5 }, { score: 0.8, effort: 5 }, { score: 0.8, effort: 5 }],
    });

    const winner = await registry.bestForCategory(category);

    expect(winner?.designId, 'the lineage was ignored and the plain 0.8 won').toBe(heir);
    expect(winner?.designId).not.toBe(unrelated);
  });

  it('an UNPROVEN child becomes eligible on its ancestry — the live case', async () => {
    // Exactly the shape the real database produced: zero own observations, no
    // own score, one proven parent. Before the fix this design could never be
    // bid at all, so the redesign the escalation ladder had just produced was
    // dead on arrival.
    //
    // The parent is retired here for the same reason as above — a first version
    // asserted only "not null", which the still-active parent satisfied on its
    // own column, proving nothing about the child. With the incumbent retired
    // the child is the ONLY candidate, so a non-null answer can only mean it
    // became eligible on inherited evidence.
    const category = 'clade.decision.unproven';
    const proven = await design({ category, runs: Array.from({ length: 10 }, () => ({ score: 0.6, effort: 5 })) });
    await registry.deactivate(proven);
    const fresh = await design({ category, parentDesignId: proven });

    expect((await registry.findById(fresh))?.observations, 'fixture is wrong — the child must be unproven').toBe(0);
    expect((await registry.cladeScoreFor(fresh)).observations).toBe(10);

    const winner = await registry.bestForCategory(category);
    expect(winner?.designId, 'a design with a 10-run ancestry was treated as having no record').toBe(fresh);
  });

  it('DISTRACTOR: an unproven child does NOT displace its own proven parent', async () => {
    // The risk the previous test creates. Child and parent share one lineage, so
    // their clade scores are IDENTICAL and the order is a tie — and a tie broken
    // the wrong way would let every redesign instantly evict the incumbent it
    // was derived from, without ever running. Inherited standing gets a design
    // into the room; its own record wins the seat.
    const category = 'clade.decision.incumbent';
    const proven = await design({ category, runs: Array.from({ length: 10 }, () => ({ score: 0.6, effort: 5 })) });
    const fresh = await design({ category, parentDesignId: proven });

    const winner = await registry.bestForCategory(category);

    expect(winner?.designId, 'an unrun redesign evicted the design it was derived from').toBe(proven);
    expect(winner?.designId).not.toBe(fresh);
  });

  it('DISTRACTOR: the evidence bar still bites — a thin LINEAGE is still a no-bid', async () => {
    // Aggregating over ancestors must not become a way to clear a bar nobody
    // earned. Two designs with one run each are still two runs, not proof.
    const category = 'clade.decision.thin';
    const root = await design({ category, runs: [{ score: 0.9, effort: 5 }] });
    await design({ category, parentDesignId: root, runs: [{ score: 0.9, effort: 5 }] });

    expect(await registry.bestForCategory(category), 'a 2-observation lineage cleared a 3-observation bar').toBeNull();
  });

  it('DISTRACTOR: an INACTIVE design is still never bid, whatever its lineage says', async () => {
    // Down-weighting is how this project retires a design (never delete). If the
    // lineage rewrite dropped the `active` filter, a retired design would come
    // back through the front door carrying its ancestors' record.
    const category = 'clade.decision.retired';
    const good = await design({ category, runs: Array.from({ length: 10 }, () => ({ score: 0.95, effort: 5 })) });
    await registry.deactivate(good);

    expect(await registry.bestForCategory(category), 'a retired design was bid again').toBeNull();
  });
});

/**
 * R35 AC-2's data dependency — the ancestor IDs, not just their aggregate score.
 *
 * `independenceViolation` decides whether a verifier may grade a producer by
 * comparing their LINEAGES, and it takes ancestry as a plain list so the
 * decision stays pure. `cladeScoreFor` walks the same ancestors but returns a
 * weighted mean, which answers a different question — so this is a genuinely new
 * query rather than a duplicate of one that exists.
 */
describe('R35 AC-2 — a design ancestor list, for the independence check', () => {
  it('returns every ancestor, nearest first', async () => {
    const grandparent = await design({ runs: [{ score: 0.5, effort: 1 }] });
    const parent = await design({ parentDesignId: grandparent, runs: [{ score: 0.5, effort: 1 }] });
    const child = await design({ parentDesignId: parent, runs: [{ score: 0.5, effort: 1 }] });

    expect(await registry.ancestorsOf(child)).toEqual([parent, grandparent]);
  });

  it('DISTRACTOR: the design itself is NOT in its own ancestor list', async () => {
    // `independenceViolation` already handles identity as its own, differently
    // worded rule ("that is self-review, not verification"). Including self here
    // would make every design its own ancestor and collapse the two messages
    // into one, losing which rule actually fired.
    const solo = await design({ runs: [{ score: 0.5, effort: 1 }] });

    expect(await registry.ancestorsOf(solo)).toEqual([]);
  });

  it('DISTRACTOR: a cycle terminates instead of hanging', async () => {
    // Same argument as the clade query's: ancestry is model-adjacent data, and a
    // cycle must degrade to a finite answer rather than spin inside a live
    // staffing decision.
    const a = await design({ runs: [{ score: 0.5, effort: 1 }] });
    const b = await design({ parentDesignId: a, runs: [{ score: 0.5, effort: 1 }] });
    await registry.reparent(a, b);

    const ancestors = await registry.ancestorsOf(b);

    expect(ancestors).toContain(a);
    expect(ancestors.length).toBeLessThan(5);
  });

  it('DISTRACTOR: an unknown design has no ancestors rather than throwing', async () => {
    // Staffing must not fail because a design id is stale. No ancestry recorded
    // means the identity half of the check still applies and the lineage half
    // simply finds nothing — which is the truth, not an error.
    expect(await registry.ancestorsOf('cccccccc-dddd-4eee-8fff-ffffffffffff')).toEqual([]);
  });
});
