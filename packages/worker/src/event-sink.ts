/**
 * Where a broker's events go.
 *
 * Both the Context Broker and the Action Broker append to the ledger, and both
 * need to be testable without a database — so they depend on this interface
 * rather than on `@artifex/memory-fabric`. In production the sink is the ledger
 * repository; in tests it is a recorder.
 *
 * It lives in its own module so neither broker has to import the other. They are
 * siblings, not collaborators: context is what an agent may know, actions are
 * what it may do, and coupling them would blur exactly the distinction that
 * makes their grants mean different things.
 */
import type { LedgerEventInput } from '@artifex/shared-types';

export interface EventSink {
  append(event: LedgerEventInput): Promise<unknown>;
}
