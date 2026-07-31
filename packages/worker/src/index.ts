import { randomUUID } from 'node:crypto';
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

import { AssetRegistryRepository, DecompositionTemplateRepository, HotFixRepository, KnowledgeCommonsRepository, LedgerRepository, ModelCatalogRepository, ReplayBenchRepository, runMigrations } from '@artifex/memory-fabric';
import { ModelRouter, createBackend } from '@artifex/model-router';
import type { TaskContract } from '@artifex/shared-types';
import { Worker } from 'bullmq';
import pg from 'pg';

import { runMission } from './mission-loop.js';
import { LedgerEvidenceSource } from './ledger-evidence.js';
import { rankWeakSpots } from './science-loop.js';
import { buildWorkerSeams } from './worker-seams.js';

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
export * from './worker-seams.js';

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
  const assets = new AssetRegistryRepository(pool);
  // The Knowledge Commons (defect `753bc6dd`). Built in R24 and reachable by
  // nothing until R40 gave a verified task an evidence bundle worth submitting.
  const commons = new KnowledgeCommonsRepository(pool);
  // The fast loop's hot-fix log (R26, defect `188c6892`). Its three pieces —
  // decision core, constitutional guard, store — were built and mutation-proven
  // in one iteration and called by nothing; this line is the producer.
  const hotFixes = new HotFixRepository(pool);
  // The sealed replay bench (R35 AC-1, defect `2eeef21f`). Its known answers are
  // what turns `probeMisses` from a correct function into a measurement — and
  // the one thing that catches a reviewer wrong the same way every time, which
  // unanimity sampling cannot (`627cd71c`).
  const bench = new ReplayBenchRepository(pool);
  // Learnable decomposition templates (R31 AC-2). Distilled from splits that
  // survived Gate A, and offered back as guidance the next time the swarm meets
  // that kind of work.
  const templates = new DecompositionTemplateRepository(pool);
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
        // Every seam the loop runs on — the operator's control signals, the
        // reuse market, the decompose-or-delegate gate and the model seams.
        // Assembled by `buildWorkerSeams` rather than inline, so what the
        // deployed binary wires is the thing the tests assert. Built inline,
        // this was untestable without booting a worker — which is how the Asset
        // Registry stayed a null-bidding stub for the project's whole life
        // (defect `41f7555c`) with every suite green.
        buildWorkerSeams(
          { generator, models: { worker, evaluator }, assets, ledger, commons, hotFixes, bench, templates, knowledge: commons },
          contract.missionId,
        ),
        {
          // A real clock, read per event (defect `74950cfc`). Passing a single
          // instant made every event in a run claim the same timestamp, so the
          // timeline lens could show no elapsed time and no stall.
          now: () => new Date().toISOString(),
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

      // ---- the science loop mines, now that there is history (R27 AC-0) -----
      // Run AFTER the mission's own events are durable, so this mission counts
      // toward the history it is mining. The Learning Agent lives in the worker
      // (it is one of the four meta-agents), which is why this is here rather
      // than behind an API endpoint — the control plane does not host agents.
      //
      // Read-only and propose-only (invariant #4): mining ranks weak spots and
      // APPENDS the ranking. It changes nothing, and the constitutional path
      // decides what, if anything, to do about it.
      //
      // Failure is swallowed. A learning pass that could not run is a missing
      // observation, never a failed mission.
      try {
        const weakSpots = rankWeakSpots(await new LedgerEvidenceSource(ledger, ledger).evidenceFor());
        if (weakSpots.length > 0) {
          await ledger.append({
            eventId: randomUUID(),
            missionId: contract.missionId,
            taskId: null,
            family: 'learning',
            type: 'learning.weak_spots_ranked',
            actor: { kind: 'learning_agent', id: 'learning_agent', displayName: 'Learning Agent' },
            // Ranked highest-severity first; the head is what a hypothesis
            // would be aimed at. Capped so one append cannot carry the whole
            // taxonomy — the full ranking is re-derivable from the ledger at
            // any time, which is the point of deriving rather than storing.
            payload: { ranked: weakSpots.length, top: weakSpots.slice(0, 5) },
            occurredAt: new Date().toISOString(),
          });
        }
      } catch (cause) {
        console.error('! weak-spot mining failed:', String(cause));
      }

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
