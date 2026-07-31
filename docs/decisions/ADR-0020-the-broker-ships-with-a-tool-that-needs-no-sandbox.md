# ADR-0020 — The Action Broker ships wired, carrying a tool that needs no sandbox

**Date:** 2026-07-31
**Status:** Accepted
**Context:** R13 AC-0, ADR-0015 (which this corrects in one respect), phase P13b

## Context

ADR-0015 recorded R13 AC-0 as unsatisfied and named four links missing between a
complete, tested `ActionBroker` and the deployable worker:

1. the model layer cannot request a tool;
2. no contract can grant one (`mission-intake.service.ts:146` hardcoded `[]`);
3. nothing constructs the broker outside its own test;
4. the work seam has no path to it.

## The correction

**Link 1 was an over-claim.** Its evidence — *"`packages/model-router` has no
tool-calling support at all — zero occurrences of `tool` in its production
sources"* — is true. The conclusion drawn from it, *"a worker agent has no way to
emit an invocation"*, does not follow.

`generator.generate({ provider, model, probe: { schema, prompt } })` takes an
**arbitrary TypeBox schema**, and every other decision this system makes already
travels that way: the planner emits structured decompositions, the reviewer emits
structured verdicts, the decompose-or-delegate gate emits a structured judgement.
A tool invocation is one more structured object. Nothing blocked the agent from
asking. Nothing had been written to ask.

This matters beyond the fix, because ADR-0015 rejected its own **Option B**
(wire a credential-free internal tool) *"because link 1 still blocks the agent
from asking"*. That rejection rests on the false half of the claim, so it is
revisited here rather than inherited.

The retracted reasoning is left visible in ADR-0015, as its own `requestedBy`
correction was. Two of that ADR's arguments have now failed on inspection, which
is worth recording plainly: it was written from a reachability trace, and a trace
tells you what *is* called, never what *could* be.

## Options considered

**A — Ship a real search tool.** Rejected, unchanged from ADR-0015. R13's scope
note is explicit: *"this touches sandboxing and credential handling — security is
a deferred concern project-wide and this requirement does NOT lift that
deferral."* Search is outbound network access from an agent. Shipping it would
lift the deferral by the back door.

**B — Ship the mediated path with a tool that cannot reach anything.** Chosen.

**C — Ship the path with no tools at all.** Rejected. `admissibleRiskClasses`
would grant nothing, no agent could invoke anything, and AC-0's given would stay
unreachable while the wiring *looked* complete — converting a visible gap into an
invisible one, which is the `cd18baa0` failure shape ADR-0015 itself named.

## Decision

All four links close. Intake grants tools by blast radius, `worker-seams.ts`
constructs the broker, the work seam reaches it through a narrow `ToolInvoker`,
and the agent asks for an invocation with a structured probe.

**The catalogue carries one tool: `text.count`.** It counts the words,
characters and sentences of text supplied in the invocation. It is a pure
function of its arguments and reaches no network, filesystem or shell, so the
deferred security work is not a prerequisite for it — which is the whole point of
the choice.

It is `compute`, not `read`. Risk classes grade **consequence**, and a pure
function over supplied text has none. That places it above `low` blast radius, so
a low-blast-radius mission genuinely receives no tools at all. That is
inconvenient and correct: it is R13 AC-3 working rather than a gap, and it is
asserted as a property rather than special-cased.

**It was chosen to change outcomes rather than to demonstrate a mechanism.**
Models are unreliable at counting words, and this project's own missions ask them
to be — "in exactly seven words" is the honest input this repo already uses to
reach the fast loop. An ornamental tool would have satisfied the ledger criterion
while leaving the work untouched, which is the objection that sank Option C.

### Grants are derived, not configured

`grantsFor(blastRadius)` returns every catalogued tool the radius admits. Derived
from R13's own words: *"blastRadius gains a second job … it must also bound WHICH
tools are reachable"* and *"tools are granted per contract by the level above —
the contract stays the sole authority on what a task may do."* The request never
names a tool, and a request that tries is rejected as malformed. A requester
picking its own tools would make the requester the authority, which is precisely
what the contract exists to be.

`admissibleRiskClasses` **moved** into `@artifex/shared-types`. Intake decides
what a contract grants; the broker decides what it permits; those two must not be
able to disagree. Two copies of one rule is the shape this project has found four
times, most recently defect `6d58e8ef`, where `bestForCategory` filtered on
`active` and `knownCapabilities` did not.

### The tool result is fed back

The agent drafts, may run one tool over its draft, sees the result, and may
revise. An action that cannot change the deliverable is theatre: it would satisfy
AC-0's ledger clause while leaving the work exactly as it was. A mutant that
drops the revision is killed by its own test.

## Consequences

- **Live, on mission `138bf70b`:** an API-submitted mission produced
  `action.invoked` from the deployable worker, carrying grant id, tool,
  arguments and result digest. Before this, the count of contracts that had ever
  carried a tool grant was **0**, and every `action.invoked` in the ledger had
  been produced by a script that constructed the broker itself.
- `ActionBroker` leaves `KNOWN_UNREACHABLE`. The anti-rot assertion in
  `reachability.test.ts` is what forced it out — it failed the moment the broker
  gained a production caller, which is the allowlist working rather than breaking.
- `reviewer.ts:450`, which fails a task that carried entitlements and produced no
  actions, can now reward as well as punish. It could only ever punish before.
- **Bound, stated rather than rounded up:** `EvidenceBundle.actions` carrying the
  structured record is proven by composition test, not live. On the live mission
  the one execution that completed took no action, and the attempt that acted
  produced a malformed deliverable. The ledger clause AC-0 actually names is live.
- **The live run also showed the agent using the tool badly** — it passed its own
  draft *including hallucinated counts* as the text to measure. The mechanism is
  proven; the prompting is not. That is a real finding about the thin base and is
  logged as its own defect rather than smoothed over.
- Search, code execution and outbound APIs stay roadmapped behind the security
  deferral. The seam takes them without redesign, which is the obligation R13's
  scope note actually imposes.
