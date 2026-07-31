/**
 * The tool catalogue — what an Artifex agent may be granted (R13).
 *
 * DATA here, behaviour in `packages/worker/src/tools.ts`. The control plane has
 * to decide what a contract grants at intake, and the API must not import the
 * worker, so the catalogue that both sides read lives with the schemas they
 * already share. A tool's `invoke` never crosses that boundary.
 *
 * The catalogue is deliberately tiny. R13's own scope note says it *"touches
 * sandboxing and credential handling — security is a deferred concern
 * project-wide and this requirement does NOT lift that deferral."* Search — the
 * tool R13 actually wants — is outbound network access from an agent, which is
 * exactly what the deferred security work would govern, so it is roadmapped
 * rather than shipped. What ships is the mediated PATH, carrying a tool that
 * needs no sandbox because it cannot reach anything: see ADR-0020.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { SlugIdSchema, TextSchema, ToolRiskClassSchema } from './common.js';
import type { BlastRadius, ToolRiskClass } from './common.js';
import type { ToolEntitlement } from './contract.js';

export const ToolSpecSchema = Type.Object(
  {
    toolId: SlugIdSchema,
    riskClass: ToolRiskClassSchema,
    /** Shown to the agent — this is how it learns the tool exists and what it does. */
    description: TextSchema,
    /** What the grant covers, recorded on the entitlement it produces. */
    scope: TextSchema,
  },
  {
    additionalProperties: false,
    description: 'A tool the swarm can offer, described without its implementation.',
  },
);
export type ToolSpec = Static<typeof ToolSpecSchema>;

/**
 * Every tool this build knows how to run.
 *
 * `text.count` is `compute`, not `read`: risk classes grade CONSEQUENCE, and a
 * pure function over a string supplied in the invocation reaches nothing at all.
 * That places it above `low` blast radius, which is the correct and slightly
 * inconvenient answer — a low-blast-radius task genuinely gets no tools, and
 * that is R13 AC-3 working rather than a gap.
 *
 * Chosen because it changes outcomes rather than demonstrating a mechanism.
 * Models are unreliable at counting words, and this project's own missions ask
 * them to be: a criterion like "in exactly seven words" is the honest input that
 * reaches the fast loop. An agent that can count can satisfy such a criterion
 * instead of guessing at it.
 */
export const TOOL_CATALOGUE: readonly ToolSpec[] = [
  {
    toolId: 'text.count',
    riskClass: 'compute',
    description:
      'Count the words, characters and sentences of a piece of text you supply. ' +
      'Use it when a criterion constrains length and you need the exact number rather than an estimate.',
    scope: 'text passed in the invocation; reaches no network, filesystem or shell',
  },
];

/**
 * Which risk classes a blast radius admits (ADR-0007).
 *
 * The rule is that **a declared blast radius must cover the tools used**. A
 * `write` action creates consequence, so performing one under a `low`
 * declaration would make the task's real blast radius exceed its declared one —
 * invalidating the verification depth and model tier assigned on that
 * declaration.
 *
 * Lives here rather than beside the broker because intake decides what to grant
 * and the broker decides what to permit, and those two must not be able to
 * disagree. Two copies of one rule is the shape this project has found four
 * times (defect `6d58e8ef` most recently).
 */
export function admissibleRiskClasses(blastRadius: BlastRadius): ToolRiskClass[] {
  switch (blastRadius) {
    case 'low':
      return ['read'];
    case 'medium':
      return ['read', 'compute'];
    case 'high':
      return ['read', 'compute', 'write'];
  }
}

/**
 * The tool grants a contract at this blast radius carries (R13 AC-3).
 *
 * Derived from the requirement rather than chosen: *"blastRadius gains a second
 * job … it must also bound WHICH tools are reachable"*, and *"tools are granted
 * per contract by the level above — the contract stays the sole authority on
 * what a task may do."* So the grant set IS the admissible set, and nothing
 * about the request picks tools by name. A requester naming tools would make the
 * requester the authority, which is precisely what the contract is supposed to
 * be.
 *
 * The orchestrator copies these down to children unchanged, so a subtask can
 * never hold a grant its mission did not.
 */
export function grantsFor(blastRadius: BlastRadius): ToolEntitlement[] {
  const admitted = admissibleRiskClasses(blastRadius);
  return TOOL_CATALOGUE.filter((tool) => admitted.includes(tool.riskClass)).map((tool) => ({
    entitlementId: `grant-${tool.toolId}`,
    toolId: tool.toolId,
    riskClass: tool.riskClass,
    scope: tool.scope,
  }));
}
