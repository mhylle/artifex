/**
 * R27 AC-0's upstream — mission evidence, folded from the real ledger.
 *
 * `ScienceLoop.mine` was correct and had nothing to mine: the criterion says
 * "given a completed mission HISTORY", which is cross-mission, and the worker's
 * only reader was `replay({missionId})`.
 *
 * No new query was needed. `listMissions()` already enumerates every mission
 * with its status and escalation count — it is what backs the fleet rail — and
 * `replay` supplies the per-task detail. This is the fold between them.
 *
 * **No window is invented.** The history is every mission that has FINISHED: a
 * running mission has no outcome yet, so it carries no evidence, and counting
 * its partial verdicts would make a category look weak merely because its work
 * is still in progress. "The last N missions" would be a constant nobody
 * measured — the ledger already knows which missions are over.
 */
import { capabilityOf, proposableCapabilities } from './agent-creator.js';
import type { MissionEvidence } from './science-loop.js';

/** The cross-mission index — `LedgerRepository.listMissions` in practice. */
export interface MissionIndex {
  listMissions(): Promise<ReadonlyArray<{
    readonly missionId: string;
    readonly status: 'running' | 'delivered' | 'surrendered';
    readonly escalations: number;
  }>>;
}

/** Per-mission detail — `LedgerRepository.replay` in practice. */
export interface MissionReader {
  replay(filter: { missionId: string }): Promise<ReadonlyArray<{
    readonly taskId: string | null;
    readonly type: string;
    readonly payload: Record<string, unknown>;
  }>>;
}

/**
 * The registry, read-only — `AssetRegistryRepository.findById` in practice.
 *
 * REQUIRED, not optional. An optional lookup is how a mechanism ends up wired
 * everywhere and called nowhere: every construction site would compile without
 * it and the ladder would silently collapse to its bottom rung.
 */
export interface DesignLookup {
  findById(designId: string): Promise<{ readonly category: string } | null>;
}

/** What a task recorded about which capability did its work, before resolution. */
interface CategoryEvidence {
  capability?: string;
  designId?: string;
  raw?: string;
}

/** Accumulated per (mission, category). */
interface Bucket {
  gateBAttempts: number;
  gateBPasses: number;
  budgetSpent: number;
  budgetCeiling: number;
}

export class LedgerEvidenceSource {
  readonly #index: MissionIndex;
  readonly #reader: MissionReader;
  readonly #designs: DesignLookup;
  /** Memoised across the whole pass: the lookup is a query inside a loop. */
  readonly #categoryOfDesign = new Map<string, string | null>();

  constructor(index: MissionIndex, reader: MissionReader, designs: DesignLookup) {
    this.#index = index;
    this.#reader = reader;
    this.#designs = designs;
  }

  /**
   * The category a task's work belongs to, down a ladder of what was RECORDED.
   *
   * Never inference. `resolveCapability` would merge more — measured, 105 raw
   * categories down to 57 — but listing the merges rather than the count shows
   * it folding `Rail Travel Overview` into `hand tools overview` and `Marine
   * Engineering / Sailing Basics` into `mechanical engineering`. That bias is
   * right when staffing one proposal at a time, because a wrong reuse is caught
   * downstream at the evidence bar. Here the bucket IS the output — a claim
   * about which capability is weak — so a guess corrupts the answer instead of
   * being checked by it.
   */
  async #categoryFor(evidence: CategoryEvidence): Promise<string | undefined> {
    const raw = await this.#recordedCategoryFor(evidence);
    if (raw === undefined) return undefined;

    // Structural roles are not capabilities (defect `a750be53`). Checked BEFORE
    // normalisation, and that ordering is the whole subtlety: `capabilityOf`
    // strips punctuation, so `verification.physics` becomes `verification
    // physics` and stops matching the prefix. A filter one line lower would drop
    // the mission role, leave every verification capability in the ranking, and
    // look correct in any test that only checked `mission`.
    //
    // The rule itself is not restated here — it is the same
    // `proposableCapabilities` that decides what `staff()` may resolve to and
    // what the planner may be shown. A ranking of what the swarm is weak at can
    // only contain things the swarm could be asked to do.
    if (proposableCapabilities([raw]).length === 0) return undefined;

    // ONE normalisation point, so no two rungs can disagree about the shape of
    // a name. Rung 1's value is already normalised and this is idempotent on it.
    return capabilityOf(raw);
  }

  /** The ladder itself: what was recorded, in order of directness. */
  async #recordedCategoryFor(evidence: CategoryEvidence): Promise<string | undefined> {
    // Rung 1 — what staffing resolved, recorded on the event itself.
    if (evidence.capability !== undefined) return evidence.capability;

    // Rung 2 — what staffing resolved, looked up by the design id the event has
    // carried since P0 and the ranker never read.
    if (evidence.designId !== undefined) {
      const known = this.#categoryOfDesign.get(evidence.designId);
      if (known === undefined) {
        const design = await this.#designs.findById(evidence.designId).catch(() => null);
        this.#categoryOfDesign.set(evidence.designId, design?.category ?? null);
        if (design !== null) return design.category;
      } else if (known !== null) {
        return known;
      }
    }

    // Rung 3 — the planner's raw phrasing. Reached by every task whose design
    // predates the registry's current id scheme: 140 of 220 live staffings have
    // no row to find.
    return evidence.raw;
  }

  /**
   * Evidence for the given missions, or for the whole finished history.
   *
   * One row per (mission, CATEGORY) rather than per mission, because that is
   * what `rankWeakSpots` aggregates on: a mission usually spans several
   * categories, and collapsing them would attribute one category's failures to
   * every other category the mission touched.
   */
  async evidenceFor(missionIds?: readonly string[]): Promise<MissionEvidence[]> {
    const all = await this.#index.listMissions();
    const wanted = missionIds === undefined ? null : new Set(missionIds);

    const evidence: MissionEvidence[] = [];

    for (const mission of all) {
      if (wanted !== null && !wanted.has(mission.missionId)) continue;
      // Skipped BEFORE reading: an unfinished mission is not history, and
      // replaying it would cost a query to produce nothing.
      if (mission.status === 'running') continue;

      const events = await this.#reader.replay({ missionId: mission.missionId });

      // What each task RECORDED about its capability, and what it was allowed
      // to spend. Collected first and resolved after, because the ladder's
      // middle rung is a query and the precedence between rungs must not depend
      // on the order events happen to arrive in.
      const recorded = new Map<string, CategoryEvidence>();
      const ceilingOf = new Map<string, number>();
      const evidenceOf = (taskId: string): CategoryEvidence => {
        const existing = recorded.get(taskId);
        if (existing !== undefined) return existing;
        const fresh: CategoryEvidence = {};
        recorded.set(taskId, fresh);
        return fresh;
      };

      for (const event of events) {
        if (event.taskId === null) continue;

        if (event.type === 'task.contracted') {
          const category = event.payload['category'];
          // `??=` rather than `=` is an EQUIVALENT mutant: a task is contracted
          // exactly once (re-contracting appends `task.recontracted`, a
          // different type), so first-wins and last-wins are indistinguishable.
          // No test asserts it, because a fixture with two contracts for one
          // task would be asserting a state the system cannot produce.
          if (typeof category === 'string') evidenceOf(event.taskId).raw ??= category;
          const contract = event.payload['contract'] as { budget?: { ceiling?: unknown } } | undefined;
          const ceiling = contract?.budget?.ceiling;
          if (typeof ceiling === 'number') ceilingOf.set(event.taskId, ceiling);
          continue;
        }

        // Only the PRODUCER's staffing. A task carries two staffings on the same
        // task id, and the verifier's has its own `verifier.staffed` type —
        // reading it here would put every verified task in a `verification.*`
        // bucket and make production evidence disappear.
        if (event.type === 'agent.staffed') {
          const capability = event.payload['capability'];
          if (typeof capability === 'string' && capability.length > 0) {
            evidenceOf(event.taskId).capability = capability;
          }
          const designId = event.payload['designId'];
          if (typeof designId === 'string' && designId.length > 0) {
            evidenceOf(event.taskId).designId = designId;
          }
        }
      }

      const categoryOf = new Map<string, string>();
      for (const [taskId, evidence] of recorded) {
        const category = await this.#categoryFor(evidence);
        if (category !== undefined) categoryOf.set(taskId, category);
      }

      const buckets = new Map<string, Bucket>();
      const bucketFor = (taskId: string): Bucket | null => {
        const category = categoryOf.get(taskId);
        if (category === undefined) return null;
        const existing = buckets.get(category);
        if (existing !== undefined) return existing;
        const fresh: Bucket = {
          gateBAttempts: 0,
          gateBPasses: 0,
          budgetSpent: 0,
          budgetCeiling: ceilingOf.get(taskId) ?? 0,
        };
        buckets.set(category, fresh);
        return fresh;
      };

      for (const event of events) {
        if (event.taskId === null) continue;
        const bucket = bucketFor(event.taskId);
        if (bucket === null) continue;

        if (event.type === 'gate_b.verdict_issued') {
          bucket.gateBAttempts += 1;
          if (event.payload['outcome'] === 'pass') bucket.gateBPasses += 1;
        }

        if (event.type === 'task.executed') {
          const spent = event.payload['effortSpent'];
          if (typeof spent === 'number') bucket.budgetSpent += spent;
        }
      }

      for (const [category, bucket] of buckets) {
        evidence.push({
          missionId: mission.missionId,
          category,
          gateBAttempts: bucket.gateBAttempts,
          gateBPasses: bucket.gateBPasses,
          // The mission's escalations, attributed to each category it touched.
          // Imprecise where a mission spans several, and honest about it: the
          // ledger records escalations per TASK, but the fleet index aggregates
          // them per mission, and re-deriving them here would duplicate the
          // fleet rail's own fold.
          escalations: mission.escalations,
          budgetSpent: bucket.budgetSpent,
          budgetCeiling: bucket.budgetCeiling,
          surrendered: mission.status === 'surrendered',
        });
      }
    }

    return evidence;
  }
}
