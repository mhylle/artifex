# ADR-0015 — R13 is recorded as unsatisfied rather than wired

**Date:** 2026-07-31
**Status:** Accepted
**Context:** defect `635b7a9f`, requirement R13 (Action Broker), friction on the doneness gate

## Context

R13 was marked **satisfied**. The `ActionBroker` is implemented, has its own test
file, and the live ledger holds three `action.invoked` and three `action.denied`
events. Nothing about the class is wrong.

It is also unreachable. Tracing every non-test reference to the deployable
entrypoint found four independent missing links, any one of which is sufficient
to make tool use impossible in the running system:

1. **The model layer cannot request a tool.** `packages/model-router` has no
   tool-calling support at all — zero occurrences of `tool` in its production
   sources. A worker agent has no way to emit an invocation.
2. **No contract can grant one.** `mission-intake.service.ts:146` hardcodes
   `inputs.toolEntitlements: []`, and the orchestrator only copies the parent's
   entitlements down. Live count of contracts carrying a tool entitlement: **0**.
3. **Nothing constructs the broker.** `new ActionBroker` appears only in
   `action-broker.test.ts`. `runtime.ts` wires no tool seam.
4. **The work seam has no path to it.** `work.execute` receives a contract and
   returns a deliverable; the broker is not among its dependencies.

The ledger events that look like evidence are not evidence of the running
system. They date from 2026-07-26 and 2026-07-30, and their missions carry no
`requestedBy` — they were produced by scripts that constructed the broker
themselves, which is the same shape as the P13 dogfood that passed 20/20 while
`packages/worker`'s `main()` was still a placeholder.

Meanwhile six production sites read `contract.inputs.toolEntitlements`, and
`reviewer.ts:450` fails a task that carried entitlements but produced no actions.
The running system can penalise work for not using a broker it never provides.

## Options considered

**A — Wire the broker now.** Rejected. Closing link 1 means adding tool-calling
to the model router and having agents emit structured invocations; closing link 2
means deciding which tools a mission may be granted at intake. R13's own scope
note says it "touches sandboxing and credential handling — security is a deferred
concern project-wide and this requirement does NOT lift that deferral." A real
`web.search` tool is outbound network access from an agent, which is exactly what
the deferred security work would govern. Wiring it now would either lift the
deferral by the back door or ship a broker whose only tools are ornamental.

**B — Wire a credential-free internal tool only** (e.g. registry search).
Rejected as a half-measure that would make the reachability check green while
leaving R13's actual criterion — that replaying the ledger reproduces the full
set of actions an agent took — as unreachable as before, because link 1 still
blocks the agent from asking. It would convert a visible gap into an invisible
one, which is the `cd18baa0` failure shape.

**C — Record R13 as unsatisfied.** Chosen.

## Decision

R13's status returns to `approved`, and **AC-0 is un-satisfied**: "Every tool
invocation by a swarm agent appends a first-class ledger event … replaying the
ledger reproduces the full set of actions taken." No swarm agent can invoke a
tool, so the criterion is vacuously true and means nothing.

AC-1 (denied attempts are logged, never silently ignored or permitted), AC-2
(`EvidenceBundle.actions` validates as structured records and rejects free-text
prose) and AC-3 (blast radius bounds the reachable tool set, "proven by a
rejection test") **remain satisfied**, and the bound is stated rather than
implied: AC-2 is a schema property that holds independently of wiring, AC-3
names a rejection test as its own proof, and AC-1's behaviour is implemented and
was exercised — but like AC-0, its "given" is not reachable from the deployable
process today.

This follows the project's own durable preference: *a deferral is only real once
it is an unsatisfied requirement in the system of record.* Writing "roadmap, not
v0" into a markdown file is what let the operator console vanish while all five
pillars reported green.

## Consequences

- `getProjectDoneness` will now block on R13, correctly. The gap was always
  there; it was invisible.
- Nothing is deleted. The broker, its tests, and its ledger events remain — they
  are truthful work, and removing them to quiet a finding is the failure shape
  this ADR exists to avoid.
- A reachability test (`packages/worker/src/reachability.test.ts`) now fails on
  any exported class no other production file constructs, with `ActionBroker` and
  `LearningProjection` listed against their defect. The habit that found these
  five cases becomes a check that catches the sixth.
- The remaining links are a genuine feature, not a fix, and belong in a phase of
  their own: tool-calling in the model router, tool grants at intake, a tool
  registry, and the broker in the work seam.
