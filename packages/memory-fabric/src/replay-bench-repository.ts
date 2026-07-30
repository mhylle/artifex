/**
 * The replay bench (R25) — known ground truth, at fixed cost.
 *
 * A benchmark lets a candidate improvement be scored without running a whole
 * mission: replay a case, compare against what a verified run actually produced.
 * That only works while the benchmark is honest, and the component most
 * motivated to make it dishonest is the one being scored.
 *
 * Hence two slices, and an enforcement that does not depend on anyone's good
 * intentions:
 *
 *   open    optimise against it freely — that is what it is for.
 *   sealed  evaluates amendment petitions and calibrates the Reviewer.
 *           Unreachable by the Learning Agent.
 *
 * The seal is a database VIEW, not a role check in a method. A reader
 * constructed for the Learning Agent is bound to `benchmark_case_open` and has
 * no way to name the table — there is no predicate to forget and no flag to
 * omit. A method that checked a caller-supplied role would be a convention the
 * caller can decline to honour, which is exactly the implementation the
 * criterion rules out.
 */
import type { Pool } from 'pg';

export type BenchSlice = 'open' | 'sealed';

/** Raised when a restricted reader reaches for the sealed slice. */
export class SealedBenchAccessError extends Error {
  constructor(detail: string) {
    super(
      `the sealed bench is not readable by this component: ${detail}. ` +
      `Nothing that optimizes against a benchmark may also own it.`,
    );
    this.name = 'SealedBenchAccessError';
  }
}

export interface BenchCase {
  readonly caseId: string;
  readonly slice: BenchSlice;
  readonly sourceTaskId: string;
  readonly sourceMissionId: string;
  readonly capability: string;
  readonly contract: unknown;
  readonly inputs: unknown;
  readonly verifiedOutcome: unknown;
  readonly evidence: readonly string[];
  readonly retiredAt: string | null;
  readonly retiredReason: string | null;
}

interface CaseRow {
  case_id: string;
  slice: BenchSlice;
  source_task_id: string;
  source_mission_id: string;
  capability: string;
  contract: unknown;
  inputs: unknown;
  verified_outcome: unknown;
  evidence: string[];
  retired_at: string | null;
  retired_reason: string | null;
}

const COLUMNS = `
  case_id, slice, source_task_id, source_mission_id, capability,
  contract, inputs, verified_outcome, evidence, retired_at, retired_reason
`;

const toCase = (row: CaseRow): BenchCase => ({
  caseId: row.case_id,
  slice: row.slice,
  sourceTaskId: row.source_task_id,
  sourceMissionId: row.source_mission_id,
  capability: row.capability,
  contract: row.contract,
  inputs: row.inputs,
  verifiedOutcome: row.verified_outcome,
  evidence: row.evidence,
  retiredAt: row.retired_at === null ? null : new Date(row.retired_at).toISOString(),
  retiredReason: row.retired_reason,
});

export class ReplayBenchRepository {
  readonly #pool: Pool;
  readonly #restricted: boolean;

  /**
   * Which relation this reader is bound to.
   *
   * Exposed so a test can assert the STRUCTURE rather than only the behaviour —
   * an API-level test would pass equally well against a role check, and a role
   * check is the implementation R25 AC-1 explicitly rules out.
   */
  readonly boundTo: 'benchmark_case' | 'benchmark_case_open';

  constructor(pool: Pool, options?: { readonly role?: 'learning_agent' }) {
    this.#pool = pool;
    this.#restricted = options?.role === 'learning_agent';
    this.boundTo = this.#restricted ? 'benchmark_case_open' : 'benchmark_case';
  }

  /**
   * Bank a verified task as a replayable case (R25 AC-0).
   *
   * Evidence is required by the database, not merely by this method: a case with
   * no recorded verdict is a guess about ground truth, and scoring against a
   * guess produces a number that looks like a measurement.
   */
  async record(input: {
    readonly slice: BenchSlice;
    readonly sourceTaskId: string;
    readonly sourceMissionId: string;
    readonly capability: string;
    readonly contract: unknown;
    readonly inputs: unknown;
    readonly verifiedOutcome: unknown;
    readonly evidence: readonly string[];
  }): Promise<BenchCase> {
    if (input.evidence.length === 0) {
      throw new Error(
        'a benchmark case needs evidence that its outcome was verified — unverified ground truth is a guess',
      );
    }

    const { rows } = await this.#pool.query<CaseRow>(
      `INSERT INTO benchmark_case
         (slice, source_task_id, source_mission_id, capability, contract, inputs, verified_outcome, evidence)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
       RETURNING ${COLUMNS}`,
      [
        input.slice,
        input.sourceTaskId,
        input.sourceMissionId,
        input.capability,
        JSON.stringify(input.contract),
        JSON.stringify(input.inputs),
        JSON.stringify(input.verifiedOutcome),
        JSON.stringify(input.evidence),
      ],
    );

    return toCase(rows[0]!);
  }

  /**
   * Cases available for scoring — retired ones excluded (R25 AC-1, AC-2).
   *
   * A restricted reader asking explicitly for the sealed slice is REFUSED rather
   * than quietly given nothing: an empty result reads as "the sealed bench is
   * empty", which is a different and false claim.
   */
  async list(filter?: { readonly slice?: BenchSlice }): Promise<BenchCase[]> {
    if (this.#restricted && filter?.slice === 'sealed') {
      throw new SealedBenchAccessError('it asked for the sealed slice by name');
    }

    const { rows } = await this.#pool.query<CaseRow>(
      `SELECT ${COLUMNS} FROM ${this.boundTo}
        WHERE retired_at IS NULL
          AND ($1::text IS NULL OR slice = $1::text)
        ORDER BY created_at`,
      [filter?.slice ?? null],
    );

    return rows.map(toCase);
  }

  /**
   * One case by id, or null.
   *
   * A restricted reader that names a sealed case is refused rather than told
   * "not found" — the distinction matters, because "no such case" would let an
   * optimiser probe the seal by elimination.
   */
  async findById(caseId: string): Promise<BenchCase | null> {
    const { rows } = await this.#pool.query<CaseRow>(
      `SELECT ${COLUMNS} FROM ${this.boundTo} WHERE case_id = $1`,
      [caseId],
    );

    if (rows.length === 0) {
      if (!this.#restricted) return null;

      // The view hid it. Distinguish "sealed" from "absent" by asking the table
      // whether the row exists AT ALL — a count, never the contents, so this
      // cannot become a back door to the case itself.
      const { rows: exists } = await this.#pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM benchmark_case WHERE case_id = $1`,
        [caseId],
      );
      if (Number(exists[0]?.n ?? 0) > 0) {
        throw new SealedBenchAccessError(`case ${caseId} is in the sealed slice`);
      }
      return null;
    }

    return toCase(rows[0]!);
  }

  /**
   * Age out cases the mission mix has moved past (R25 AC-2).
   *
   * "Curated like the commons, not accumulated like the ledger." A bench that
   * only grows drifts away from the work it is supposed to represent, and every
   * score it produces drifts with it.
   *
   * Staleness is derived from the capabilities missions are ACTUALLY exercising
   * rather than from an invented TTL — the same rule the rest of the system
   * follows about constants.
   *
   * An EMPTY active set retires nothing. "No capabilities are active" almost
   * always means the caller could not determine the mission mix, not that all
   * work has stopped, and acting on it would empty the bench precisely when the
   * signal is missing.
   *
   * Retirement is a tombstone, never a delete: a removed case takes its history
   * with it, so a later question about why a score moved has no answer.
   */
  async curate(input: { readonly activeCapabilities: readonly string[] }): Promise<BenchCase[]> {
    if (input.activeCapabilities.length === 0) return [];

    const { rows } = await this.#pool.query<CaseRow>(
      `UPDATE benchmark_case
          SET retired_at = now(),
              retired_reason = 'the capability "' || capability ||
                '" no longer appears in the mission mix, so this case no longer represents the work'
        WHERE retired_at IS NULL
          AND capability <> ALL($1::text[])
      RETURNING ${COLUMNS}`,
      [input.activeCapabilities],
    );

    return rows.map(toCase);
  }
}
