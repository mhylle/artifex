/**
 * Mission Control — the cockpit.
 *
 * Renders the tree that `buildMissionTree` folds out of the ledger. It owns no
 * state: everything on screen is a `computed` over the raw event list, so what
 * the operator sees cannot disagree with the audit trail.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LedgerFeed } from './ledger-feed';

@Component({
  selector: 'app-mission-control',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './mission-control.css',
  template: `
    <header>
      <h1>Artifex — Mission Control</h1>
      <div class="watch">
        <input [(ngModel)]="missionId" placeholder="mission id" aria-label="mission id" />
        <button (click)="watch()" [disabled]="!missionId()">Watch</button>
        <span class="dot" [class.live]="feed.connected()"></span>
        <span>{{ feed.connected() ? 'live' : 'offline' }}</span>
      </div>
    </header>

    @if (feed.tree(); as tree) {
      <section class="mission" [attr.data-status]="tree.status">
        <h2>{{ tree.objective || '(no objective yet)' }}</h2>
        <p class="meta">
          <span class="badge">{{ tree.status }}</span>
          <span>{{ tree.eventCount }} events</span>
        </p>

        @if (tree.blockers.length) {
          <ul class="blockers">
            @for (blocker of tree.blockers; track blocker) { <li>{{ blocker }}</li> }
          </ul>
        }

        <ol class="tasks">
          @for (task of tree.children; track task.taskId) {
            <li [attr.data-status]="task.status">
              <span class="badge">{{ task.status }}</span>
              <span class="objective">{{ task.objective }}</span>
              @if (task.logicalTier !== null) { <span class="tier">tier {{ task.logicalTier }}</span> }
              @if (task.escalations) { <span class="esc">↑{{ task.escalations }}</span> }
            </li>
          } @empty {
            <li class="empty">No tasks contracted yet.</li>
          }
        </ol>
      </section>
    } @else {
      <p class="empty">Watch a mission to see its trail.</p>
    }
  `,
})
export class MissionControl {
  readonly feed = inject(LedgerFeed);
  readonly missionId = signal('');

  watch(): void {
    this.feed.watch(this.missionId());
  }
}
