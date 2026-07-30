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

export interface MissionSummary {
  readonly missionId: string;
  readonly objective: string | null;
  readonly status: 'running' | 'delivered' | 'surrendered';
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
  readonly error = signal<string | null>(null);

  /** Fleet totals, derived — never counted into a field of their own. */
  readonly total = computed(() => this.missions().length);
  readonly running = computed(() => this.missions().filter((m) => m.status === 'running').length);
  readonly agentsActive = computed(() => this.missions().reduce((n, m) => n + m.agentsStaffed, 0));
  readonly tasksToday = computed(() => this.missions().reduce((n, m) => n + m.tasksToday, 0));

  /**
   * How many missions want a human.
   *
   * v0 reads this as "surrendered": a surrender is precisely the outcome that
   * ends with a question only a person can answer. The full attention queue —
   * escalations at the ladder's top rung, clarification requests, amendment
   * ratifications — is R18, and this count is expected to grow into it rather
   * than be replaced.
   */
  readonly needingAttention = computed(() => this.missions().filter((m) => m.status === 'surrendered').length);

  /** `127.0.0.1` for the same reason as the feed: WSL's relay holds `[::1]:3000`. */
  async refresh(url = 'http://127.0.0.1:3000'): Promise<void> {
    try {
      const missions = await firstValueFrom(this.#http.get<MissionSummary[]>(`${url}/missions`));
      this.missions.set(missions);
      this.error.set(null);
    } catch (cause: unknown) {
      // Surfaced, not swallowed: an empty rail and an unreachable control plane
      // look identical, and the operator needs to tell them apart.
      this.error.set(cause instanceof Error ? cause.message : 'Could not reach the control plane.');
    }
  }
}
