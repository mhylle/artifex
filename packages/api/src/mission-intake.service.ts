/**
 * Mission intake — the control plane's one act of creation.
 *
 * It turns a request into **task zero**: a real `TaskContract`, validated against
 * the same schema every other task uses, because the mission is a task too. Then
 * it enqueues and stops.
 *
 * The guardrail this service exists to enforce: **the API never runs a mission.**
 * A mission's thousand-task tree cannot live inside an HTTP request, so intake
 * decomposes nothing, staffs nobody, and verifies nothing. It validates, records
 * the human act, and hands the work to the runtime.
 */
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { MissionIntakeRequestSchema, TaskContractSchema, assertValid, validate } from '@artifex/shared-types';
import type { AutonomyDial, BlastRadius, TaskContract } from '@artifex/shared-types';

import type { LedgerSink } from './ledger.types';

export interface IntakeRequest {
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly outOfScope: readonly string[];
  readonly autonomyDial: AutonomyDial;
  readonly budget: { readonly floor: number; readonly ceiling: number; readonly unit: string };
  readonly blastRadius: BlastRadius;
  readonly requestedBy: string;
  /** A surrendered mission this one re-enters (R37 AC-2). */
  readonly priorMissionId?: string;
}

export interface MissionJob {
  readonly missionId: string;
  readonly contract: TaskContract;
}

/**
 * Where a prior mission's surrender dossier comes from (R37 AC-2).
 *
 * A seam rather than a repository import, so the control plane keeps depending
 * on shapes rather than on the fabric — and so intake can be tested without a
 * database. Returns null when there is no such dossier: a requester quoting a
 * mission id that no longer exists should still get a mission, and inventing
 * context for it would be worse than having none.
 */
export interface DossierLookup {
  forMission(missionId: string): Promise<Record<string, unknown> | null>;
}

export interface MissionQueue {
  enqueue(job: MissionJob): Promise<void>;
}

export interface IntakeClock {
  now(): string;
  newId(): string;
}

@Injectable()
export class MissionIntakeService {
  constructor(
    private readonly queue: MissionQueue,
    private readonly ledger: LedgerSink,
    private readonly clock: IntakeClock,
    /** Optional: without it, re-entry simply carries nothing forward. */
    private readonly dossiers?: DossierLookup,
  ) {}

  async accept(request: IntakeRequest): Promise<{ contract: TaskContract }> {
    // Two layers, in this order, because they answer different questions and the
    // operator deserves the more specific answer when it applies.
    //
    // First: the field is *there* but says nothing. These get the sentence a
    // human can act on. Written defensively because at this point nothing has
    // yet proven the body has any shape at all.
    //
    // Refusing rather than defaulting is the point — inventing a criterion on
    // the requester's behalf would be the control plane deciding what success
    // means, and "no work without a contract" (invariant #2) starts at intake,
    // not at the first decomposition.
    if (typeof request?.objective === 'string' && request.objective.trim().length === 0) {
      throw new BadRequestException('a mission needs an objective');
    }
    if (
      Array.isArray(request?.successCriteria) &&
      request.successCriteria.every((c) => typeof c !== 'string' || c.trim().length === 0)
    ) {
      throw new BadRequestException('a mission needs at least one success criterion — a mission nobody can grade is not a mission');
    }

    // Second: the body is malformed — a field missing, mistyped, or unexpected.
    // Until this existed, `@Body() body: IntakeRequest` typed against a
    // TypeScript interface that is erased at runtime, so a missing field reached
    // the code below and died as `Cannot read properties of undefined (reading
    // 'length')` — a 500 that told the operator nothing and looked exactly like
    // the control plane being down (defect `fd345eae`). Validating with the
    // shared TypeBox object keeps this edge on the same validator as everything
    // else rather than importing a second validation dialect (ADR-0004).
    const shape = validate(MissionIntakeRequestSchema, request);
    if (!shape.ok) {
      throw new BadRequestException({
        message: `the mission request is not well-formed: ${shape.errors.map((e) => e.message).join('; ')}`,
        errors: shape.errors,
      });
    }

    const missionId = this.clock.newId();
    const createdAt = this.clock.now();

    // ---- re-entry: start from what the first attempt already learned --------
    // Pinned rather than merely attached: `pinnedDecisions` is inherited by every
    // child contract, so the planner and each worker see the prior blockers.
    // Recording it on the intake event alone would put it in the trail and out
    // of the swarm's way, which is exactly the rediscovery this prevents.
    //
    // A failed lookup is swallowed. A control plane that refuses to start a
    // mission because a *historical* record could not be read has turned an
    // optional convenience into a hard dependency.
    let priorDossier: Record<string, unknown> | null = null;
    if (typeof request.priorMissionId === 'string' && this.dossiers !== undefined) {
      priorDossier = await this.dossiers.forMission(request.priorMissionId).catch(() => null);
    }

    const inherited = ((priorDossier?.['whatItWouldTake'] as unknown[] | undefined) ?? [])
      .filter((entry): entry is string => typeof entry === 'string')
      .map((decision, index) => ({ id: `prior-${index + 1}`, decision }));

    const contract: TaskContract = {
      taskId: missionId,
      // The mission IS task zero: it is its own mission, has no parent, sits at
      // depth zero, and is graded exactly like anything else.
      missionId,
      parentTaskId: null,
      category: 'mission',
      depth: 0,
      objective: request.objective,
      acceptanceCriteria: request.successCriteria.map((statement, index) => ({
        criterionId: `m-${index + 1}`,
        statement,
      })),
      boundaries: { outOfScope: [...request.outOfScope], siblingOwners: [] },
      inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: inherited },
      dependencies: { consumesTaskIds: [], mayRequest: [] },
      stoppingConditions: {
        doneWhen: request.successCriteria.map((s) => `Demonstrably met: ${s}`),
        stopTryingWhen: ['The escalation ladder is exhausted without a verified result.'],
        maxAttempts: 3,
        stallLimit: 2,
      },
      budget: { ...request.budget },
      escalationPolicy: {
        ladder: ['retry_higher_tier', 'different_agent', 'agent_redesign', 're_decomposition', 'human_review'],
        // Where the human sits is the autonomy dial's decision, not the API's.
        humanAt: request.autonomyDial === 'autonomous' ? null : 'human_review',
      },
      verificationPlan: {
        depth: request.blastRadius === 'high' ? 'redundant' : 'single',
        requiredAgreement: request.blastRadius === 'high' ? 2 : null,
      },
      blastRadius: request.blastRadius,
      autonomyDial: request.autonomyDial,
      createdAt,
    };

    // Validated before anything is recorded or enqueued: nothing downstream can
    // fix a malformed contract, and the worker is entitled to assume it is valid.
    assertValid(TaskContractSchema, contract);

    // The human act is a first-class ledger event — the symmetry rule. An
    // operator starting a mission is exactly as auditable as an agent acting.
    await this.ledger.append({
      eventId: this.clock.newId(),
      missionId,
      taskId: missionId,
      family: 'contract',
      type: 'mission.intake_accepted',
      actor: { kind: 'human', id: request.requestedBy, displayName: request.requestedBy },
      payload: {
        objective: contract.objective,
        autonomyDial: contract.autonomyDial,
        budget: contract.budget,
        // Task zero's WHOLE contract, for the same reason children carry theirs
        // (R41): a mission cannot be resumed from a trail that does not contain
        // the contract it is being judged against.
        contract,
        // What this attempt inherited, and from where (R37 AC-2). Recorded even
        // though the pinned decisions are already in the contract: the trail
        // should show that this was a SECOND attempt, not a fresh one that
        // happened to arrive with constraints attached.
        ...(priorDossier === null ? {} : { priorMissionId: request.priorMissionId, priorDossier }),
      },
      occurredAt: createdAt,
    });

    await this.queue.enqueue({ missionId, contract });

    return { contract };
  }
}
