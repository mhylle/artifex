import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LedgerRepository } from '@artifex/memory-fabric';
import { Queue } from 'bullmq';
import { Pool } from 'pg';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LedgerGateway } from './ledger.gateway';
import { LedgerStreamService } from './ledger-stream.service';
import { MissionController } from './mission.controller';
import { MissionIntakeService } from './mission-intake.service';
import type { MissionJob, MissionQueue } from './mission-intake.service';
import { INTAKE_CLOCK, LEDGER_READER, LEDGER_SINK, MISSION_QUEUE } from './tokens';

/**
 * The control plane's composition root.
 *
 * The Memory Fabric and the job queue are wired here and nowhere else, so the
 * services stay testable without a database — every P10 test constructs them
 * directly with in-memory doubles.
 */
export const MISSION_QUEUE_NAME = 'artifex.missions';

@Module({
  controllers: [AppController, MissionController],
  providers: [
    AppService,
    LedgerGateway,
    {
      provide: 'PG_POOL',
      useFactory: () =>
        new Pool({
          connectionString:
            process.env['DATABASE_URL'] ?? 'postgres://artifex:artifex@localhost:5433/artifex',
        }),
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
      provide: LedgerStreamService,
      useFactory: (reader) => new LedgerStreamService(reader),
      inject: [LEDGER_READER],
    },
  ],
})
export class AppModule {}
