/**
 * P10 — mission intake (R10 AC-1).
 *
 * The control plane's job at intake is narrow and absolute: turn a request into
 * *task zero* — a real contract — and enqueue it. It must never start doing the
 * work, and it must never enqueue something that is not a valid contract.
 */
import { TaskContractSchema, validate } from '@artifex/shared-types';

import { MissionIntakeService } from './mission-intake.service';
import type { IntakeRequest, MissionQueue } from './mission-intake.service';
import type { LedgerSink } from './ledger.types';

const AT = '2026-07-30T09:00:00.000Z';

function request(over: Partial<IntakeRequest> = {}): IntakeRequest {
  return {
    objective: 'Produce a cited briefing on EV adoption.',
    successCriteria: ['Covers market share with a date.', 'Every claim carries a citation.'],
    outOfScope: ['No forecasts beyond 2030.'],
    autonomyDial: 'checkpointed',
    budget: { floor: 2, ceiling: 20, unit: 'effort-units' },
    blastRadius: 'medium',
    requestedBy: 'operator@example.com',
    ...over,
  };
}

function harness() {
  const enqueued: unknown[] = [];
  const appended: unknown[] = [];
  const queue: MissionQueue = { async enqueue(job) { enqueued.push(job); } };
  const ledger: LedgerSink = { async append(event) { appended.push(event); return event; } };
  const service = new MissionIntakeService(queue, ledger, { now: () => AT, newId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${(n += 1).toString(16).padStart(12, '0')}`; })() });
  return { service, enqueued, appended };
}

describe('R10 AC-1 — intake creates task zero and enqueues it', () => {
  it('produces a contract carrying criteria, boundaries, autonomy dial and budget', async () => {
    const { service } = harness();

    const { contract } = await service.accept(request());

    expect(contract.acceptanceCriteria).toHaveLength(2);
    expect(contract.boundaries.outOfScope).toContain('No forecasts beyond 2030.');
    expect(contract.autonomyDial).toBe('checkpointed');
    expect(contract.budget.ceiling).toBe(20);
  });

  it('task zero IS a contract — it validates against the shared schema', async () => {
    const { service } = harness();

    const { contract } = await service.accept(request());
    const result = validate(TaskContractSchema, contract);

    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('the mission is task zero: no parent, depth zero, and its own mission id', async () => {
    const { service } = harness();

    const { contract } = await service.accept(request());

    expect(contract.parentTaskId).toBeNull();
    expect(contract.depth).toBe(0);
    expect(contract.missionId).toBe(contract.taskId);
  });

  it('enqueues the mission for the worker', async () => {
    const { service, enqueued } = harness();

    const { contract } = await service.accept(request());

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ missionId: contract.missionId });
  });

  it('records the human intake as a first-class ledger event (the symmetry rule)', async () => {
    const { service, appended } = harness();

    await service.accept(request());

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ family: 'contract', type: 'mission.intake_accepted' });
    expect((appended[0] as { actor: { kind: string } }).actor.kind).toBe('human');
  });

  it('DISTRACTOR: a request with no success criteria is REFUSED, not defaulted', async () => {
    // "No work without a contract" starts here. A mission nobody can grade must
    // not be enqueued — inventing a criterion on the requester's behalf would be
    // the control plane deciding what success means.
    const { service, enqueued } = harness();

    await expect(service.accept(request({ successCriteria: [] }))).rejects.toThrow(/success criterion/i);
    expect(enqueued).toHaveLength(0);
  });

  it('DISTRACTOR: a refused intake enqueues NOTHING and writes no acceptance event', async () => {
    const { service, enqueued, appended } = harness();

    await expect(service.accept(request({ objective: '' }))).rejects.toThrow(/objective/i);
    expect(enqueued).toHaveLength(0);
    expect(appended.filter((e) => (e as { type: string }).type === 'mission.intake_accepted')).toHaveLength(0);
  });

  it('DISTRACTOR: the API does NOT decompose — it enqueues and stops', async () => {
    // The single most important guardrail for this package: a mission's
    // thousand-task tree cannot live inside an HTTP request.
    const { service, appended } = harness();

    await service.accept(request());

    const types = appended.map((e) => (e as { type: string }).type);
    expect(types).not.toContain('task.contracted');
    expect(types).not.toContain('gate_a.verdict_issued');
  });

  it('carries the budget floor through — a floor prevents drive-by shallow work', async () => {
    const { service } = harness();

    const { contract } = await service.accept(request({ budget: { floor: 5, ceiling: 30, unit: 'effort-units' } }));

    expect(contract.budget.floor).toBe(5);
  });
});
