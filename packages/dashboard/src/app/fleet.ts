/**
 * The fleet (R21) — every mission, so Mission Control opens on the work rather
 * than on an empty box demanding a UUID.
 *
 * Like everything else in this dashboard it stores nothing it was not handed:
 * the rail is the control plane's projection of the ledger, refreshed, never
 * accumulated locally. If a mission is in the rail there are events behind it.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** One item waiting on a human (R18), carrying enough context to decide. */
export interface AttentionItem {
  readonly missionId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly rung: string;
  readonly autonomyDial: string | null;
  readonly findings: readonly string[];
  readonly acceptanceCriteria: readonly { criterionId: string; statement: string }[];
  readonly waitingSince: string;
}

export interface MissionSummary {
  readonly missionId: string;
  readonly objective: string | null;
  readonly status: 'running' | 'delivered' | 'surrendered' | 'abandoned';
  readonly eventCount: number;
  readonly escalations: number;
  readonly agentsStaffed: number;
  readonly tasksToday: number;
  readonly lastEventAt: string;
}

@Injectable({ providedIn: 'root' })
export class Fleet {
  readonly #http = inject(HttpClient);

  readonly missions = signal<readonly MissionSummary[]>([]);
  readonly attention = signal<readonly AttentionItem[]>([]);
  readonly error = signal<string | null>(null);

  /** Fleet totals, derived — never counted into a field of their own. */
  readonly total = computed(() => this.missions().length);
  readonly running = computed(() => this.missions().filter((m) => m.status === 'running').length);
  readonly agentsActive = computed(() => this.missions().reduce((n, m) => n + m.agentsStaffed, 0));
  readonly tasksToday = computed(() => this.missions().reduce((n, m) => n + m.tasksToday, 0));

  /**
   * How many items are waiting on a human (R18).
   *
   * Previously this counted surrendered missions, which was a stand-in: a
   * surrender is an outcome, not a question. Now it counts what is genuinely
   * blocked awaiting a decision, which is what the dossier means by "the
   * attention count" being visible from the fleet without opening the queue.
   */
  readonly needingAttention = computed(() => this.attention().length);

  /** `127.0.0.1` for the same reason as the feed: WSL's relay holds `[::1]:3000`. */
  async refresh(url = 'http://127.0.0.1:3000'): Promise<void> {
    try {
      const [missions, attention] = await Promise.all([
        firstValueFrom(this.#http.get<MissionSummary[]>(`${url}/missions`)),
        firstValueFrom(this.#http.get<AttentionItem[]>(`${url}/missions/attention`)),
      ]);
      this.missions.set(missions);
      this.attention.set(attention);
      this.error.set(null);
    } catch (cause: unknown) {
      // Surfaced, not swallowed: an empty rail and an unreachable control plane
      // look identical, and the operator needs to tell them apart.
      this.error.set(cause instanceof Error ? cause.message : 'Could not reach the control plane.');
    }
  }
}
