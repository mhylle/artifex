/**
 * Cockpit actions (R17) — the operator's half of "watching is also acting".
 *
 * Thin by design. It carries intent to the control plane and nothing else: the
 * decision about what an action *means* belongs to the ledger and the runtime,
 * not to a button.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type CockpitAction = 'pause' | 'resume' | 'cancel' | 'grant_budget' | 'turn_dial' | 'annotate';

export interface CockpitCommand {
  readonly missionId: string;
  readonly taskId: string | null;
  readonly action: CockpitAction;
  readonly amount?: number;
  readonly autonomyDial?: 'autonomous' | 'checkpointed' | 'supervised';
  readonly note?: string;
}

/**
 * Who is acting.
 *
 * A placeholder until R22 scopes audiences and a real identity exists — but it
 * is sent rather than omitted, because the symmetry rule needs the trail to name
 * an actor, and "unknown" recorded honestly beats a blank field.
 */
export const OPERATOR = 'operator';

@Injectable({ providedIn: 'root' })
export class Cockpit {
  readonly #http = inject(HttpClient);

  async act(command: CockpitCommand, url = 'http://127.0.0.1:3000'): Promise<void> {
    const { missionId, ...body } = command;
    await firstValueFrom(
      this.#http.post(`${url}/missions/${missionId}/control`, { ...body, operator: OPERATOR }),
    );
  }
}
