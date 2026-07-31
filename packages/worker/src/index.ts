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
import { casesFromTrail } from './bench-producer.js';
import { candidateExecutor, candidateJudge } from './candidate-execution.js';
import { buildScienceLoop } from './science-seams.js';
import { createCandidateSeams, missionConcurrency } from './runtime.js';
import { evaluatePetition } from './sealed-evaluation.js';
import { petitionFromWeakSpots, petitionRefusal } from './petition.js';
import { ProposalEmitter } from './proposal-emitter.js';
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
          {
            generator, models: { worker, evaluator }, assets, ledger, commons, hotFixes, bench, templates,
            knowledge: commons,
            // The Action Broker's append path (R13). Routed through the SAME
            // chain as the loop's own events rather than straight to the
            // repository: two independent writers would interleave, and an
            // action would land before or after the task that took it depending
            // on timing — which would make the trail's order a lie exactly where
            // the criterion asks it to be reproducible.
            sink: {
              append: (event) => {
                appends = appends
                  .then(() => ledger.append(event))
                  .catch((cause: unknown) => {
                    failed.push(`${event.type}: ${String(cause)}`);
                  });
                return appends;
              },
            },
          },
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

      // ---- verified tasks become bench cases (R25 AC-0, defect `c1b3ae71`) --
      // `bench.record` had no production caller, so the bench held only what
      // scripts had put there and everything downstream starved: the Reviewer's
      // calibration probes (R35), the science loop's cases (R27), and the
      // sealed-bench evaluation R29 AC-0 needs.
      //
      // Before the mining below, so a mission's own verified work is available
      // to the next mission's science rather than one mission late.
      //
      // Failure is swallowed for the same reason the learning pass is: a case
      // that could not be banked is a missing benchmark, never a failed mission.
      try {
        const banked = new Map<string, number>();
        for (const existing of await bench.list()) {
          banked.set(existing.capability, (banked.get(existing.capability) ?? 0) + 1);
        }
        const cases = casesFromTrail(result.trail, { sealedSoFar: banked });
        for (const bankable of cases) await bench.record(bankable);
        if (cases.length > 0) {
          console.log(`  banked ${cases.length} bench case(s): ${cases.map((c) => c.slice).join(', ')}`);
        }
      } catch (cause) {
        console.error('! banking bench cases failed:', String(cause));
      }

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
        const weakSpots = rankWeakSpots(await new LedgerEvidenceSource(ledger, ledger, assets).evidenceFor());
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
        // ---- the amendment protocol's producer (R29 AC-0, defect `d08191c8`)
        // `ProposalEmitter` has been complete, tested, and never constructed —
        // invariant #4's only outward channel with nothing feeding it. This is
        // the producer.
        //
        // A petition is filed ONLY where the learner's own authority cannot
        // reach: it may rewrite prompts, playbooks and taxonomies freely, so a
        // weak spot it could fix that way is not a constitutional matter. An
        // amendment protocol that fired routinely would make the Constitution a
        // suggestion.
        const petition = petitionFromWeakSpots({
          missionId: contract.missionId,
          weakSpots,
          // Argued from THIS mission's ledger, which is what makes it a petition
          // rather than an opinion. Capped: the evidence is a pointer into the
          // trail, not a copy of it.
          evidenceEventIds: result.trail.slice(0, 20).map((e) => e.eventId),
        });

        if (petition !== null) {
          const refusal = petitionRefusal(petition);
          if (refusal === null) {
            // ---- evaluated on the SEALED bench (R29 AC-0) -------------------
            // The criterion's second clause: a petition is judged against the
            // slice the learner never sees, "rather than any slice the learner
            // could have optimized against". The spend a case ran at is not on
            // the case — it is on the ledger — so each case's source mission is
            // replayed to find it, memoised because sibling cases share one.
            const spentByTask = new Map<string, number>();
            const replayed = new Set<string>();
            const sealed = await bench.list({ slice: 'sealed' });
            for (const bankedCase of sealed) {
              if (replayed.has(bankedCase.sourceMissionId)) continue;
              replayed.add(bankedCase.sourceMissionId);
              for (const past of await ledger
                .replay({ missionId: bankedCase.sourceMissionId })
                .catch(() => [])) {
                if (past.type !== 'task.executed' || past.taskId === null) continue;
                const spent = past.payload['effortSpent'];
                if (typeof spent === 'number') spentByTask.set(past.taskId, spent);
              }
            }

            // Not caught: `evaluateOnSealedBench` throws when handed an open
            // case, and that refusal is the point of the clause.
            const sealedVerdict = await evaluatePetition(
              { title: petition.title, category: weakSpots[0]?.category ?? '' },
              {
                async sealedCases() {
                  return sealed.map((c) => ({
                    caseId: c.caseId, slice: c.slice, capability: c.capability,
                    contract: c.contract, verifiedOutcome: c.verifiedOutcome,
                    effortSpent: spentByTask.get(c.sourceTaskId),
                  }));
                },
              },
            );
            console.log(
              `  sealed-bench verdict: ${sealedVerdict.verdict} ` +
                `(${sealedVerdict.supported}/${sealedVerdict.evaluated} case(s))`,
            );

            const emitter = new ProposalEmitter(
              { append: (event) => ledger.append(event) },
              { newId: () => randomUUID(), now: () => new Date().toISOString() },
            );
            const filed = await emitter.propose(petition);

            // The verdict is appended as its own event rather than folded into
            // the proposal: the proposal is what the learner ARGUED, and the
            // evaluation is what the sealed bench ANSWERED. Collapsing them
            // would let a reader mistake the learner's own filing for a
            // judgement made against evidence it never chose.
            await ledger.append({
              eventId: randomUUID(),
              missionId: contract.missionId,
              taskId: null,
              family: 'learning',
              type: 'learning.petition_evaluated',
              actor: { kind: 'learning_agent', id: 'learning_agent', displayName: 'Learning Agent' },
              payload: {
                petitionId: filed.eventId,
                verdict: sealedVerdict.verdict,
                evaluated: sealedVerdict.evaluated,
                supported: sealedVerdict.supported,
                slice: 'sealed',
              },
              occurredAt: new Date().toISOString(),
            });

            // ---- and it waits for a HUMAN (R29 AC-1) ------------------------
            // Recorded as an attention item so the petition reaches the queue an
            // operator actually watches. It stays `proposed` until a decision is
            // recorded against it — the emitter has no `apply`, and this event
            // is a request for a decision, never the decision itself.
            await ledger.append({
              eventId: randomUUID(),
              missionId: contract.missionId,
              taskId: null,
              family: 'escalation',
              type: 'escalation.awaiting_human',
              actor: { kind: 'learning_agent', id: 'learning_agent', displayName: 'Learning Agent' },
              payload: {
                rung: 'amendment_ratification',
                petitionId: filed.eventId,
                objective: petition.title,
                autonomyDial: contract.autonomyDial,
                findings: [petition.rationale],
              },
              occurredAt: new Date().toISOString(),
            });
            console.log(`  petition filed and awaiting ratification: ${petition.title}`);
          }
        }
      } catch (cause) {
        console.error('! weak-spot mining failed:', String(cause));
      }

      // ---- the science loop EXPERIMENTS, not just mines (R27 AC-1/2/3) -----
      // Defect `a1288794`: `ScienceLoop` was constructed only by its own test,
      // so the worker ran the mining half and nothing else. What blocked it was
      // a question rather than code — ADR-0017 answers it: a candidate is a
      // fast-loop hot-fix, re-tested properly on the bench.
      //
      // ONE candidate per pass, oldest first. Not a tuning threshold: it is a
      // queue drained one item per mission-completion, because each run costs
      // real model calls per case per replication and mission latency must not
      // become a function of research backlog.
      try {
        const candidates = await hotFixes.resolvedCandidates(1);
        const openCases = await bench.list({ slice: 'open' });

        if (candidates.length > 0 && openCases.length > 0) {
          const seams = createCandidateSeams(generator, { worker, evaluator });
          const byId = new Map(
            candidates.map((c) => [c.hotFixId, { candidateId: c.hotFixId, patchedValue: c.patchedValue }]),
          );

          const loop = buildScienceLoop({
            index: ledger, reader: ledger, bench, designs: assets,
            executor: candidateExecutor(byId, seams.generator),
            judge: candidateJudge(seams.judge),
          });

          // The budget IS the open bench: every candidate sits the same exam,
          // which is what makes heterogeneous changes comparable (AC-1). It is
          // read from the bench rather than chosen, so it grows with the
          // evidence instead of being a number someone picked.
          const results = await loop.experiment(candidates.map((c) => c.hotFixId), {
            totalBudget: openCases.length * candidates.length,
            replications: 2,
          });

          for (const decision of loop.evaluate(results)) {
            await ledger.append({
              eventId: randomUUID(),
              missionId: contract.missionId,
              taskId: null,
              family: 'learning',
              type: 'learning.candidate_evaluated',
              actor: { kind: 'learning_agent', id: 'learning_agent', displayName: 'Learning Agent' },
              // The verdict AND why, so a rejected candidate is still a
              // measurement the next hypothesis can build on.
              payload: { ...decision },
              occurredAt: new Date().toISOString(),
            });
            console.log(`  candidate ${decision.evidence.candidateId}: ${decision.adopt ? 'ADOPT' : 'reject'} — ${decision.reason}`);
          }
        }
      } catch (cause) {
        console.error('! science experiment failed:', String(cause));
      }

      return { outcome: result.outcome, events: result.trail.length };
    },
    // Instance per mission, shared brain (R39). This was `concurrency: 1`, so a
    // second mission simply waited and the fleet view could only ever show the
    // "list of one" the requirement exists to end. The value is an operator
    // choice with a default above 1 — see ADR-0021.
    { connection: redis, concurrency: missionConcurrency(process.env) },
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
