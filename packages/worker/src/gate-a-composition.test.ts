/**
 * R33 AC-0's sixth clause, in the loop — the producer's test.
 *
 * `gateA` audits the decompose-or-delegate decision, and `gate-a-full.test.ts`
 * proves the audit. This file proves the loop actually FEEDS it: two mutants
 * survived all 589 tests without it — one that stopped passing the decision to
 * Gate A entirely, and one that reported a gate which had THROWN as having
 * decided. Both are the shape this project has found twelve times, and neither
 * was visible from the pure function's own tests.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission, templateKeyFor } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-31T09:00:00.000Z';
const MISSION_ID = '5c9e1d73-2a48-4b06-9f31-7e2a4c8b5d60';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'State one fact.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The fact is stated.' }],
    boundaries: { outOfScope: ['Everything else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['Stated.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 40, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

/** A planner that proposes exactly ONE subtask — the incoherent shape. */
function seams(gate?: MissionSeams['decompositionGate']): MissionSeams {
  return {
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: 'State it.', category: 'stating',
            acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The fact is stated.' }],
            outOfScope: ['Else.'], blastRadius: 'low' as const, effortShare: 0.9,
          }],
        };
      },
    },
    coverageJudge: {
      async assess({ parent, children }) {
        return {
          coverage: parent.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, coveredByTaskIds: children.map((k) => k.taskId),
          })),
        };
      },
    },
    planJudge: {
      async audit({ children }) {
        return {
          tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          untestable: [], overlaps: [],
        };
      },
    },
    intentJudge: { async assess() { return { servesIntent: true, detail: 'ok', redFlags: [] }; } },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'State it.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 2 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({ criterionId: c.criterionId, met: true, detail: 'ok' })),
          redFlags: [],
        };
      },
    },
    reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
    ...(gate === undefined ? {} : { decompositionGate: gate }),
  };
}

const gateAVerdict = (trail: readonly { type: string; payload: Record<string, unknown> }[]) =>
  trail.find((e) => e.type === 'gate_a.verdict_issued');

describe('R33 AC-0 — the loop feeds Gate A the decomposition decision', () => {
  it('records WHO decided, not just what was decided', async () => {
    // `decision: split` was recorded on both paths from the start; `decidedBy`
    // is what makes the two distinguishable by a field rather than by matching
    // rationale prose.
    const result = await runMission(
      mission(),
      seams({ async assess() { return { keepWhole: false, rationale: 'genuinely divisible' }; } }),
      { now: () => AT },
    );

    const decided = result.trail.find((e) => e.type === 'decomposition.decided');
    expect(decided?.payload['decidedBy']).toBe('gate');
  });

  it('a GATE split producing one child is faulted by Gate A', async () => {
    // The clause reaching production. Without the loop passing the decision
    // through, this mission passes Gate A and the clause is decoration.
    const result = await runMission(
      mission(),
      seams({ async assess() { return { keepWhole: false, rationale: 'genuinely divisible' }; } }),
      { now: () => AT },
    );

    const verdict = gateAVerdict(result.trail);
    expect(verdict?.payload['outcome'], 'Gate A never saw the gate decision').toBe('fail');
    expect(JSON.stringify(verdict?.payload)).toMatch(/decompose-or-delegate/i);
  });

  it('DISTRACTOR: with NO gate wired the same plan passes', async () => {
    // The configuration that forced the first version's revert, asserted end to
    // end rather than only at the pure function. 53 tests fail if this regresses.
    const result = await runMission(mission(), seams(), { now: () => AT });

    const decided = result.trail.find((e) => e.type === 'decomposition.decided');
    expect(decided?.payload['decidedBy']).toBe('default');
    expect(gateAVerdict(result.trail)?.payload['outcome']).toBe('pass');
  });

  it('DISTRACTOR: a gate that THROWS did not decide, and its plan is not faulted', async () => {
    // A mutant reporting a thrown gate as `decidedBy: gate` survived all 589
    // tests. The loop already falls back to splitting when the gate errors —
    // faulting the planner for that split would blame it for an outage.
    const result = await runMission(
      mission(),
      seams({ async assess() { throw new Error('gate backend unavailable'); } }),
      { now: () => AT },
    );

    const decided = result.trail.find((e) => e.type === 'decomposition.decided');
    expect(decided?.payload['decidedBy'], 'a gate that errored was recorded as having decided').toBe('default');
    expect(gateAVerdict(result.trail)?.payload['outcome'], 'the planner was faulted for a gate outage').toBe('pass');
  });
});

/**
 * R31 AC-2 in the loop — templates guide, are recorded, and accumulate.
 *
 * The pure pieces are proven elsewhere: the planner puts the recipe in its
 * prompt (`planner.test.ts`) and the store enforces its own rules against a real
 * Postgres (`decomposition-template.test.ts`). What neither can see is whether
 * the loop looks a template up, hands it to the planner, records its use, and
 * folds the outcome back — the four things the criterion actually asks for.
 *
 * REWRITTEN for defect `16532469`, not extended. Every test here used to drive
 * the template through TASK ZERO, whose category is always `MISSION_CATEGORY` —
 * the one category the criterion's given excludes. AC-2 asks for "a
 * decomposition template in the Asset Registry matching THE KIND OF WORK", and
 * `mission` is the structural role Artifex stamps on every mission, not a kind
 * of work. Measured live before the fix: 26 of 26 retrievals returned the single
 * row stored under `mission` — one osmosis/diffusion recipe, handed to missions
 * about hand tools, kitchen utensils and rail travel alike, while the one
 * template keyed on a real capability had never been used at all.
 *
 * So the fixture nests. The mission carries THREE criteria, which makes
 * `depthBound` 3 and lets the depth-0 split hand a two-criterion child down;
 * that child is non-atomic, so the loop recurses and decomposes a task whose
 * category is a REAL capability. That is the criterion's given, and it is the
 * only place the template may now fire.
 */
describe('defect 16532469 — which categories may key a decomposition template', () => {
  it('refuses the structural roles and accepts a real capability', () => {
    // Both sides, because a rule that answered null to everything would satisfy
    // the first assertion alone and switch templates off entirely.
    expect(templateKeyFor('mission'), 'the mission ROLE was accepted as a kind of work').toBeNull();
    expect(templateKeyFor('tool description')).toBe('tool description');
  });

  it('DISTRACTOR: filters the RAW category, before capabilityOf rewrites it', () => {
    // `capabilityOf` replaces punctuation with spaces, so `verification.x`
    // normalises to `verification x` and a prefix test applied AFTERWARDS would
    // let it through. The order is the rule; asserting it here makes the
    // ordering a property rather than a comment.
    expect(templateKeyFor('verification.tool description')).toBeNull();
    // ...and the normalisation still happens for a category that passes.
    expect(templateKeyFor('Tool Description / Kitchenware')).toBe('tool description');
  });
});

describe('R31 AC-2 — a template guides the split and accumulates evidence', () => {
  /** The kind of work the depth-1 node carries — a capability, not a role. */
  const CAPABILITY = 'tool description';

  /** Records WHICH capability was asked for, not merely that something was. */
  function templateStore(existing: { templateId: string; recipe: string } | null) {
    const askedFor: string[] = [];
    const remembered: Array<{ capability: string; recipe: string }> = [];
    const outcomes: Array<{ templateId: string; survived: boolean }> = [];
    return {
      askedFor,
      remembered,
      outcomes,
      seam: {
        async forCapability(capability: string) {
          askedFor.push(capability);
          return existing;
        },
        async remember(input: { capability: string; recipe: string }) {
          remembered.push(input);
          return { templateId: 'tpl-new' };
        },
        async recordOutcome(templateId: string, survived: boolean) {
          outcomes.push({ templateId, survived });
        },
      },
    };
  }

  /** Three criteria, so `depthBound` is 3 and a depth-1 decomposition happens. */
  function nestedMission(): TaskContract {
    return {
      ...mission(),
      acceptanceCriteria: [
        { criterionId: 'm-1', statement: 'The first fact is stated.' },
        { criterionId: 'm-2', statement: 'The second fact is stated.' },
        { criterionId: 'm-3', statement: 'The third fact is stated.' },
      ],
    };
  }

  /**
   * A planner that splits three criteria into an atomic child and a
   * two-criterion child, then splits that child once more.
   *
   * Keyed on the criteria it is handed rather than on `depth`, so the fixture
   * makes no assumption about a field the loop populates. Two children at the
   * top on purpose: a one-child split decided by the GATE is faulted by R33's
   * sixth clause, and the survival test below needs the top level to pass so
   * the depth-1 split is the one being judged.
   */
  function nestingSeams(gate?: MissionSeams['decompositionGate']): MissionSeams {
    const base = seams(gate);
    return {
      ...base,
      planner: {
        async propose({ contract }: { contract: TaskContract }) {
          const criteria = contract.acceptanceCriteria;
          if (criteria.length > 2) {
            return {
              subtasks: [
                {
                  objective: 'State the first fact.', category: CAPABILITY,
                  acceptanceCriteria: [criteria[0]!],
                  outOfScope: ['Else.'], blastRadius: 'low' as const, effortShare: 0.45,
                },
                {
                  objective: 'State the remaining facts.', category: CAPABILITY,
                  acceptanceCriteria: criteria.slice(1),
                  outOfScope: ['Else.'], blastRadius: 'low' as const, effortShare: 0.45,
                },
              ],
            };
          }
          return {
            subtasks: [{
              objective: 'State one fact.', category: CAPABILITY,
              acceptanceCriteria: [criteria[0]!],
              outOfScope: ['Else.'], blastRadius: 'low' as const, effortShare: 0.9,
            }],
          };
        },
      },
    } as MissionSeams;
  }

  /** Captures what the planner was actually told, per call. */
  function recordingPlanner(base: MissionSeams) {
    const seen: Array<{ templateRecipe?: string }> = [];
    return {
      seen,
      seams: {
        ...base,
        planner: {
          async propose(input: { templateRecipe?: string }) {
            seen.push(input);
            return base.planner.propose(input as never);
          },
        },
      } as MissionSeams,
    };
  }

  it('looks the template up for the KIND OF WORK, never for the mission role', async () => {
    // Defect `16532469`. The lookup key used to be `capabilityOf(parent.category)`
    // unconditionally, and task zero's category is the constant `mission` — so
    // every mission ever run shared one template whatever its subject.
    const store = templateStore({ templateId: 'tpl-1', recipe: 'One subtask per item.' });

    await runMission(nestedMission(), { ...nestingSeams(), templates: store.seam } as never, { now: () => AT });

    // Both sides of the discriminator: it asked for the capability, and it did
    // not ask for the role. Asserting only the second passes trivially if the
    // store is never consulted at all.
    expect(store.askedFor, 'the template store was never consulted').toContain(CAPABILITY);
    expect(store.askedFor, 'the mission ROLE was used as a capability key').not.toContain('mission');
  });

  it('hands the template recipe to the PLANNER, at the node whose capability matched', async () => {
    // The difference between guiding a split and logging that one could have
    // been guided.
    const store = templateStore({ templateId: 'tpl-1', recipe: 'One subtask per item.' });
    const planner = recordingPlanner(nestingSeams());

    await runMission(nestedMission(), { ...planner.seams, templates: store.seam } as never, { now: () => AT });

    // The mission's own split gets NO recipe, because a mission has no kind of
    // work to match; the capability-carrying node below it does. Both halves,
    // so a rule that simply always passed the recipe would fail here.
    expect(planner.seen[0]?.templateRecipe, 'task zero was guided by a template').toBeUndefined();
    expect(
      planner.seen.slice(1).map((call) => call.templateRecipe),
      'the template was looked up and never used',
    ).toContain('One subtask per item.');
  });

  it('records the template use on the ledger, carrying the capability it matched', async () => {
    const store = templateStore({ templateId: 'tpl-1', recipe: 'One subtask per item.' });

    const result = await runMission(
      nestedMission(), { ...nestingSeams(), templates: store.seam } as never, { now: () => AT },
    );

    const used = result.trail.find((e) => e.type === 'decomposition.template_used');
    expect(used?.payload['templateId']).toBe('tpl-1');
    expect(used?.payload['capability'], 'the event named the role rather than the work').toBe(CAPABILITY);
  });

  it('folds the Gate A outcome back into the template record', async () => {
    // "Templates accumulate evidence and become learnable assets" — the half
    // that makes them learnable rather than merely reusable.
    const store = templateStore({ templateId: 'tpl-1', recipe: 'One subtask per item.' });

    await runMission(nestedMission(), { ...nestingSeams(), templates: store.seam } as never, { now: () => AT });

    expect(store.outcomes).toHaveLength(1);
    expect(store.outcomes[0]?.templateId).toBe('tpl-1');
  });

  it('scores the template on whether the split SURVIVED Gate A', async () => {
    // With the gate deciding, the depth-1 plan is a one-child GATE split, which
    // R33's sixth clause faults — so the guided split did NOT survive and the
    // template must be scored down. A recorder hard-coding `true` passes every
    // other test in this file.
    const store = templateStore({ templateId: 'tpl-1', recipe: 'One subtask per item.' });

    await runMission(
      nestedMission(),
      {
        ...nestingSeams({ async assess() { return { keepWhole: false, rationale: 'divisible' }; } }),
        templates: store.seam,
      } as never,
      { now: () => AT },
    );

    expect(store.outcomes[0]?.survived, 'a rejected split was recorded as a success').toBe(false);
  });

  it('LEARNS a template from a split that survived, keyed on the capability', async () => {
    // Without this the criterion's "given" is unreachable: nothing else creates
    // a template, so the store would stay empty forever and every lookup would
    // return null.
    //
    // The KEY is asserted, not just the count. Storing under the mission role is
    // how the live store came to hold a single osmosis recipe that answered for
    // every mission — the write side of the same defect.
    const store = templateStore(null);

    const result = await runMission(
      nestedMission(), { ...nestingSeams(), templates: store.seam } as never, { now: () => AT },
    );

    expect(store.remembered, 'a surviving split taught the system nothing').toHaveLength(1);
    expect(store.remembered[0]?.capability, 'a template was stored under the mission ROLE').toBe(CAPABILITY);
    expect(store.remembered[0]?.recipe).toMatch(/State one fact\./);
    expect(result.trail.some((e) => e.type === 'decomposition.template_learned')).toBe(true);
  });

  it('DISTRACTOR: a REJECTED split with no template teaches nothing', async () => {
    // Learning from a plan Gate A refused would fill the store with recipes for
    // producing rejected decompositions — the opposite of a learnable asset.
    const store = templateStore(null);

    await runMission(
      nestedMission(),
      {
        ...nestingSeams({ async assess() { return { keepWhole: false, rationale: 'divisible' }; } }),
        templates: store.seam,
      } as never,
      { now: () => AT },
    );

    expect(store.remembered, 'a rejected split was distilled into a template').toHaveLength(0);
  });

  it('DISTRACTOR: a mission with NO template store runs exactly as before', async () => {
    const withStore = await runMission(
      nestedMission(), { ...nestingSeams(), templates: templateStore(null).seam } as never, { now: () => AT },
    );
    const without = await runMission(nestedMission(), nestingSeams(), { now: () => AT });

    expect(without.outcome).toBe(withStore.outcome);
    expect(without.trail.some((e) => e.type === 'decomposition.template_used')).toBe(false);
  });
});

/**
 * `340aa7de` in the loop — the planner is really shown the registry.
 *
 * `planner.test.ts` proves the prompt carries the list; it cannot see whether
 * anything supplies one. That gap has produced fifteen dead mechanisms here, so
 * the producer gets its test in the same iteration.
 */
describe('340aa7de — the loop feeds the planner known capabilities', () => {
  function recordingPlanner(base: MissionSeams) {
    const seen: Array<{ knownCapabilities?: readonly string[] }> = [];
    return {
      seen,
      seams: {
        ...base,
        registry: {
          async bestForCategory() { return null; },
          async knownCapabilities() { return ['defining terms', 'comparing options']; },
        },
        planner: {
          async propose(input: { knownCapabilities?: readonly string[] }) {
            seen.push(input);
            return base.planner.propose(input as never);
          },
        },
      } as MissionSeams,
    };
  }

  it('passes what the registry holds into the split', async () => {
    const p = recordingPlanner(seams());

    await runMission(mission(), p.seams, { now: () => AT });

    expect(p.seen[0]?.knownCapabilities, 'the planner names capabilities without seeing what exists')
      .toEqual(['defining terms', 'comparing options']);
  });

  it('DISTRACTOR: a registry that cannot answer does not block the split', async () => {
    // Naming guidance is an improvement, not a gate. A registry outage must
    // cost a slightly worse taxonomy, never a mission.
    const base = seams();
    const broken = {
      ...base,
      registry: {
        async bestForCategory() { return null; },
        async knownCapabilities() { throw new Error('registry unavailable'); },
      },
    } as MissionSeams;

    const result = await runMission(mission(), broken, { now: () => AT });

    expect(result.trail.some((e) => e.type === 'task.contracted'), 'the split never happened').toBe(true);
  });
});

/**
 * R30 AC-0/AC-1 in the loop — the dialogue actually runs, and actually refuses.
 *
 * `triageQuestions` is proven in `intake-dialogue.test.ts`. What that cannot see
 * is whether anything CALLS it, whether a blocking question stops the mission
 * before a task tree exists, and whether every question reaches the ledger. This
 * project has found fifteen mechanisms that were correct and unreachable, so the
 * producer gets its test in the same iteration.
 */
describe('R30 — the intake dialogue runs before anything is decomposed', () => {
  const interrogator = (questions: Array<{ criterionId: string | null; subject: string; question: string; stakes: 'low' | 'high' }>) => ({
    calls: [] as unknown[],
    seam: {
      async assess(input: unknown) {
        (interrogatorCalls as unknown[]).push(input);
        return { questions };
      },
    },
  });
  let interrogatorCalls: unknown[] = [];

  it('refuses to start: a blocking question means NO task is contracted', async () => {
    // "Refuses to start the mission while any is missing" — not a late
    // rejection. The absence of `task.contracted` is the assertion, because a
    // mission that planned and then stopped has already started.
    interrogatorCalls = [];
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
      { now: () => AT },
    );

    expect(interrogatorCalls, 'the interrogator was never consulted').toHaveLength(1);
    expect(result.outcome).toBe('surrendered');
    expect(
      result.trail.some((e) => e.type === 'task.contracted'),
      'the mission planned work despite an unanswered blocking question',
    ).toBe(false);
    expect(result.trail.some((e) => e.type === 'agent.staffed' && e.taskId !== MISSION_ID)).toBe(false);
  });

  it('puts the blocking question on the attention queue, quoting it', async () => {
    // A refusal a human cannot act on is a dead end. The requester has to be
    // able to read the actual question.
    interrogatorCalls = [];
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
      { now: () => AT },
    );

    const waiting = result.trail.find((e) => e.type === 'escalation.awaiting_human');
    expect(waiting, 'nothing reached the attention queue').toBeDefined();
    expect(JSON.stringify(waiting?.payload)).toMatch(/Which audience\?/);
    expect(result.trail.some((e) => e.type === 'intake.question_raised')).toBe(true);
  });

  it('carries a low-stakes ambiguity instead, and RECORDS it rather than assuming it', async () => {
    // AC-1's real demand. The mission proceeds — and the assumption is on the
    // trail, so it was never silently resolved. Both halves asserted: a rule
    // that blocked everything would satisfy "recorded" and fail the criterion.
    interrogatorCalls = [];
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'low' }]).seam } as never,
      { now: () => AT },
    );

    const flagged = result.trail.find((e) => e.type === 'intake.assumption_flagged');
    expect(flagged, 'a carried ambiguity left no trace — it was silently assumed').toBeDefined();
    expect(JSON.stringify(flagged?.payload)).toMatch(/Which audience\?/);
    expect(
      result.trail.some((e) => e.type === 'task.contracted'),
      'a LOW-stakes ambiguity stopped the mission',
    ).toBe(true);
  });

  it('DISTRACTOR: a mission with NO interrogator runs exactly as before', async () => {
    // Every caller predating the dialogue must be untouched — the additive half.
    const withOut = await runMission(mission(), seams(), { now: () => AT });

    expect(withOut.trail.some((e) => e.type === 'intake.question_raised')).toBe(false);
    expect(withOut.trail.some((e) => e.type === 'task.contracted')).toBe(true);
  });

  it('DISTRACTOR: an interrogator that THROWS does not stop a well-specified mission', async () => {
    // Degrading to "ask nothing" loses a safeguard; degrading to "refuse
    // everything" loses the system. A model outage must not become an intake
    // outage — the same reasoning that keeps the call out of the API.
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: { async assess() { throw new Error('model down'); } } } as never,
      { now: () => AT },
    );

    expect(result.trail.some((e) => e.type === 'task.contracted'), 'a model outage blocked intake').toBe(true);
  });

  it('DISTRACTOR: a RESUMED mission is not re-interrogated', async () => {
    // Re-asking is how a mission a human just answered stops again on the same
    // question. The prior trail carries a contract, so the loop is resuming.
    interrogatorCalls = [];
    const prior = (await runMission(mission(), seams(), { now: () => AT })).trail;

    await runMission(
      mission(),
      { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
      { now: () => AT, resumeFrom: prior as never },
    );

    expect(interrogatorCalls, 'a resumed mission was interrogated again').toHaveLength(0);
  });

  /**
   * The answer channel (defect `2bedadb8`, ADR-0023).
   *
   * The intake block IS an escalation — `escalation.awaiting_human` with rung
   * `intake_clarification`, recorded against the mission task. The system
   * already has exactly one rule for "a human has answered this escalation, do
   * not stop here again": `prior.decided`, folded from `operator.decided` and
   * honoured by the escalation ladder. Intake was the one site not applying it,
   * which is find-shape (b) — and the consequence was find-shape (v): a gate
   * that can say no with no channel for the answer that makes it say yes.
   *
   * Proven live before this was written. An operator answered mission
   * 63498d62 through the real cockpit route; `operator.decided` was recorded,
   * the mission was re-enqueued, the worker replayed 14 events — and
   * re-interrogated and blocked again. The answer changed nothing.
   */
  describe('an operator answer clears the intake block', () => {
    /** A real intake-blocked trail: escalation and surrender, no contract. */
    async function blockedTrail(): Promise<Array<Record<string, unknown>>> {
      interrogatorCalls = [];
      const trail = (await runMission(
        mission(),
        { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
        { now: () => AT },
      )).trail as unknown as Array<Record<string, unknown>>;

      expect(trail.some((e) => e['type'] === 'escalation.awaiting_human'), 'FIXTURE: nothing blocked').toBe(true);
      expect(trail.some((e) => e['type'] === 'task.contracted'), 'FIXTURE: a contract would make this a normal resume').toBe(false);
      return trail;
    }

    /** The operator's ruling, shaped like the live one: taskId === missionId. */
    function decidedOn(trail: Array<Record<string, unknown>>, taskId: string) {
      const escalation = trail.find((e) => e['type'] === 'escalation.awaiting_human')!;
      expect(escalation['taskId'], 'FIXTURE: the live escalation is recorded against the mission task').toBe(MISSION_ID);
      return [...trail, { ...escalation, type: 'operator.decided', taskId, payload: { decision: 'approve', note: 'Engineers.' } }];
    }

    it('does not re-interrogate, and the mission finally runs', async () => {
      const prior = decidedOn(await blockedTrail(), MISSION_ID);

      interrogatorCalls = [];
      const result = await runMission(
        mission(),
        { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
        { now: () => AT, resumeFrom: prior as never },
      );

      expect(interrogatorCalls, 'the answered question was put to the requester again').toHaveLength(0);
      expect(result.trail.some((e) => e.type === 'task.contracted'), 'the mission still refused to start').toBe(true);
      expect(result.outcome).toBe('delivered');
    });

    it('a REJECTED question does not clear the block — a refusal is not permission', async () => {
      // Measured live before this was written: an operator answered a blocking
      // intake question with `decision: "reject"` and the note "No - do not
      // proceed with this mission", and the mission ran and DELIVERED anyway.
      // `foldPriorTrail` added to `decided` on any `operator.decided` without
      // reading the decision, so a refusal read exactly like consent.
      const prior = await blockedTrail();
      const escalation = prior.find((e) => e['type'] === 'escalation.awaiting_human')!;
      prior.push({
        ...escalation,
        type: 'operator.decided',
        taskId: MISSION_ID,
        payload: { decision: 'reject', note: 'No - do not proceed.' },
      });

      interrogatorCalls = [];
      const result = await runMission(
        mission(),
        { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
        { now: () => AT, resumeFrom: prior as never },
      );

      expect(interrogatorCalls, 'CONTROL: intake never ran, so the block was not tested').toHaveLength(1);
      expect(result.trail.some((e) => e.type === 'task.contracted'), 'a rejected mission went ahead and worked').toBe(false);
    });

    it('DISTRACTOR: a ruling with NO decision value still clears — only a refusal blocks', async () => {
      // `decision` is optional on a cockpit action, so an operator who answers
      // without picking approve/reject has still answered. A rule keyed on
      // `=== 'approve'` would read that silence as refusal and strand the
      // mission on a technicality — and it survived the first mutation round,
      // because every other fixture here sets the field explicitly.
      const prior = await blockedTrail();
      const escalation = prior.find((e) => e['type'] === 'escalation.awaiting_human')!;
      prior.push({ ...escalation, type: 'operator.decided', taskId: MISSION_ID, payload: { note: 'Engineers.' } });

      interrogatorCalls = [];
      const result = await runMission(
        mission(),
        { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
        { now: () => AT, resumeFrom: prior as never },
      );

      expect(interrogatorCalls, 'the answered question was put to the requester again').toHaveLength(0);
      expect(result.trail.some((e) => e.type === 'task.contracted')).toBe(true);
    });

    it('DISTRACTOR: a decision on a DIFFERENT task does not clear the mission block', async () => {
      // The other side of the discriminator. A rule keyed on "any decision
      // exists" rather than "this task was decided" would pass the test above
      // and let one unrelated ruling wave every future mission through.
      const prior = decidedOn(await blockedTrail(), 'some-other-task-id');

      interrogatorCalls = [];
      const result = await runMission(
        mission(),
        { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
        { now: () => AT, resumeFrom: prior as never },
      );

      expect(interrogatorCalls, 'CONTROL: intake did not run, so the block was not tested').toHaveLength(1);
      expect(result.trail.some((e) => e.type === 'task.contracted'), 'an unrelated decision cleared the block').toBe(false);
    });

    it('DISTRACTOR: an UNANSWERED intake block still blocks on replay', async () => {
      // Today's behaviour, preserved. Re-enqueuing without an answer must not
      // become a way to launder a mission past intake.
      const prior = await blockedTrail();

      interrogatorCalls = [];
      const result = await runMission(
        mission(),
        { ...seams(), interrogator: interrogator([{ criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high' }]).seam } as never,
        { now: () => AT, resumeFrom: prior as never },
      );

      expect(interrogatorCalls, 'CONTROL: intake did not run').toHaveLength(1);
      expect(result.trail.some((e) => e.type === 'task.contracted'), 'an unanswered block let the mission through').toBe(false);
    });
  });

  it('RECORDS an interrogation failure rather than degrading in silence', async () => {
    // Observed live: the first vague mission threw here under concurrent load
    // and went straight on to decompose, indistinguishable from a clean
    // interrogation. Degrading open is the right policy; degrading INVISIBLY is
    // the thing AC-1 rules out.
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: { async assess() { throw new Error('model down'); } } } as never,
      { now: () => AT },
    );

    const failure = result.trail.find((e) => e.type === 'intake.interrogation_failed');
    expect(failure, 'the interrogation failed and left no trace').toBeDefined();
    expect(String(failure?.payload['detail'])).toMatch(/model down/);
    // ...and the mission still ran, because a model outage is not a spec problem.
    expect(result.trail.some((e) => e.type === 'task.contracted')).toBe(true);
  });
});

/**
 * R30 AC-2 in the loop — the escalation fires at the TASK, not at delivery.
 *
 * Written BEFORE the wiring this time. The pure rule was RED-first in iterations
 * 86 and 88 while the loop integration was not, so its composition tests passed
 * on first run and proved nothing by passing. This file failed first.
 */
describe('R30 AC-2 — a carried assumption escalates when it starts to matter', () => {
  /** A mission whose dial permits carrying a low-stakes ambiguity. */
  const carried = [{ criterionId: 'm-1', subject: 'audience', question: 'Which audience is this for?', stakes: 'low' as const }];

  it('escalates at the TASK that carries the criterion, before the mission ends', async () => {
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: { async assess() { return { questions: carried }; } } } as never,
      { now: () => AT },
    );

    const flagged = result.trail.findIndex((e) => e.type === 'intake.assumption_flagged');
    const escalated = result.trail.findIndex((e) => e.type === 'assumption.became_load_bearing');
    const delivered = result.trail.findIndex((e) => e.type === 'mission.delivered');

    expect(flagged, 'the assumption was never carried').toBeGreaterThanOrEqual(0);
    expect(escalated, 'the assumption never became load-bearing').toBeGreaterThanOrEqual(0);
    // The clause with teeth: at that MOMENT rather than at delivery.
    expect(escalated, 'the escalation waited for delivery').toBeLessThan(delivered);
  });

  it('names the question, and reaches the attention queue', async () => {
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: { async assess() { return { questions: carried }; } } } as never,
      { now: () => AT },
    );

    const event = result.trail.find((e) => e.type === 'assumption.became_load_bearing');
    expect(JSON.stringify(event?.payload)).toMatch(/Which audience is this for\?/);
    expect(
      result.trail.some((e) => e.type === 'escalation.awaiting_human'
        && String(e.payload['rung']) === 'assumption_became_load_bearing'),
      'nothing reached the attention queue',
    ).toBe(true);
  });

  it('DISTRACTOR: an assumption about an UNRELATED criterion never escalates', async () => {
    // The fixture mission has criterion m-1 only, so an assumption about m-9 can
    // never become load-bearing. A rule that escalated everything carried would
    // pass both tests above.
    const result = await runMission(
      mission(),
      {
        ...seams(),
        interrogator: {
          async assess() {
            return { questions: [{ criterionId: 'm-9', subject: 'x', question: 'Unrelated?', stakes: 'low' as const }] };
          },
        },
      } as never,
      { now: () => AT },
    );

    expect(result.trail.some((e) => e.type === 'intake.assumption_flagged'), 'CONTROL: nothing was carried').toBe(true);
    expect(result.trail.some((e) => e.type === 'assumption.became_load_bearing')).toBe(false);
  });

  it('DISTRACTOR: with nothing carried, no mission pays for the check', async () => {
    const result = await runMission(mission(), seams(), { now: () => AT });

    expect(result.trail.some((e) => e.type === 'assumption.became_load_bearing')).toBe(false);
    expect(result.trail.some((e) => e.type === 'mission.delivered')).toBe(true);
  });
});

/**
 * R30 AC-2 across a RESUME — the carried assumption has to survive the boundary.
 *
 * The interrogation is deliberately skipped on resume, so `carriedAssumptions`
 * was rebuilt from nothing and `loadBearingNow` ran over an empty list. Every
 * assumption the intake dialogue carried was silently dropped the moment a
 * mission continued — find-shape (a): the ledger records it, and the one reader
 * that needs it later does not read it back.
 *
 * That matters more than it looks, because a resume is the ONLY way a mission
 * whose intake raised a high-stakes question ever reaches a task at all. Measured
 * over 8 trials on two requests differing only in specificity, the live
 * interrogator produced at least one high-stakes question every single time
 * (see defect `343c3fb8`), so "just write a request with no high-stakes
 * ambiguity" is not a path that exists.
 *
 * The prior trail is a REAL trail, truncated after the last contract — exactly
 * the state a process that died mid-mission leaves behind. Nothing is
 * hand-authored except the two synthetic events noted in their own tests.
 */
describe('R30 AC-2 — a carried assumption survives a resume', () => {
  const carried = [{ criterionId: 'm-1', subject: 'audience', question: 'Which audience is this for?', stakes: 'low' as const }];
  const carrying = () => ({ ...seams(), interrogator: { async assess() { return { questions: carried }; } } } as never);

  /** A real trail cut off after the last contract: assumptions carried, no work done. */
  async function priorThroughContracts(): Promise<Array<Record<string, unknown>>> {
    const full = (await runMission(mission(), carrying(), { now: () => AT })).trail as unknown as Array<
      Record<string, unknown>
    >;
    const lastContract = full.map((e) => e['type']).lastIndexOf('task.contracted');
    const sliced = full.slice(0, lastContract + 1);

    // The fixture has to be capable of proving what the test claims.
    expect(sliced.some((e) => e['type'] === 'task.contracted'), 'FIXTURE: no contract, so the run would not resume').toBe(true);
    expect(sliced.some((e) => e['type'] === 'intake.assumption_flagged'), 'FIXTURE: nothing was carried to lose').toBe(true);
    expect(sliced.some((e) => e['type'] === 'assumption.became_load_bearing'), 'FIXTURE: the escalation already happened').toBe(false);
    return sliced;
  }

  it('escalates on the resumed run, from the assumption the prior trail recorded', async () => {
    const prior = await priorThroughContracts();

    const result = await runMission(mission(), carrying(), { now: () => AT, resumeFrom: prior as never });

    expect(result.trail.some((e) => e.type === 'mission.resumed'), 'CONTROL: this was not a resume').toBe(true);
    expect(result.trail.some((e) => e.type === 'task.executed'), 'CONTROL: no task ran, so nothing could become load-bearing').toBe(true);
    const escalated = result.trail.find((e) => e.type === 'assumption.became_load_bearing');
    expect(escalated, 'the carried assumption was dropped at the resume boundary').toBeDefined();
    // Read BACK from the trail, not re-derived: the question has to survive intact.
    expect(JSON.stringify(escalated?.payload)).toMatch(/Which audience is this for\?/);
  });

  it('DISTRACTOR: an assumption the prior trail already escalated is not raised twice', async () => {
    // "Escalated at that moment" is a moment, singular. A resume that re-raised
    // it would refill the attention queue with the item the operator has already
    // been shown — the failure `prior.decided` exists to prevent one rung over.
    // The ONE synthetic event in this suite: the prior escalation, cloned from
    // the real flag event so its shape is the loop's own.
    const prior = await priorThroughContracts();
    const flag = prior.find((e) => e['type'] === 'intake.assumption_flagged')!;
    prior.push({ ...flag, type: 'assumption.became_load_bearing' });

    const result = await runMission(mission(), carrying(), { now: () => AT, resumeFrom: prior as never });

    expect(result.trail.some((e) => e.type === 'task.executed'), 'CONTROL: no task ran, so nothing could have escalated').toBe(true);
    expect(
      result.trail.some((e) => e.type === 'assumption.became_load_bearing'),
      'an assumption already on the attention queue was raised again',
    ).toBe(false);
  });

  it('DISTRACTOR: a BLOCKING question on the prior trail is not carried as an assumption', async () => {
    // `intake.question_raised` is the half the operator was asked to answer, not
    // the half the dial permitted carrying. Folding both would turn a high-stakes
    // question the requester already answered into a low-stakes assumption and
    // escalate it — and it would pass the test above.
    const prior = (await priorThroughContracts()).filter((e) => e['type'] !== 'intake.assumption_flagged');
    const contract = prior.find((e) => e['type'] === 'task.contracted')!;
    prior.push({
      ...contract,
      type: 'intake.question_raised',
      payload: { criterionId: 'm-1', subject: 'audience', question: 'Which audience?', stakes: 'high', blocking: true },
    });

    const result = await runMission(mission(), carrying(), { now: () => AT, resumeFrom: prior as never });

    expect(result.trail.some((e) => e.type === 'task.executed'), 'CONTROL: no task ran').toBe(true);
    expect(
      result.trail.some((e) => e.type === 'assumption.became_load_bearing'),
      'a blocking question was carried as though the dial had permitted it',
    ).toBe(false);
  });

  it('DISTRACTOR: a mission that is NOT resuming still carries from the interrogator alone', async () => {
    // The additive half. Nothing about folding the trail may change the path
    // that had no prior trail to fold.
    const result = await runMission(mission(), carrying(), { now: () => AT });

    expect(result.trail.some((e) => e.type === 'assumption.became_load_bearing')).toBe(true);
  });
});

/**
 * Restating a mission continues it — it does not start a new one (R41, R37 AC-2).
 *
 * The owner's correction, and the right one: "it should not create a new
 * mission. we should be using the same mission, but continuing with what we
 * learned. creating a new mission is a waste and gives us too many missions."
 *
 * A retry that minted a fresh mission id split one piece of work across two
 * trails, and left the fleet growing by one row every time a specification
 * needed a word changed. The ledger is append-only and already the checkpoint
 * a mission resumes from — so a restatement is another event on the SAME trail.
 *
 * The subtlety that makes this more than an event: on resume the loop recovers
 * the prior task tree and does NOT re-plan. That is right for a mission that
 * was merely interrupted, and wrong for one whose specification just changed —
 * the plan was built to satisfy criteria that no longer exist, and Gate A would
 * reject it for the same reason a second time. So a restatement invalidates the
 * plan that preceded it.
 */
describe('R41 — a restatement continues the same mission and re-plans it', () => {
  const AMENDED = [{ criterionId: 'm-1', statement: 'Lists exactly three named algorithms.' }];

  /** A real trail: contracted work, then the operator restating the criteria. */
  async function trailWithRestatement(): Promise<Array<Record<string, unknown>>> {
    const trail = (await runMission(mission(), seams(), { now: () => AT })).trail as unknown as Array<
      Record<string, unknown>
    >;
    expect(trail.some((e) => e['type'] === 'task.contracted'), 'FIXTURE: no plan to invalidate').toBe(true);

    const started = trail.find((e) => e['type'] === 'mission.started')!;
    return [
      ...trail,
      { ...started, type: 'operator.restated', taskId: MISSION_ID, payload: { acceptanceCriteria: AMENDED } },
    ];
  }

  it('re-plans after a restatement instead of resuming a plan built for the old criteria', async () => {
    const prior = await trailWithRestatement();
    const contractedBefore = prior.filter((e) => e['type'] === 'task.contracted').length;

    const result = await runMission(mission(), seams(), { now: () => AT, resumeFrom: prior as never });

    // Fresh contracts, because the plan that preceded the restatement was built
    // to satisfy criteria that no longer exist.
    expect(
      result.trail.filter((e) => e.type === 'task.contracted').length,
      'the restated mission reused the plan Gate A had already rejected',
    ).toBeGreaterThan(0);
    expect(contractedBefore, 'CONTROL: the prior trail had no contracts, so nothing was invalidated').toBeGreaterThan(0);
  });

  it('DISTRACTOR: without a restatement, a resumed mission still reuses its plan', async () => {
    // The additive half. Re-planning every resume would throw away verified work
    // and make R41 pointless — a mission interrupted mid-flight must continue,
    // not start over.
    const prior = (await runMission(mission(), seams(), { now: () => AT })).trail;

    const result = await runMission(mission(), seams(), { now: () => AT, resumeFrom: prior as never });

    expect(
      result.trail.some((e) => e.type === 'task.contracted'),
      'a plain resume re-contracted work it had already done',
    ).toBe(false);
  });

  it('DISTRACTOR: a restatement does not discard the operator answers that preceded it', async () => {
    // `decided` is what clears the intake block (ADR-0023). Wiping it along with
    // the plan would send a restated mission straight back to the question the
    // operator has already answered.
    const prior = await trailWithRestatement();
    const started = prior.find((e) => e['type'] === 'mission.started')!;
    prior.splice(1, 0, { ...started, type: 'operator.decided', taskId: MISSION_ID, payload: { decision: 'approve' } });

    let asked = 0;
    const result = await runMission(
      mission(),
      { ...seams(), interrogator: { async assess() { asked += 1; return { questions: [{ criterionId: 'm-1', subject: 'x', question: 'Which audience?', stakes: 'high' as const }] }; } } } as never,
      { now: () => AT, resumeFrom: prior as never },
    );

    expect(asked, 'CONTROL: the interrogator was never consulted, so the block was not tested').toBe(0);

    expect(result.trail.some((e) => e.type === 'task.contracted'), 'the restated mission stopped at an answered question').toBe(true);
  });
});

/**
 * The mission's answer is ON the ledger (invariant #1).
 *
 * Reported by the owner of a delivered mission: "there is no place where I can
 * see what was delivered."
 *
 * `mission.delivered` recorded the objective and the pedigree — everything
 * *about* the delivery except the delivery. For a mission kept whole the answer
 * could still be dug out of `task.executed`; for a DECOMPOSED mission the
 * reconciled result existed only in `runMission`'s return value and reached no
 * event at all. A replay could say a mission delivered and not what it
 * delivered, which invariant #1 does not allow — the same shape as defect
 * `aa6948ee`, where an event named everything about a patch except what the
 * instructions were patched to.
 */
describe('R37 AC-0 — mission.delivered carries what was delivered', () => {
  it('records the deliverable on the delivery event', async () => {
    const result = await runMission(mission(), seams(), { now: () => AT });

    const delivered = result.trail.find((e) => e.type === 'mission.delivered');
    expect(delivered, 'CONTROL: the mission did not deliver, so nothing was tested').toBeDefined();
    expect(delivered?.payload['deliverable'], 'the delivery event does not say what was delivered')
      .toEqual(result.deliverable);
  });

  it('records the ASSEMBLED result for a decomposed mission, not one child\'s', async () => {
    // The half that could not be dug out of `task.executed` at all: a split
    // mission's answer is what the reconciler assembled, and that existed only
    // in a return value. The fixture's reconciler returns `{ n: childCount }`,
    // which no single child ever produced.
    const result = await runMission(mission(), seams(), { now: () => AT });

    const delivered = result.trail.find((e) => e.type === 'mission.delivered');
    const executed = result.trail.filter((e) => e.type === 'task.executed');
    expect(executed.length, 'CONTROL: no task executed, so there is nothing to distinguish').toBeGreaterThan(0);
    // Whatever the loop returned is what the event must carry — if they can
    // differ, the trail is describing a different answer than the caller got.
    expect(delivered?.payload['deliverable']).toEqual(result.deliverable);
  });
});

/**
 * The loop actually CARRIES the verdict into the retry (R36).
 *
 * `runtime-evidence.test.ts` proves the work seam uses `priorFindings` when it
 * is given them. Nothing there can see whether the loop ever passes them — and
 * this project has found six mechanisms that were correct and unreachable, so
 * the producer gets its own test.
 */
describe('R36 — a retry is told why the last attempt was rejected', () => {
  /** Fails the first attempt with a specific diagnosis, then passes. */
  function failingOnce(): { seams: MissionSeams; promptsFindings: (readonly string[])[] } {
    const base = seams();
    const promptsFindings: (readonly string[])[] = [];
    let attempts = 0;

    return {
      promptsFindings,
      seams: {
        ...base,
        work: {
          async execute(input: { priorFindings?: readonly string[] }) {
            promptsFindings.push(input.priorFindings ?? []);
            return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 2 };
          },
        },
        completionJudge: {
          async assess({ contract }) {
            attempts += 1;
            if (attempts === 1) {
              return {
                criteria: contract.acceptanceCriteria.map((c) => ({
                  criterionId: c.criterionId,
                  met: false,
                  detail: "conflates 'biological models' with 'algorithms'",
                })),
                redFlags: [],
              };
            }
            return {
              criteria: contract.acceptanceCriteria.map((c) => ({ criterionId: c.criterionId, met: true, detail: 'ok' })),
              redFlags: [],
            };
          },
        },
      } as MissionSeams,
    };
  }

  it('hands the second attempt the finding that failed the first', async () => {
    const { seams: s, promptsFindings } = failingOnce();

    await runMission(mission(), s, { now: () => AT });

    expect(promptsFindings.length, 'CONTROL: there was no second attempt, so nothing was carried').toBeGreaterThan(1);
    expect(promptsFindings[0], 'the FIRST attempt was told about a failure that had not happened').toEqual([]);
    expect(promptsFindings[1], 'the retry was blind to why the last attempt was rejected')
      .toContain("conflates 'biological models' with 'algorithms'");
  });

  it('DISTRACTOR: a task that passes first time is never told about a failure', async () => {
    const base = seams();
    const seen: (readonly string[])[] = [];
    const s = {
      ...base,
      work: {
        async execute(input: { priorFindings?: readonly string[] }) {
          seen.push(input.priorFindings ?? []);
          return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 2 };
        },
      },
    } as MissionSeams;

    await runMission(mission(), s, { now: () => AT });

    expect(seen.length, 'CONTROL: no work ran').toBeGreaterThan(0);
    for (const findings of seen) expect(findings).toEqual([]);
  });
});

/**
 * The bounce loop is bounded (R36, defect found 2026-08-03).
 *
 * Measured on a live task that bounced three times and exhausted its ladder
 * without ever executing. The three objections were DISJOINT — the Clarifier
 * addressed each and the judge produced a different one:
 *
 *   1. "named algorithms" is ambiguous; GEOGRAPHICAL_LOCATION — "does not
 *      specify where these computational work must be demonstrated"; TIME_LIMITS
 *   2. scope of "computational algorithm"; on what basis three are selected;
 *      how word count is verified
 *   3. the word "unique" is subjective
 *
 * `GEOGRAPHICAL_LOCATION` on a report-writing task is not a specification
 * defect. This is the documented false-bounce rate (17–58% depending on model,
 * and NOT monotonic in model size — 9B is best, 12B worst), which means the
 * ladder's own remedy of escalating a tier makes it likelier, not less.
 *
 * Gate A already bounds exactly this: one re-split, then stop, because "the
 * alternative is an unbounded loop". The bounce path had no such bound — the
 * same rule at one site and not its sibling, find-shape (b).
 *
 * The rule adopted: **an objection that cannot survive one clarification is not
 * evidence about the contract.** The Clarifier had the objections in hand and
 * rewrote the spec; a fresh, unrelated complaint is a new opinion, not a
 * persistent defect. Work proceeds — and Gate B, which is untouched, remains
 * the gate that decides whether the output is any good.
 */
describe('R36 — a bounce that survives clarification stops blocking the work', () => {
  function alwaysBounces(): { seams: MissionSeams; executed: number[] } {
    const base = seams();
    const executed: number[] = [];
    let assessments = 0;
    return {
      executed,
      seams: {
        ...base,
        clarityJudge: {
          async assess() {
            assessments += 1;
            // A different objection every time, exactly as measured.
            return { restatement: 'r', ambiguities: [`objection number ${assessments}`] };
          },
        },
        clarifier: {
          async clarify({ contract }) {
            return { objective: `${contract.objective} (clarified)`, acceptanceCriteria: null };
          },
        },
        work: {
          async execute() {
            executed.push(1);
            return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 2 };
          },
        },
      } as MissionSeams,
    };
  }

  it('does the work rather than bouncing for ever', async () => {
    const { seams: s, executed } = alwaysBounces();

    const result = await runMission(mission(), s, { now: () => AT });

    expect(executed.length, 'the task never executed — it bounced until the ladder ran out').toBeGreaterThan(0);
    expect(result.trail.some((e) => e.type === 'task.executed')).toBe(true);
  });

  it('records that it proceeded, and why — the objection is not silently dropped', async () => {
    // A judge overruled without a trace would be the system quietly deciding it
    // knows better. The objection stays on the trail with the reason it was
    // set aside, so an operator reading the mission can disagree.
    const { seams: s } = alwaysBounces();

    const result = await runMission(mission(), s, { now: () => AT });

    const overruled = result.trail.find((e) => e.type === 'task.bounce_overruled');
    expect(overruled, 'the work proceeded past a bounce with nothing on the trail saying so').toBeDefined();
    expect(JSON.stringify(overruled?.payload)).toMatch(/objection number/);
  });

  it('DISTRACTOR: the FIRST bounce still clarifies rather than being overruled', async () => {
    // The bounce is doing its job the first time: the spec really may be
    // unclear, and rewriting it is the cheap fix. Only a bounce that survives
    // that rewrite is treated as noise.
    const { seams: s } = alwaysBounces();

    const result = await runMission(mission(), s, { now: () => AT });

    const order = result.trail.map((e) => e.type);
    expect(order.indexOf('task.recontracted'), 'the contract was never clarified at all').toBeGreaterThan(-1);
    expect(order.indexOf('task.recontracted')).toBeLessThan(order.indexOf('task.bounce_overruled'));
  });

  it('DISTRACTOR: a task that never bounces is untouched', async () => {
    const result = await runMission(mission(), seams(), { now: () => AT });

    expect(result.trail.some((e) => e.type === 'task.bounced')).toBe(false);
    expect(result.trail.some((e) => e.type === 'task.bounce_overruled')).toBe(false);
    expect(result.outcome).toBe('delivered');
  });
});
