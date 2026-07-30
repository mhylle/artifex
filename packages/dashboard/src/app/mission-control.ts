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

import { CanvasNode } from './canvas-node';
import { Fleet } from './fleet';
import { LedgerFeed } from './ledger-feed';
import { MissionIntake, toLines } from './mission-intake';
import type { TaskNode } from './mission-tree';

@Component({
  selector: 'app-mission-control',
  standalone: true,
  imports: [FormsModule, CanvasNode],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mission-control.html',
  styleUrl: './mission-control.css',
})
export class MissionControl implements OnInit {
  readonly feed = inject(LedgerFeed);
  readonly fleet = inject(Fleet);
  readonly #intake = inject(MissionIntake);

  readonly missionId = signal('');

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
  readonly selectedTaskId = signal<string | null>(null);
  readonly focusedTaskId = signal<string | null>(null);
  readonly zoom = signal(1);

  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));

  /** The path from task zero down to the focused subtree. */
  readonly breadcrumb = computed(() => {
    const focused = this.focusedTaskId();
    if (focused === null) return [];
    return pathTo(this.feed.tree()?.children ?? [], focused);
  });

  /** What the canvas draws: the whole tree, or the focused subtree. */
  readonly visibleNodes = computed(() => {
    const roots = this.feed.tree()?.children ?? [];
    const focused = this.focusedTaskId();
    if (focused === null) return roots;
    const node = findTask(roots, focused);
    // A focus that no longer exists falls back to the whole tree rather than
    // rendering an empty canvas the operator cannot explain.
    return node === null ? roots : [node];
  });

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
