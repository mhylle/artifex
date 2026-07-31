/**
 * A judge that argues against its own verdict (defect `627cd71c`).
 *
 * On live mission `02a7d050` Gate A's plan audit flagged a criterion as
 * untestable, and the detail justifying the flag read:
 *
 *   "Criterion ac-1 … is not testable as written: **The criterion is TESTABLE.**
 *    It specifies formal structures (integral representation, functional equat…"
 *
 * The structured field says untestable; its own rationale says testable. Same
 * shape as `f720938a` (the clarity judge returning "there are none found" AS an
 * ambiguity) and `890cdea5` (the decompose gate returning `keep_whole` with a
 * rationale arguing for splitting).
 *
 * WHY SAMPLING DOES NOT CATCH THIS, and why probes do not either. ADR-0010's
 * mitigation is unanimity in the direction that preserves work: the plan audit
 * needs all three samples to flag before it rejects. All three flagged, because
 * the model fills the boolean the same wrong way every time — sampling catches
 * an UNRELIABLE judge, not a CONSISTENT one. R35's probes measure the reviewer's
 * calibration after a mission; this kills a mission at planning time, before any
 * probe is scored. Different mechanisms, different failure.
 *
 * The defect named its own fix: a cheap deterministic cross-check that the
 * detail does not contradict the claim — the "mechanical tier" reasoning R34
 * used for Gate B, applied to a judge's self-consistency. Precedent exists:
 * `cd677737` already discards a self-critique revision that breaks a criterion
 * the critique itself marked met.
 */
import { describe, expect, it } from 'vitest';

import { affirmsTestability } from './judge-consistency.js';
import { gateA } from './reviewer.js';
import type { CoverageJudge, PlanJudge } from './reviewer.js';
import type { TaskContract } from '@artifex/shared-types';

const AT = '2026-07-31T09:00:00.000Z';
const META = { verdictId: 'v-1', reviewerId: 'reviewer', issuedAt: AT };

const base = (over: Partial<TaskContract> = {}): TaskContract => ({
  taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
  missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
  parentTaskId: null,
  category: 'mission', depth: 0,
  objective: 'Do the thing.',
  acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The thing is done.' }],
  boundaries: { outOfScope: ['Everything else.'], siblingOwners: [] },
  inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
  dependencies: { consumesTaskIds: [], mayRequest: [] },
  stoppingConditions: { doneWhen: ['Done.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
  budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
  escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
  verificationPlan: { depth: 'single', requiredAgreement: null },
  blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
});

/** A child carrying its OWN criterion, so the inherited-criteria skip does not hide the case. */
const child = (n: number): TaskContract => ({
  ...base(),
  taskId: `aaaaaaaa-0000-4000-8000-00000000000${n + 1}`,
  parentTaskId: base().taskId,
  depth: 1,
  objective: `Part ${n}`,
  acceptanceCriteria: [{ criterionId: 'sub-1', statement: 'The part is done.' }],
});

const parentOf = (kids: readonly TaskContract[]) => base();

const coverAll = (): CoverageJudge => ({
  async assess({ parent, children }) {
    return {
      coverage: parent.acceptanceCriteria.map((c) => ({
        criterionId: c.criterionId, coveredByTaskIds: children.map((k) => k.taskId),
      })),
    };
  },
});

describe('627cd71c — an UNQUALIFIED affirmation contradicts an untestable verdict', () => {
  it('catches the live wording that started this', async () => {
    expect(
      affirmsTestability('The criterion is TESTABLE. It specifies formal structures (integral representation).'),
    ).toBe(true);
  });

  it('catches it in the other phrasings a model reaches for', async () => {
    expect(affirmsTestability('This is testable.')).toBe(true);
    expect(affirmsTestability('It is clearly testable as written.')).toBe(true);
  });
});

describe('627cd71c — a QUALIFIED mention is not an affirmation', () => {
  // The whole risk of a keyword check. Every one of these legitimately supports
  // an "untestable" verdict while containing the word.

  it('DISTRACTOR: a plain negation is not an affirmation', async () => {
    expect(affirmsTestability('The criterion is not testable as written.')).toBe(false);
    expect(affirmsTestability("The criterion isn't testable without a threshold.")).toBe(false);
  });

  it('DISTRACTOR: a CONDITIONAL is not an affirmation', async () => {
    // The most important case: the judge is explaining what would make it
    // testable, which is exactly the useful form of this finding.
    expect(affirmsTestability('The criterion is testable only if the input format is defined.')).toBe(false);
    expect(affirmsTestability('This would be testable if it named a threshold.')).toBe(false);
    expect(affirmsTestability('It could be testable once the output schema is pinned.')).toBe(false);
  });

  it('DISTRACTOR: a detail that never mentions testability is not an affirmation', async () => {
    expect(affirmsTestability('No measurable outcome is stated.')).toBe(false);
  });

  it('DISTRACTOR: the affirmation must be about TESTABILITY, not any adjective', async () => {
    // A guard that fired on "is clear" would misread the clarity judge's own
    // vocabulary and start discarding findings it has no business touching.
    expect(affirmsTestability('The objective is clear and the scope is bounded.')).toBe(false);
  });

  it('DISTRACTOR: a negation in ONE sentence does not excuse an affirmation in another', async () => {
    // Sentence-scoped, not detail-scoped. A judge that says both things is
    // still contradicting itself, and scanning the whole string for "not" would
    // let the real case through whenever the model hedged elsewhere.
    expect(
      affirmsTestability('The task is not atomic. The criterion is testable. Both were checked.'),
    ).toBe(true);
  });

  it('DISTRACTOR: an empty or whitespace detail affirms nothing', async () => {
    expect(affirmsTestability('')).toBe(false);
    expect(affirmsTestability('   ')).toBe(false);
  });
});

/**
 * The composition — Gate A really discards the self-contradicting finding.
 *
 * `affirmsTestability` is a pure predicate, and a pure predicate's own tests
 * cannot see whether anything calls it. That gap has produced fourteen dead
 * mechanisms in this project, so the producer gets its test in the same
 * iteration.
 */
describe('627cd71c — Gate A discards a finding whose detail refutes it', () => {
  const planWith = (untestable: Array<{ taskId: string; criterionId: string; detail: string }>): PlanJudge => ({
    async audit({ children }) {
      return {
        tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
        untestable,
        overlaps: [],
      };
    },
  });

  it('does not reject the plan over a finding that argues it is testable', async () => {
    // The live mission's exact shape: a NEW criterion (not inherited from
    // intake, which is skipped for a different reason) flagged untestable with a
    // detail asserting the opposite.
    const kids = [child(1)];
    const verdict = await gateA(
      parentOf(kids), kids, coverAll(),
      planWith([{ taskId: kids[0]!.taskId, criterionId: 'sub-1', detail: 'The criterion is TESTABLE. It specifies formal structures.' }]),
      META,
    );

    expect(verdict.outcome, 'a mission was killed by a judge arguing against itself').toBe('pass');
  });

  it('DISTRACTOR: a COHERENT untestable finding still rejects the plan', async () => {
    // The rule must be able to say no. A guard that swallowed every testability
    // finding would delete the clause instead of repairing it — and the clause
    // catches real specification faults.
    const kids = [child(1)];
    const verdict = await gateA(
      parentOf(kids), kids, coverAll(),
      planWith([{ taskId: kids[0]!.taskId, criterionId: 'sub-1', detail: 'No measurable outcome is stated.' }]),
      META,
    );

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.failingStep).join(' ')).toMatch(/testab/i);
  });

  it('DISTRACTOR: a CONDITIONAL finding still rejects — it is the useful form', async () => {
    // "Testable only if X" is the judge explaining what would fix the criterion.
    // Discarding those would throw away the most helpful verdicts the gate makes.
    const kids = [child(1)];
    const verdict = await gateA(
      parentOf(kids), kids, coverAll(),
      planWith([{ taskId: kids[0]!.taskId, criterionId: 'sub-1', detail: 'The criterion is testable only if the output format is defined.' }]),
      META,
    );

    expect(verdict.outcome, 'a conditional explanation was mistaken for self-contradiction').toBe('fail');
  });
});
