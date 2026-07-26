/**
 * Canonical schema-valid samples, one per shared schema.
 *
 * These stand in for what an LLM returns from a structured-output call
 * constrained by the exported JSON Schema (R1 AC-1). Each is `satisfies`-checked
 * against its inferred `Static<>` type, so the fixtures also prove the schema's
 * TypeScript inference is usable — if a schema and its type ever drift, this
 * file stops compiling.
 *
 * Excluded from the build (see tsconfig.json) — test support only.
 */
import type {
  ActionRecord,
  CapabilityManifest,
  EvidenceBundle,
  LedgerEvent,
  LedgerEventInput,
  ModelCatalogEntry,
  ReflectionRecord,
  TaskContract,
  Verdict,
  WorkerContractView,
} from '../index.js';

// Fixed ids/timestamps — fixtures must be deterministic.
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const TASK_ID = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const AGENT_ID = '7b2d9e10-4c58-4a3f-b6e2-1f8c0d5a9b47';
const AT = '2026-07-24T09:00:00.000Z';

export function validTaskContract(): TaskContract {
  return {
    taskId: TASK_ID,
    missionId: MISSION_ID,
    parentTaskId: MISSION_ID,
    category: 'research.sub-question',
    depth: 1,
    objective: 'Answer the sub-question "what is the current adoption rate?" with cited sources.',
    acceptanceCriteria: [
      {
        criterionId: 'ac-1',
        statement: 'The answer states a rate with a unit and a date.',
      },
      {
        criterionId: 'ac-2',
        statement: 'Every factual claim carries at least one resolvable citation.',
      },
    ],
    boundaries: {
      outOfScope: ['Do not draft the final report — the parent assembles it.'],
      siblingOwners: [{ concern: 'Cost projections', taskId: MISSION_ID }],
    },
    inputs: {
      entitlements: ['The mission brief', 'The shared source list'],
      toolEntitlements: [
        {
          entitlementId: 'te-1',
          toolId: 'web.search',
          riskClass: 'read',
          scope: 'The entitled source list only.',
        },
      ],
      pinnedDecisions: [
        { id: 'pd-1', decision: 'Cite sources as "Author (Year), URL".' },
      ],
    },
    dependencies: {
      consumesTaskIds: [],
      mayRequest: ['knowledge-commons:adoption-metrics'],
    },
    stoppingConditions: {
      doneWhen: ['All acceptance criteria are demonstrably met.'],
      stopTryingWhen: ['No resolvable source exists after the search budget is spent.'],
      maxAttempts: 3,
      stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: {
      ladder: ['retry_higher_tier', 'different_agent', 'human_review'],
      humanAt: 'human_review',
    },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low',
    autonomyDial: 'checkpointed',
    createdAt: AT,
  } satisfies TaskContract;
}

export function validLedgerEventInput(): LedgerEventInput {
  return {
    eventId: 'e2b7c1d0-5a49-4f38-9b6e-0c3d8a7f2e51',
    missionId: MISSION_ID,
    taskId: TASK_ID,
    family: 'verification',
    type: 'gate_b.verdict_issued',
    actor: { kind: 'reviewer', id: AGENT_ID, displayName: 'Reviewer' },
    payload: { gate: 'B', outcome: 'pass' },
    occurredAt: AT,
  } satisfies LedgerEventInput;
}

export function validLedgerEvent(): LedgerEvent {
  return {
    ...validLedgerEventInput(),
    seq: 42,
    recordedAt: AT,
  } satisfies LedgerEvent;
}

export function validWorkerContractView(): WorkerContractView {
  // Built by withholding, so the fixture cannot drift from the full contract.
  const { verificationPlan: _withheld, ...view } = validTaskContract();

  return view satisfies WorkerContractView;
}

export function validActionRecord(): ActionRecord {
  return {
    actionId: '5e4d3c2b-1a09-4f8e-7d6c-5b4a39281706',
    toolId: 'web.search',
    riskClass: 'read',
    arguments: { query: 'seat adoption rate Q1 2026', limit: 5 },
    resultDigest: '5 hits; top: vendor report Q1 2026 (sha256:9f2c4b…)',
    viaBrokerGrantId: 'grant-91',
    outcome: 'ok',
    invokedAt: AT,
  } satisfies ActionRecord;
}

export function validReflectionRecord(): ReflectionRecord {
  return {
    reflectionId: '2c1b0a9f-8e7d-4c6b-9a58-4736251409e8',
    priorDraftEventId: 'f0e1d2c3-b4a5-4968-8776-5a4b3c2d1e0f',
    critiques: [
      { criterionId: 'ac-1', assessment: 'met', note: 'Rate and date are both stated.' },
      {
        criterionId: 'ac-2',
        assessment: 'unmet',
        note: 'The 34% claim carried no citation; re-searched and cited the vendor report.',
      },
    ],
    revised: true,
    effortSpent: 1,
    performedAt: AT,
  } satisfies ReflectionRecord;
}

export function validEvidenceBundle(): EvidenceBundle {
  return {
    bundleId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    taskId: TASK_ID,
    agentId: AGENT_ID,
    deliverable: { answer: 'Adoption reached 34% as of Q1 2026.', citations: 2 },
    actions: [validActionRecord()],
    consulted: [
      { source: 'knowledge-commons:adoption-metrics', viaBrokerGrantId: 'grant-77' },
      { source: 'mission-brief', viaBrokerGrantId: null },
    ],
    assumptions: ['"Adoption" means paid seats, per the pinned decision.'],
    reflection: validReflectionRecord(),
    effortSpent: 4,
    producedAt: AT,
  } satisfies EvidenceBundle;
}

export function validVerdict(): Verdict {
  return {
    verdictId: 'd4c3b2a1-f6e5-4b7a-9c8d-1e0f3a2b5c4d',
    taskId: TASK_ID,
    gate: 'B',
    outcome: 'fail',
    reviewerId: AGENT_ID,
    verificationDepth: 'single',
    findings: [
      {
        criterionId: 'ac-2',
        errorClass: 'verification_failure',
        failingStep: 'Citation check',
        detail: 'Claim "34% adoption" carries no resolvable citation.',
      },
    ],
    redFlags: [],
    issuedAt: AT,
  } satisfies Verdict;
}

export function validModelCatalogEntry(): ModelCatalogEntry {
  return {
    logicalTier: 1,
    provider: 'ollama',
    model: 'qwen2.5:14b',
    params: { temperature: 0.2 },
    contextWindow: 32_768,
    costWeight: 1,
    capabilities: ['structured-output', 'tool-calling'],
    quantization: 'q4_K_M',
    admitted: true,
    version: 1,
    updatedAt: AT,
  } satisfies ModelCatalogEntry;
}

export function validCapabilityManifest(): CapabilityManifest {
  return {
    manifestId: 'b5a4c3d2-e1f0-4a9b-8c7d-6e5f4a3b2c1d',
    designId: '9c8b7a6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d',
    version: 1,
    category: 'research.sub-question',
    roleInstructions: 'Answer exactly one sub-question from entitled sources; cite everything.',
    capabilities: ['web.search', 'text.summarize'],
    contextEntitlements: ['mission-brief', 'knowledge-commons:adoption-metrics'],
    logicalTier: 1,
    validationHarness: {
      checks: ['Every claim has a citation.', 'Answer length is under 300 words.'],
    },
    createdAt: AT,
  } satisfies CapabilityManifest;
}
