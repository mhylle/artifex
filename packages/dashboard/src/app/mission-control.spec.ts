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

/**
 * R15 AC-2/AC-3 — the canvas is a way of LOOKING at the ledger.
 *
 * Collapse, focus and zoom are properties of the viewer, not of the mission.
 * If any of them could alter what the projection reports, the dashboard would
 * have become a second truth (invariant #1).
 */
describe('MissionControl — canvas lens (R15)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;

  const nested = () => [
    ev(1, 'mission.started', MISSION, { objective: 'Root' }),
    ev(2, 'task.contracted', 't-a', { objective: 'Part A', category: 'research', parentTaskId: MISSION }),
    ev(3, 'task.contracted', 't-a1', { objective: 'Part A1', category: 'research', parentTaskId: 't-a' }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);
  });

  it('AC-0: renders the node with its category alongside objective and state', () => {
    feed.events.set(nested());
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Part A');
    expect(text).toContain('research');
    expect(text).toContain('contracted');
  });

  it('AC-2 DISTRACTOR: focusing a subtree does not change the projection', () => {
    // The canvas may show less; the ledger must still report everything.
    feed.events.set(nested());
    fixture.detectChanges();
    const before = JSON.stringify(feed.tree());

    component.focus('t-a');
    fixture.detectChanges();

    expect(component.visibleNodes()).toHaveLength(1);
    expect(JSON.stringify(feed.tree())).toBe(before);
    expect(feed.events()).toHaveLength(3);
  });

  it('AC-3: the breadcrumb shows the path from task zero to the focused subtree', () => {
    feed.events.set(nested());
    fixture.detectChanges();

    component.focus('t-a1');

    expect(component.breadcrumb().map((n) => n.taskId)).toEqual(['t-a', 't-a1']);
  });

  it('AC-3 DISTRACTOR: zoom is bounded, so the canvas cannot be driven illegible', () => {
    for (let i = 0; i < 40; i += 1) component.zoomOut();
    expect(component.zoom()).toBeGreaterThanOrEqual(0.5);

    for (let i = 0; i < 40; i += 1) component.zoomIn();
    expect(component.zoom()).toBeLessThanOrEqual(2);

    component.resetZoom();
    expect(component.zoom()).toBe(1);
  });

  it('AC-3 DISTRACTOR: focusing a task that has since vanished falls back to the whole tree', () => {
    // A focus pinned to a task the ledger no longer reports would otherwise
    // render an empty canvas the operator cannot explain or escape.
    feed.events.set(nested());
    fixture.detectChanges();

    component.focus('t-does-not-exist');

    expect(component.visibleNodes().length).toBeGreaterThan(0);
  });
});

/**
 * R16 — the inspector. Every claim on screen must have a ledger event behind it,
 * and be reachable from it in two clicks.
 */
describe('MissionControl — inspector (R16)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;

  const trail = () => [
    ev(1, 'mission.started', MISSION, { objective: 'Root' }),
    ev(2, 'task.contracted', 't-a', {
      objective: 'Part A', category: 'research', parentTaskId: MISSION, ceiling: 10,
      acceptanceCriteria: [
        { criterionId: 'ac-1', statement: 'Cites a source.' },
        { criterionId: 'ac-2', statement: 'States a date.' },
      ],
    }),
    ev(3, 'agent.staffed', 't-a', { designId: 'analyst', version: 3, logicalTier: 2 }),
    ev(4, 'task.executed', 't-a', { effortSpent: 4, ceiling: 10 }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);
  });

  it('AC-0: shows the contract, criteria, effort against budget and the staffed agent', () => {
    feed.events.set(trail());
    component.selectTask('t-a');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Part A');
    expect(text).toContain('Cites a source.');
    expect(text).toContain('States a date.');
    expect(text).toContain('analyst');
    expect(text).toContain('4 / 10');
    // Formatted for reading, not rounded in the ledger.
    expect(text).not.toContain('6.666');
  });

  it('AC-1: a Gate B verdict arriving later updates the criteria without a reload', () => {
    feed.events.set(trail());
    component.selectTask('t-a');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('0 / 2 met');

    feed.events.update((events) => [
      ...events,
      ev(5, 'gate_b.verdict_issued', 't-a', {
        outcome: 'fail',
        findings: [{ criterionId: 'ac-2', detail: 'no date given', errorClass: 'incomplete' }],
      }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('1 / 2 met');
    expect(text).toContain('no date given');
  });

  it('AC-2: the raw ledger events are one click away', () => {
    feed.events.set(trail());
    component.selectTask('t-a');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.drill-events') as HTMLButtonElement;
    expect(button.textContent).toContain('3 ledger events');
    button.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.events li')).toHaveLength(3);
  });

  it('DISTRACTOR: with nothing selected the inspector invents no task', () => {
    feed.events.set(trail());
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Select a task');
  });

  it('DISTRACTOR: effort is "not reported" rather than zero when the ledger is silent', () => {
    // A task that has not reported effort has not spent nothing — it has not
    // said. An empty bar would be a claim the ledger never made.
    feed.events.set(trail().slice(0, 3));
    component.selectTask('t-a');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('not reported');
  });
});
