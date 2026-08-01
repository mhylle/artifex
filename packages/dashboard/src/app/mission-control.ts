/**
 * Mission Control — the cockpit.
 *
 * Renders the tree that `buildMissionTree` folds out of the ledger. It owns no
 * state: everything on screen is a `computed` over the raw event list, so what
 * the operator sees cannot disagree with the audit trail.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { mayAct, scopeFor } from './audience';
import type { Audience } from './audience';
import { CanvasNode } from './canvas-node';
import { Cockpit } from './cockpit';
import type { CockpitAction } from './cockpit';
import { buildRequesterView } from './requester-view';
import { answerNote, partitionAttention } from './attention-queue';
import { Fleet } from './fleet';
import type { AttentionItem } from './fleet';
import { groupMissions } from './fleet-groups';
import { Inspector } from './inspector';
import { LensPanels } from './lens-panels';
import type { LensName } from './lens-panels';
import { LedgerFeed } from './ledger-feed';
import { MissionIntake, toLines } from './mission-intake';
import { buildMissionTree } from './mission-tree';
import type { TaskNode } from './mission-tree';
import { diffMoments, eventsAsOf, momentsOf } from './time-travel';

@Component({
  selector: 'app-mission-control',
  standalone: true,
  imports: [FormsModule, CanvasNode, Inspector, LensPanels],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mission-control.html',
  styleUrl: './mission-control.css',
})
export class MissionControl implements OnInit {
  readonly feed = inject(LedgerFeed);
  readonly fleet = inject(Fleet);
  readonly #intake = inject(MissionIntake);
  readonly #cockpit = inject(Cockpit);

  readonly missionId = signal('');

  /**
   * Rail search, and the answers being drafted in the queue.
   *
   * Both are properties of *looking and typing*, never facts about a mission —
   * so they live here and touch no projection (invariant #1).
   */
  readonly search = signal('');
  readonly answers = signal<Record<string, readonly string[]>>({});
  /** The out-of-band petitions, behind a disclosure. Closed by default. */
  readonly showAdvisory = signal(false);
  /** Which collapsed rail groups the operator has opened. */
  readonly openGroups = signal<Record<string, boolean>>({});

  /**
   * The rail, grouped and filtered (R21).
   *
   * 170 missions in one flat list, 26 of them abandoned and most titled with a
   * raw UUID, is how a live mission got buried under yesterday's corpses.
   */
  readonly missionGroups = computed(() => groupMissions(this.fleet.missions(), this.search()));

  /**
   * The queue, split by whether anything is stopped behind it (R18).
   *
   * Measured live: 61 items, 49 of them out-of-band amendment petitions. The
   * operator's own blocked mission was one row among them.
   */
  readonly triaged = computed(() => partitionAttention(this.fleet.attention()));

  isGroupOpen(status: string, collapsed: boolean): boolean {
    return collapsed ? (this.openGroups()[status] ?? false) : true;
  }

  toggleGroup(status: string): void {
    this.openGroups.update((all) => ({ ...all, [status]: !(all[status] ?? false) }));
  }

  /** The draft an operator is authoring. Cleared once the mission is accepted. */
  readonly objective = signal('');
  readonly criteriaText = signal('');
  readonly outOfScopeText = signal('');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Canvas view state — zoom, which subtree is focused, which node is selected.
   *
   * All of it lives here and none of it in the projection: these are properties
   * of *looking at* a mission, not facts about it, and the tree must remain a
   * pure function of the ledger (invariant #1).
   */
  /**
   * Which of the five lenses is showing (R19).
   *
   * A property of looking, like zoom and focus — never of the mission, so it
   * lives here and touches no projection.
   */
  readonly lens = signal<LensName>('canvas');
  readonly lenses: readonly LensName[] = ['canvas', 'workforce', 'timeline', 'learning', 'ledger'];

  /**
   * Audience scoping (R22) — one substrate, three ways of being allowed to look.
   *
   * Not identity: no authentication exists yet and none is implied. This picks
   * a *view*, and the scope it resolves to decides both what is rendered and
   * what may be sent.
   */
  readonly audience = signal<Audience>('operator');
  readonly audiences: readonly Audience[] = ['operator', 'requester', 'observer'];
  readonly scope = computed(() => scopeFor(this.audience()));

  /**
   * The lens actually showing, after scoping.
   *
   * An audience that may not see the selected lens falls back to the first it
   * is allowed. Keeping `lens()` as the sole authority would leave an observer
   * staring at the ledger explorer because a signal still said 'ledger'.
   */
  readonly activeLens = computed<LensName | null>(() => {
    const allowed = this.scope().lenses;
    const current = this.lens();
    return allowed.includes(current) ? current : (allowed[0] ?? null);
  });

  /** The requester's own mission, in their terms — never internal task counts. */
  readonly requesterView = computed(() => buildRequesterView(this.visibleEvents()));

  /**
   * The decompose-or-delegate gate's verdict for this node, when it declined to
   * split (R31).
   *
   * A kept-whole mission contracts no children, so the canvas has nothing to
   * draw — and "No tasks contracted yet" is then a lie about a mission that ran.
   * The canvas must never be quietly less complete than the ledger.
   */
  readonly keptWhole = computed(() => {
    const decision = [...this.visibleEvents()]
      .reverse()
      .find((event) => event.type === 'decomposition.decided');
    if (decision === undefined || decision.payload['decision'] !== 'keep_whole') return null;
    const rationale = decision.payload['rationale'];
    return { rationale: typeof rationale === 'string' ? rationale : '' };
  });

  /**
   * `taskId` → objective for every task in the moment being shown, so a
   * dependency edge can name the task it points at rather than counting them
   * (R15 AC-0). Built from the same projection the canvas draws, so it cannot
   * disagree with it.
   */
  readonly nodeLabels = computed(() => {
    const labels: Record<string, string> = {};
    const walk = (nodes: readonly TaskNode[]): void => {
      for (const node of nodes) {
        labels[node.taskId] = node.objective || node.taskId;
        walk(node.children);
      }
    };
    walk(this.visibleTree()?.children ?? []);
    return labels;
  });

  /** Template-side guard, so a control is drawn only where it could be used. */
  can(action: CockpitAction): boolean {
    return mayAct(this.audience(), action);
  }

  readonly selectedTaskId = signal<string | null>(null);
  readonly focusedTaskId = signal<string | null>(null);
  readonly zoom = signal(1);

  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));

  /**
   * Time travel (R20) — which moment the cockpit is showing.
   *
   * `null` is the present. Like zoom and lens this is a property of *looking*,
   * so it lives here and touches no projection: the past is reconstructed by
   * re-folding a truncated event list, never by reading a stored snapshot.
   */
  readonly cursor = signal<number | null>(null);
  readonly isPast = computed(() => this.cursor() !== null);

  /** Every recorded event is a stop the operator can visit. */
  readonly moments = computed(() => momentsOf(this.feed.events()));

  readonly firstSeq = computed(() => this.moments()[0]?.seq ?? 0);
  readonly lastSeq = computed(() => this.moments().at(-1)?.seq ?? 0);

  /** Where the scrubber handle sits: the parked moment, or the newest event. */
  readonly cursorSeq = computed(() => this.cursor() ?? this.lastSeq());

  readonly currentMoment = computed(() => {
    const seq = this.cursorSeq();
    return this.moments().find((moment) => moment.seq === seq) ?? null;
  });

  /**
   * The trail as of the cursor — the single source every view below reads.
   *
   * Everything on screen routes through this rather than `feed.events()`. A view
   * that read the raw feed would keep showing the present beside a past canvas,
   * and the operator would have no way to tell they were reading two moments at
   * once.
   */
  readonly visibleEvents = computed(() => eventsAsOf(this.feed.events(), this.cursor()));
  readonly visibleTree = computed(() => buildMissionTree(this.visibleEvents()));

  /** The other end of a comparison, if the operator has marked one. */
  readonly compareFrom = signal<number | null>(null);

  readonly diff = computed(() => {
    const from = this.compareFrom();
    if (from === null) return null;
    return diffMoments(this.feed.events(), from, this.cursorSeq());
  });

  /** The path from task zero down to the focused subtree. */
  readonly breadcrumb = computed(() => {
    const focused = this.focusedTaskId();
    if (focused === null) return [];
    return pathTo(this.visibleTree()?.children ?? [], focused);
  });

  /** What the canvas draws: the whole tree, or the focused subtree. */
  readonly visibleNodes = computed(() => {
    const roots = this.visibleTree()?.children ?? [];
    const focused = this.focusedTaskId();
    if (focused === null) return roots;
    const node = findTask(roots, focused);
    // A focus that no longer exists falls back to the whole tree rather than
    // rendering an empty canvas the operator cannot explain.
    return node === null ? roots : [node];
  });

  /** The node the inspector is showing — resolved from the projection, not stored. */
  readonly selectedTask = computed(() => {
    const taskId = this.selectedTaskId();
    if (taskId === null) return null;
    return findTask(this.visibleTree()?.children ?? [], taskId);
  });

  scrubTo(seq: number): void {
    this.cursor.set(seq);
  }

  returnToLive(): void {
    this.cursor.set(null);
  }

  /** Marks the current moment as one end of a comparison (AC-1). */
  markCompareStart(): void {
    this.compareFrom.set(this.cursorSeq());
  }

  clearCompare(): void {
    this.compareFrom.set(null);
  }

  /** Cockpit inputs. The dial addresses the mission; the rest address a task. */
  readonly grantAmount = signal(10);
  readonly dial = signal<'autonomous' | 'checkpointed' | 'supervised'>('checkpointed');
  readonly noteText = signal('');
  readonly cockpitError = signal<string | null>(null);

  async pauseTask(): Promise<void> { await this.#actOnTask('pause'); }
  async resumeTask(): Promise<void> { await this.#actOnTask('resume'); }
  async cancelTask(): Promise<void> { await this.#actOnTask('cancel'); }

  async grantBudget(): Promise<void> {
    await this.#actOnTask('grant_budget', { amount: this.grantAmount() });
  }

  async annotate(): Promise<void> {
    const note = this.noteText().trim();
    // An empty annotation teaches the Learning Agent nothing and clutters the
    // trail; refuse it here rather than append it.
    if (note.length === 0) return;
    await this.#actOnTask('annotate', { note });
    this.noteText.set('');
  }

  /**
   * Turn the autonomy dial.
   *
   * Addressed to the MISSION (taskId null), never to a task: the dial is
   * mission-level, fixed at intake, and a child may never widen its own autonomy.
   */
  /**
   * Answer an item in the attention queue (R18 AC-2).
   *
   * Deciding is the only cockpit action that re-enqueues the mission, because it
   * is the only one that UNBLOCKS: the runtime resumes by replaying the trail
   * (R41), and it only replays when a job arrives. The rail refreshes afterwards
   * so the answered item leaves the queue rather than lingering as a decision
   * the operator has already made.
   */
  async decide(item: { missionId: string; taskId: string }, decision: 'approve' | 'reject'): Promise<void> {
    // A learning observer may read every mission and steer none of them (R22).
    if (!this.can('decide')) return;
    await this.#send({ missionId: item.missionId, taskId: item.taskId, action: 'decide', decision });
    await this.fleet.refresh();
  }

  /**
   * Answer the questions an item is actually asking, and resume.
   *
   * The gap this closes: the queue rendered the questions and offered only
   * Approve and Reject, so the one thing the mission was waiting for — the
   * answer — had nowhere to go. Approve meant "run anyway with the ambiguity
   * unresolved"; neither button answered anything. Observed on mission
   * `5ed04265`, which asked three load-bearing questions and sat surrendered.
   *
   * The answers travel in `note`, which is the field the runtime already
   * records verbatim on `operator.decided`. Nothing parses it, by design
   * (ADR-0023) — this is for the human who opens the trail later.
   */
  async sendAnswers(item: AttentionItem): Promise<void> {
    if (!this.can('decide')) return;
    const note = answerNote(item.findings, this.answersFor(item.taskId));
    // An empty note would record a ruling that answered nothing while clearing
    // the block — exactly the blind approval this control exists to replace.
    if (note === '') return;
    await this.#send({
      missionId: item.missionId,
      taskId: item.taskId,
      action: 'decide',
      decision: 'approve',
      note,
    });
    this.answers.update((all) => ({ ...all, [item.taskId]: [] }));
    await this.fleet.refresh();
  }

  /** The draft answers for one queue item, indexed by question position. */
  answersFor(taskId: string): readonly string[] {
    return this.answers()[taskId] ?? [];
  }

  answerAt(taskId: string, index: number): string {
    return this.answersFor(taskId)[index] ?? '';
  }

  setAnswer(taskId: string, index: number, value: string): void {
    this.answers.update((all) => {
      const next = [...(all[taskId] ?? [])];
      next[index] = value;
      return { ...all, [taskId]: next };
    });
  }

  /** Has the operator written anything worth sending for this item? */
  hasAnswers(item: AttentionItem): boolean {
    return answerNote(item.findings, this.answersFor(item.taskId)) !== '';
  }

  async turnDial(): Promise<void> {
    const missionId = this.missionId();
    if (missionId.length === 0 || this.isPast() || !this.can('turn_dial')) return;
    await this.#send({ missionId, taskId: null, action: 'turn_dial', autonomyDial: this.dial() });
  }

  /**
   * The cockpit's task-scoped actions.
   *
   * The read-only guard lives HERE rather than only in the template, because a
   * hidden button is not an absent capability: there is still a keyboard path, a
   * stale click on a view that has just changed, and any caller that reaches the
   * method directly. R20 AC-2 forbids issuing an action against a state that has
   * already been superseded, and that has to be enforced where the action is
   * sent.
   *
   * Deciding an attention-queue item deliberately does NOT pass through here.
   * It addresses a different mission entirely, so a parked cursor on the mission
   * being watched says nothing about it — blocking it would strand the operator
   * who parked the view precisely in order to investigate before answering.
   */
  async #actOnTask(action: CockpitAction, extra: Record<string, unknown> = {}): Promise<void> {
    const missionId = this.missionId();
    const taskId = this.selectedTaskId();
    if (missionId.length === 0 || taskId === null || this.isPast() || !this.can(action)) return;
    await this.#send({ missionId, taskId, action, ...extra });
  }

  async #send(command: Parameters<Cockpit['act']>[0]): Promise<void> {
    try {
      await this.#cockpit.act(command);
      this.cockpitError.set(null);
    } catch (cause: unknown) {
      // Surfaced: an action that silently failed would leave the operator
      // believing they had stopped something that is still running.
      this.cockpitError.set(messageOf(cause));
    }
  }

  selectTask(taskId: string): void {
    this.selectedTaskId.set(taskId);
  }

  focus(taskId: string): void {
    this.focusedTaskId.set(taskId);
  }

  clearFocus(): void {
    this.focusedTaskId.set(null);
  }

  // Zoom is bounded so the canvas cannot be driven to a size nothing is legible
  // at, in either direction.
  zoomIn(): void {
    this.zoom.update((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10));
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10));
  }

  resetZoom(): void {
    this.zoom.set(1);
  }

  ngOnInit(): void {
    // The rail is what makes this screen usable cold; fetch it before the
    // operator has to think of anything to type.
    void this.fleet.refresh();
  }

  watch(): void {
    this.feed.watch(this.missionId());
  }

  /** Switch the cockpit to a mission chosen from the rail. */
  select(missionId: string): void {
    this.missionId.set(missionId);
    this.feed.watch(missionId);
  }

  /**
   * Start a mission and immediately watch it.
   *
   * The refusals below are not a second opinion on the control plane's rules —
   * they are the same rule applied where the operator can still act on it. A
   * draft that cannot be graded never reaches the wire, so the feedback is
   * immediate and the trail is not littered with rejected intakes.
   */
  async submit(): Promise<void> {
    const objective = this.objective().trim();
    const successCriteria = toLines(this.criteriaText());

    if (objective.length === 0) {
      this.error.set('A mission needs an objective.');
      return;
    }
    if (successCriteria.length === 0) {
      this.error.set('A mission needs at least one success criterion — a mission nobody can grade is not a mission.');
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      const missionId = await this.#intake.submit({
        objective,
        successCriteria,
        outOfScope: toLines(this.outOfScopeText()),
      });

      // Watching is the point: an operator who starts a mission should not then
      // have to find its id to see what it is doing.
      this.missionId.set(missionId);
      this.feed.watch(missionId);
      this.objective.set('');
      this.criteriaText.set('');
      this.outOfScopeText.set('');
    } catch (cause: unknown) {
      // Surfaced rather than swallowed — a silent failure is indistinguishable
      // from a control plane that is simply down.
      this.error.set(messageOf(cause));
    } finally {
      this.submitting.set(false);
    }
  }
}

/** Depth-first search for one task in the projected tree. */
function findTask(nodes: readonly TaskNode[], taskId: string): TaskNode | null {
  for (const node of nodes) {
    if (node.taskId === taskId) return node;
    const found = findTask(node.children, taskId);
    if (found !== null) return found;
  }
  return null;
}

/** The ancestors of `taskId`, task-zero-first, including the task itself. */
function pathTo(nodes: readonly TaskNode[], taskId: string): TaskNode[] {
  for (const node of nodes) {
    if (node.taskId === taskId) return [node];
    const below = pathTo(node.children, taskId);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

/** Prefers the control plane's own words over a generic transport message. */
function messageOf(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'error' in cause) {
    const body = (cause as { error?: { message?: unknown } }).error;
    if (typeof body?.message === 'string') return body.message;
  }
  return cause instanceof Error ? cause.message : 'The control plane rejected the mission.';
}
