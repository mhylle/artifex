/**
 * The science loop, actually running (R27).
 *
 * `science-loop.ts` holds the four decisions — what counts as a weak spot, what
 * makes experiments comparable, what earns adoption. This is the part that
 * *runs* them, and it exists because a decision function with no caller had
 * already happened three times before (`41f7555c`, `753bc6dd`, `2eeef21f`) and
 * happened a fourth time to R27 itself (`66356a6e`).
 *
 * Everything is a seam. The Learning Agent may propose, never enact (invariant
 * #4), so this returns decisions rather than adopting anything: `evaluate`
 * hands back verdicts for the constitutional path to act on.
 */
import { adoptionDecision, experimentPlan, rankWeakSpots } from './science-loop.js';
import type { AdoptionDecision, CandidateResult, CandidateRun, MissionEvidence, WeakSpot } from './science-loop.js';

/** Where the per-mission evidence comes from — R11's projection, in practice. */
export interface EvidenceSource {
  evidenceFor(missionIds: readonly string[]): Promise<readonly MissionEvidence[]>;
}

/** R25's bench, split by slice. */
export interface BenchSource {
  cases(slice: 'open' | 'sealed'): Promise<readonly string[]>;
}

/** Runs one candidate against one slice under a fixed budget. */
export interface CandidateRunner {
  run(input: {
    readonly candidateId: string;
    readonly slice: 'open' | 'sealed';
    readonly cases: readonly string[];
    readonly budget: number;
  }): Promise<boolean>;
}

export class ScienceLoop {
  readonly #evidence: EvidenceSource;
  readonly #bench: BenchSource;
  readonly #runner: CandidateRunner;

  constructor(seams: {
    readonly evidence: EvidenceSource;
    readonly bench: BenchSource;
    readonly runner: CandidateRunner;
  }) {
    this.#evidence = seams.evidence;
    this.#bench = seams.bench;
    this.#runner = seams.runner;
  }

  /** Rank weak spots across a mission history (R27 AC-0). */
  async mine(missionIds: readonly string[]): Promise<WeakSpot[]> {
    return rankWeakSpots(await this.#evidence.evidenceFor(missionIds));
  }

  /**
   * Run every candidate on the open bench, then re-check each on the sealed
   * slice it was never tuned against (R27 AC-1/AC-2).
   *
   * The budget is split by `experimentPlan`, which refuses an uneven division
   * rather than approximating — so a plan that would produce incomparable
   * numbers never reaches the runner at all.
   *
   * A runner that THROWS counts as a loss. An experiment that crashed did not
   * succeed, and swallowing the error into a pass would adopt a candidate that
   * cannot even run.
   */
  async experiment(
    candidates: readonly string[],
    options: { readonly totalBudget: number; readonly replications: number },
  ): Promise<CandidateResult[]> {
    const openCases = await this.#bench.cases('open');
    const sealedCases = await this.#bench.cases('sealed');

    const plan = experimentPlan(candidates, { totalBudget: options.totalBudget, benchCases: openCases });

    const results: CandidateResult[] = [];

    for (const slot of plan) {
      const runs: CandidateRun[] = [];
      for (let i = 0; i < options.replications; i += 1) {
        runs.push({ won: await this.#attempt(slot.candidateId, 'open', slot.cases, slot.budget), slice: 'open' });
      }

      // No sealed case means no held-out exam. Reported as absent rather than
      // as a failure: "we could not check" is a different finding from "it did
      // not transfer", and `adoptionDecision` refuses both anyway.
      const heldOut: CandidateRun | null = sealedCases.length === 0
        ? null
        : { won: await this.#attempt(slot.candidateId, 'sealed', sealedCases, slot.budget), slice: 'sealed' };

      results.push({ candidateId: slot.candidateId, runs, heldOut });
    }

    return results;
  }

  /**
   * Turn results into adoption verdicts (R27 AC-2/AC-3).
   *
   * Verdicts, not actions: the Learning Agent proposes and the constitutional
   * path disposes. Every decision carries its evidence whether or not it was
   * adopted, so a rejected candidate is still a measurement the next hypothesis
   * can build on.
   */
  evaluate(results: readonly CandidateResult[]): AdoptionDecision[] {
    return results.map(adoptionDecision);
  }

  async #attempt(
    candidateId: string,
    slice: 'open' | 'sealed',
    cases: readonly string[],
    budget: number,
  ): Promise<boolean> {
    try {
      return await this.#runner.run({ candidateId, slice, cases, budget });
    } catch {
      return false;
    }
  }
}
