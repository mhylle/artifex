/**
 * @artifex/worker — the agent runtime, the heart of Artifex.
 *
 * Hosts the four meta-agents (Orchestrator, Agent Creator, Reviewer, Learning
 * Agent) plus the Constitution, the Context and Action Brokers, and the
 * ephemeral Worker Swarm. A BullMQ consumer runs the whole mission loop here —
 * OUTSIDE the API request path, because a mission's task tree cannot live
 * inside an HTTP request.
 */
import { pathToFileURL } from 'node:url';

import { LedgerRepository, ModelCatalogRepository, runMigrations } from '@artifex/memory-fabric';
import { ModelRouter, createBackend } from '@artifex/model-router';
import type { TaskContract } from '@artifex/shared-types';
import { Worker } from 'bullmq';
import pg from 'pg';

import { runMission } from './mission-loop.js';
import { createLedgerControl, createMissionSeams } from './runtime.js';

export * from './constitution.js';
export * from './tier-policy.js';
export * from './orchestrator.js';
export * from './planner.js';
export * from './agent-creator.js';
export * from './reviewer.js';
export * from './event-sink.js';
export * from './context-broker.js';
export * from './specialist.js';
export * from './action-broker.js';
export * from './self-critique.js';
export * from './mission-loop.js';
export * from './learning-projection.js';
export * from './proposal-emitter.js';
export * from './runtime.js';

export const PACKAGE_NAME = '@artifex/worker';

/** Must match the control plane's queue name. */
export const MISSION_QUEUE_NAME = 'artifex.missions';

export async function main(): Promise<void> {
  const connectionString =
    process.env['DATABASE_URL'] ?? 'postgres://artifex:artifex@localhost:5433/artifex';
  const redis = {
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
  };
  const localBaseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1';

  await runMigrations(connectionString, 'up');

  const pool = new pg.Pool({ connectionString });
  const ledger = new LedgerRepository(pool);
  const catalog = new ModelCatalogRepository(pool);
  const router = new ModelRouter({
    catalog: {
      // `null` means "no admitted model for this tier"; a rejection would mean
      // the catalog itself failed, and that must not read as absence.
      async resolve(tier) {
        try {
          return await catalog.resolve(tier);
        } catch {
          return null;
        }
      },
    },
  });

  // Resolved once at boot so a misconfigured catalog fails loudly here, rather
  // than halfway through someone's first mission.
  const worker = await router.resolveTier(1);
  const evaluator = await router.resolveTier(2);
  const generator = createBackend({ localBaseUrl });

  console.log(`${PACKAGE_NAME}: listening on "${MISSION_QUEUE_NAME}"`);
  console.log(`  worker tier 1     -> ${worker.provider}/${worker.model}`);
  console.log(`  evaluative tier 2 -> ${evaluator.provider}/${evaluator.model}`);

  const consumer = new Worker<{ missionId: string; contract: TaskContract }>(
    MISSION_QUEUE_NAME,
    async (job) => {
      const { contract } = job.data;
      console.log(`\n> mission ${contract.missionId}: ${contract.objective}`);

      // The ledger is the checkpoint (R41). A mission that already has a trail
      // is being RESUMED — after a pause, a human decision, or a surrender — so
      // the loop folds what happened and continues, rather than re-planning from
      // scratch with fresh task ids that no earlier decision refers to.
      const priorTrail = await ledger.replay({ missionId: contract.missionId }).catch(() => []);
      if (priorTrail.length > 0) {
        console.log(`  resuming from ${priorTrail.length} recorded events`);
      }

      // Appends are chained rather than fired in parallel: the ledger's ordering
      // is what replay and time-travel are defined by, so events must reach it
      // in the order they happened. Awaiting the chain after the run means a
      // surrendered mission still lands a complete, ordered history.
      let appends: Promise<unknown> = Promise.resolve();
      const failed: string[] = [];

      const result = await runMission(
        contract,
        // The operator's pause/cancel reaches the runtime here. Without this
        // argument the control plane would append signals nothing ever read —
        // the exact shape of defects 04071ce9 and b3b4e554.
        createMissionSeams(
          generator,
          { worker, evaluator },
          createLedgerControl(ledger, contract.missionId),
        ),
        {
          now: new Date().toISOString(),
          resumeFrom: priorTrail,
          // Streamed as they happen (defect `b3b4e554`). Appending the whole
          // trail after the run left a watching dashboard blind for the entire
          // mission, then jumping straight to the finished state.
          onEvent: (event) => {
            appends = appends
              .then(() => ledger.append(event))
              .catch((cause: unknown) => {
                // Recorded, not thrown: losing the mission because the ledger
                // hiccuped would trade a reporting problem for a real one.
                failed.push(`${event.type}: ${String(cause)}`);
              });
          },
        },
      );

      await appends;
      if (failed.length > 0) {
        console.error(`! ${failed.length} ledger append(s) failed:\n  ${failed.join('\n  ')}`);
      }

      console.log(
        `< mission ${contract.missionId}: ${result.outcome} ` +
          `(${result.trail.length} events, ${result.escalations.length} escalations)`,
      );
      return { outcome: result.outcome, events: result.trail.length };
    },
    { connection: redis, concurrency: 1 },
  );

  consumer.on('failed', (job, error) => {
    // A job that throws OUT of the loop is a bug, not a mission outcome —
    // runMission is supposed to surrender rather than raise.
    console.error(`x mission ${job?.data?.missionId ?? '(unknown)'} threw:`, error.message);
  });

  const shutdown = async (): Promise<void> => {
    console.log(`\n${PACKAGE_NAME}: shutting down`);
    await consumer.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// Run only when executed directly (`node dist/index.js`), not when imported.
const entryArg = process.argv[1];
if (entryArg !== undefined && import.meta.url === pathToFileURL(entryArg).href) {
  main().catch((error: unknown) => {
    console.error(
      `${PACKAGE_NAME}: failed to start —`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}
