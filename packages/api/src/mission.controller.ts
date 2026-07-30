import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { LedgerEvent } from '@artifex/shared-types';

import { CockpitService } from './cockpit.service';
import type { CockpitRequest } from './cockpit.service';
import { MissionIntakeService } from './mission-intake.service';
import type { IntakeRequest } from './mission-intake.service';
import type { LedgerReader, MissionSummary } from './ledger.types';
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
    private readonly cockpit: CockpitService,
  ) {}

  @Post()
  async create(@Body() body: IntakeRequest) {
    const { contract } = await this.intake.accept(body);
    return { missionId: contract.missionId, contract };
  }

  /**
   * The fleet (R21) — every mission the ledger knows about.
   *
   * Declared BEFORE `:missionId/events` because Nest matches routes in
   * declaration order, and a bare `GET /missions` must not be mistaken for a
   * mission whose id is the empty string.
   */
  @Get()
  async fleet(): Promise<MissionSummary[]> {
    return this.ledger.listMissions();
  }

  /**
   * A cockpit action (R17) — pause, resume, cancel, grant budget, turn the dial,
   * annotate. Each appends a ledger event attributed to the operator.
   *
   * A POST rather than a PATCH on purpose: nothing is being modified. The
   * operator is adding a fact to an append-only trail, and the verb should say so.
   */
  @Post(':missionId/control')
  async control(
    @Param('missionId') missionId: string,
    @Body() body: Omit<CockpitRequest, 'missionId'>,
  ): Promise<{ eventId: string }> {
    return this.cockpit.act({ ...body, missionId });
  }

  /** The whole trail for one mission — the dashboard's cold-start read. */
  @Get(':missionId/events')
  async events(@Param('missionId') missionId: string): Promise<LedgerEvent[]> {
    return this.ledger.replay({ missionId });
  }
}
