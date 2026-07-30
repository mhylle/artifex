/**
 * The inspector (R16) — the evidence beneath a node.
 *
 * "Every pixel is drillable… the dashboard's job is not to summarize away
 * detail but to make the full depth reachable in two clicks." So this panel
 * shows the contract, the criteria with their live state, the effort against
 * budget, the agent that did the work — and, one click away, the raw ledger
 * events those claims rest on.
 *
 * It computes nothing. Every value is read from the projection, which is itself
 * a pure fold of the event list, so there is no path by which the inspector can
 * assert something the ledger cannot justify.
 */
import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import type { CriterionState, TaskNode } from './mission-tree';

@Component({
  selector: 'app-inspector',
  standalone: true,
  imports: [JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inspector.html',
  styleUrl: './inspector.css',
})
export class Inspector {
  readonly task = input<TaskNode | null>(null);

  /** The raw-events drill-down, one click from any claim. */
  readonly showEvents = signal(false);

  readonly metCount = computed(() => this.task()?.criteria.filter((c) => c.state === 'met').length ?? 0);
  readonly criterionCount = computed(() => this.task()?.criteria.length ?? 0);

  /**
   * Effort as a fraction of the ceiling, or null when either is unknown.
   *
   * Deliberately null rather than 0: a task that has not reported effort has not
   * spent nothing, it has not said. Rendering that as an empty bar would be a
   * claim the ledger never made.
   */
  readonly effortFraction = computed(() => {
    const task = this.task();
    if (task?.effortSpent == null || task.ceiling == null || task.ceiling === 0) return null;
    return Math.min(1, task.effortSpent / task.ceiling);
  });

  /**
   * Round a budget figure for display only.
   *
   * Budgets divide by `effortShare` on every split, so a ceiling is routinely
   * something like 6.666666666666666. The LEDGER keeps full precision — cost
   * accounting must not be rounded at the source — but showing sixteen digits
   * to an operator is noise pretending to be rigour.
   */
  format(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  mark(state: CriterionState): string {
    // Icon AND text, for the same reason the canvas does it: colour is never the
    // carrier of meaning.
    return state === 'met' ? '✓' : state === 'unmet' ? '✕' : '○';
  }

  toggleEvents(): void {
    this.showEvents.update((value) => !value);
  }
}
