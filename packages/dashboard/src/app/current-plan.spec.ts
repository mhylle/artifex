/**
 * Which events belong to the plan the mission is actually running (R41).
 *
 * A restatement replaces the specification, so everything contracted before it
 * was planned to satisfy criteria that no longer exist. `foldPriorTrail` in the
 * worker already discards that plan; the dashboard learned it in
 * `buildMissionTree` — and then the timeline and workforce lenses were found
 * still drawing the rejected tree, because each fold reads `task.contracted`
 * for itself.
 *
 * One rule in one place, so a fourth projection cannot quietly disagree —
 * find-shape (b), a rule implemented inline at one site while its siblings
 * ignore it.
 */
import { sinceLastRestatement } from './current-plan';
import type { LedgerEventView } from './mission-tree';

const ev = (seq: number, type: string): LedgerEventView =>
  ({ seq, eventId: `e-${seq}`, missionId: 'm-1', taskId: 'm-1', family: 'contract', type, payload: {} });

describe('sinceLastRestatement', () => {
  it('drops everything up to and including the restatement', () => {
    const trail = [ev(1, 'mission.started'), ev(2, 'task.contracted'), ev(3, 'operator.restated'), ev(4, 'task.contracted')];

    expect(sinceLastRestatement(trail).map((e) => e.seq)).toEqual([4]);
  });

  it('uses the LAST restatement when a mission was restated twice', () => {
    const trail = [ev(1, 'operator.restated'), ev(2, 'task.contracted'), ev(3, 'operator.restated'), ev(4, 'task.contracted')];

    expect(sinceLastRestatement(trail).map((e) => e.seq)).toEqual([4]);
  });

  it('DISTRACTOR: without a restatement the whole trail is the current plan', () => {
    // Trimming on any resume would empty every lens of every mission that was
    // ever interrupted.
    const trail = [ev(1, 'mission.started'), ev(2, 'task.contracted'), ev(3, 'task.executed')];

    expect(sinceLastRestatement(trail)).toHaveLength(3);
  });

  it('DISTRACTOR: it reads seq order, not array order', () => {
    // A websocket delivers promptly, not in order. Trusting array position
    // would trim the wrong half of a shuffled batch.
    const trail = [ev(4, 'task.contracted'), ev(3, 'operator.restated'), ev(1, 'mission.started')];

    expect(sinceLastRestatement(trail).map((e) => e.seq)).toEqual([4]);
  });
});
