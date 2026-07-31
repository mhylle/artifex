/**
 * Running a science-loop candidate against a bench case (ADR-0017, defect
 * `a1288794`).
 *
 * A candidate is a fast-loop hot-fix — R26 says so outright: "fast-loop results
 * become science-loop hypotheses (R27)". A hot-fix is already a worker-layer
 * change to one concrete asset (`role_instructions` on a design), so running it
 * is well-defined: execute a bench case's contract with the candidate's PATCHED
 * instructions in front of the worker, and judge what comes back.
 *
 * **Judged, never diffed.** `bench-runner.ts` already argues this and it is
 * repeated here because it is the easy thing to get wrong: the case's recorded
 * outcome is one verified answer, not the only correct one. A candidate that
 * answers "100 degrees Celsius" where the case recorded "100C" has not
 * regressed, and a string comparison would reject a real improvement.
 *
 * **A candidate that cannot be found does not silently become a plain run.** An
 * executor that fell back to the un-patched instructions would score the
 * BASELINE and report it as the candidate's result — the most dangerous
 * possible failure here, because it looks exactly like a successful experiment.
 */

/** The runnable part of a fast-loop hot-fix. */
export interface Candidate {
  readonly candidateId: string;
  /** The instructions the fast loop patched IN — what is actually under test. */
  readonly patchedValue: string;
}

/** Produces one deliverable from a prompt — the model seam, already tiered. */
export interface CandidateGenerator {
  answer(input: {
    readonly roleInstructions: string;
    readonly objective: string;
    readonly criteria: readonly string[];
  }): Promise<unknown>;
}

/** Judges a deliverable against a contract's own criteria — the completion judge. */
export interface CandidateJudge {
  meetsAll(input: {
    readonly objective: string;
    readonly criteria: readonly { readonly criterionId: string; readonly statement: string }[];
    readonly deliverable: unknown;
  }): Promise<boolean>;
}

interface CaseContract {
  readonly objective?: unknown;
  readonly acceptanceCriteria?: unknown;
}

/** The contract's criteria, in the shape the judge needs. */
export function criteriaOf(contract: unknown): { criterionId: string; statement: string }[] {
  const raw = (contract as CaseContract | undefined)?.acceptanceCriteria;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is { criterionId: string; statement: string } =>
      typeof c === 'object' && c !== null
      && typeof (c as { criterionId?: unknown }).criterionId === 'string'
      && typeof (c as { statement?: unknown }).statement === 'string')
    .map((c) => ({ criterionId: c.criterionId, statement: c.statement }));
}

/**
 * A `CaseExecutor` that runs the case under the candidate's patched instructions.
 *
 * Throws when the candidate is unknown. `BenchCandidateRunner` counts a throw as
 * a loss, which is the honest outcome — a candidate that could not be applied
 * has demonstrated nothing, and the alternative (running without the patch) would
 * report the baseline's score under the candidate's name.
 */
export function candidateExecutor(
  candidates: ReadonlyMap<string, Candidate>,
  generator: CandidateGenerator,
) {
  return {
    async execute(input: { readonly candidateId: string; readonly contract: unknown }) {
      const candidate = candidates.get(input.candidateId);
      if (candidate === undefined) {
        throw new Error(
          `unknown candidate "${input.candidateId}" — refusing to run the case without the patch ` +
            'under test, which would score the baseline and report it as the candidate',
        );
      }

      const contract = input.contract as CaseContract | undefined;
      const deliverable = await generator.answer({
        roleInstructions: candidate.patchedValue,
        objective: String(contract?.objective ?? ''),
        criteria: criteriaOf(input.contract).map((c) => c.statement),
      });

      return { deliverable };
    },
  };
}

/**
 * A `CaseJudge` over the completion judge — the same judgement Gate B makes.
 *
 * A case with NO criteria is judged a loss rather than a pass. "Every criterion
 * was met" is vacuously true of an empty list, and the live sealed bench really
 * does hold a dogfood stub whose contract is `{"o": "sealed case"}` with no
 * criteria at all — so this is a case that exists, not a hypothetical.
 */
export function candidateJudge(judge: CandidateJudge) {
  return {
    async meets(input: { readonly contract: unknown; readonly deliverable: unknown }) {
      const criteria = criteriaOf(input.contract);
      if (criteria.length === 0) return false;

      const contract = input.contract as CaseContract | undefined;
      return judge.meetsAll({
        objective: String(contract?.objective ?? ''),
        criteria,
        deliverable: input.deliverable,
      });
    },
  };
}
