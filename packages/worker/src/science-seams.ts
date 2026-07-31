/**
 * The science loop, composed against the real fabric (R27).
 *
 * Kept separate from `worker-seams.ts` because the two are wired at different
 * moments: mission seams are built per mission, while the science loop reads
 * across the whole history and runs experiments outside any one mission.
 *
 * Everything here is an ADAPTER — the decisions live in `science-loop.ts`, the
 * orchestration in `science-runner.ts`, and this file only connects them to the
 * repositories. That separation is why the decisions could be tested and
 * mutation-checked long before a database existed for them.
 */
import { BenchCandidateRunner } from './bench-runner.js';
import type { BenchCase, CaseExecutor, CaseJudge } from './bench-runner.js';
import { LedgerEvidenceSource } from './ledger-evidence.js';
import type { DesignLookup } from './ledger-evidence.js';
import type { MissionIndex, MissionReader } from './ledger-evidence.js';
import { ScienceLoop } from './science-runner.js';
import type { BenchSource } from './science-runner.js';

/** The slice of R25's bench this needs. */
export interface BenchRepository {
  list(filter?: { slice?: 'open' | 'sealed' }): Promise<ReadonlyArray<{
    readonly caseId: string;
    readonly contract: unknown;
    readonly inputs: unknown;
    readonly verifiedOutcome: unknown;
  }>>;
}

/**
 * A bench-backed case store.
 *
 * Loads through `list` rather than per-id `findById`, because the restricted
 * (Learning Agent) reader refuses a sealed id by design (R25 AC-1) — asking it
 * for cases one at a time would turn the seal into an exception storm. `list`
 * simply returns what the caller is allowed to see, which is the same rule
 * expressed as data instead of as errors.
 */
function caseStoreOver(bench: BenchRepository) {
  return {
    async load(caseIds: readonly string[]): Promise<readonly BenchCase[]> {
      const wanted = new Set(caseIds);
      const all = [...(await bench.list({ slice: 'open' })), ...(await bench.list({ slice: 'sealed' }))];
      return all
        .filter((c) => wanted.has(c.caseId))
        .map((c) => ({
          caseId: c.caseId,
          contract: c.contract,
          inputs: c.inputs,
          verifiedOutcome: c.verifiedOutcome,
        }));
    },
  };
}

function benchSourceOver(bench: BenchRepository): BenchSource {
  return {
    async cases(slice) {
      return (await bench.list({ slice })).map((c) => c.caseId);
    },
  };
}

/**
 * Compose the science loop against the real ledger and bench.
 *
 * The executor and judge stay injected: what it means to "run a candidate" is
 * the one thing this file cannot decide, because a candidate is a change to how
 * the swarm works and only the caller knows what change it is testing.
 */
export function buildScienceLoop(deps: {
  readonly index: MissionIndex;
  readonly reader: MissionReader;
  readonly bench: BenchRepository;
  readonly executor: CaseExecutor;
  readonly judge: CaseJudge;
  // Required, so that adding the ladder's registry rung could not leave this
  // path silently resolving every historical task by normalisation alone.
  readonly designs: DesignLookup;
}): ScienceLoop {
  return new ScienceLoop({
    evidence: new LedgerEvidenceSource(deps.index, deps.reader, deps.designs),
    bench: benchSourceOver(deps.bench),
    runner: new BenchCandidateRunner(caseStoreOver(deps.bench), deps.executor, deps.judge),
  });
}
