/**
 * R25 — the replay bench, against a real PostgreSQL.
 *
 * A benchmark exists to score candidate improvements against known ground truth
 * at fixed cost, and that only works while the benchmark is honest. The thing
 * most motivated to make it dishonest is the component being scored — "nothing
 * that optimizes against a benchmark may also own it."
 *
 * So the sealed slice is unreachable through a DATABASE VIEW rather than through
 * a repository method that checks a caller-supplied role. A role check is a
 * convention an optimiser can decline to pass; a view is a missing grant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReplayBenchRepository, SealedBenchAccessError } from './replay-bench-repository.js';
import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;
let bench: ReplayBenchRepository;
/** The reader the Learning Agent gets: bound to the open view, never the table. */
let learningBench: ReplayBenchRepository;

let seq = 0;
const nextId = () => `cccccccc-dddd-4eee-8fff-${(seq += 1).toString(16).padStart(12, '0')}`;

beforeAll(async () => {
  db = await startTestDatabase();
  bench = new ReplayBenchRepository(db.pool);
  learningBench = new ReplayBenchRepository(db.pool, { role: 'learning_agent' });
});

afterAll(async () => {
  await db?.stop();
});

const record = (over: Partial<Parameters<ReplayBenchRepository['record']>[0]> = {}) =>
  bench.record({
    slice: 'open',
    sourceTaskId: nextId(),
    sourceMissionId: nextId(),
    capability: 'answering',
    contract: { objective: 'State a fact.', acceptanceCriteria: [{ criterionId: 'c-1', statement: 'Stated.' }] },
    inputs: { entitlements: [] },
    verifiedOutcome: { answer: '100' },
    evidence: ['11111111-2222-4333-8444-555555555555'],
    ...over,
  });

describe('R25 AC-0 — a case carries contract, inputs and a VERIFIED outcome', () => {
  it('records all three, so a candidate can be scored against known ground truth', async () => {
    const c = await record();

    expect(c.contract).toMatchObject({ objective: 'State a fact.' });
    expect(c.verifiedOutcome).toEqual({ answer: '100' });
    expect(c.inputs).toEqual({ entitlements: [] });
  });

  it('traces back to the task it was distilled from', async () => {
    const sourceTaskId = nextId();

    const c = await record({ sourceTaskId });

    expect(c.sourceTaskId).toBe(sourceTaskId);
  });

  it('DISTRACTOR: a case with NO evidence is refused — unverified ground truth is a guess', async () => {
    // Scoring against a guess is worse than not scoring: it produces a number
    // that looks like a measurement.
    await expect(record({ evidence: [] })).rejects.toThrow(/evidence|verified/i);
  });

  it('DISTRACTOR: the same task cannot be banked twice in one slice', async () => {
    // A duplicated case weights that task twice in every score it appears in.
    const sourceTaskId = nextId();
    await record({ sourceTaskId });

    await expect(record({ sourceTaskId })).rejects.toThrow();
  });

  it('DISTRACTOR: a slice outside the closed set is refused', async () => {
    // A third bench nobody audits is where a case goes to be forgotten.
    await expect(record({ slice: 'private' as never })).rejects.toThrow();
  });
});

describe('R25 AC-1 — the sealed bench is structurally unreachable by the Learning Agent', () => {
  it('serves open cases to the Learning Agent', async () => {
    // The open bench is for optimising against. Refusing everything would make
    // the split pointless rather than protective.
    const c = await record({ slice: 'open' });

    const served = await learningBench.list();

    expect(served.map((x) => x.caseId)).toContain(c.caseId);
  });

  it('does NOT serve sealed cases to the Learning Agent', async () => {
    const sealed = await record({ slice: 'sealed' });

    const served = await learningBench.list();

    expect(served.map((x) => x.caseId)).not.toContain(sealed.caseId);
  });

  it('refuses even an EXPLICIT request for the sealed slice', async () => {
    // Asking politely for the thing you may not have must fail loudly rather
    // than quietly returning nothing — a silent empty result reads as "the
    // sealed bench is empty", which is a different and false claim.
    await expect(learningBench.list({ slice: 'sealed' })).rejects.toBeInstanceOf(SealedBenchAccessError);
  });

  it('refuses to fetch a sealed case by id, even knowing the id', async () => {
    const sealed = await record({ slice: 'sealed' });

    await expect(learningBench.findById(sealed.caseId)).rejects.toBeInstanceOf(SealedBenchAccessError);
  });

  it('DISTRACTOR: the refusal is STRUCTURAL — the learning reader is bound to the open view', async () => {
    // The point of the criterion. A repository method that checks a role is a
    // convention the caller can decline to honour; the enforcement has to be a
    // missing grant rather than a forgotten check.
    //
    // Asserted by reading the source the learning reader is actually bound to,
    // because a test that only calls the API would pass just as well against a
    // role check — and that is precisely the implementation the criterion rules
    // out.
    expect(learningBench.boundTo).toBe('benchmark_case_open');
    expect(bench.boundTo).toBe('benchmark_case');
  });

  it('DISTRACTOR: an unrestricted reader still sees sealed cases — the seal is not deletion', async () => {
    // The Reviewer's calibration and amendment evaluation both need the sealed
    // slice. Making it unreadable by everyone would destroy what it is for.
    const sealed = await record({ slice: 'sealed' });

    expect((await bench.list({ slice: 'sealed' })).map((x) => x.caseId)).toContain(sealed.caseId);
  });
});

describe('R25 AC-2 — the bench is curated, not accumulated', () => {
  it('retires a case whose capability no longer appears in the mission mix', async () => {
    const stale = await record({ capability: 'fax-machine-repair' });

    const retired = await bench.curate({ activeCapabilities: ['answering', 'summarising'] });

    expect(retired.map((r) => r.caseId)).toContain(stale.caseId);
  });

  it('records WHY a case was retired — a silent removal is indistinguishable from hiding it', async () => {
    await record({ capability: 'fax-machine-repair' });

    const [retired] = await bench.curate({ activeCapabilities: ['answering'] });

    expect(retired?.retiredReason).toMatch(/no longer|mix|represent/i);
  });

  it('a retired case is no longer served for scoring', async () => {
    const stale = await record({ capability: 'fax-machine-repair' });
    await bench.curate({ activeCapabilities: ['answering'] });

    expect((await bench.list()).map((c) => c.caseId)).not.toContain(stale.caseId);
  });

  it('DISTRACTOR: a retired case is RETAINED, not deleted', async () => {
    // "Down-weight, never hard-delete" is the same rule the Asset Registry
    // follows. A deleted case takes its history with it, so a later question
    // about why a score moved has no answer.
    const stale = await record({ capability: 'fax-machine-repair' });
    await bench.curate({ activeCapabilities: ['answering'] });

    expect(await bench.findById(stale.caseId)).not.toBeNull();
  });

  it('DISTRACTOR: a case whose capability is STILL active is not retired', async () => {
    // A curation that retired everything would empty the bench at the first run.
    const live = await record({ capability: 'answering' });

    await bench.curate({ activeCapabilities: ['answering'] });

    expect((await bench.list()).map((c) => c.caseId)).toContain(live.caseId);
  });

  it('DISTRACTOR: curating with an EMPTY active set retires nothing', async () => {
    // "No capabilities are active" almost always means the caller could not
    // determine the mission mix, not that the work has genuinely stopped. Acting
    // on it would wipe the bench precisely when the signal is missing.
    const live = await record({ capability: 'answering' });

    const retired = await bench.curate({ activeCapabilities: [] });

    expect(retired).toEqual([]);
    expect((await bench.list()).map((c) => c.caseId)).toContain(live.caseId);
  });

  it('DISTRACTOR: an already-retired case is not retired twice', async () => {
    // Re-retiring would rewrite `retired_at` and lose when it actually happened.
    await record({ capability: 'fax-machine-repair' });
    await bench.curate({ activeCapabilities: ['answering'] });

    expect(await bench.curate({ activeCapabilities: ['answering'] })).toEqual([]);
  });
});
