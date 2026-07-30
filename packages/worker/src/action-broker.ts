/**
 * The Action Broker — the sole ACTION channel (R13, ADR-0006/0007).
 *
 * Sibling of the Context Broker, and deliberately a sibling rather than an
 * extension of it: context is what an agent may *know*, actions are what it may
 * *do*. Those carry different risk, different governance, and different audit
 * needs, so overloading one channel would blur exactly the distinction that
 * makes the grants meaningful.
 *
 * Agent code never reaches the network, filesystem or shell directly. An
 * unmediated tool call is an unlogged side effect, and the ledger is supposed to
 * be the complete record of what happened (invariant #1) — so every invocation
 * funnels through {@link ActionBroker.invoke}, including the ones that fail and
 * the ones that are refused.
 *
 * That single funnel is also what lets sandboxing and credential handling land
 * later without redesign. Security remains deferred project-wide; the obligation
 * discharged here is only that there is exactly one door.
 */
import type {
  ActionRecord,
  AutonomyDial,
  BlastRadius,
  ToolRiskClass,
  WorkerContractView,
} from '@artifex/shared-types';

import type { EventSink } from './event-sink.js';

export interface ToolDescriptor {
  readonly toolId: string;
  readonly riskClass: ToolRiskClass;
  readonly description: string;
  invoke(args: Record<string, unknown>): Promise<unknown>;
}

export interface Ratification {
  readonly ratifiedBy: string;
  readonly ratifiedAt: string;
}

export class ToolNotEntitledError extends Error {
  constructor(toolId: string, taskId: string) {
    super(`task ${taskId} is not entitled to invoke "${toolId}"`);
    this.name = 'ToolNotEntitledError';
  }
}

export class RiskClassNotAdmittedError extends Error {
  constructor(toolId: string, riskClass: ToolRiskClass, blastRadius: BlastRadius) {
    super(
      `"${toolId}" is ${riskClass}-class, which a ${blastRadius}-blast-radius task does not admit — ` +
        `using it would make the task's real blast radius exceed its declared one`,
    );
    this.name = 'RiskClassNotAdmittedError';
  }
}

export class RatificationRequiredError extends Error {
  constructor(toolId: string, riskClass: ToolRiskClass, dial: AutonomyDial) {
    super(`"${toolId}" is ${riskClass}-class and the ${dial} autonomy dial requires human ratification first`);
    this.name = 'RatificationRequiredError';
  }
}

/**
 * Which risk classes a blast radius admits (ADR-0007).
 *
 * The rule is that **a declared blast radius must cover the tools used**. A
 * `write` action creates consequence, so performing one under a `low` declaration
 * would make the task's real blast radius exceed its declared one — invalidating
 * the verification depth and model tier that were assigned on that declaration.
 */
export function admissibleRiskClasses(blastRadius: BlastRadius): ToolRiskClass[] {
  switch (blastRadius) {
    case 'low':
      return ['read'];
    case 'medium':
      return ['read', 'compute'];
    case 'high':
      return ['read', 'compute', 'write'];
  }
}

/** Which risk classes need a human first, per the autonomy dial (ADR-0007). */
export function requiresRatification(dial: AutonomyDial): ToolRiskClass[] {
  switch (dial) {
    case 'autonomous':
      return [];
    case 'checkpointed':
      return ['write'];
    case 'supervised':
      return ['compute', 'write'];
  }
}

/** A short, reviewable summary — bundles must stay bounded, so never the payload. */
function digest(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= 200 ? text : `${text.slice(0, 197)}...`;
}

let counter = 0;

export class ActionBroker {
  readonly #tools: Map<string, ToolDescriptor>;
  readonly #sink: EventSink;
  readonly #missionId: string;

  constructor(options: { tools: readonly ToolDescriptor[]; sink: EventSink; missionId: string }) {
    this.#tools = new Map(options.tools.map((t) => [t.toolId, t]));
    this.#sink = options.sink;
    this.#missionId = options.missionId;
  }

  /**
   * Invoke one tool on behalf of an agent.
   *
   * Three denial paths, each a typed error and each **logged as a denied
   * attempt**. Neither silence is acceptable: silently ignoring the call hides a
   * capability gap the Learning Agent should see, and silently permitting it
   * defeats the entitlement entirely.
   */
  async invoke(input: {
    readonly agentId: string;
    readonly contract: WorkerContractView;
    readonly toolId: string;
    readonly args: Record<string, unknown>;
    readonly occurredAt: string;
    readonly ratification?: Ratification;
  }): Promise<ActionRecord> {
    const { agentId, contract, toolId, args, occurredAt, ratification } = input;

    const tool = this.#tools.get(toolId);
    if (tool === undefined) {
      await this.#deny(contract, agentId, toolId, occurredAt, 'unknown tool — not in the registry');
      throw new Error(`unknown tool "${toolId}"`);
    }

    const entitlement = contract.inputs.toolEntitlements.find((t) => t.toolId === toolId);
    if (entitlement === undefined) {
      await this.#deny(contract, agentId, toolId, occurredAt, 'the contract does not entitle this tool');
      throw new ToolNotEntitledError(toolId, contract.taskId);
    }

    if (!admissibleRiskClasses(contract.blastRadius).includes(tool.riskClass)) {
      await this.#deny(
        contract, agentId, toolId, occurredAt,
        `${tool.riskClass}-class tool is not admitted at ${contract.blastRadius} blast radius`,
      );
      throw new RiskClassNotAdmittedError(toolId, tool.riskClass, contract.blastRadius);
    }

    if (requiresRatification(contract.autonomyDial).includes(tool.riskClass) && ratification === undefined) {
      await this.#deny(
        contract, agentId, toolId, occurredAt,
        `${tool.riskClass}-class tool needs human ratification under a ${contract.autonomyDial} dial`,
      );
      throw new RatificationRequiredError(toolId, tool.riskClass, contract.autonomyDial);
    }

    counter += 1;
    const grantId = `action-${contract.taskId.slice(0, 8)}-${counter}`;

    // A tool that throws is a recorded outcome, not a swallowed one: "we tried
    // and it failed" is information the Reviewer and the Learning Agent need.
    let outcome: ActionRecord['outcome'] = 'ok';
    let result: unknown;
    try {
      result = await tool.invoke(args);
    } catch (error) {
      outcome = 'error';
      result = error instanceof Error ? error.message : String(error);
    }

    const record: ActionRecord = {
      actionId: `${contract.taskId.slice(0, 24)}${counter.toString(16).padStart(12, '0')}`,
      toolId,
      riskClass: tool.riskClass,
      arguments: args,
      resultDigest: digest(result),
      viaBrokerGrantId: grantId,
      outcome,
      invokedAt: occurredAt,
    };

    await this.#sink.append({
      eventId: `${contract.taskId.slice(0, 24)}${(counter + 0x500000).toString(16).padStart(12, '0')}`,
      missionId: this.#missionId,
      taskId: contract.taskId,
      family: 'action',
      type: 'action.invoked',
      actor: { kind: 'action_broker', id: agentId, displayName: 'Action Broker' },
      payload: {
        grantId, toolId, riskClass: tool.riskClass, arguments: args,
        resultDigest: record.resultDigest, outcome,
        ...(ratification === undefined ? {} : { ratifiedBy: ratification.ratifiedBy }),
      },
      occurredAt,
    });

    return record;
  }

  async #deny(
    contract: WorkerContractView,
    agentId: string,
    toolId: string,
    occurredAt: string,
    reason: string,
  ): Promise<void> {
    counter += 1;
    await this.#sink.append({
      eventId: `${contract.taskId.slice(0, 24)}${(counter + 0xa00000).toString(16).padStart(12, '0')}`,
      missionId: this.#missionId,
      taskId: contract.taskId,
      family: 'action',
      type: 'action.denied',
      actor: { kind: 'action_broker', id: agentId, displayName: 'Action Broker' },
      payload: { toolId, reason },
      occurredAt,
    });
  }
}
