import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { LedgerEvent } from '@artifex/shared-types';

import { MissionIntakeService } from './mission-intake.service';
import type { IntakeRequest } from './mission-intake.service';
import type { LedgerReader } from './ledger.types';
import { LEDGER_READER } from './tokens';
import { Inject } from '@nestjs/common';

/**
 * Mission intake and ledger reads.
 *
 * Note what is absent: there is no "run" endpoint. The control plane enqueues
 * and the runtime executes — a mission's task tree cannot live in an HTTP
 * request, so there is deliberately no handler that could try.
 */
@Controller('missions')
export class MissionController {
  constructor(
    private readonly intake: MissionIntakeService,
    @Inject(LEDGER_READER) private readonly ledger: LedgerReader,
  ) {}

  @Post()
  async create(@Body() body: IntakeRequest) {
    const { contract } = await this.intake.accept(body);
    return { missionId: contract.missionId, contract };
  }

  /** The whole trail for one mission — the dashboard's cold-start read. */
  @Get(':missionId/events')
  async events(@Param('missionId') missionId: string): Promise<LedgerEvent[]> {
    return this.ledger.replay({ missionId });
  }
}
