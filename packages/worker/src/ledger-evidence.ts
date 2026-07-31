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

  constructor(index: MissionIndex, reader: MissionReader) {
    this.#index = index;
    this.#reader = reader;
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

      // Which category each task belongs to, and what it was allowed to spend.
      const categoryOf = new Map<string, string>();
      const ceilingOf = new Map<string, number>();
      for (const event of events) {
        if (event.taskId === null) continue;

        if (event.type === 'task.contracted') {
          // The planner's RAW phrasing — a fallback, not the preference. Kept
          // because thousands of historical events predate the capability
          // field, and dropping them would empty the ranking to improve its
          // resolution: all the evidence traded for cleaner buckets.
          const category = event.payload['category'];
          // The `!has` guard is an EQUIVALENT mutant under current ordering —
          // removing it changes nothing, because replay is ordered by `seq` and
          // `task.contracted` always precedes `agent.staffed` for a task, so the
          // capability set below always wins anyway. Kept as a statement of
          // precedence rather than a reliance on arrival order: if a future
          // event ever re-contracts a task after staffing, the resolved
          // capability must still not be overwritten by a raw name.
          if (typeof category === 'string' && !categoryOf.has(event.taskId)) {
            categoryOf.set(event.taskId, category);
          }
          const contract = event.payload['contract'] as { budget?: { ceiling?: unknown } } | undefined;
          const ceiling = contract?.budget?.ceiling;
          if (typeof ceiling === 'number') ceilingOf.set(event.taskId, ceiling);
          continue;
        }

        // The RESOLVED capability wins wherever it exists (defect `340aa7de`).
        // `staff()` merges the planner's invented name onto a known capability;
        // bucketing on the raw name re-splits what it merged. Measured: 31 raw
        // categories over tasks that staffed 22 capabilities, with one
        // capability absorbing five raw names — five buckets of one observation
        // where the registry held one design with ten, which is why every weak
        // spot looked like a singleton.
        if (event.type === 'agent.staffed') {
          const capability = event.payload['capability'];
          if (typeof capability === 'string' && capability.length > 0) {
            categoryOf.set(event.taskId, capability);
          }
        }
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
