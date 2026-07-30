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
