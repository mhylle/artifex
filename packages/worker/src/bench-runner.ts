/**
 * Replaying a candidate against the bench (R27 AC-1/AC-2/AC-3).
 *
 * `ScienceLoop.experiment` was correct and had nothing to run. A bench case
 * carries its full contract, its inputs and the outcome a VERIFIED run produced
 * (R25), so replaying one is: re-contract it, execute under the candidate, and
 * judge the result against that case's own acceptance criteria.
 *
 * **Judged, not diffed.** The recorded outcome is one verified answer, not the
 * only correct one. A candidate answering "100 degrees Celsius" where the case
 * recorded "100C" has not regressed, and a string comparison would call that a
 * loss and reject a real improvement. The criteria are what the original verdict
 * was made against, so they are what a re-run is measured against too.
 *
 * **Everything that is not a demonstrated pass is a loss.** A candidate that
 * crashed, whose judge was unavailable, or whose case would not load has not
 * shown anything — treating any of those as "no evidence" would let a broken
 * candidate through on the cases it happened to survive.
 */
import type { CandidateRunner } from './science-runner.js';

export interface BenchCase {
  readonly caseId: string;
  readonly contract: unknown;
  readonly inputs: unknown;
  readonly verifiedOutcome: unknown;
}

/** Loads bench cases by id — `ReplayBenchRepository` in practice. */
export interface BenchCaseStore {
  load(caseIds: readonly string[]): Promise<readonly BenchCase[]>;
}

/** Executes one case's contract under a candidate change. */
export interface CaseExecutor {
  execute(input: {
    readonly candidateId: string;
    readonly contract: unknown;
    readonly inputs: unknown;
  }): Promise<{ readonly deliverable: unknown }>;
}

/** Judges a produced deliverable against the case's own criteria. */
export interface CaseJudge {
  meets(input: { readonly contract: unknown; readonly deliverable: unknown }): Promise<boolean>;
}

export class BenchCandidateRunner implements CandidateRunner {
  readonly #store: BenchCaseStore;
  readonly #executor: CaseExecutor;
  readonly #judge: CaseJudge;

  constructor(store: BenchCaseStore, executor: CaseExecutor, judge: CaseJudge) {
    this.#store = store;
    this.#executor = executor;
    this.#judge = judge;
  }

  /**
   * A candidate wins a slice only by meeting EVERY case it was given.
   *
   * Not a majority: a candidate that fixes one case and breaks another has not
   * improved the system, and scoring on a majority would adopt changes that
   * trade one failure for a different one.
   *
   * Zero cases is a LOSS, because "every case passed" is vacuously true of an
   * empty exam. `experimentPlan` already refuses an empty bench at the planning
   * layer; this is the same rule where the work actually happens, since the two
   * can be called independently.
   */
  async run(input: {
    readonly candidateId: string;
    readonly slice: 'open' | 'sealed';
    readonly cases: readonly string[];
    readonly budget: number;
  }): Promise<boolean> {
    // The budget is what makes heterogeneous candidates comparable (AC-1): one
    // that could buy more attempts than another would be sitting a longer exam.
    const attempted = input.cases.slice(0, Math.max(0, Math.floor(input.budget)));
    if (attempted.length === 0) return false;

    let loaded: readonly BenchCase[];
    try {
      loaded = await this.#store.load(attempted);
    } catch {
      return false;
    }

    // A case that would not load is a loss, not a skip: scoring on whichever
    // cases happened to load would make the result depend on store availability.
    if (loaded.length !== attempted.length) return false;

    for (const benchCase of loaded) {
      try {
        const { deliverable } = await this.#executor.execute({
          candidateId: input.candidateId,
          contract: benchCase.contract,
          inputs: benchCase.inputs,
        });

        if (!(await this.#judge.meets({ contract: benchCase.contract, deliverable }))) return false;
      } catch {
        // Crashed executor or unavailable judge. An unjudged run is not a pass.
        return false;
      }
    }

    return true;
  }
}
