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

import { Cockpit } from './cockpit';
import type { CockpitCommand } from './cockpit';
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

  it('AC-0: surfaces the count of items needing a human (R18)', () => {
    // This counted surrendered missions until R18 gave it something real. A
    // surrender is an OUTCOME, not a question — the count now means "blocked
    // awaiting a decision", which is what the fleet is supposed to advertise.
    fleet.missions.set(SUMMARIES);
    fleet.attention.set([
      {
        missionId: 'm-2', taskId: 't-x', objective: 'Count the sand.', rung: 'human_review',
        autonomyDial: 'checkpointed', findings: ['no census exists'],
        acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Exact count.' }],
        waitingSince: '2026-07-30T09:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    expect(fleet.needingAttention()).toBe(1);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Count the sand.');
    // Full context inline, so deciding needs no separate investigation.
    expect(text).toContain('Exact count.');
    expect(text).toContain('no census exists');
  });

  it('AC-0 DISTRACTOR: a surrendered mission alone is NOT something waiting on a human', () => {
    // The old behaviour. A mission that surrendered has finished — nobody is
    // being asked anything, and counting it would send an operator looking for
    // a decision that does not exist.
    fleet.missions.set(SUMMARIES);
    fleet.attention.set([]);
    fixture.detectChanges();

    expect(fleet.needingAttention()).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Nothing is waiting on you');
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

/**
 * R17 — the cockpit acts. These tests are about REACHABILITY as much as
 * behaviour: a control an operator cannot click is the defect shape this
 * project has already shipped (an unreachable focus() made the breadcrumb
 * permanently empty despite passing unit tests).
 */
describe('MissionControl — cockpit actions (R17)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;
  let sent: CockpitCommand[];

  beforeEach(async () => {
    sent = [];
    const stub: Pick<Cockpit, 'act'> = { async act(command) { sent.push(command); } };

    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Cockpit, useValue: stub }],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);

    // select() calls feed.watch(), which clears the event list — so the mission
    // is chosen FIRST and the trail set afterwards, mirroring what really
    // happens when a watch replays a mission's history.
    component.select(MISSION);
    feed.events.set([
      ev(1, 'mission.started', MISSION, { objective: 'Root' }),
      ev(2, 'task.contracted', 't-a', {
        objective: 'Part A', parentTaskId: MISSION, ceiling: 10,
        acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Cites a source.' }],
      }),
    ]);
    component.selectTask('t-a');
    fixture.detectChanges();
  });

  it('AC-0: pausing the selected task sends the action with its task id', async () => {
    await component.pauseTask();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.action).toBe('pause');
    expect(sent[0]?.taskId).toBe('t-a');
    expect(sent[0]?.missionId).toBe(MISSION);
  });

  it('AC-0: cancel and resume are both reachable for the selected task', async () => {
    await component.cancelTask();
    await component.resumeTask();

    expect(sent.map((c) => c.action)).toEqual(['cancel', 'resume']);
  });

  it('AC-2: a budget grant carries the amount', async () => {
    component.grantAmount.set(25);

    await component.grantBudget();

    expect(sent[0]?.action).toBe('grant_budget');
    expect(sent[0]?.amount).toBe(25);
  });

  it('AC-3: turning the dial addresses the MISSION, not one task', async () => {
    // The dial is a property of the mission's contract; scoping it to a task
    // would let one leaf widen its own autonomy.
    component.dial.set('supervised');

    await component.turnDial();

    expect(sent[0]?.action).toBe('turn_dial');
    expect(sent[0]?.taskId).toBeNull();
    expect(sent[0]?.autonomyDial).toBe('supervised');
  });

  it('an annotation carries the note', async () => {
    component.noteText.set('Watch this one.');

    await component.annotate();

    expect(sent[0]?.action).toBe('annotate');
    expect(sent[0]?.note).toBe('Watch this one.');
  });

  it('DISTRACTOR: the controls are actually RENDERED, not just callable', async () => {
    // A method an operator cannot reach is not a feature. This is the failure
    // that made the breadcrumb permanently empty despite green unit tests.
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.cockpit button') as NodeListOf<HTMLButtonElement>,
    ).map((b) => b.textContent?.trim().toLowerCase() ?? '');

    for (const expected of ['pause', 'resume', 'cancel']) {
      expect(labels.some((l) => l.includes(expected)), `no button for "${expected}"`).toBe(true);
    }
  });

  it('DISTRACTOR: an empty annotation is not sent', async () => {
    component.noteText.set('   ');

    await component.annotate();

    expect(sent).toHaveLength(0);
  });
});

/**
 * R18 AC-2 — the operator must be able to REACH the decision.
 *
 * The CockpitService has had a 'decide' action for an iteration, and no button
 * called it. That is precisely the shape that made focus() unreachable and left
 * the breadcrumb permanently empty despite green unit tests.
 */
describe('MissionControl — deciding an attention item (R18)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let fleet: Fleet;
  let sent: CockpitCommand[];

  const ITEM = {
    missionId: 'm-9', taskId: 't-9', objective: 'Count the sand.', rung: 'human_review',
    autonomyDial: 'checkpointed', findings: ['no census exists'],
    acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Exact count.' }],
    waitingSince: '2026-07-30T09:00:00.000Z',
  };

  beforeEach(async () => {
    sent = [];
    const stub: Pick<Cockpit, 'act'> = { async act(command) { sent.push(command); } };
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Cockpit, useValue: stub }],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    fleet = TestBed.inject(Fleet);
    fleet.attention.set([ITEM]);
    fixture.detectChanges();
  });

  function queueButtons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.queue button') as NodeListOf<HTMLButtonElement>);
  }

  it('AC-2: the operator can approve the item without answering, and the decision is sent', async () => {
    // Renamed and rewritten in place. This asserted a button labelled
    // "Approve"; an item that asks questions now labels that path "Proceed
    // without answering", because approving an item you have not answered is a
    // different act from answering it. What the test PROVES is unchanged: the
    // queue can send an approve decision for the right task.
    const proceed = queueButtons().find((b) => b.textContent?.trim() === 'Proceed without answering');
    expect(proceed, 'no way to approve the item without answering').toBeDefined();

    proceed!.click();
    await fixture.whenStable();

    expect(sent[0]?.action).toBe('decide');
    expect(sent[0]?.decision).toBe('approve');
    expect(sent[0]?.taskId).toBe('t-9');
    expect(sent[0]?.missionId).toBe('m-9');
  });

  it('DISTRACTOR: Reject sends a different decision, not the same one', async () => {
    queueButtons().find((b) => b.textContent?.trim() === 'Reject')!.click();
    await fixture.whenStable();

    expect(sent[0]?.decision).toBe('reject');
  });

  it('AC-2: the answer an operator types reaches the runtime as the note', async () => {
    // The gap that made mission 5ed04265 unrecoverable from the UI: the queue
    // rendered the questions and offered only Approve and Reject, so the answer
    // had nowhere to go. One box per finding; the answers travel in `note`.
    const boxes = Array.from(
      fixture.nativeElement.querySelectorAll('.questions textarea') as NodeListOf<HTMLTextAreaElement>,
    );
    expect(boxes, 'no answer box was rendered for the question the item is asking').toHaveLength(1);

    boxes[0]!.value = 'Use the parish census.';
    boxes[0]!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const send = queueButtons().find((b) => b.textContent?.includes('Send answers'));
    expect(send?.disabled, 'the send button stayed disabled after an answer was typed').toBe(false);
    send!.click();
    await fixture.whenStable();

    expect(sent[0]?.action).toBe('decide');
    expect(sent[0]?.decision).toBe('approve');
    expect(sent[0]?.note).toContain('no census exists');
    expect(sent[0]?.note).toContain('Use the parish census.');
  });

  it('DISTRACTOR: with nothing typed, the send button is disabled and sends nothing', async () => {
    // An empty note would clear the block while answering nothing — exactly the
    // blind approval this control exists to replace. The "proceed anyway" path
    // is still there, but it says what it is.
    const send = queueButtons().find((b) => b.textContent?.includes('Send answers'));

    expect(send?.disabled).toBe(true);
    send!.click();
    await fixture.whenStable();

    expect(sent).toHaveLength(0);
  });
});

/**
 * R19 — the lenses must be REACHABLE and must agree.
 *
 * Reachability first, because this project has shipped four capabilities that
 * worked and had no caller. Agreement second, because that is the AC that makes
 * five lenses one dashboard rather than five dashboards.
 */
describe('MissionControl — the five lenses (R19)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;

  const trail = () => [
    ev(1, 'mission.started', MISSION, { objective: 'Root' }),
    ev(2, 'task.contracted', 't-a', { objective: 'Part A', category: 'research', parentTaskId: MISSION }),
    ev(3, 'agent.staffed', 't-a', { designId: 'analyst', version: 3, logicalTier: 2 }),
    ev(4, 'task.executed', 't-a', { effortSpent: 2 }),
    ev(5, 'gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);
    feed.events.set(trail());
    fixture.detectChanges();
  });

  it('renders a switcher button for every lens', () => {
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.lenses button') as NodeListOf<HTMLButtonElement>,
    ).map((b) => b.textContent?.trim());

    for (const lens of ['canvas', 'workforce', 'timeline', 'learning', 'ledger']) {
      expect(labels, `no switcher button for "${lens}"`).toContain(lens);
    }
  });

  it('the workforce lens shows the staffed specialist with its design and version', () => {
    component.lens.set('workforce');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('analyst');
    expect(text).toContain('v3');
    expect(text).toContain('100% compliant');
  });

  it('the timeline lens shows a lane for the task', () => {
    component.lens.set('timeline');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Part A');
    expect(fixture.nativeElement.querySelectorAll('.lanes > li').length).toBe(1);
  });

  it('the ledger explorer shows every event, and narrows when filtered', () => {
    component.lens.set('ledger');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.rows li').length).toBe(5);
  });

  it('the learning observatory says plainly that nothing has been recorded', () => {
    // Honest emptiness rather than invented content — still the right property.
    //
    // The assertion CHANGED because its expectation had gone stale: it required
    // the literal words "not built yet", which the panel used to say because
    // R26 and R27 were unbuilt. Both loops ship now and emit, so a lens still
    // claiming they do not exist would be asserting something false about the
    // system. The empty state is still asserted; the obsolete reason for it is
    // not (defect: the lens read four event types nothing ever emitted).
    component.lens.set('learning');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Learning observatory');
    expect(text, 'this mission recorded no learning events, so the lens must say so').toMatch(
      /No experiment is running|no experiment, adoption, petition/i,
    );
    expect(text, 'the stale "the loops are unbuilt" claim must be gone').not.toContain('not built yet');
  });

  it('AC-4 DISTRACTOR: the workforce lens and the canvas agree about this mission', () => {
    // Each is a projection of the identical event list, so they cannot disagree
    // — this asserts that rather than trusting it.
    component.lens.set('workforce');
    fixture.detectChanges();

    const staffedNodes = component.visibleNodes().filter((n) => n.designId !== null).length;
    const agents = fixture.nativeElement.querySelectorAll('.agents li').length;

    expect(agents).toBe(staffedNodes);
  });

  it('DISTRACTOR: switching lenses changes no ledger fact', () => {
    const before = JSON.stringify(feed.tree());

    for (const lens of component.lenses) {
      component.lens.set(lens);
      fixture.detectChanges();
    }

    expect(JSON.stringify(feed.tree())).toBe(before);
    expect(feed.events()).toHaveLength(5);
  });
});

/**
 * R20 — time travel.
 *
 * The projection is unit-tested in `time-travel.spec.ts`. These tests are about
 * the cockpit actually WIRING it: that the scrubber exists on screen, that every
 * view is routed through the cursor rather than only the canvas, and above all
 * that the past is read-only. This project has shipped four "correct component
 * nothing calls" defects; a scrubber that only the canvas obeys would be the
 * fifth, and the operator would be reading a mixture of two moments.
 */
describe('MissionControl — time travel (R20)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;
  let sent: CockpitCommand[];

  /** Task A fails, then is retried and passes. B is contracted along the way. */
  const trail = () => [
    ev(1, 'mission.started', MISSION, { objective: 'Root' }),
    ev(2, 'task.contracted', 't-a', {
      objective: 'Part A', parentTaskId: MISSION, ceiling: 10,
      acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Cites a source.' }],
    }),
    ev(3, 'agent.staffed', 't-a', { designId: 'analyst', version: 1, logicalTier: 1 }),
    ev(4, 'task.executed', 't-a', { effortSpent: 2, ceiling: 10 }),
    ev(5, 'gate_b.verdict_issued', 't-a', {
      outcome: 'fail', findings: [{ criterionId: 'ac-1', detail: 'no citation' }],
    }),
    ev(6, 'task.contracted', 't-b', { objective: 'Part B', parentTaskId: MISSION }),
    ev(7, 'task.executed', 't-a', { effortSpent: 6, ceiling: 10 }),
    ev(8, 'gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }),
  ];

  beforeEach(async () => {
    sent = [];
    const stub: Pick<Cockpit, 'act'> = { async act(command) { sent.push(command); } };
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Cockpit, useValue: stub }],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);

    component.select(MISSION);
    feed.events.set(trail());
    fixture.detectChanges();
  });

  it('AC-0: the scrubber is RENDERED — time travel is reachable, not merely implemented', () => {
    const scrubber = fixture.nativeElement.querySelector('.scrubber input[type="range"]') as HTMLInputElement;

    expect(scrubber, 'no scrubber on screen').toBeTruthy();
    expect(Number(scrubber.max)).toBe(8);
  });

  it('AC-0: scrubbing back renders the canvas as it stood at that moment', () => {
    component.scrubTo(5);
    fixture.detectChanges();

    // At seq 5 the mission had one task and it had just failed.
    expect(component.visibleNodes().map((n) => n.taskId)).toEqual(['t-a']);
    expect(component.visibleNodes()[0]!.status).toBe('failed');

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Part B');
  });

  it('AC-0: the inspector and budgets read as they stood, not as they stand now', () => {
    component.selectTask('t-a');
    component.scrubTo(5);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('2 / 10');        // effort at that moment, not 6
    expect(text).toContain('no citation');   // the verdict that stood then
    expect(text).toContain('0 / 1 met');
  });

  it('AC-0: the lenses obey the cursor too — every view shows one moment, not a mixture', () => {
    // The defect this guards: routing only the canvas through the cursor, so the
    // operator reads a past canvas beside a present ledger and cannot tell.
    component.lens.set('ledger');
    component.scrubTo(4);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.rows li').length).toBe(4);
  });

  it('AC-0: returning to live restores the present', () => {
    component.scrubTo(5);
    fixture.detectChanges();
    expect(component.isPast()).toBe(true);

    component.returnToLive();
    fixture.detectChanges();

    expect(component.isPast()).toBe(false);
    expect(component.visibleNodes().map((n) => n.taskId)).toEqual(['t-a', 't-b']);
    expect(fixture.nativeElement.textContent).toContain('Part B');
  });

  it('AC-1: comparing two moments shows what changed between them', () => {
    component.scrubTo(5);
    component.markCompareStart();
    component.scrubTo(8);
    fixture.detectChanges();

    const diff = component.diff();
    expect(diff, 'no diff produced').not.toBeNull();
    expect(diff!.appeared.map((t) => t.objective)).toEqual(['Part B']);
    expect(diff!.changed[0]).toMatchObject({ taskId: 't-a', before: 'failed', after: 'verified' });
    expect(diff!.criteriaMet).toBe(1);

    // ...and it is on screen, not just in a signal.
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Part B');
    expect(text).toMatch(/criteria met/i);
  });

  it('AC-2 DISTRACTOR: the past is read-only — no cockpit action can be issued against it', async () => {
    component.selectTask('t-a');
    component.scrubTo(5);
    fixture.detectChanges();

    await component.pauseTask();
    await component.cancelTask();
    await component.grantBudget();
    await component.turnDial();

    // The guard must live in the METHOD, not only in the template. A disabled
    // button still has a keyboard path, a stale click and a test that calls it —
    // and an action issued against a superseded state is exactly what this
    // criterion forbids.
    expect(sent).toEqual([]);
  });

  it('AC-2 DISTRACTOR: the controls are hidden while showing the past, and return when live', () => {
    component.selectTask('t-a');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.cockpit button').length).toBeGreaterThan(0);

    component.scrubTo(5);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.cockpit button').length).toBe(0);
    expect(fixture.nativeElement.textContent).toMatch(/read-only|read only/i);

    // The inverse matters as much: controls that never came back would satisfy
    // "unavailable in the past" while breaking the cockpit permanently.
    component.returnToLive();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.cockpit button').length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: time travel changes no ledger fact — the trail is untouched', () => {
    const before = JSON.stringify(feed.events());

    component.scrubTo(3);
    fixture.detectChanges();
    component.scrubTo(7);
    fixture.detectChanges();
    component.returnToLive();

    expect(JSON.stringify(feed.events())).toBe(before);
    expect(feed.events()).toHaveLength(8);
  });

  it('DISTRACTOR: a live mission growing under a parked cursor does not drag the view forward', () => {
    // The operator is reading seq 5. New events arriving must not silently
    // change what they are looking at — that is the whole point of parking.
    component.scrubTo(5);
    fixture.detectChanges();

    feed.events.update((events) => [...events, ev(9, 'mission.folded', MISSION, {})]);
    fixture.detectChanges();

    expect(component.visibleEvents()).toHaveLength(5);
    expect(fixture.nativeElement.textContent).not.toContain('delivered');
  });
});

/**
 * R22 — audience scoping.
 *
 * The scope decision is unit-tested in `audience.spec.ts`. These tests are
 * about the cockpit OBEYING it — and specifically about the guard living where
 * the action is sent, not only where the button is drawn. R20 taught that
 * lesson once; hiding a control is not the same as withholding a capability.
 */
describe('MissionControl — audience scoping (R22)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let component: MissionControl;
  let feed: LedgerFeed;
  let fleet: Fleet;
  let sent: CockpitCommand[];

  const trail = () => [
    ev(1, 'mission.intake_accepted', MISSION, {
      objective: 'Explain three things about lamps.',
      budget: { unit: 'effort-units', floor: 1, ceiling: 40 },
      contract: {
        acceptanceCriteria: [
          { criterionId: 'm-1', statement: 'Explains what a light bulb does.' },
          { criterionId: 'm-2', statement: 'Explains what a light switch does.' },
        ],
      },
    }),
    ev(2, 'mission.started', MISSION, { objective: 'Explain three things about lamps.' }),
    ev(3, 'task.contracted', 't-a', {
      objective: 'INTERNAL bulb subtask', parentTaskId: MISSION,
      acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Explains what a light bulb does.' }],
    }),
    ev(4, 'task.executed', 't-a', { effortSpent: 2 }),
    ev(5, 'gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }),
  ];

  beforeEach(async () => {
    sent = [];
    const stub: Pick<Cockpit, 'act'> = { async act(command) { sent.push(command); } };
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Cockpit, useValue: stub }],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    feed = TestBed.inject(LedgerFeed);
    fleet = TestBed.inject(Fleet);

    component.select(MISSION);
    feed.events.set(trail());
    component.selectTask('t-a');
    fixture.detectChanges();
  });

  it('AC-0: the operator reaches all five lenses, the raw ledger and the attention queue', () => {
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.lenses button') as NodeListOf<HTMLButtonElement>,
    ).map((b) => b.textContent?.trim());

    for (const lens of ['canvas', 'workforce', 'timeline', 'learning', 'ledger']) {
      expect(labels, `operator cannot reach the "${lens}" lens`).toContain(lens);
    }
    // `section.attention` became `section.queue` when the queue was split into
    // what is blocked and what is merely advisory. Same reachability claim.
    expect(fixture.nativeElement.querySelector('section.queue')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.cockpit button').length).toBeGreaterThan(0);
  });

  it('AC-0: the audience is switchable from the UI — the scoping is reachable, not theoretical', () => {
    const picker = fixture.nativeElement.querySelector('select[name="audience"]') as HTMLSelectElement;

    expect(picker, 'no audience picker on screen').toBeTruthy();
    expect(Array.from(picker.options).map((o) => o.value).sort())
      .toEqual(['observer', 'operator', 'requester']);
  });

  it('AC-1: the requester sees progress against the MISSION criteria and budget, not internal tasks', () => {
    component.audience.set('requester');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Explains what a light bulb does.');
    expect(text).toContain('Explains what a light switch does.');
    expect(text).toContain('2');  // consumed
    expect(text).toContain('40'); // granted

    // The internal subtask must not leak into the requester's view.
    expect(text).not.toContain('INTERNAL bulb subtask');
  });

  it('AC-1: the requester keeps exactly the three powers intake promised them', async () => {
    component.audience.set('requester');
    fixture.detectChanges();

    // A real note, so the refusal is the AUDIENCE guard and not annotate()'s
    // own empty-note check — otherwise this assertion would pass vacuously.
    component.noteText.set('Please hurry.');

    await component.pauseTask();
    await component.cancelTask();
    await component.annotate();
    expect(sent, 'a requester must not pause, cancel or annotate').toEqual([]);

    component.grantAmount.set(5);
    await component.grantBudget();
    await component.turnDial();
    expect(sent.map((c) => c.action)).toEqual(['grant_budget', 'turn_dial']);
  });

  it('AC-1 DISTRACTOR: flagged assumptions are shown as unavailable, never as "none"', () => {
    // Nothing in the ledger carries them (R30/R40 are the unbuilt producers).
    // An empty list would tell the requester nothing was assumed.
    component.audience.set('requester');
    fixture.detectChanges();

    expect(component.requesterView().assumptions).toBeNull();
    expect(fixture.nativeElement.textContent).toMatch(/not recorded|unavailable/i);
  });

  it('AC-2 DISTRACTOR: the learning observer is offered no action at all', async () => {
    component.audience.set('observer');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.cockpit button').length).toBe(0);

    // ...and the guard holds where the action is SENT, not only where it is drawn.
    component.noteText.set('Observers should not be able to write this.');

    await component.pauseTask();
    await component.resumeTask();
    await component.cancelTask();
    await component.grantBudget();
    await component.turnDial();
    await component.annotate();
    await component.decide({ missionId: MISSION, taskId: 't-a' }, 'approve');

    expect(sent, 'an observer must not be able to steer the system it measures').toEqual([]);
  });

  it('AC-2 DISTRACTOR: the observer gets the observatory, not the whole cockpit greyed out', () => {
    component.audience.set('observer');
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.lenses button') as NodeListOf<HTMLButtonElement>,
    ).map((b) => b.textContent?.trim());

    expect(labels).toEqual(['learning']);
    expect(fixture.nativeElement.querySelector('section.attention')).toBeNull();
  });

  it('DISTRACTOR: a lens the new audience may not see is left behind, not kept showing', () => {
    // The operator is on the ledger explorer; switching to observer must not
    // keep rendering it just because a signal still says 'ledger'.
    component.lens.set('ledger');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rows')).toBeTruthy();

    component.audience.set('observer');
    fixture.detectChanges();

    expect(component.activeLens()).toBe('learning');
    expect(fixture.nativeElement.querySelector('.rows')).toBeNull();
  });

  it('DISTRACTOR: scoping changes what is shown, never what the ledger says', () => {
    const before = JSON.stringify(feed.events());

    for (const audience of ['requester', 'observer', 'operator'] as const) {
      component.audience.set(audience);
      fixture.detectChanges();
    }

    expect(JSON.stringify(feed.events())).toBe(before);
    expect(feed.events()).toHaveLength(5);
  });
});

/**
 * R15 AC-0 — the canvas is a tree PLUS a typed dependency graph.
 *
 * "edges connect each node to its parent and to the tasks it depends on."
 *
 * Parenthood is drawn by nesting. Dependency had nothing to draw until R32 gave
 * the planner a way to declare edges — and a bare count ("after 1") names a
 * number, not a connection: an operator cannot tell WHICH sibling a task is
 * waiting on, which is the only thing the edge is for.
 */
describe('MissionControl — canvas dependency edges (R15 AC-0)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let feed: LedgerFeed;

  const trail = () => [
    ev(1, 'mission.started', MISSION, { objective: 'Write then critique.' }),
    ev(2, 'task.contracted', 't-draft', {
      objective: 'Write the paragraph.', category: 'writing', parentTaskId: MISSION, dependsOn: [],
    }),
    ev(3, 'task.contracted', 't-critique', {
      objective: 'Critique the paragraph.', category: 'review', parentTaskId: MISSION,
      dependsOn: ['t-draft'],
    }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    feed = TestBed.inject(LedgerFeed);
    feed.events.set(trail());
    fixture.detectChanges();
  });

  it('names the task each node depends on, not merely how many', () => {
    const chips = Array.from(
      fixture.nativeElement.querySelectorAll('.deps') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim() ?? '');

    expect(chips.join(' ')).toContain('Write the paragraph.');
  });

  it('DISTRACTOR: a node with no dependencies renders no edge at all', () => {
    // "after 0" or an empty chip would suggest a relationship the ledger never
    // recorded — and every independent task would look like it was waiting.
    const nodes = Array.from(
      fixture.nativeElement.querySelectorAll('app-canvas-node') as NodeListOf<HTMLElement>,
    );
    const draft = nodes.find((n) => n.textContent?.includes('Write the paragraph.'));

    expect(draft?.querySelector('.deps')).toBeNull();
  });

  it('DISTRACTOR: an edge to a task not in the trail degrades to its id, not a blank chip', () => {
    // The producer may live in another subtree, or the event may not have
    // arrived yet. A blank chip would read as "depends on nothing".
    feed.events.set([
      ...trail(),
      ev(4, 'task.contracted', 't-orphan', {
        objective: 'Consume something absent.', parentTaskId: MISSION, dependsOn: ['t-elsewhere'],
      }),
    ]);
    fixture.detectChanges();

    const chips = Array.from(
      fixture.nativeElement.querySelectorAll('.deps') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim() ?? '');

    expect(chips.join(' ')).toContain('t-elsewhere');
  });
});

/**
 * R31 — a mission the gate kept WHOLE must not look like a mission that never
 * started.
 *
 * When the decompose-or-delegate gate declines to split, no child task is ever
 * contracted, so the canvas has no nodes to draw — and its empty state said
 * "No tasks contracted yet." on a mission that had run three attempts and been
 * verified three times. That is the one thing the canvas must never do: be
 * quietly less complete than the ledger, so the operator cannot tell a missing
 * node from a finished one.
 */
describe('MissionControl — a node kept whole by the gate (R31)', () => {
  let fixture: ComponentFixture<MissionControl>;
  let feed: LedgerFeed;

  const keptWhole = () => [
    ev(1, 'mission.started', MISSION, { objective: 'Compose a single limerick.' }),
    ev(2, 'decomposition.decided', MISSION, {
      decision: 'keep_whole',
      rationale: 'Rhyme and metre constrain each other; splitting would damage it.',
      ceiling: 30,
    }),
    ev(3, 'agent.staffed', MISSION, { designId: 'poet', version: 1, logicalTier: 1 }),
    ev(4, 'task.executed', MISSION, { effortSpent: 4, ceiling: 30 }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MissionControl);
    feed = TestBed.inject(LedgerFeed);
  });

  it('says the work was kept whole, and why, instead of "no tasks contracted"', () => {
    feed.events.set(keptWhole());
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toMatch(/kept whole/i);
    expect(text).toContain('Rhyme and metre constrain each other');
    expect(text, 'the old message is a lie on this mission').not.toContain('No tasks contracted yet');
  });

  it('DISTRACTOR: a mission that genuinely has not started yet still says so', () => {
    // Without this, "always claim it was kept whole" would pass the test above
    // and mislabel every mission that is merely still decomposing.
    feed.events.set([ev(1, 'mission.started', MISSION, { objective: 'Something else.' })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No tasks contracted yet');
  });

  it('DISTRACTOR: a mission the gate SPLIT shows its nodes, not the kept-whole notice', () => {
    feed.events.set([
      ev(1, 'mission.started', MISSION, { objective: 'Two things.' }),
      ev(2, 'decomposition.decided', MISSION, { decision: 'split', rationale: 'Unrelated.', ceiling: 30 }),
      ev(3, 'task.contracted', 't-a', { objective: 'Thing one.', parentTaskId: MISSION }),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Thing one.');
    expect(text).not.toMatch(/kept whole/i);
  });
});
