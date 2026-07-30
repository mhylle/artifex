/**
 * P12 — the cockpit renders the tree (R10 AC-2, dashboard half).
 *
 * The projection is unit-tested separately; this proves the component actually
 * puts it on screen, and that what it shows comes from the feed's event list
 * rather than any state of its own.
 */
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Fleet } from './fleet';
import { LedgerFeed } from './ledger-feed';
import { MissionControl } from './mission-control';
import { MissionIntake } from './mission-intake';
import type { MissionDraft } from './mission-intake';
import type { LedgerEventView } from './mission-tree';

const MISSION = 'm-1';
const ev = (seq: number, type: string, taskId: string | null, payload: Record<string, unknown> = {}): LedgerEventView =>
  ({ seq, eventId: `e-${seq}`, missionId: MISSION, taskId, family: 'contract', type, payload });

describe('MissionControl', () => {
  let fixture: ComponentFixture<MissionControl>;
  let feed: LedgerFeed;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
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

/**
 * R14 — an operator starts a mission from the cockpit.
 *
 * Before this, the only way to put work into Artifex was curl: the UI could
 * watch a mission but never begin one. "Mission control is a cockpit, not a
 * window."
 */
describe('MissionControl — intake (R14)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;
  let submitted: MissionDraft[];
  let respond: () => Promise<string>;

  beforeEach(async () => {
    submitted = [];
    respond = async () => 'm-new';
    const stub: Pick<MissionIntake, 'submit'> = {
      async submit(draft: MissionDraft) {
        submitted.push(draft);
        return respond();
      },
    };

    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: MissionIntake, useValue: stub }],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);
    fixture.detectChanges();
  });

  /** Fills the form the way an operator would. */
  const draft = (over: Partial<Record<'objective' | 'criteria' | 'outOfScope', string>> = {}): void => {
    component.objective.set(over.objective ?? 'Explain heat pumps.');
    component.criteriaText.set(over.criteria ?? 'Names a COP figure.\nCites a source.');
    component.outOfScopeText.set(over.outOfScope ?? 'No installation costs.');
  };

  it('AC-0: submits the drafted mission with every field the contract requires', async () => {
    draft();

    await component.submit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.objective).toBe('Explain heat pumps.');
    expect(submitted[0]?.successCriteria).toEqual(['Names a COP figure.', 'Cites a source.']);
    expect(submitted[0]?.outOfScope).toEqual(['No installation costs.']);
  });

  it('AC-2: watches the accepted mission automatically — no id is ever pasted', async () => {
    const watched: string[] = [];
    feed.watch = (missionId: string) => void watched.push(missionId);
    draft();

    await component.submit();

    expect(watched).toEqual(['m-new']);
    expect(component.missionId()).toBe('m-new');
  });

  it('AC-1 DISTRACTOR: a draft with no objective is refused and NOTHING is sent', async () => {
    draft({ objective: '   ' });

    await component.submit();

    expect(submitted).toHaveLength(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('objective');
  });

  it('AC-1 DISTRACTOR: criteria of only blank lines are not criteria', async () => {
    // Whitespace would satisfy a naive "is the box non-empty" check while being
    // ungradeable — the exact thing intake is supposed to refuse.
    draft({ criteria: '   \n  \n' });

    await component.submit();

    expect(submitted).toHaveLength(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(/criterion|criteria/i);
  });

  it('AC-3: a rejection from the control plane is shown, not swallowed', async () => {
    respond = () => Promise.reject(new Error('a mission needs an objective'));
    draft();

    await component.submit();

    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('a mission needs an objective');
  });
});

/**
 * R21 — the fleet view. Mission Control used to open on an empty box demanding
 * a UUID, which made it unusable to anyone who did not already know one.
 */
describe('MissionControl — fleet rail (R21)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;
  let fleet: Fleet;

  const SUMMARIES = [
    { missionId: 'm-1', objective: 'Explain heat pumps.', status: 'running' as const, eventCount: 7, escalations: 1, agentsStaffed: 2, tasksToday: 3, lastEventAt: '2026-07-30T09:00:00.000Z' },
    { missionId: 'm-2', objective: 'Explain solar panels.', status: 'surrendered' as const, eventCount: 15, escalations: 3, agentsStaffed: 4, tasksToday: 1, lastEventAt: '2026-07-30T08:00:00.000Z' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);
    fleet = TestBed.inject(Fleet);
  });

  it('AC-0: lists every mission with its status, and shows fleet totals', () => {
    fleet.missions.set(SUMMARIES);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Explain heat pumps.');
    expect(text).toContain('Explain solar panels.');
    expect(text).toContain('surrendered');
    expect(fleet.total()).toBe(2);
    expect(fleet.running()).toBe(1);
  });

  it('AC-0: surfaces the count of missions needing a human', () => {
    fleet.missions.set(SUMMARIES);
    fixture.detectChanges();

    expect(fleet.needingAttention()).toBe(1);
  });

  it('AC-1: selecting a mission from the rail switches the view to it', () => {
    const watched: string[] = [];
    feed.watch = (missionId: string) => void watched.push(missionId);
    fleet.missions.set(SUMMARIES);
    fixture.detectChanges();

    component.select('m-2');

    expect(watched).toEqual(['m-2']);
    expect(component.missionId()).toBe('m-2');
  });

  it('DISTRACTOR: an empty fleet says so rather than rendering a blank rail', () => {
    // A blank area is indistinguishable from a broken one.
    fleet.missions.set([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toMatch(/no missions/i);
  });

  it('DISTRACTOR: an unreachable control plane is reported, not shown as an empty fleet', () => {
    // The failure this guards: operator sees "no missions yet" while the API is
    // simply down, and concludes the system is idle.
    fleet.missions.set([]);
    fleet.error.set('Failed to fetch');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Failed to fetch');
  });
});
