/**
 * @artifex/worker — the agent runtime, the heart of Artifex.
 *
 * Hosts the four meta-agents (Orchestrator, Agent Creator, Reviewer, Learning
 * Agent) plus the Constitution, Context Broker, and the ephemeral Worker Swarm.
 * From phase P9 a BullMQ consumer runs the whole mission loop here — this runs
 * OUTSIDE the API request path. As of P4 the Constitution guards and the Tier
 * Policy engine are real; the meta-agents and the queue wiring are not yet.
 */
import { pathToFileURL } from 'node:url';

export * from './constitution.js';
export * from './tier-policy.js';
export * from './orchestrator.js';
export * from './planner.js';

export const PACKAGE_NAME = '@artifex/worker';

export function main(): void {
  // BullMQ worker wiring lands in P9. Placeholder entrypoint.
  console.log(`${PACKAGE_NAME}: placeholder entrypoint (no mission loop yet)`);
}

// Run only when executed directly (`node dist/index.js`), not when imported.
const entryArg = process.argv[1];
if (entryArg !== undefined && import.meta.url === pathToFileURL(entryArg).href) {
  main();
}
