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
import { TaskContractSchema, assertValid } from '@artifex/shared-types';
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
}

export interface MissionJob {
  readonly missionId: string;
  readonly contract: TaskContract;
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
  ) {}

  async accept(request: IntakeRequest): Promise<{ contract: TaskContract }> {
    // Refuse rather than default. Inventing a criterion on the requester's
    // behalf would be the control plane deciding what success means — and "no
    // work without a contract" (invariant #2) starts at intake, not at the first
    // decomposition.
    if (request.objective.trim().length === 0) {
      throw new BadRequestException('a mission needs an objective');
    }
    if (request.successCriteria.length === 0) {
      throw new BadRequestException('a mission needs at least one success criterion — a mission nobody can grade is not a mission');
    }

    const missionId = this.clock.newId();
    const createdAt = this.clock.now();

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
      inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
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
      payload: { objective: contract.objective, autonomyDial: contract.autonomyDial, budget: contract.budget },
      occurredAt: createdAt,
    });

    await this.queue.enqueue({ missionId, contract });

    return { contract };
  }
}
