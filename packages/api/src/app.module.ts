import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LedgerListener, LedgerRepository } from '@artifex/memory-fabric';
import { Queue } from 'bullmq';
import { Pool } from 'pg';

import { AppController } from './app.controller';
import { CockpitService } from './cockpit.service';
import { AppService } from './app.service';
import { LedgerGateway } from './ledger.gateway';
import { LedgerLiveBridge } from './ledger-live.bridge';
import { LedgerStreamService } from './ledger-stream.service';
import { MissionController } from './mission.controller';
import { MissionIntakeService } from './mission-intake.service';
import type { MissionJob, MissionQueue } from './mission-intake.service';
import type { LedgerReader } from './ledger.types';
import { INTAKE_CLOCK, LEDGER_READER, LEDGER_SINK, MISSION_QUEUE } from './tokens';

/**
 * The control plane's composition root.
 *
 * The Memory Fabric and the job queue are wired here and nowhere else, so the
 * services stay testable without a database — every P10 test constructs them
 * directly with in-memory doubles.
 */
export const MISSION_QUEUE_NAME = 'artifex.missions';

/** One place the connection string is decided, so the pool and the LISTEN client agree. */
function connectionString(): string {
  return process.env['DATABASE_URL'] ?? 'postgres://artifex:artifex@localhost:5433/artifex';
}

@Module({
  controllers: [AppController, MissionController],
  providers: [
    AppService,
    LedgerGateway,
    {
      provide: 'PG_POOL',
      useFactory: () => new Pool({ connectionString: connectionString() }),
    },
    { provide: LEDGER_READER, useFactory: (pool: Pool) => new LedgerRepository(pool), inject: ['PG_POOL'] },
    { provide: LEDGER_SINK, useFactory: (pool: Pool) => new LedgerRepository(pool), inject: ['PG_POOL'] },
    {
      provide: MISSION_QUEUE,
      useFactory: (): MissionQueue => {
        const queue = new Queue(MISSION_QUEUE_NAME, {
          connection: {
            host: process.env['REDIS_HOST'] ?? 'localhost',
            port: Number(process.env['REDIS_PORT'] ?? 6379),
          },
        });
        return { async enqueue(job: MissionJob) { await queue.add('mission', job); } };
      },
    },
    { provide: INTAKE_CLOCK, useValue: { now: () => new Date().toISOString(), newId: () => randomUUID() } },
    {
      provide: MissionIntakeService,
      useFactory: (q, sink, clock) => new MissionIntakeService(q, sink, clock),
      inject: [MISSION_QUEUE, LEDGER_SINK, INTAKE_CLOCK],
    },
    {
      // Human action is a first-class ledger write, which is why the control
      // plane holds the sink here alongside intake — per packages/api/CLAUDE.md,
      // the API writes gate/intake events and reads everything else.
      provide: CockpitService,
      useFactory: (sink, reader: LedgerReader, clock, queue: MissionQueue) =>
        new CockpitService(sink, reader, clock, {
          /**
           * Re-enqueue the mission so the runtime picks it up and resumes (R41).
           *
           * The contract is read back from the intake event rather than
           * reconstructed: the resumed run must be judged against the SAME
           * contract it was commissioned with, and a rebuilt one would be a
           * different mission wearing the same id.
           */
          async resume(missionId: string) {
            const trail = await reader.replay({ missionId });
            const intake = trail.find((e) => e.type === 'mission.intake_accepted');
            const contract = intake?.payload['contract'];
            if (contract === undefined || contract === null) {
              throw new Error(`mission ${missionId} has no recorded contract to resume from`);
            }
            await queue.enqueue({ missionId, contract: contract as never });
          },
        }),
      inject: [LEDGER_SINK, LEDGER_READER, INTAKE_CLOCK, MISSION_QUEUE],
    },
    {
      provide: LedgerStreamService,
      useFactory: (reader) => new LedgerStreamService(reader),
      inject: [LEDGER_READER],
    },
    {
      // The line whose absence WAS defect `b3b4e554`. Both halves of the live
      // stream existed and were tested; nothing started the listener, so a
      // running mission pushed nothing and only a reload showed the trail.
      //
      // `LedgerListener` takes its own client rather than borrowing from the
      // pool: `LISTEN` is per-connection, and a pooled connection can be handed
      // to another caller mid-subscription.
      provide: LedgerLiveBridge,
      useFactory: (stream: LedgerStreamService) =>
        new LedgerLiveBridge(stream, () => LedgerListener.start(connectionString())),
      inject: [LedgerStreamService],
    },
  ],
})
export class AppModule {}
