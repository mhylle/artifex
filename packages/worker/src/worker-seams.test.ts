/**
 * The composition root, asserted.
 *
 * `main()` builds its dependencies inline and then starts a BullMQ consumer, so
 * nothing could test what it wires without booting a worker. That made
 * `index.ts` the least-tested file in the repo AND the one where a single
 * missing argument silently disables a whole feature — which is exactly what
 * happened: `registry` was hard-coded to `{ bestForCategory: () => null }` for
 * the project's entire life (defect `41f7555c`), and the reuse market did
 * nothing while looking implemented.
 *
 * When that was fixed, the "unwired input" mutant — passing `undefined` instead
 * of the real repository — was run as usual and produced only
 * `TS6133: 'assets' is declared but its value is never read`. Incidental: had
 * `assets` been referenced anywhere else, the mutant would have compiled
 * cleanly and no test would have failed.
 *
 * So the assembly is now an exported function, and this is the test that mutant
 * should have failed.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildWorkerSeams } from './worker-seams.js';
import type { WorkerDependencies } from './worker-seams.js';

const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

/** Stand-ins that record what the seams reach for. */
function dependencies() {
  const calls = {
    bestForCategory: [] as string[],
    upsert: [] as string[],
    recordOutcome: [] as Array<{ designId: string; score: number }>,
    submitted: [] as Array<{ claim: string }>,
    replay: [] as string[],
    harnesses: [] as Array<{ checks: string[] } | null>,
    capabilities: 0,
    roleWrites: [] as Array<{ designId: string; roleInstructions: string }>,
    hotFixApplied: [] as Array<{ patchedValue: string }>,
    hotFixResolved: [] as Array<{ revert: boolean }>,
  };

  const deps: WorkerDependencies = {
    generator: { async generate() { return {}; } },
    models: {
      worker: { provider: 'ollama', model: 'qwen3.5:2b' },
      evaluator: { provider: 'ollama', model: 'gemma4:12b' },
    },
    assets: {
      async bestForCategory(category: string) { calls.bestForCategory.push(category); return null; },
      async upsert(input: { designId: string; validationHarness?: { checks: string[] } }) {
      calls.upsert.push(input.designId);
      calls.harnesses.push(input.validationHarness ?? null);
      return { version: 7 };
    },
      async recordOutcome(designId: string, score: number) { calls.recordOutcome.push({ designId, score }); },
      async knownCapabilities() { calls.capabilities += 1; return ['hand tool overview']; },
      async findById(designId: string) { return { designId, roleInstructions: 'Do the work.' }; },
      async setRoleInstructions(designId: string, roleInstructions: string) {
        calls.roleWrites.push({ designId, roleInstructions });
      },
    },
    ledger: {
      async replay() { calls.replay.push(MISSION_ID); return []; },
    },
    commons: {
      async submit(entry: { claim: string }) { calls.submitted.push(entry); return { entryId: 'e-1' }; },
    },
    hotFixes: {
      async apply(input: { patchedValue: string }) { calls.hotFixApplied.push(input); return 'hf-1'; },
      async resolve(input: { revert: boolean }) { calls.hotFixResolved.push(input); },
    },
  };

  return { deps, calls };
}

describe('buildWorkerSeams — the wiring a missing argument would silently disable', () => {
  it('reaches the Asset Registry for a bid', async () => {
    const { deps, calls } = dependencies();

    const seams = buildWorkerSeams(deps, MISSION_ID);
    await seams.registry.bestForCategory('research.sub-question');

    expect(calls.bestForCategory).toEqual(['research.sub-question']);
  });

  it('reaches the Asset Registry to REGISTER, and returns the version it stored', async () => {
    // Registration is idempotent, so the stored version may already have been
    // advanced by the ratchet. Reporting the proposed 1 instead is how the
    // ledger and the registry came to disagree (defect `fe690036`).
    const { deps, calls } = dependencies();

    const seams = buildWorkerSeams(deps, MISSION_ID);
    const stored = await seams.registry.register?.({
      designId: 'dddddddd-eeee-4fff-8aaa-000000000001',
      category: 'research.sub-question',
      roleInstructions: 'Answer it.',
      capabilities: ['text'],
    });

    expect(calls.upsert).toEqual(['dddddddd-eeee-4fff-8aaa-000000000001']);
    expect(stored).toEqual({ version: 7 });
  });

  it('reaches the Asset Registry to record an outcome', async () => {
    const { deps, calls } = dependencies();

    const seams = buildWorkerSeams(deps, MISSION_ID);
    await seams.registry.recordOutcome?.('dddddddd-eeee-4fff-8aaa-000000000001', 1);

    expect(calls.recordOutcome).toEqual([
      { designId: 'dddddddd-eeee-4fff-8aaa-000000000001', score: 1 },
    ]);
  });

  it('DISTRACTOR: the registry is the REAL one, not the null-bidding stub', async () => {
    // The stub that shipped for the project's whole life answered every bid with
    // `null` and had no `register` or `recordOutcome` at all. Asserting those
    // two exist is what distinguishes a wired registry from that placeholder.
    const { deps } = dependencies();

    const seams = buildWorkerSeams(deps, MISSION_ID);

    expect(typeof seams.registry.register, 'a stub has no register').toBe('function');
    expect(typeof seams.registry.recordOutcome, 'a stub has no recordOutcome').toBe('function');
    // Without this the taxonomy cannot converge (R38 AC-0).
    expect(typeof seams.registry.knownCapabilities, 'a stub has no knownCapabilities').toBe('function');
  });

  it('wires the operator control seam to the ledger, not to a permanent "run"', async () => {
    const { deps, calls } = dependencies();

    const seams = buildWorkerSeams(deps, MISSION_ID);
    await seams.control?.check('any-task');

    expect(calls.replay, 'control signals are DERIVED from the trail').not.toHaveLength(0);
  });

  it('DISTRACTOR: the decompose-or-delegate gate is present, so atomization stays a decision', async () => {
    const { deps } = dependencies();

    expect(buildWorkerSeams(deps, MISSION_ID).decompositionGate).toBeDefined();
  });

  it('DISTRACTOR: every seam the loop requires is present — none silently absent', async () => {
    // A missing OPTIONAL seam degrades quietly; a missing required one throws at
    // runtime, in production, mid-mission. Both are worth catching here.
    const { deps } = dependencies();
    const seams = buildWorkerSeams(deps, MISSION_ID);

    for (const name of ['planner', 'coverageJudge', 'registry', 'author', 'clarityJudge', 'work', 'completionJudge', 'reconciler'] as const) {
      expect(seams[name], `seam "${name}" is missing`).toBeDefined();
    }
  });
});

describe('main() uses the assembly rather than duplicating it', () => {
  it('the worker binary imports buildWorkerSeams', async () => {
    // The point of extracting the assembly is that the binary uses it. If
    // `main()` kept its own inline copy, every test above would pass while the
    // deployed process wired something else entirely — the shape of defect
    // `04071ce9`, where the logic was proven end to end and the binary was
    // still a placeholder.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./index.ts', import.meta.url), 'utf8'),
    );

    expect(source).toContain('buildWorkerSeams');
    expect(source, 'the inline stub must be gone').not.toContain('async bestForCategory() { return null; }');
  });
});

describe('the harness reaches the registry (R28 AC-2)', () => {
  it('a registered design carries its validation harness, so it can ever be promoted', async () => {
    // Permanence is decided on harness evidence: a design registered without one
    // is refused by the ratchet forever. Dropping it here would make every
    // specialist the swarm authors permanently unpromotable — silently, since
    // nothing else would look wrong.
    const { deps, calls } = dependencies();

    const seams = buildWorkerSeams(deps, MISSION_ID);
    await seams.registry.register?.({
      designId: 'dddddddd-eeee-4fff-8aaa-000000000002',
      category: 'research.sub-question',
      roleInstructions: 'Answer it.',
      capabilities: ['text'],
      validationHarness: { checks: ['[ac-1] It is answered.'] },
    });

    expect(calls.harnesses).toEqual([{ checks: ['[ac-1] It is answered.'] }]);
  });
});

describe('the author seam composes from the playbook (R38 AC-2)', () => {
  it('produces block-structured instructions, not a template string', async () => {
    // The seam used to return `You answer exactly this task...` regardless of
    // the contract. Asserting the BLOCK STRUCTURE is what distinguishes a
    // composed design from a string with the objective interpolated into it.
    const { deps } = dependencies();
    const seams = buildWorkerSeams(deps, MISSION_ID);

    const design = await seams.author.design({
      contract: {
        category: 'research.sub-question',
        objective: 'Explain how a bicycle bell works.',
        acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Names the mechanism.' }],
        boundaries: { outOfScope: ['No traffic law.'], siblingOwners: [] },
        inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
        stoppingConditions: { doneWhen: [], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
      } as never,
    });

    expect(design.roleInstructions).toContain('OUT OF SCOPE');
    expect(design.roleInstructions).toContain('STOP TRYING IF');
    expect(design.roleInstructions).toContain('Names the mechanism.');
    expect(design.roleInstructions).toContain('No traffic law.');
  });
});

vi.mock('bullmq', () => ({ Worker: class {} }));

/**
 * Defect 753bc6dd — the Knowledge Commons had no producer.
 *
 * The store was built, correct, and unreachable: nothing called `submit`. That
 * is the same failure shape as the Asset Registry above, and it stayed hidden
 * for the same reason — a store with no caller looks exactly like a store with
 * one, from the inside.
 */
describe('buildWorkerSeams — the Knowledge Commons producer', () => {
  it('wires the commons through, so a verified task can submit its finding', async () => {
    const { deps, calls } = dependencies();

    const seams = buildWorkerSeams(deps, MISSION_ID);
    await seams.commons?.submit({
      claim: 'Water boils at 100C at sea level.',
      impact: 'low',
      provenance: {
        producedByDesignId: 'd-1', missionId: MISSION_ID, taskId: 't-1',
        evidence: ['ev-1'], verifiedBy: 'gate_b',
      },
    });

    expect(calls.submitted).toHaveLength(1);
  });

  it('wires the calibration seam, so the reviewer is actually measured (R35)', async () => {
    // `calibration` is optional on MissionSeams, so an unwired one is silent —
    // the mission runs, the reviewer is never measured, and nothing anywhere
    // says so. That is the failure shape `41f7555c` and `753bc6dd` both had.
    const { deps } = dependencies();

    expect(buildWorkerSeams(deps, MISSION_ID).calibration).toBeDefined();
  });

  it('DISTRACTOR: the seam is PRESENT, not merely optional-and-absent', async () => {
    // `commons?.submit(...)` silently does nothing when the seam is missing, so
    // an unwired commons and a working one are indistinguishable at the call
    // site — precisely the mutant that `41f7555c` survived for the registry.
    const { deps } = dependencies();

    expect(buildWorkerSeams(deps, MISSION_ID).commons).toBeDefined();
  });
});

/**
 * R26 — the fast loop is really constructed here (defect `188c6892`).
 *
 * `MissionSeams.fastLoop` is OPTIONAL, which is what let three proven,
 * mutation-tested modules ship with no producer at all. `WorkerDependencies`
 * makes the store required so the deployed binary cannot run without it — and
 * this file is where "required at the composition root" stops being a comment.
 *
 * The same argument as the Asset Registry's, which was a null-bidding stub for
 * the project's entire life with every suite green (defect `41f7555c`).
 */
describe('buildWorkerSeams — the fast loop', () => {
  it('supplies a fastLoop seam at all', async () => {
    const { deps } = dependencies();

    expect(buildWorkerSeams(deps, MISSION_ID).fastLoop, 'the deployed worker has no fast loop').toBeDefined();
  });

  it('applying a hot-fix writes the LOG and then patches the asset', async () => {
    // Both halves, in that order. The log first: if the asset write fails, the
    // log holds an experiment that was never applied and the window closes on a
    // flat rate, which reverts — harmless. The other order would patch the
    // registry with nothing recording what it replaced.
    const { deps, calls } = dependencies();
    const seam = buildWorkerSeams(deps, MISSION_ID).fastLoop!;

    const id = await seam.apply({
      missionId: MISSION_ID, category: 'summarising', criterionId: 'c-1',
      target: { layer: 'worker', kind: 'role_instructions', assetId: 'design-1' },
      previousValue: 'Do the work.', patchedValue: 'Do the work. Check c-1.',
      windowObservations: 4, baselineFailureRate: 0.75,
      predictedFailureRate: 0.75, predictionBasis: 'strict_improvement',
    });

    expect(id).toBe('hf-1');
    expect(calls.hotFixApplied).toHaveLength(1);
    expect(calls.roleWrites).toEqual([{ designId: 'design-1', roleInstructions: 'Do the work. Check c-1.' }]);
  });

  it('a REVERT puts the previous value back', async () => {
    // AC-1's substance at the composition root: the revert is an operation on
    // the real registry, not a note in a log.
    const { deps, calls } = dependencies();
    const seam = buildWorkerSeams(deps, MISSION_ID).fastLoop!;

    await seam.resolve({
      hotFixId: 'hf-1',
      target: { layer: 'worker', kind: 'role_instructions', assetId: 'design-1' },
      previousValue: 'Do the work.',
      revert: true, reason: 'no movement', observedFailureRate: 0.75,
    });

    expect(calls.roleWrites).toEqual([{ designId: 'design-1', roleInstructions: 'Do the work.' }]);
    expect(calls.hotFixResolved).toEqual([{ hotFixId: 'hf-1', revert: true, reason: 'no movement', observedFailureRate: 0.75 }]);
  });

  it('DISTRACTOR: a KEPT hot-fix does not touch the asset again', async () => {
    // Rewriting the patched value on a keep would be harmless today and wrong
    // tomorrow — it would clobber any later patch, and it would make "kept" and
    // "reverted" indistinguishable from the registry's point of view.
    const { deps, calls } = dependencies();
    const seam = buildWorkerSeams(deps, MISSION_ID).fastLoop!;

    await seam.resolve({
      hotFixId: 'hf-1',
      target: { layer: 'worker', kind: 'role_instructions', assetId: 'design-1' },
      previousValue: 'Do the work.',
      revert: false, reason: 'rate fell', observedFailureRate: 0.1,
    });

    expect(calls.roleWrites, 'a kept hot-fix rewrote the asset').toHaveLength(0);
    expect(calls.hotFixResolved[0]!.revert).toBe(false);
  });

  it('DISTRACTOR: a store that declines (one live fix already) does NOT patch the asset', async () => {
    // `apply` returning null is the partial unique index talking — an ordinary
    // bound, not an error. Patching anyway would leave the registry changed with
    // no log entry and therefore nothing able to revert it.
    const { deps, calls } = dependencies();
    deps.hotFixes.apply = async () => null;
    const seam = buildWorkerSeams(deps, MISSION_ID).fastLoop!;

    const id = await seam.apply({
      missionId: MISSION_ID, category: 'summarising', criterionId: 'c-1',
      target: { layer: 'worker', kind: 'role_instructions', assetId: 'design-1' },
      previousValue: 'Do the work.', patchedValue: 'patched',
      windowObservations: 4, baselineFailureRate: 0.75,
      predictedFailureRate: 0.75, predictionBasis: 'strict_improvement',
    });

    expect(id).toBeNull();
    expect(calls.roleWrites, 'the asset was patched with no log entry to revert it').toHaveLength(0);
  });
});

/**
 * R35 AC-1 — probes are really planted (defect `2eeef21f`).
 *
 * `probeMisses` sat correct and unfed since P35 because `probes()` is optional
 * on the seam. `WorkerDependencies.bench` is required for the same reason
 * `commons` and `hotFixes` are: the deployed worker must not run with the
 * reviewer's leniency unmeasured.
 */
describe('buildWorkerSeams — the sealed bench feeds the probes', () => {
  function benched(cases: Array<{ caseId: string; contract: unknown; verifiedOutcome: unknown; retiredAt: string | null }>) {
    const asked: Array<{ slice?: string } | undefined> = [];
    const { deps } = dependencies();
    deps.bench = {
      async list(filter?: { slice?: string }) { asked.push(filter); return cases; },
    };
    return { deps, asked };
  }

  const aCase = (caseId: string, answer: string, retiredAt: string | null = null) => ({
    caseId,
    contract: { objective: `question ${caseId}`, category: 'answering', acceptanceCriteria: [] },
    verifiedOutcome: { answer },
    retiredAt,
  });

  it('supplies a probes() seam at all', async () => {
    const { deps } = benched([]);

    expect(buildWorkerSeams(deps, MISSION_ID).calibration?.probes).toBeDefined();
  });

  it('reads the SEALED slice, never the open one', async () => {
    // The open slice is what the Learning Agent optimises against. Scoring the
    // Reviewer on it would measure how well the reviewer agrees with something
    // already tuned to the reviewer.
    const { deps, asked } = benched([aCase('a', '100'), aCase('b', 'Paris')]);

    await buildWorkerSeams(deps, MISSION_ID).calibration!.probes!();

    expect(asked[0]?.slice, 'the probes were drawn from the wrong slice').toBe('sealed');
  });

  it('plants both directions from two sealed cases', async () => {
    const { deps } = benched([aCase('a', '100'), aCase('b', 'Paris')]);

    const probes = await buildWorkerSeams(deps, MISSION_ID).calibration!.probes!();

    expect(probes.filter((p) => p.expected === 'fail').length, 'no known-bad probe').toBeGreaterThan(0);
    expect(probes.filter((p) => p.expected === 'pass').length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: a RETIRED case is not used as ground truth', async () => {
    // A case that no longer represents the work is not ground truth about the
    // reviewer either. With the only other case retired there is nothing to
    // borrow, so no known-bad probe can be built.
    const { deps } = benched([aCase('a', '100'), aCase('b', 'Paris', '2026-07-01T00:00:00.000Z')]);

    const probes = await buildWorkerSeams(deps, MISSION_ID).calibration!.probes!();

    expect(probes.filter((p) => p.expected === 'fail'), 'a retired case was borrowed from').toHaveLength(0);
    expect(probes.filter((p) => p.expected === 'pass')).toHaveLength(1);
  });

  it('DISTRACTOR: an empty bench yields no probes rather than throwing', async () => {
    // The ordinary state of a young system. The calibration reports none
    // planted; it does not fail the mission.
    const { deps } = benched([]);

    await expect(buildWorkerSeams(deps, MISSION_ID).calibration!.probes!()).resolves.toEqual([]);
  });
});
