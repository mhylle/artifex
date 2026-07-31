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
    /** Set only for a redesign (R28 AC-0); null marks an origin explicitly. */
    readonly parentDesignId?: string | null;
    readonly validationHarness?: { readonly checks: string[] };
  }): Promise<{ readonly version: number }>;
  recordOutcome(designId: string, score: number, effort?: number): Promise<unknown>;
  knownCapabilities(): Promise<string[]>;
  /**
   * A design's ancestors, nearest first (R35 AC-2).
   *
   * Without this the independence check degrades to identity alone — it would
   * catch a verifier grading itself and miss a sibling grading its own lineage,
   * which is the half that matters now that redesigns actually have parents.
   */
  ancestorsOf(designId: string): Promise<string[]>;
  /** Read one design, so a hot-fix knows what it is about to replace (R26). */
  findById(designId: string): Promise<{ readonly designId: string; readonly roleInstructions: string } | null>;
  /** Apply — or revert — the fast loop's one worker-layer patch (R26). */
  setRoleInstructions(designId: string, roleInstructions: string): Promise<void>;
}

/**
 * The slice of the hot-fix log the worker binds to (R26).
 *
 * Structural, like every other dependency here — the worker still imports no
 * database driver.
 */
export interface HotFixStore {
  apply(input: {
    readonly missionId: string;
    readonly category: string;
    readonly criterionId: string;
    readonly target: { readonly layer: string; readonly kind: string; readonly assetId: string };
    readonly previousValue: string;
    readonly patchedValue: string;
    readonly windowObservations: number;
    readonly baselineFailureRate: number;
    readonly predictedFailureRate: number;
    readonly predictionBasis: string;
  }): Promise<string | null>;
  resolve(input: {
    readonly hotFixId: string;
    readonly revert: boolean;
    readonly reason: string;
    readonly observedFailureRate: number | null;
  }): Promise<void>;
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
  /**
   * The fast loop's hot-fix log (R26, defect `188c6892`).
   *
   * REQUIRED here even though `MissionSeams.fastLoop` is optional, for exactly
   * the reason `commons` is: the seam being optional is what let three proven,
   * mutation-tested modules ship with no producer at all. Optional at the seam
   * keeps every existing test caller compiling; required at the composition root
   * means the deployed worker cannot quietly run without it.
   */
  readonly hotFixes: HotFixStore;
}

/**
 * Every seam one mission runs on, wired to the real fabric.
 *
 * Per-mission rather than per-process because the control seam is scoped to a
 * mission's own trail: operator signals are derived from the ledger, not held in
 * a shared cache, which is what keeps invariant #1 true on the runtime side.
 */
export function buildWorkerSeams(deps: WorkerDependencies, missionId: string): MissionSeams {
  const { assets, hotFixes } = deps;

  /**
   * The fast loop, wired (R26).
   *
   * `apply` logs the experiment and puts the patch in place; `resolve` records
   * the verdict and, when reverting, restores what was there. Each is one call
   * rather than two so there is no window in which the log and the asset
   * disagree — the log is supposed to be what the asset's state means.
   *
   * The log is written FIRST and the asset second. If the write to the asset
   * fails, the log holds an experiment that was never applied and the window
   * closes on a flat rate, which reverts — harmless. The other order would patch
   * the registry with nothing recording what it replaced, and the revert would
   * have nothing to restore.
   */
  const fastLoop = {
    asset: (designId: string) => assets.findById(designId),
    apply: async (input: Parameters<HotFixStore['apply']>[0]) => {
      const hotFixId = await hotFixes.apply(input);
      if (hotFixId === null) return null;
      await assets.setRoleInstructions(input.target.assetId, input.patchedValue);
      return hotFixId;
    },
    resolve: async (input: {
      hotFixId: string;
      target: { assetId: string };
      previousValue: string;
      revert: boolean;
      reason: string;
      observedFailureRate: number | null;
    }) => {
      // Restore BEFORE recording the verdict. A crash between the two leaves the
      // asset correct and the log open, which the next mission's window closes;
      // the reverse would leave a log claiming "reverted" over an asset that
      // still carries the patch, and the log would be lying.
      if (input.revert) await assets.setRoleInstructions(input.target.assetId, input.previousValue);
      await hotFixes.resolve({
        hotFixId: input.hotFixId,
        revert: input.revert,
        reason: input.reason,
        observedFailureRate: input.observedFailureRate,
      });
    },
  };

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
      // The lineage half of R35 AC-2. Absent, a sibling design could be staffed
      // to grade its own lineage and the check would report nothing.
      ancestorsOf: (designId: string) => assets.ancestorsOf(designId),
    },
    deps.commons,
    fastLoop,
  );
}
