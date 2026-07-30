# 023 — P8.5: the Action Broker (R13 runtime)

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P8.5 (Tasktracker `ede231c1-…`) · **Requirement:** R13 · **ADR:** [ADR-0007](../docs/decisions/ADR-0007-r12-r13-sequencing-and-contract-surface.md)

**What:** Built the Action Broker — mediated, entitlement-scoped, fully logged tool use. With the P2.5 contract surface, **R13 is now complete**: Artifex agents can act, not only think.

**Why:** ADR-0006 identified tool use as the largest gap in the design. Agents could reason and consult context but had no way to affect anything.

**Details:**
- **One door.** Every invocation funnels through `invoke()` — successes, failures, and refusals alike. That single funnel is what lets sandboxing and credential handling land later without redesign; security stays deferred project-wide, and the obligation discharged here is only that there is exactly one place to put it.
- **Three denial paths, each typed *and* logged.** Neither silence is acceptable: silently ignoring a call hides a capability gap the Learning Agent should see, and silently permitting it defeats the entitlement. The write-class descriptor in the tests **throws if it is ever reached**, so a silent permission surfaces as the wrong error rather than as a pass.
- **`blastRadius` bounds the reachable tool set.** The rule is that a declared blast radius must *cover* the tools used — writing to the world under a `low` declaration would make the task's real blast radius exceed its declared one, invalidating the verification depth and model tier assigned on that declaration. Both ADR-0007 tables are stated policy functions, not conditionals scattered through the call path.
- **A tool that throws is recorded, not swallowed.** "We tried and it failed" is information the Reviewer and the Learning Agent need.
- **`EventSink` extracted to its own module** so the two brokers stay siblings rather than importing each other. Context is what an agent may *know*, actions are what it may *do*; coupling them would blur exactly the distinction that makes their grants mean different things.

**Outcome:** TDD red→green. 87 worker tests, **177 repo-wide**, 29 integration, build + typecheck clean. Mutation-verified: removing the blast-radius bound failed exactly the LOW-blast write distractor, 86 still passing. The typecheck caught a duplicate `EventSink` export across the brokers — fixed by extracting it rather than making one broker depend on the other.

**Dogfooded with a real tool doing real I/O** — a read-class search over the Asset Registry in Postgres, with agent code never touching the pool:

```
registry.search -> {"hits":1,"first":"a real row to find"}   (genuinely queried Postgres)
3 denials raised: ungranted tool · write-class at LOW blast · unratified write under SUPERVISED
the same supervised write PROCEEDED once ratified (the guard is conditional, not a wall)
replay: 5 action-family events — 2 invoked, 3 denied; grants and digests on every invocation
```

**Consequence to track:** open defect `8a6ee598` (ledger `seq` gaps under concurrent writers) is now **reachable**, exactly as the phase body warned. It stays tracked separately and was deliberately not papered over inside the broker.
