/**
 * The four non-canvas lenses, rendered (R19).
 *
 * One component rather than four, because they share a single input — the event
 * list — and differ only in which projection they show. Four components would
 * duplicate that plumbing to no benefit. The projections themselves live in
 * `lenses.ts` and are pure, which is what keeps the lenses agreeing: none of
 * them has its own source of truth.
 */
import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { buildLearningView, buildLedgerView, buildTimeline, buildWorkforce } from './lenses';
import type { LedgerFilter, TimedEvent } from './lenses';

export type LensName = 'canvas' | 'workforce' | 'timeline' | 'learning' | 'ledger';

@Component({
  selector: 'app-lens-panels',
  standalone: true,
  imports: [FormsModule, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lens-panels.html',
  styleUrl: './lens-panels.css',
})
export class LensPanels {
  readonly lens = input.required<LensName>();
  readonly events = input.required<readonly TimedEvent[]>();

  readonly family = signal('');
  readonly errorClass = signal('');
  readonly agent = signal('');

  readonly workforce = computed(() => buildWorkforce(this.events()));
  readonly timeline = computed(() => buildTimeline(this.events()));
  readonly learning = computed(() => buildLearningView(this.events()));

  readonly ledger = computed(() => {
    // Only non-empty filters are applied, so an untouched box narrows nothing.
    const filter: LedgerFilter = {
      ...(this.family() ? { family: this.family() } : {}),
      ...(this.errorClass() ? { errorClass: this.errorClass() } : {}),
      ...(this.agent() ? { agent: this.agent() } : {}),
    };
    return buildLedgerView(this.events(), filter);
  });

  /** The families actually present — the filter offers what exists, not a guess. */
  readonly families = computed(() => [...new Set(this.events().map((e) => e.family))].sort());

  readonly hasLearning = computed(() => {
    const view = this.learning();
    return view.experiments.length + view.adoptions.length + view.reverts.length + view.petitions.length > 0;
  });

  percent(rate: number | null): string {
    // An em dash rather than "0%" when nothing has judged the agent yet.
    return rate === null ? '—' : `${Math.round(rate * 100)}%`;
  }
}
