/**
 * R24 — the Knowledge Commons, against a real PostgreSQL.
 *
 * "Knowledge is guilty until proven useful." The dossier is explicit that this
 * is a functional requirement, not hygiene: measured attacks corrupt shared
 * knowledge stores at poison rates under 0.1% via normal-looking interactions,
 * and a hallucinated fact from one confused worker propagates through retrieval
 * exactly like a poisoned record.
 *
 * The store's rules are database constraints, so these are database behaviours.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KnowledgeCommonsRepository } from './knowledge-commons-repository.js';
import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;
let commons: KnowledgeCommonsRepository;

let seq = 0;
const nextId = () => `dddddddd-eeee-4fff-8aaa-${(seq += 1).toString(16).padStart(12, '0')}`;

const PRODUCER = 'aaaaaaaa-1111-4222-8333-444444444444';
const STRANGER = 'bbbbbbbb-1111-4222-8333-444444444444';

beforeAll(async () => {
  db = await startTestDatabase();
  commons = new KnowledgeCommonsRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

const submit = (over: Partial<Parameters<KnowledgeCommonsRepository['submit']>[0]> = {}) =>
  commons.submit({
    claim: 'A bicycle bell is struck by a spring-loaded hammer.',
    ...over,
    provenance: {
      producedByDesignId: PRODUCER,
      missionId: nextId(),
      evidence: ['11111111-2222-4333-8444-555555555555'],
      verifiedBy: 'gate_b',
      ...over.provenance,
    },
  });

describe('R24 AC-0 — admission is quarantine, and quarantine carries provenance', () => {
  it('a submitted finding lands quarantined, never published', async () => {
    const entry = await submit();

    expect(entry.status).toBe('quarantined');
  });

  it('carries which agent, which mission, which evidence, verified how', async () => {
    const entry = await submit();

    expect(entry.provenance.producedByDesignId).toBe(PRODUCER);
    expect(entry.provenance.evidence).toHaveLength(1);
    expect(entry.provenance.verifiedBy).toBe('gate_b');
    expect(entry.provenance.missionId).toBeTruthy();
  });

  it('is served WITH its unproven label — usable, but never as established fact', async () => {
    const entry = await submit();

    const served = (await commons.retrieve(entry.provenance.missionId))[0];

    expect(served?.label).toBe('unproven');
    // Usable: withholding it entirely would waste work the swarm already paid for.
    expect(served?.current).toBe(true);
  });

  it('DISTRACTOR: a finding with NO evidence is refused — a rumour is not knowledge', async () => {
    await expect(submit({ provenance: { evidence: [] } as never })).rejects.toThrow(/evidence|rumour/i);
  });

  it('DISTRACTOR: there is no admission path that skips quarantine', async () => {
    // A "trusted" flag on admission is the first thing an attacker — or a
    // hurried caller — would reach for. The API surface must not offer one.
    const surface = Object.getOwnPropertyNames(KnowledgeCommonsRepository.prototype);

    expect(surface.filter((m) => /insertPublished|trust|admitDirect/i.test(m))).toEqual([]);
  });
});

describe('R24 AC-1 — a stranger must find it again', () => {
  it('refuses to publish a HIGH-impact finding nobody else re-derived', async () => {
    const entry = await submit({ impact: 'high' });

    await expect(commons.publish(entry.entryId, 3600)).rejects.toThrow(/re-derived|stranger/i);
    expect((await commons.findById(entry.entryId))?.status).toBe('quarantined');
  });

  it('publishes it once a DIFFERENT agent has re-derived it', async () => {
    const entry = await submit({ impact: 'high' });
    await commons.corroborate(entry.entryId, {
      designId: STRANGER,
      missionId: nextId(),
      evidence: ['22222222-3333-4444-8555-666666666666'],
    });

    expect((await commons.publish(entry.entryId, 3600)).status).toBe('published');
  });

  it('DISTRACTOR: the PRODUCING agent cannot corroborate itself', async () => {
    // A second run of the same agent reproducing its own mistake is not
    // evidence — it is the mistake happening twice.
    const entry = await submit({ impact: 'high' });

    await expect(
      commons.corroborate(entry.entryId, {
        designId: PRODUCER,
        missionId: nextId(),
        evidence: ['33333333-4444-4555-8666-777777777777'],
      }),
    ).rejects.toThrow(/produced this finding|stranger/i);
  });

  it('DISTRACTOR: a self-corroboration planted directly in the row does not count', async () => {
    // Found by a surviving mutant. `corroborate()` refuses self-corroboration,
    // so this state cannot arise through the API today — which is exactly why
    // the check inside `publish` was untested. It is the last line, and it has
    // to hold against a direct write, a future bulk import, or a bug upstream:
    // the store's rule is "a stranger found it again", not "corroborate() was
    // polite about it".
    const entry = await submit({ impact: 'high' });
    await db.pool.query(
      `UPDATE knowledge_entry SET corroborations = $2::jsonb WHERE entry_id = $1`,
      [entry.entryId, JSON.stringify([{ designId: PRODUCER, missionId: nextId(), evidence: ['x'] }])],
    );

    await expect(commons.publish(entry.entryId, 3600)).rejects.toThrow(/re-derived|stranger/i);
  });

  it('DISTRACTOR: a LOW-impact finding publishes on its own verified provenance', async () => {
    // Requiring corroboration for everything would mean nothing was ever
    // shared. The impact field exists precisely to say what being wrong costs.
    const entry = await submit({ impact: 'low' });

    expect((await commons.publish(entry.entryId, 3600)).status).toBe('published');
  });
});

describe('R24 AC-2 — knowledge is mortal', () => {
  it('an expired published entry is NOT served as current fact', async () => {
    const entry = await submit();
    await commons.publish(entry.entryId, 1);
    await new Promise((resolve) => { setTimeout(resolve, 1200); });

    const served = (await commons.retrieve(entry.provenance.missionId))[0];

    expect(served?.label).toBe('expired');
    expect(served?.current, 'stale certainty is worse than honest absence').toBe(false);
  });

  it('DISTRACTOR: an UNEXPIRED published entry IS current — expiry is not "always stale"', async () => {
    const entry = await submit();
    await commons.publish(entry.entryId, 3600);

    const served = (await commons.retrieve(entry.provenance.missionId))[0];

    expect(served?.label).toBe('published');
    expect(served?.current).toBe(true);
  });

  it('DISTRACTOR: publishing without a lifetime is impossible', async () => {
    const entry = await submit();

    await expect(commons.publish(entry.entryId, 0)).rejects.toThrow(/lifetime|positive/i);
  });

  it('DISTRACTOR: an expired entry is still RETRIEVABLE, just not current', async () => {
    // Hiding it reads as "nobody ever found this" and invites the same work
    // again. The caller needs to know the claim exists and has lapsed.
    const entry = await submit();
    await commons.publish(entry.entryId, 1);
    await new Promise((resolve) => { setTimeout(resolve, 1200); });

    const served = await commons.retrieve(entry.provenance.missionId);

    expect(served.map((s) => s.entryId)).toContain(entry.entryId);
  });
});
