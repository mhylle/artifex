/**
 * The mission rail, grouped and searchable (R21).
 *
 * Measured on the live stack: 170 missions in one flat list, 26 of them
 * abandoned and most titled with a raw UUID because they never recorded an
 * objective. The page rendered 62,000 characters in a single scroll.
 *
 * Grouping is by the status the ledger already derives (ADR-0024/0025). The
 * rail invents no categories of its own — that would be the dashboard holding a
 * second truth, which is the one thing it may not do.
 */
import type { MissionSummary } from './fleet';

export interface MissionGroup {
  readonly status: MissionSummary['status'];
  readonly missions: readonly MissionSummary[];
  /** Rendered behind a disclosure rather than expanded. */
  readonly collapsed: boolean;
}

/**
 * Group order: what an operator acts on first.
 *
 * Running work, then the outcomes worth reading, then the dead. Sorting the
 * rail by recency alone is what buried a live mission under yesterday's
 * corpses.
 */
const ORDER: readonly MissionSummary['status'][] = ['running', 'surrendered', 'delivered', 'abandoned'];

/**
 * Abandoned is a graveyard, not a worklist — nothing is pending on those
 * missions and they outnumber everything else. Collapsed, never filtered out:
 * the ledger records them and the rail must not pretend otherwise.
 */
const COLLAPSED: ReadonlySet<string> = new Set(['abandoned']);

/** Does this mission match what the operator typed? Empty search matches all. */
export function matchesSearch(mission: MissionSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  // The id as well as the objective: the abandoned missions have no objective
  // at all, and an id is exactly what an operator pastes when hunting one.
  return (
    (mission.objective ?? '').toLowerCase().includes(needle) ||
    mission.missionId.toLowerCase().includes(needle)
  );
}

/** The rail: grouped by status, filtered by search, empty groups dropped. */
export function groupMissions(missions: readonly MissionSummary[], search: string): readonly MissionGroup[] {
  const matching = missions.filter((m) => matchesSearch(m, search));

  return ORDER.map((status) => ({
    status,
    missions: matching.filter((m) => m.status === status),
    collapsed: COLLAPSED.has(status),
  })).filter((group) => group.missions.length > 0);
}
