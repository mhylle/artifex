/**
 * The design playbook — typed building blocks, and effort sized to the work (R38 AC-2).
 *
 * "Designs on no-bid — composed from the design playbook's typed building
 * blocks, not blank-page prompt authorship. A constrained design space
 * demonstrably beats freeform generation (AFlow). Scales effort — how many
 * workers a category gets, sized to task class and budget, preventing both
 * fifty-agents-for-a-triviality and one-agent-for-an-avalanche."
 *
 * The author seam used to be a single hardcoded template string. That is not a
 * constrained design space, it is one block pretending to be a design: it could
 * not vary with the contract, so every specialist in the system said the same
 * thing regardless of what it had been asked to do.
 *
 * The constraint here is structural rather than instructional. A composer that
 * can only emit known block kinds, each filled from a named contract field,
 * cannot acquire an obligation the contract never stated — no prompt asks it not
 * to, and no model gets the chance to improvise one.
 */
import type { TaskContract } from '@artifex/shared-types';

/**
 * The playbook's blocks, in the order a specialist reads them.
 *
 * Ordered deliberately: what you are, what you must do, what counts as done,
 * what you must not touch, and when to stop trying. A worker that reads its
 * stopping condition before its objective has to hold the whole thing in mind
 * to make sense of either.
 */
export const BLOCK_KINDS = ['role', 'scope', 'evidence', 'anti_scope', 'stopping'] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface DesignBlock {
  readonly kind: BlockKind;
  readonly text: string;
}

export interface ComposedDesign {
  readonly blocks: readonly DesignBlock[];
  readonly roleInstructions: string;
  readonly capabilities: string[];
}

/** A list, or a named absence — never a blank that reads as "nothing applies". */
function listOrNone(items: readonly string[], none: string): string {
  return items.length === 0 ? none : items.map((item) => `  - ${item}`).join('\n');
}

/**
 * Compose a specialist from the playbook.
 *
 * Every block's content comes from a contract field, so the design is traceable
 * clause by clause to what was actually agreed.
 */
export function composeDesign(contract: TaskContract): ComposedDesign {
  const blocks: DesignBlock[] = [
    {
      kind: 'role',
      text: `You are a specialist in ${contract.category}. You do this one task and nothing else.`,
    },
    { kind: 'scope', text: `TASK: ${contract.objective}` },
    {
      kind: 'evidence',
      text: `DONE WHEN each of these can be shown to be true:\n${listOrNone(
        contract.acceptanceCriteria.map((criterion) => `[${criterion.criterionId}] ${criterion.statement}`),
        '  - (this contract states no acceptance criteria)',
      )}`,
    },
    {
      kind: 'anti_scope',
      text: `OUT OF SCOPE — do not address these, they belong to others:\n${listOrNone(
        contract.boundaries.outOfScope,
        '  - none stated',
      )}`,
    },
    {
      kind: 'stopping',
      text: `STOP TRYING IF:\n${listOrNone(
        contract.stoppingConditions.stopTryingWhen,
        '  - no stopping condition stated; escalate rather than loop',
      )}`,
    },
  ];

  return {
    blocks,
    roleInstructions: blocks.map((block) => block.text).join('\n\n'),
    // Derived from what the contract actually grants. Declaring a capability the
    // contract does not entitle would let a design claim reach it does not have.
    capabilities: contract.inputs.toolEntitlements.length > 0 ? ['text', 'tools'] : ['text'],
  };
}

/**
 * How many of a ready wave may run at once (R38 AC-2, effort scaling).
 *
 * Two bounds, both read off the contract rather than chosen:
 *
 *  - **Budget.** A worker consumes at least its floor. The parent's ceiling
 *    therefore caps how many can be in flight before the budget is committed
 *    beyond what it can pay — this is the "fifty agents for a triviality" half.
 *  - **Blast radius.** The contract's own class marker, and the reason to be
 *    careful: many concurrent high-risk workers is precisely the avalanche the
 *    criterion warns about. High halves the budget's allowance, medium leaves it,
 *    low doubles it — a ratio rather than a count, so it scales with the budget
 *    instead of overriding it.
 *
 * Never returns 0 for a non-empty wave. A budget too thin for even one worker's
 * floor must still run one: progress with an overrun is recoverable and visible,
 * a silent halt is neither.
 */
export function concurrencyFor(parent: TaskContract, wave: readonly TaskContract[]): number {
  if (wave.length === 0) return 0;

  const floors = wave.map((child) => Math.max(child.budget.floor, Number.EPSILON));
  const heaviest = Math.max(...floors);
  const affordable = Math.floor(parent.budget.ceiling / heaviest);

  // The riskiest task in the wave sets the caution, not the average: one
  // high-blast-radius sibling is enough reason to widen the blast interval.
  //
  // Expressed as a FRACTION OF THE WAVE rather than a subtraction from the
  // budget, so the two bounds stay independent: budget says what can be paid
  // for, risk says how much of it should be in flight at once. A high-risk wave
  // runs a quarter of itself concurrently, medium a half, low all of it.
  const riskiest = wave.some((c) => c.blastRadius === 'high')
    ? 'high'
    : wave.some((c) => c.blastRadius === 'medium')
      ? 'medium'
      : 'low';
  const riskCap =
    riskiest === 'high' ? Math.ceil(wave.length / 4)
      : riskiest === 'medium' ? Math.ceil(wave.length / 2)
        : wave.length;

  return Math.max(1, Math.min(wave.length, riskCap, affordable));
}
