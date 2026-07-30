/**
 * P12 — the cockpit renders the tree (R10 AC-2, dashboard half).
 *
 * The projection is unit-tested separately; this proves the component actually
 * puts it on screen, and that what it shows comes from the feed's event list
 * rather than any state of its own.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LedgerFeed } from './ledger-feed';
import { MissionControl } from './mission-control';
import type { LedgerEventView } from './mission-tree';

const MISSION = 'm-1';
const ev = (seq: number, type: string, taskId: string | null, payload: Record<string, unknown> = {}): LedgerEventView =>
  ({ seq, eventId: `e-${seq}`, missionId: MISSION, taskId, family: 'contract', type, payload });

describe('MissionControl', () => {
  let fixture: ComponentFixture<MissionControl>;
  let feed: LedgerFeed;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MissionControl] }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    feed = TestBed.inject(LedgerFeed);
  });

  it('shows nothing until events arrive — it invents no mission', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Watch a mission');
  });

  it('renders the mission and its tasks from the event list alone', () => {
    feed.events.set([
      ev(1, 'mission.started', MISSION, { objective: 'Two-part briefing' }),
      ev(2, 'task.contracted', 't-a', { objective: 'Part A' }),
      ev(3, 'gate_b.verdict_issued', 't-a', { outcome: 'pass' }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Two-part briefing');
    expect(text).toContain('Part A');
    expect(text).toContain('verified');
  });

  it('DISTRACTOR: the view follows the ledger — removing events removes them from screen', () => {
    // A cockpit holding its own copy would keep showing the stale task.
    feed.events.set([
      ev(1, 'mission.started', MISSION, { objective: 'Briefing' }),
      ev(2, 'task.contracted', 't-a', { objective: 'Part A' }),
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Part A');

    feed.events.set([ev(1, 'mission.started', MISSION, { objective: 'Briefing' })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Part A');
  });

  it('shows surrender with its blockers rather than a silent stall', () => {
    feed.events.set([
      ev(1, 'mission.started', MISSION, { objective: 'Briefing' }),
      ev(2, 'mission.surrendered', MISSION, { blockers: ['no resolvable source'] }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('surrendered');
    expect(text).toContain('no resolvable source');
  });
});
