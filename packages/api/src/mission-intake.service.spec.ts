/**
 * P10 — mission intake (R10 AC-1).
 *
 * The control plane's job at intake is narrow and absolute: turn a request into
 * *task zero* — a real contract — and enqueue it. It must never start doing the
 * work, and it must never enqueue something that is not a valid contract.
 */
import { TaskContractSchema, grantsFor, validate } from '@artifex/shared-types';

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

/**
 * R14 AC-3 — a malformed request gets a stated reason, not a 500.
 *
 * Defect `fd345eae`: the controller typed its body against a TypeScript
 * interface, which is erased at runtime, so a body missing `successCriteria`
 * reached `accept()` and threw `Cannot read properties of undefined (reading
 * 'length')`. The operator saw "Internal server error" — indistinguishable from
 * the control plane being down, and useless for fixing the request.
 */
describe('R14 AC-3 — intake refuses a malformed request with a stated reason', () => {
  it('rejects a body missing successCriteria as a 400 naming the field', async () => {
    const { service, enqueued } = harness();

    await expect(
      service.accept({ objective: 'Explain heat pumps.' } as unknown as IntakeRequest),
    ).rejects.toMatchObject({ status: 400 });

    expect(enqueued).toHaveLength(0);
  });

  it('names the offending field rather than failing generically', async () => {
    const { service } = harness();

    await service
      .accept({ objective: 'Explain heat pumps.' } as unknown as IntakeRequest)
      .then(
        () => { throw new Error('expected a rejection'); },
        (error: unknown) => {
          expect(JSON.stringify(error)).toMatch(/successCriteria/);
        },
      );
  });

  it('DISTRACTOR: a well-formed request still succeeds — the guard refuses malformed input, not all input', async () => {
    // Without this, "reject everything" would satisfy the two tests above.
    const { service, enqueued } = harness();

    await service.accept(request());

    expect(enqueued).toHaveLength(1);
  });

  it('DISTRACTOR: a criterion that is only whitespace is refused, not accepted as gradeable', async () => {
    const { service, enqueued } = harness();

    await expect(service.accept(request({ successCriteria: ['   '] }))).rejects.toMatchObject({ status: 400 });

    expect(enqueued).toHaveLength(0);
  });
});

/**
 * R37 AC-2 — "given a surrendered mission, when it is re-entered at intake, then
 * the dossier is available as its starting context so the second attempt does
 * not rediscover the first attempt's blockers."
 *
 * The point is not that the dossier is *stored somewhere reachable* — it always
 * was, in the ledger. It is that the second attempt STARTS with it, so the swarm
 * does not spend budget rediscovering a blocker it already wrote down.
 */
describe('R37 AC-2 — a re-entered mission starts with the prior dossier', () => {
  const priorDossier = {
    reason: 'Gate B could not be satisfied',
    whatItWouldTake: [
      'Supply a capability for: live data lookup.',
      'Relax or restate: "An exact figure is given" — no verification ever met it.',
    ],
    blockers: [{ taskId: 't-1', detail: 'no source available', errorClass: 'capability_gap', evidence: ['ev-9'] }],
    completed: [{ taskId: 't-0', objective: 'Cover the background.', depth: 'single', criteria: ['m-1'], evidence: ['ev-3'] }],
    escalations: [], assumptions: [], verified: [],
    budget: { spent: 18, ceiling: 20, unit: 'effort-units' }, missionId: 'prior-1',
  };

  function harnessWithPrior() {
    const enqueued: unknown[] = [];
    const appended: unknown[] = [];
    const queue: MissionQueue = { async enqueue(job) { enqueued.push(job); } };
    const ledger: LedgerSink = { async append(event) { appended.push(event); return event; } };
    const dossiers = {
      async forMission(missionId: string) {
        return missionId === 'prior-1' ? priorDossier : null;
      },
    };
    const service = new MissionIntakeService(
      queue, ledger,
      { now: () => AT, newId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${(n += 1).toString(16).padStart(12, '0')}`; })() },
      dossiers,
    );
    return { service, appended };
  }

  it('pins what it would take, so the planner sees it rather than rediscovering it', async () => {
    const { service } = harnessWithPrior();

    const { contract } = await service.accept(request({ priorMissionId: 'prior-1' }));

    const pinned = contract.inputs.pinnedDecisions.map((d) => d.decision).join(' ');
    expect(pinned).toMatch(/live data lookup/);
  });

  it('records the dossier on the intake event, so the trail shows what was inherited', async () => {
    const { service, appended } = harnessWithPrior();

    await service.accept(request({ priorMissionId: 'prior-1' }));

    const intake = appended.find((e) => (e as { type: string }).type === 'mission.intake_accepted') as
      { payload: Record<string, unknown> };
    expect(intake.payload['priorMissionId']).toBe('prior-1');
    expect(intake.payload['priorDossier']).toBeDefined();
  });

  it('DISTRACTOR: a mission with no prior is unchanged — re-entry is the exception', async () => {
    // Every ordinary mission must not gain an empty pinned decision that reads
    // like a constraint nobody set.
    const { service } = harnessWithPrior();

    const { contract } = await service.accept(request());

    expect(contract.inputs.pinnedDecisions).toEqual([]);
  });

  it('DISTRACTOR: an UNKNOWN prior mission does not fail intake, and says nothing false', async () => {
    // A requester quoting a mission id that no longer exists should still get a
    // mission. Inventing context for it would be worse than having none.
    const { service } = harnessWithPrior();

    const { contract } = await service.accept(request({ priorMissionId: 'does-not-exist' }));

    expect(contract.inputs.pinnedDecisions).toEqual([]);
  });
});

/**
 * R13 AC-3 at intake — the contract grants the tools, and the blast radius
 * decides which (ADR-0015 link 2, ADR-0020).
 *
 * `toolEntitlements` was hardcoded `[]` here, so the live count of contracts
 * carrying a tool grant was zero and the Action Broker could refuse but never
 * permit. Every other link in R13 was complete; this line is why no swarm agent
 * had ever taken an action.
 */
describe('R13 AC-3 — intake grants tools by blast radius, and the request never names one', () => {
  it('grants nothing at low, and the compute tool at medium', async () => {
    // Both sides. Asserting only the empty case passes for a service that grants
    // nothing at all — which is exactly the bug being fixed.
    const { service } = harness();

    const low = await service.accept(request({ blastRadius: 'low' }));
    const medium = await service.accept(request({ blastRadius: 'medium' }));

    expect(low.contract.inputs.toolEntitlements).toEqual([]);
    expect(
      medium.contract.inputs.toolEntitlements.map((t) => t.toolId),
      'a medium-blast-radius mission was granted nothing, so the broker can still only refuse',
    ).toContain('text.count');
  });

  it('agrees with the catalogue rather than listing tools of its own', async () => {
    // The grant set IS the admissible set. A hand-written list here would drift
    // from the broker's view the first time the catalogue changed, and a grant
    // the broker refuses is a contract promising what the system denies.
    const { service } = harness();

    const { contract } = await service.accept(request({ blastRadius: 'high' }));

    expect(contract.inputs.toolEntitlements).toEqual(grantsFor('high'));
    expect(grantsFor('high').length, 'the catalogue is empty, so this proves nothing').toBeGreaterThan(0);
  });

  it('DISTRACTOR: the requester cannot name a tool — the contract is the authority', async () => {
    // R13: "tools are granted per contract by the level above — the contract
    // stays the sole authority on what a task may do." A request carrying a tool
    // field is rejected as malformed rather than honoured, so there is no path
    // by which a requester escalates its own grants.
    const { service } = harness();

    await expect(
      service.accept({ ...request({ blastRadius: 'low' }), toolEntitlements: [{ toolId: 'text.count' }] } as never),
    ).rejects.toThrow(/not well-formed/i);
  });

  it('DISTRACTOR: the granted contract still validates as a TaskContract', async () => {
    const { service } = harness();

    const { contract } = await service.accept(request({ blastRadius: 'high' }));

    expect(validate(TaskContractSchema, contract).ok).toBe(true);
  });
});
