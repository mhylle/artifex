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
    replay: [] as string[],
  };

  const deps: WorkerDependencies = {
    generator: { async generate() { return {}; } },
    models: {
      worker: { provider: 'ollama', model: 'qwen3.5:2b' },
      evaluator: { provider: 'ollama', model: 'gemma4:12b' },
    },
    assets: {
      async bestForCategory(category: string) { calls.bestForCategory.push(category); return null; },
      async upsert(input: { designId: string }) { calls.upsert.push(input.designId); return { version: 7 }; },
      async recordOutcome(designId: string, score: number) { calls.recordOutcome.push({ designId, score }); },
    },
    ledger: {
      async replay() { calls.replay.push(MISSION_ID); return []; },
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

vi.mock('bullmq', () => ({ Worker: class {} }));
