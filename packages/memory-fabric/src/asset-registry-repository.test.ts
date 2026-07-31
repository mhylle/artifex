/**
 * P6 — the Asset Registry against a real PostgreSQL.
 *
 * The earned-permanence ratchet (invariant #5) is a set of database behaviours:
 * a running clade score, an evidence bar, and down-weighting that never deletes.
 * Mocking those proves nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetRegistryRepository } from './asset-registry-repository.js';
import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;
let registry: AssetRegistryRepository;

const CATEGORY = 'research.sub-question';
let seq = 0;
const nextId = () => `aaaaaaaa-bbbb-4ccc-8ddd-${(seq += 1).toString(16).padStart(12, '0')}`;

beforeAll(async () => {
  db = await startTestDatabase();
  registry = new AssetRegistryRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

describe('reuse-first staffing needs an evidence bar, not just a score', () => {
  it('a brand-new design is a NO-BID — unproven is not the same as bad', async () => {
    const designId = nextId();
    await registry.upsert({ designId, category: CATEGORY, roleInstructions: 'fresh', capabilities: ['a'] });

    expect(await registry.bestForCategory(CATEGORY)).toBeNull();
  });

  it('DISTRACTOR: a single lucky outcome still does not bid', async () => {
    // One audition is not a track record. Without this bar, one good run
    // promotes a design into a permanent default.
    const designId = nextId();
    await registry.upsert({ designId, category: CATEGORY, roleInstructions: 'lucky', capabilities: ['a'] });
    await registry.recordOutcome(designId, 1);

    const best = await registry.bestForCategory(CATEGORY);
    expect(best).toBeNull();
  });

  it('bids once it has enough observations', async () => {
    const designId = nextId();
    await registry.upsert({ designId, category: CATEGORY, roleInstructions: 'proven', capabilities: ['a'] });
    for (const score of [0.9, 0.8, 1]) await registry.recordOutcome(designId, score);

    const best = await registry.bestForCategory(CATEGORY);
    expect(best?.designId).toBe(designId);
    expect(best?.observations).toBe(3);
    expect(best?.cladeScore).toBeCloseTo(0.9, 5);
  });

  it('prefers the better-scoring design among proven ones', async () => {
    const weak = nextId();
    const strong = nextId();
    const category = 'compare.me';
    await registry.upsert({ designId: weak, category, roleInstructions: 'weak', capabilities: [] });
    await registry.upsert({ designId: strong, category, roleInstructions: 'strong', capabilities: [] });
    for (const _ of [0, 1, 2]) await registry.recordOutcome(weak, 0.5);
    for (const _ of [0, 1, 2]) await registry.recordOutcome(strong, 0.95);

    expect((await registry.bestForCategory(category))?.designId).toBe(strong);
  });
});

describe('losers are down-weighted, never deleted (invariant #5)', () => {
  it('deactivating removes a design from bidding but keeps the row and its evidence', async () => {
    const designId = nextId();
    const category = 'deactivate.me';
    await registry.upsert({ designId, category, roleInstructions: 'loser', capabilities: [] });
    for (const _ of [0, 1, 2]) await registry.recordOutcome(designId, 0.9);

    expect((await registry.bestForCategory(category))?.designId).toBe(designId);

    await registry.deactivate(designId);

    expect(await registry.bestForCategory(category)).toBeNull();
    // The evidence survives — the Learning Agent still reasons over it.
    const kept = await registry.findById(designId);
    expect(kept?.active).toBe(false);
    expect(kept?.observations).toBe(3);
    expect(kept?.cladeScore).toBeCloseTo(0.9, 5);
  });
});

/**
 * Defect `6d58e8ef` — found while measuring `e34d178e`, not by inspection.
 *
 * `bestForCategory` filters `active = true`; `knownCapabilities` did not. So a
 * category whose designs are all retired was still offered to the planner as
 * "capabilities the swarm already handles" and to `resolveCapability` as a merge
 * target — and then staffed by asking `bestForCategory`, which returns null for
 * it. A guaranteed no-bid for a name the system itself suggested, and the
 * systematic-no-bid surrender signal counts those.
 *
 * The repository's own comment on `search` already draws the line:
 * `bestForCategory` "answers 'who should do this work' and so must exclude the
 * retired". `knownCapabilities` asks the same question.
 */
describe('knownCapabilities answers "what can be staffed", so the retired are excluded', () => {
  it('drops a category whose only design is retired, and keeps one that can still bid', async () => {
    const retiredOnly = 'known.retired-only';
    const stillLive = 'known.still-live';
    const doomed = nextId();
    const alive = nextId();
    await registry.upsert({ designId: doomed, category: retiredOnly, roleInstructions: 'x', capabilities: [] });
    await registry.upsert({ designId: alive, category: stillLive, roleInstructions: 'y', capabilities: [] });
    for (const _ of [0, 1, 2]) await registry.recordOutcome(doomed, 0.9);
    for (const _ of [0, 1, 2]) await registry.recordOutcome(alive, 0.9);

    // CONTROL: both are offered while both are active, so the exclusion below
    // can only be the retirement and not a query that never saw them.
    const before = await registry.knownCapabilities();
    expect(before, 'CONTROL: the fixture never reached the query').toContain(retiredOnly);
    expect(before).toContain(stillLive);

    await registry.deactivate(doomed);

    const after = await registry.knownCapabilities();
    expect(after, 'a category no design can bid for was still offered').not.toContain(retiredOnly);
    expect(after, 'CONTROL: the live category vanished too — this filters everything').toContain(stillLive);
    // The pairing that matters: whatever is offered must be staffable.
    expect(await registry.bestForCategory(retiredOnly)).toBeNull();
    expect((await registry.bestForCategory(stillLive))?.designId).toBe(alive);
  });

  it('DISTRACTOR: a category stays while ANY design in it is active', async () => {
    // Retirement is per-design. A capability whose first design was down-weighted
    // and replaced is still a capability the swarm handles; excluding it would
    // erase the whole capability the moment the ratchet retired one version.
    const category = 'known.succeeded';
    const predecessor = nextId();
    const heir = nextId();
    await registry.upsert({ designId: predecessor, category, roleInstructions: 'v1', capabilities: [] });
    await registry.upsert({ designId: heir, category, roleInstructions: 'v2', capabilities: [] });
    await registry.deactivate(predecessor);

    expect(await registry.knownCapabilities()).toContain(category);
  });

  it('DISTRACTOR: the evidence ordering counts only observations that can still bid', async () => {
    // The order IS the tie-break for `resolveCapability`, so it has to rank
    // categories by the evidence available to stake a bid. Filtering in HAVING
    // instead of WHERE would keep the category and still sum the retired
    // design's observations — ranking a category above a rival on a track record
    // that can no longer be hired.
    const hollow = 'known.hollowed-out';
    const modest = 'known.modest';
    const retiredStar = nextId();
    const survivor = nextId();
    const rival = nextId();
    await registry.upsert({ designId: retiredStar, category: hollow, roleInstructions: 'star', capabilities: [] });
    await registry.upsert({ designId: survivor, category: hollow, roleInstructions: 'rump', capabilities: [] });
    await registry.upsert({ designId: rival, category: modest, roleInstructions: 'rival', capabilities: [] });
    for (const _ of Array.from({ length: 10 })) await registry.recordOutcome(retiredStar, 0.9);
    await registry.recordOutcome(survivor, 0.9);
    for (const _ of [0, 1, 2, 3, 4]) await registry.recordOutcome(rival, 0.9);

    await registry.deactivate(retiredStar);

    const known = await registry.knownCapabilities();
    expect(known, 'CONTROL: the fixture categories are missing').toEqual(
      expect.arrayContaining([hollow, modest]),
    );
    expect(
      known.indexOf(modest),
      'the hollowed-out category outranked a rival on evidence that cannot bid',
    ).toBeLessThan(known.indexOf(hollow));
  });
});

describe('the clade score is a running mean over its observations', () => {
  it('folds each outcome in incrementally', async () => {
    const designId = nextId();
    await registry.upsert({ designId, category: 'mean.me', roleInstructions: 'x', capabilities: [] });

    const after1 = await registry.recordOutcome(designId, 1);
    expect(after1.cladeScore).toBeCloseTo(1, 5);

    const after2 = await registry.recordOutcome(designId, 0);
    expect(after2.cladeScore).toBeCloseTo(0.5, 5);

    const after3 = await registry.recordOutcome(designId, 0.5);
    expect(after3.cladeScore).toBeCloseTo(0.5, 5);
    expect(after3.observations).toBe(3);
  });

  it('DISTRACTOR: an out-of-range score is refused rather than silently clamped', async () => {
    const designId = nextId();
    await registry.upsert({ designId, category: 'range.me', roleInstructions: 'x', capabilities: [] });

    await expect(registry.recordOutcome(designId, 1.5)).rejects.toThrow(RangeError);
  });

  it('DISTRACTOR: recording against an unknown design fails loudly', async () => {
    await expect(registry.recordOutcome('ffffffff-ffff-4fff-8fff-ffffffffffff', 0.5)).rejects.toThrow(
      /no agent design/i,
    );
  });
});

describe('registration never duplicates a design', () => {
  it('re-registering one id keeps ONE row, and leaves it exactly as it stands', async () => {
    // Rewritten for defect `fe690036`. This previously asserted that
    // re-registration BUMPED the version and overwrote the content — which
    // encoded the defect rather than a requirement. Once staffing began
    // registering every design it authored (R38), an unchanged design was
    // re-registered on every no-bid and climbed v1 → v2 → v3 with no delta, no
    // evidence and no measurement, which is what R23's ratchet exists to
    // prevent.
    //
    // The intent worth keeping is the one in the describe: re-registering an id
    // must not create a second row. That is asserted directly below. The rest
    // now belongs to `proposeDelta`, the only path that carries a measurement.
    const designId = nextId();
    const first = await registry.upsert({ designId, category: 'version.me', roleInstructions: 'v1', capabilities: [] });
    const second = await registry.upsert({ designId, category: 'version.me', roleInstructions: 'v2', capabilities: [] });

    expect(first.version).toBe(1);
    expect(second.version).toBe(1);
    // Not duplicated, and not silently rewritten by an unmeasured second author.
    expect(second.designId).toBe(designId);
    expect(second.roleInstructions).toBe('v1');
  });
});
