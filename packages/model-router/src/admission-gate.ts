/**
 * The structured-output admission gate (ADR-0002).
 *
 * A model enters the Model Catalog only after proving it can hold a *real*
 * Artifex schema — not a toy one. The distinction matters: nearly every model
 * can emit `{"answer": "..."}`, and almost none of that predicts whether it can
 * emit a `Verdict` with a closed error-class enum, a nested findings array and
 * no stray properties. The catalog's `admitted` flag is only meaningful because
 * this is what sets it.
 *
 * The probes are constrained by the exact schema objects the ledger validates
 * with — ADR-0004's no-translation rule means there is no seam here to drift.
 */
import {
  CapabilityManifestSchema,
  EvidenceBundleSchema,
  VerdictSchema,
  validate,
} from '@artifex/shared-types';
import type { LogicalTier, ValidationError } from '@artifex/shared-types';
import type { TSchema } from '@sinclair/typebox';

import { NoProbesForTierError } from './errors.js';

/**
 * A coherence assertion the schema cannot express.
 *
 * These are not optional polish. Modern backends serve structured output by
 * *constrained decoding*: the grammar makes schema-valid output near-certain
 * regardless of how capable the model is. A gate that only validated shape would
 * therefore admit almost anything — measuring whether the backend can constrain,
 * not whether the model can reason. Observed directly: a 2B candidate emitted a
 * perfectly valid Verdict with `outcome: "fail"` and an empty `findings` array —
 * a failing verdict naming nothing that failed.
 */
export interface SemanticCheck {
  readonly name: string;
  /** True when the output is coherent. */
  readonly holds: (value: unknown) => boolean;
}

export interface AdmissionProbe {
  readonly name: string;
  /**
   * The tier this probe judges. Admission is granted **to a tier**, not in the
   * abstract: a Tier-1 worker produces evidence bundles and never authors a
   * Verdict, so probing it with one refuses it for failing a job it would never
   * be given. That is exactly what happened to a 2B candidate in P3.
   */
  readonly logicalTier: LogicalTier;
  /** A published shared schema — handed to the model verbatim. */
  readonly schema: TSchema;
  readonly prompt: string;
  /** What a passing response looks like; used to exercise the gate itself. */
  readonly sample: () => unknown;
  readonly semanticChecks: readonly SemanticCheck[];
}

export interface StructuredOutputBackend {
  generate(args: {
    readonly provider: string;
    readonly model: string;
    readonly probe: AdmissionProbe;
  }): Promise<unknown>;
}

export interface AdmissionFailure {
  readonly probe: string;
  readonly errors: ValidationError[];
}

export interface AdmissionResult {
  readonly candidate: { readonly provider: string; readonly model: string };
  /** The tier this verdict is about — admission is never tier-free. */
  readonly logicalTier: LogicalTier;
  readonly admitted: boolean;
  readonly failures: AdmissionFailure[];
  /** How many independent runs the verdict rests on (defect `d678cd8c`). */
  readonly runs: number;
  /**
   * Fraction of runs in which the candidate passed every probe.
   *
   * Carried as DATA rather than collapsed into the boolean, because
   * "reliable enough" is a policy question the Tier Policy engine owns —
   * ADR-0002 makes tier a computed policy, and this is one of its inputs.
   * Deciding a threshold here would be this function inventing a cap.
   */
  readonly passRate: number;
}

const AT = '2026-07-26T09:00:00.000Z';
const UUID_A = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const UUID_B = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const UUID_C = '7b2d9e10-4c58-4a3f-b6e2-1f8c0d5a9b47';

/**
 * The admission set, across all tiers. Select with {@link probesForTier} —
 * running a candidate against another tier's work is how P3 wrongly refused a
 * small local model.
 *
 * Tier 1 is judged on `EvidenceBundle`, the artifact an atomic worker actually
 * produces. Tier 2 is judged on `Verdict` (closed enums plus a nested array of
 * objects) and `CapabilityManifest` (a `minItems` constraint and an integer
 * bound) — the meta-agent authoring and review work that tier is for.
 */
export const ADMISSION_PROBES: readonly AdmissionProbe[] = [
  {
    name: 'worker-evidence-bundle',
    logicalTier: 1,
    schema: EvidenceBundleSchema,
    prompt:
      'You are a worker that answered the sub-question "what is the current adoption rate?" ' +
      'using the entitled source list. Emit your evidence bundle as JSON matching the schema. ' +
      'The deliverable MUST be an object with a non-empty "answer" string and a "citations" number. ' +
      'Use an empty actions array and null reflection.',
    sample: () => ({
      bundleId: UUID_A,
      taskId: UUID_B,
      agentId: UUID_C,
      deliverable: { answer: 'Adoption reached 34% as of Q1 2026.', citations: 2 },
      actions: [],
      consulted: [{ source: 'mission-brief', viaBrokerGrantId: null }],
      assumptions: ['"Adoption" means paid seats.'],
      reflection: null,
      effortSpent: 3,
      producedAt: AT,
    }),
    semanticChecks: [
      {
        // Instruction-following, which is what a Tier-1 worker is actually for.
        // `deliverable` is Type.Unknown() in the schema — deliberately, since its
        // shape is the task's business — so this is unreachable by validation.
        name: 'the deliverable carries the non-empty "answer" the prompt demanded',
        holds: (value) => {
          const bundle = value as { deliverable?: unknown };
          const answer = (bundle.deliverable as { answer?: unknown } | undefined)?.answer;
          return typeof answer === 'string' && answer.trim().length > 0;
        },
      },
      {
        // Effort is a currency (invariant #7). A bundle that produced a
        // deliverable while spending nothing is not a coherent account of work.
        name: 'the bundle accounts for the effort it spent',
        holds: (value) => {
          const spent = (value as { effortSpent?: unknown }).effortSpent;
          return typeof spent === 'number' && spent > 0;
        },
      },
    ],
  },
  {
    name: 'verdict',
    logicalTier: 2,
    schema: VerdictSchema,
    prompt:
      'A reviewer checked a task and found that one acceptance criterion failed: a factual ' +
      'claim carried no citation. Emit the Gate B verdict as JSON matching the schema exactly.',
    sample: () => ({
      verdictId: UUID_A,
      taskId: UUID_B,
      gate: 'B',
      outcome: 'fail',
      reviewerId: UUID_C,
      verificationDepth: 'single',
      findings: [
        {
          criterionId: 'ac-2',
          errorClass: 'verification_failure',
          failingStep: 'Citation check',
          detail: 'The claim carries no resolvable citation.',
        },
      ],
      redFlags: [],
      issuedAt: AT,
    }),
    semanticChecks: [
      {
        // The one assertion the schema genuinely cannot make: a verdict that
        // fails must say what failed. `findings` is legitimately empty on a
        // pass, so `minItems` would be wrong — the constraint is conditional.
        name: 'a failing verdict names at least one finding',
        holds: (value) => {
          const verdict = value as { outcome?: unknown; findings?: unknown };
          if (verdict.outcome !== 'fail') return true;
          return Array.isArray(verdict.findings) && verdict.findings.length > 0;
        },
      },
      {
        name: 'the verdict answers the prompt — it reports a failure',
        holds: (value) => (value as { outcome?: unknown }).outcome === 'fail',
      },
    ],
  },
  {
    name: 'capability-manifest',
    logicalTier: 2,
    schema: CapabilityManifestSchema,
    prompt:
      'Design a specialist that answers one research sub-question from entitled sources and ' +
      'cites everything. Emit its capability manifest as JSON matching the schema exactly.',
    sample: () => ({
      manifestId: UUID_A,
      designId: UUID_B,
      version: 1,
      category: 'research.sub-question',
      roleInstructions: 'Answer exactly one sub-question from entitled sources; cite everything.',
      capabilities: ['web.search', 'text.summarize'],
      contextEntitlements: ['mission-brief'],
      logicalTier: 1,
      validationHarness: { checks: ['Every claim has a citation.'] },
      createdAt: AT,
    }),
    semanticChecks: [
      {
        // A specialist that may request nothing cannot do research. The schema
        // permits an empty list because some agents legitimately need no context.
        name: 'a research specialist is granted some context',
        holds: (value) => {
          const manifest = value as { contextEntitlements?: unknown };
          return Array.isArray(manifest.contextEntitlements) && manifest.contextEntitlements.length > 0;
        },
      },
    ],
  },
];

/** The probes that judge a candidate applying for `logicalTier`. */
export function probesForTier(logicalTier: LogicalTier): readonly AdmissionProbe[] {
  return ADMISSION_PROBES.filter((probe) => probe.logicalTier === logicalTier);
}

/**
 * Run a candidate model against the admission set for the tier it is applying for.
 *
 * Two failure modes are deliberately *not* silent:
 *   - A probe that **throws** counts as a failure, not an absence of failures. A
 *     crashed or unreachable backend must never read as "nothing went wrong",
 *     which would admit a model nobody ever successfully tested.
 *   - A tier with **no probes** raises {@link NoProbesForTierError} rather than
 *     returning `admitted: true`. Vacuous truth is the rubber stamp this gate
 *     exists to prevent, and it looks identical to a real pass.
 */
export async function runAdmissionGate(options: {
  readonly candidate: { readonly provider: string; readonly model: string };
  readonly logicalTier: LogicalTier;
  /** Defaults to the probes registered for this tier. */
  readonly probes?: readonly AdmissionProbe[];
  readonly backend: StructuredOutputBackend;
  /**
   * How many independent runs to sample (defect `d678cd8c`).
   *
   * Model output is stochastic, and a single sample was being recorded as a
   * permanent catalog fact — the same model was refused at Tier 2 in one phase
   * and admitted at Tier 2 in the next. Tier resolution should not depend on
   * which sample happened to run on admission day.
   *
   * Admission requires EVERY run to pass. That is unanimity, not an invented
   * threshold: the `passRate` is carried alongside so the Tier Policy engine
   * can treat reliability as an input rather than this function deciding what
   * "reliable enough" means. Defaults to 1, so existing callers are unchanged.
   */
  readonly runs?: number;
}): Promise<AdmissionResult> {
  const { candidate, logicalTier, backend } = options;
  const probes = options.probes ?? probesForTier(logicalTier);
  const runs = options.runs ?? 1;

  if (probes.length === 0) {
    throw new NoProbesForTierError(logicalTier);
  }

  const failures: AdmissionFailure[] = [];
  let cleanRuns = 0;

  for (let run = 0; run < runs; run += 1) {
    const before = failures.length;

  for (const probe of probes) {
    let output: unknown;
    try {
      output = await backend.generate({ ...candidate, probe });
    } catch (error) {
      failures.push({
        probe: probe.name,
        errors: [
          {
            path: '/',
            message: `${probe.name}: backend failed — ${
              error instanceof Error ? error.message : String(error)
            }`,
            keyword: 'backend',
          },
        ],
      });
      continue;
    }

    const result = validate(probe.schema, output);
    if (!result.ok) {
      failures.push({ probe: probe.name, errors: result.errors });
      continue;
    }

    // Shape passed. Now ask whether the content means anything — see SemanticCheck.
    const incoherent = probe.semanticChecks
      .filter((check) => !check.holds(output))
      .map((check) => ({
        path: '/',
        message: `${probe.name}: schema-valid but incoherent — ${check.name}`,
        keyword: 'semantic',
      }));

    if (incoherent.length > 0) {
      failures.push({ probe: probe.name, errors: incoherent });
    }
    }

    if (failures.length === before) cleanRuns += 1;
  }

  return {
    candidate,
    logicalTier,
    admitted: failures.length === 0,
    failures,
    runs,
    passRate: cleanRuns / runs,
  };
}
