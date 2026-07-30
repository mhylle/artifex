/**
 * The composition root's assembly, extracted so it can be asserted.
 *
 * `main()` used to build this inline and then start a BullMQ consumer, so
 * nothing could test what it wired without booting a worker. That made
 * `index.ts` simultaneously the least-tested file in the repo and the one where
 * a single missing argument disables a whole feature — which is not theoretical:
 * the Asset Registry was hard-coded to a null-bidding stub for the project's
 * entire life (defect `41f7555c`), so the reuse market did nothing while looking
 * implemented, and no test could have noticed.
 *
 * Everything here is structural — the worker still depends on no database
 * driver. `WorkerDependencies` names only the shapes it needs, so the real
 * repositories satisfy it without this module importing them.
 */
import type { RegisteredDesign } from './agent-creator.js';
import type { KnowledgeCommonsSubmitter, MissionSeams } from './mission-loop.js';
import type { StructuredGenerator } from './planner.js';
import { createLedgerControl, createMissionSeams } from './runtime.js';
import type { ControlReader, RuntimeModels } from './runtime.js';

/** The slice of the Asset Registry the worker binds to. */
export interface AssetStore {
  bestForCategory(category: string): Promise<RegisteredDesign | null>;
  upsert(input: {
    readonly designId: string;
    readonly category: string;
    readonly roleInstructions: string;
    readonly capabilities: string[];
    readonly validationHarness?: { readonly checks: string[] };
  }): Promise<{ readonly version: number }>;
  recordOutcome(designId: string, score: number, effort?: number): Promise<unknown>;
  knownCapabilities(): Promise<string[]>;
}

export interface WorkerDependencies {
  readonly generator: StructuredGenerator;
  readonly models: RuntimeModels;
  readonly assets: AssetStore;
  /** Read-only: the control seam DERIVES operator signals from the trail. */
  readonly ledger: ControlReader;
  /**
   * The Knowledge Commons (defect `753bc6dd`).
   *
   * The store shipped correct and unreachable — nothing called `submit`, which
   * is the same failure the Asset Registry had and just as invisible from the
   * inside. Required here rather than optional so a missing commons is a
   * compile error at the composition root instead of a silently inert store.
   */
  readonly commons: KnowledgeCommonsSubmitter;
}

/**
 * Every seam one mission runs on, wired to the real fabric.
 *
 * Per-mission rather than per-process because the control seam is scoped to a
 * mission's own trail: operator signals are derived from the ledger, not held in
 * a shared cache, which is what keeps invariant #1 true on the runtime side.
 */
export function buildWorkerSeams(deps: WorkerDependencies, missionId: string): MissionSeams {
  const { assets } = deps;

  return createMissionSeams(
    deps.generator,
    deps.models,
    createLedgerControl(deps.ledger, missionId),
    {
      bestForCategory: (category) => assets.bestForCategory(category),
      // Returns the version the registry HOLDS, which idempotent registration
      // may have advanced by an earlier ratchet decision. Reporting the version
      // this call proposed is how the ledger and the registry came to disagree
      // about which version did the work (defect `fe690036`).
      register: async (design) => ({ version: (await assets.upsert(design)).version }),
      recordOutcome: async (designId, score, effort) => void (await assets.recordOutcome(designId, score, effort)),
      // Without this the taxonomy never converges: clustering falls back to
      // normalising each proposal alone, and the planner never repeats a name.
      knownCapabilities: () => assets.knownCapabilities(),
    },
    deps.commons,
  );
}
