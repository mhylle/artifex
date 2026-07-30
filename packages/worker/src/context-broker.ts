/**
 * The Context Broker — the sole context channel (invariant #6).
 *
 * Agents exchange context only through here, and every exchange is logged. The
 * design choice that makes that real rather than aspirational: **the grant IS the
 * capability**. `BrokeredFabric.read` requires a grant id the broker issued for
 * that exact source, so "bypassing the broker" is not a rule someone can forget
 * to enforce — it is a missing argument that fails at the call site.
 *
 * A policy that lives in a comment gets bypassed the first time somebody is in a
 * hurry. A policy that lives in a type signature does not.
 */
import type { LedgerEventInput, WorkerContractView } from '@artifex/shared-types';

/** Anything that can hand back a context payload for a named source. */
export interface ContextStore {
  read(source: string): Promise<unknown>;
}

/** Where broker events go. The real one is the ledger repository. */
export interface EventSink {
  append(event: LedgerEventInput): Promise<unknown>;
}

export class UnentitledSourceError extends Error {
  readonly source: string;

  constructor(source: string, taskId: string) {
    super(`task ${taskId} is not entitled to context source "${source}"`);
    this.name = 'UnentitledSourceError';
    this.source = source;
  }
}

export class UnbrokeredAccessError extends Error {
  constructor(source: string, detail: string) {
    super(`refused unbrokered read of "${source}": ${detail}`);
    this.name = 'UnbrokeredAccessError';
  }
}

export interface ContextGrant {
  readonly grantId: string;
  readonly source: string;
  readonly agentId: string;
  readonly payload: unknown;
}

/**
 * A fabric handle that only answers to broker-issued grants.
 *
 * Grants are registered here when issued, and checked against the *source* they
 * were issued for — a grant is a capability for one source, not a general key.
 */
export class BrokeredFabric {
  readonly #store: ContextStore;
  readonly #grants = new Map<string, string>();

  constructor(store: ContextStore) {
    this.#store = store;
  }

  /** Called by the broker as it issues a grant. */
  registerGrant(grantId: string, source: string): void {
    this.#grants.set(grantId, source);
  }

  async read(source: string, grantId: string | undefined): Promise<unknown> {
    if (grantId === undefined) {
      throw new UnbrokeredAccessError(source, 'no broker grant was presented');
    }
    const granted = this.#grants.get(grantId);
    if (granted === undefined) {
      throw new UnbrokeredAccessError(source, 'the grant is not one this broker issued');
    }
    if (granted !== source) {
      throw new UnbrokeredAccessError(source, `the grant was issued for "${granted}", not this source`);
    }
    return this.#store.read(source);
  }

  /**
   * The broker's own read path. It needs no grant because it is the thing that
   * issues them; entitlement was already checked against the contract.
   */
  readAsBroker(source: string): Promise<unknown> {
    return this.#store.read(source);
  }
}

let grantCounter = 0;

export class ContextBroker {
  readonly #sink: EventSink;
  readonly #missionId: string;
  readonly #fabric: BrokeredFabric;

  /**
   * The fabric is required, not optional. An earlier shape let you construct a
   * broker without one, which silently produced grants no fabric would honour —
   * a working broker and a useless one were indistinguishable at the call site.
   */
  constructor(options: { fabric: BrokeredFabric; sink: EventSink; missionId: string }) {
    this.#fabric = options.fabric;
    this.#sink = options.sink;
    this.#missionId = options.missionId;
  }

  /**
   * Serve one context request.
   *
   * Entitlement is checked against **this contract**, never a global allowlist —
   * the contract is the sole authority on what a task may know, exactly as it is
   * the sole authority on what a task may do.
   *
   * A refusal is logged too. A silent denial leaves no more of a trail than a
   * silent permission, and the ledger is supposed to be the complete record of
   * what happened (invariant #1).
   */
  async request(input: {
    readonly agentId: string;
    readonly contract: WorkerContractView;
    readonly source: string;
    readonly occurredAt: string;
  }): Promise<ContextGrant> {
    const { agentId, contract, source, occurredAt } = input;
    const entitled =
      contract.inputs.entitlements.includes(source) || contract.dependencies.mayRequest.includes(source);

    if (!entitled) {
      await this.#sink.append(this.#event(contract, agentId, 'context.request_denied', occurredAt, {
        source,
        reason: 'not entitled by the contract',
      }));
      throw new UnentitledSourceError(source, contract.taskId);
    }

    const payload = await this.#fabric.readAsBroker(source);
    grantCounter += 1;
    const grantId = `grant-${contract.taskId.slice(0, 8)}-${grantCounter}`;
    this.#fabric.registerGrant(grantId, source);

    await this.#sink.append(this.#event(contract, agentId, 'context.granted', occurredAt, { source, grantId }));

    return { grantId, source, agentId, payload };
  }

  #event(
    contract: WorkerContractView,
    agentId: string,
    type: string,
    occurredAt: string,
    payload: Record<string, unknown>,
  ): LedgerEventInput {
    grantCounter += 1;
    return {
      eventId: `${contract.taskId.slice(0, 24)}${grantCounter.toString(16).padStart(12, '0')}`,
      missionId: this.#missionId,
      taskId: contract.taskId,
      family: 'execution',
      type,
      actor: { kind: 'context_broker', id: agentId, displayName: 'Context Broker' },
      payload,
      occurredAt,
    };
  }
}
