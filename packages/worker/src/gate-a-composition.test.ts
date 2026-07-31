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
