/**
 * Mission intake from the cockpit (R14).
 *
 * The gap this closes: Mission Control could watch a mission but never start
 * one, so the only way to put work into Artifex was curl — a control plane
 * operable only by its author. "Mission control is a cockpit, not a window."
 *
 * This service is deliberately thin. It does not decide what a good mission
 * looks like; the control plane owns that judgement (invariant #2 — no work
 * without a contract — starts at intake). It only carries a draft across the
 * wire in the shape the contract requires.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** What the operator actually authors. Everything else is a defaulted policy choice. */
export interface MissionDraft {
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly outOfScope: readonly string[];
}

/**
 * The policy fields intake requires but the v0 form does not yet ask for.
 *
 * They are named here rather than inlined so the choice is visible and
 * reviewable: a checkpointed dial and a low blast radius are the conservative
 * defaults — a human sits at `human_review`, and verification stays single-depth
 * rather than claiming a rigour nobody asked for. Exposing these as controls is
 * R17 (turn the dial) and R22 (audience limits), not this requirement.
 */
export const INTAKE_DEFAULTS = {
  autonomyDial: 'checkpointed',
  blastRadius: 'low',
  budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
  requestedBy: 'operator',
} as const;

/**
 * Split a textarea into the lines a human meant.
 *
 * Blank lines are dropped rather than preserved: a whitespace-only criterion
 * would pass the control plane's "at least one" check while being ungradeable,
 * which is precisely the shape intake exists to refuse.
 */
export function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

@Injectable({ providedIn: 'root' })
export class MissionIntake {
  readonly #http = inject(HttpClient);

  /**
   * `127.0.0.1` rather than `localhost` for the same reason as {@link LedgerFeed}:
   * WSL's relay holds IPv6 `[::1]:3000` on this machine, and browsers resolve
   * `localhost` to `::1` first — so a `localhost` URL reaches the relay instead
   * of the control plane.
   */
  async submit(draft: MissionDraft, url = 'http://127.0.0.1:3000'): Promise<string> {
    const response = await firstValueFrom(
      this.#http.post<{ missionId: string }>(`${url}/missions`, {
        objective: draft.objective,
        successCriteria: [...draft.successCriteria],
        outOfScope: [...draft.outOfScope],
        ...INTAKE_DEFAULTS,
      }),
    );
    return response.missionId;
  }
}
