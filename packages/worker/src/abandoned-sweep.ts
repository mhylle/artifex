/**
 * Recording the death of a mission nobody is running (defect `dd2e9d18`).
 *
 * Find-shape (w): **a state the system can enter but has no event to describe.**
 * A worker that is killed writes nothing, so its missions sit at "running"
 * forever — 26 of them live, oldest ~19 hours, with zero actually in flight.
 * No projection can fix that, because the ledger holds no fact either way. The
 * fabric's own guardrail says what to do with a record that has become wrong:
 * *never fix a row — append a corrective event.*
 *
 * The rule invents no threshold, which is the point. It does not ask "has this
 * been quiet for N minutes"; it asks a question with a definite answer: **is
 * anything running this?** At worker boot the answer is knowable — a mission
 * with no outcome on the ledger and no live job on the queue is owned by a
 * process that no longer exists.
 *
 * Both halves are load-bearing, and the second came from checking the live
 * queue before designing this rather than after. A sweep keyed on the ledger
 * alone would abandon a mission the API enqueued moments before this worker
 * booted — work that is about to happen, not work that died.
 *
 * A mistaken abandonment is self-correcting rather than permanent: the trail is
 * append-only and status is the LAST status-bearing event (ADR-0024/0025), so a
 * mission that does run afterwards records `mission.started` and reads as
 * running again. That is why this is safe to do automatically.
 */
import type { LedgerEventInput } from '@artifex/shared-types';

/** One mission as the fleet projection reports it. */
export interface FleetRow {
  readonly missionId: string;
  readonly status: string;
  readonly objective: string | null;
}

export interface AbandonedSweepDeps {
  /**
   * The fleet, read through the SAME projection the header uses.
   *
   * Deliberately not a second query. Two definitions of "running" is the shape
   * this defect was made of — if the sweep and the header ever disagreed, the
   * sweep would be abandoning missions the operator can see are alive.
   */
  readonly fleet: () => Promise<readonly FleetRow[]>;
  /** Missions the queue is holding in a live state — waiting, active, delayed. */
  readonly liveMissionIds: () => Promise<ReadonlySet<string>>;
  readonly append: (event: LedgerEventInput) => Promise<unknown>;
  readonly newId: () => string;
  readonly now: () => string;
}

/**
 * Record every mission that has no outcome and no owner. Returns what it swept.
 *
 * Fail-safe by construction, per the memory-fabric guardrail that anything
 * scanning the ledger on bootstrap must never throw out of the hook: if the
 * queue cannot be reached, this sweeps nothing. Not establishing what is live
 * is not the same as establishing that something is dead, and degrading to
 * "abandon everything" would be far worse than the defect it fixes.
 */
export async function sweepAbandonedMissions(deps: AbandonedSweepDeps): Promise<readonly string[]> {
  let live: ReadonlySet<string>;
  try {
    live = await deps.liveMissionIds();
  } catch {
    return [];
  }

  const rows = await deps.fleet();
  const swept: string[] = [];

  for (const row of rows) {
    if (row.status !== 'running') continue;
    if (live.has(row.missionId)) continue;

    await deps.append({
      eventId: deps.newId(),
      missionId: row.missionId,
      // Mission-scoped, so it hangs off the mission task exactly as
      // `mission.started` and `mission.delivered` do.
      taskId: row.missionId,
      family: 'contract',
      type: 'mission.abandoned',
      actor: { kind: 'system', id: 'worker-startup-sweep', displayName: 'worker startup sweep' },
      payload: {
        reason:
          'no outcome on the ledger and no job on the queue at worker startup — ' +
          'the process that was running this mission is no longer running',
        objective: row.objective,
      },
      occurredAt: deps.now(),
    });
    swept.push(row.missionId);
  }

  return swept;
}
