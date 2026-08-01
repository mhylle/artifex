/**
 * The mission rail, grouped and searchable (R21).
 *
 * Measured on the live stack: 170 missions in one flat list, **26 of them
 * abandoned and most titled with a raw UUID** because they never recorded an
 * objective. The whole page rendered 62,000 characters in a single scroll, and
 * the mission an operator had just asked about was somewhere inside it.
 *
 * Grouping is by the status the ledger already derives (ADR-0024/0025) — the
 * rail invents no categories of its own.
 */
import { groupMissions, matchesSearch } from './fleet-groups';
import type { MissionSummary } from './fleet';

function mission(missionId: string, status: MissionSummary['status'], objective: string | null): MissionSummary {
  return { missionId, objective, status, eventCount: 1, escalations: 0, agentsStaffed: 0, tasksToday: 0, lastEventAt: '2026-08-01T00:00:00.000Z' };
}

const FLEET = [
  mission('m-run', 'running', 'Explain heat pumps'),
  mission('m-del', 'delivered', 'Name a colour'),
  mission('m-sur', 'surrendered', 'Mutate enzymes'),
  mission('m-aba', 'abandoned', null),
];

describe('groupMissions', () => {
  it('orders the groups by what an operator acts on first', () => {
    // Running work, then outcomes, then the dead. A rail sorted by recency
    // alone buries a live mission under yesterday's corpses — which is what it
    // did.
    expect(groupMissions(FLEET, '').map((g) => g.status)).toEqual([
      'running',
      'surrendered',
      'delivered',
      'abandoned',
    ]);
  });

  it('collapses the abandoned group and no other', () => {
    // Abandoned missions are a graveyard, not a worklist: nothing is pending on
    // them and they outnumber everything else. They stay reachable, one click
    // away, rather than being filtered out — the ledger records them and the
    // rail must not pretend otherwise.
    const groups = groupMissions(FLEET, '');

    expect(groups.find((g) => g.status === 'abandoned')?.collapsed).toBe(true);
    for (const g of groups.filter((g) => g.status !== 'abandoned')) {
      expect(g.collapsed, `${g.status} was collapsed`).toBe(false);
    }
  });

  it('keeps every mission — grouping hides nothing', () => {
    const total = groupMissions(FLEET, '').reduce((n, g) => n + g.missions.length, 0);

    expect(total).toBe(FLEET.length);
  });

  it('drops an empty group rather than rendering a heading with nothing under it', () => {
    const groups = groupMissions([mission('m-1', 'delivered', 'Only one')], '');

    expect(groups.map((g) => g.status)).toEqual(['delivered']);
  });

  it('filters by search across every group, and reports the count that survived', () => {
    const groups = groupMissions(FLEET, 'enzymes');

    expect(groups.map((g) => g.status)).toEqual(['surrendered']);
    expect(groups[0]?.missions.map((m) => m.missionId)).toEqual(['m-sur']);
  });

  it('DISTRACTOR: search matches the mission id too, so a UUID-titled mission is findable', () => {
    // The 26 abandoned missions have no objective at all. If search only looked
    // at the title they would be unreachable by search — exactly the ones an
    // operator is most likely to be pasting an id for.
    const groups = groupMissions(FLEET, 'm-aba');

    expect(groups.map((g) => g.status)).toEqual(['abandoned']);
    expect(groups[0]?.missions[0]?.missionId).toBe('m-aba');
  });

  it('DISTRACTOR: a search matching nothing yields no groups, not every group empty', () => {
    expect(groupMissions(FLEET, 'zzzz-no-such-mission')).toEqual([]);
  });
});

describe('matchesSearch', () => {
  it('is case-insensitive and matches a fragment', () => {
    expect(matchesSearch(FLEET[2]!, 'ENZYM')).toBe(true);
  });

  it('DISTRACTOR: an empty search matches everything rather than nothing', () => {
    // A rail that empties itself the moment the box is focused and cleared
    // would be unusable.
    for (const m of FLEET) expect(matchesSearch(m, '  ')).toBe(true);
  });

  it('DISTRACTOR: a mission with a null objective does not throw', () => {
    expect(matchesSearch(FLEET[3]!, 'anything')).toBe(false);
  });
});
