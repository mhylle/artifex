/**
 * R23 — the Asset Registry's ratchet, against a real PostgreSQL.
 *
 * "Only measured wins enter; every entry is versioned. A ratchet: assets advance
 * one validated delta at a time; equal-or-worse reverts automatically;
 * simpler-is-better breaks ties. Every version keyed to the ledger evidence that
 * justified it. Retirement is down-weighting, never deletion; cold assets remain
 * searchable as stepping stones."
 *
 * These are database behaviours — a ratchet that only holds in memory is not a
 * ratchet — so they run against a real database like the rest of this package.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetRegistryRepository } from './asset-registry-repository.js';
import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;
let registry: AssetRegistryRepository;

const CATEGORY = 'drafting.ratchet';
let seq = 0;
const nextId = () => `bbbbbbbb-cccc-4ddd-8eee-${(seq += 1).toString(16).padStart(12, '0')}`;
const EVIDENCE = ['11111111-2222-4333-8444-555555555555'];

beforeAll(async () => {
  db = await startTestDatabase();
  registry = new AssetRegistryRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

/** A design with a measured incumbent score, so the ratchet has something to beat. */
async function provenDesign(score: number, over: { roleInstructions?: string; capabilities?: string[] } = {}) {
  const designId = nextId();
  await registry.upsert({
    designId,
    category: CATEGORY,
    roleInstructions: over.roleInstructions ?? 'Draft the clause carefully and at length.',
    capabilities: over.capabilities ?? ['text', 'citation'],
  });
  await registry.recordOutcome(designId, score);
  return designId;
}

describe('R23 AC-0 — an adoption is an itemized delta keyed to its evidence', () => {
  it('records the delta with the ledger events that justified it', async () => {
    const designId = await provenDesign(0.5);

    const result = await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'Draft the clause.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.9,
    });

    expect(result.outcome).toBe('adopted');
    const deltas = await registry.deltasFor(designId);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.justifiedBy).toEqual(EVIDENCE);
    expect(deltas[0]?.changes).toEqual([{ field: 'roleInstructions', to: 'Draft the clause.' }]);
  });

  it('applies ONLY the fields the delta names — it is not a wholesale rewrite', async () => {
    const designId = await provenDesign(0.4, {
      roleInstructions: 'Original instructions.',
      capabilities: ['text', 'citation', 'tables'],
    });

    await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'Sharper instructions.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.8,
    });

    const after = await registry.findById(designId);
    expect(after?.roleInstructions).toBe('Sharper instructions.');
    // Untouched, because the delta never mentioned it. A wholesale rewrite would
    // have blanked or replaced this.
    expect(after?.capabilities).toEqual(['text', 'citation', 'tables']);
  });

  it('bumps the version by exactly one — assets advance one validated delta at a time', async () => {
    const designId = await provenDesign(0.3);
    const before = await registry.findById(designId);

    await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'Better.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.7,
    });

    expect((await registry.findById(designId))?.version).toBe((before?.version ?? 0) + 1);
  });

  it('DISTRACTOR: a delta with NO evidence is refused — only measured wins enter', async () => {
    const designId = await provenDesign(0.2);

    await expect(
      registry.proposeDelta({
        designId,
        changes: [{ field: 'roleInstructions', to: 'Trust me.' }],
        justifiedBy: [],
        candidateScore: 0.99,
      }),
    ).rejects.toThrow(/evidence/i);

    // ...and nothing moved.
    expect((await registry.findById(designId))?.roleInstructions).not.toBe('Trust me.');
  });
});

describe('R23 AC-1 — the ratchet only turns one way', () => {
  it('a WORSE candidate reverts automatically and the incumbent stands', async () => {
    const designId = await provenDesign(0.8, { roleInstructions: 'Incumbent.' });

    const result = await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'Worse.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.5,
    });

    expect(result.outcome).toBe('reverted');
    expect((await registry.findById(designId))?.roleInstructions).toBe('Incumbent.');
  });

  it('an EQUAL candidate that is not simpler also reverts', async () => {
    // "Equal-or-worse reverts" — equal is not an improvement, and churn without
    // improvement is how a registry fills with noise that later evidence has to
    // be reasoned around.
    const designId = await provenDesign(0.6, { roleInstructions: 'Incumbent.' });

    const result = await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'A much longer restatement of the same thing.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.6,
    });

    expect(result.outcome).toBe('reverted');
    expect((await registry.findById(designId))?.roleInstructions).toBe('Incumbent.');
  });

  it('where two measure EQUAL, the simpler one wins', async () => {
    const designId = await provenDesign(0.6, {
      roleInstructions: 'A long-winded incumbent instruction that says more than it needs to.',
      capabilities: ['text', 'citation', 'tables'],
    });

    const result = await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'Draft it.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.6,
    });

    expect(result.outcome).toBe('adopted');
    expect((await registry.findById(designId))?.roleInstructions).toBe('Draft it.');
  });

  it('a reverted delta is still RECORDED — the attempt is evidence too', async () => {
    // A ratchet that forgets its rejections cannot explain why an asset stopped
    // moving, and the Learning Agent would re-propose the same losing change.
    const designId = await provenDesign(0.9);

    await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'Worse.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.1,
    });

    const deltas = await registry.deltasFor(designId);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.outcome).toBe('reverted');
    expect(deltas[0]?.reason).toMatch(/worse|equal/i);
  });

  it('DISTRACTOR: an UNPROVEN incumbent is beaten by any measured candidate, and says so', async () => {
    // Nothing to beat is not the same as a tie. Treating a null score as 0 would
    // be inventing evidence; treating it as unbeatable would freeze every new
    // design at its first draft.
    const designId = nextId();
    await registry.upsert({
      designId, category: CATEGORY, roleInstructions: 'Never measured.', capabilities: ['text'],
    });

    const result = await registry.proposeDelta({
      designId,
      changes: [{ field: 'roleInstructions', to: 'Measured.' }],
      justifiedBy: EVIDENCE,
      candidateScore: 0.05,
    });

    expect(result.outcome).toBe('adopted');
    expect(result.reason).toMatch(/unproven|no incumbent evidence/i);
  });
});

describe('R23 AC-2 — retirement is down-weighting, never deletion', () => {
  it('a retired design is still returned by a search, ranked below active peers', async () => {
    const retired = await provenDesign(0.95, { roleInstructions: 'Retired but excellent.' });
    const active = await provenDesign(0.10, { roleInstructions: 'Active but mediocre.' });
    await registry.deactivate(retired);

    const found = await registry.search(CATEGORY);
    const ids = found.map((d) => d.designId);

    expect(ids, 'a retired design must remain searchable as a stepping stone').toContain(retired);
    // Down-weighted, not deleted: it ranks below an ACTIVE design even though its
    // score is far higher.
    expect(ids.indexOf(active)).toBeLessThan(ids.indexOf(retired));
    expect(found.find((d) => d.designId === retired)?.retired).toBe(true);
  });

  it('DISTRACTOR: retiring loses none of the evidence — score and observations survive', async () => {
    // Retirement that wiped the score would destroy exactly what makes a cold
    // asset a stepping stone.
    const designId = await provenDesign(0.77);
    const before = await registry.findById(designId);

    await registry.deactivate(designId);
    const after = await registry.findById(designId);

    expect(after?.cladeScore).toBe(before?.cladeScore);
    expect(after?.observations).toBe(before?.observations);
  });

  it('DISTRACTOR: no repository method hard-deletes a registry entry', async () => {
    // The invariant stated as a property of the API surface rather than a habit:
    // if no method can delete, no caller can be the one that does.
    const surface = Object.getOwnPropertyNames(AssetRegistryRepository.prototype);

    expect(surface.filter((m) => /delete|destroy|remove|purge|drop/i.test(m))).toEqual([]);
  });
});
