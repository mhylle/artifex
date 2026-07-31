# ADR-0021 — Mission concurrency is an operator choice, and its default is above one

**Date:** 2026-07-31
**Status:** Accepted
**Context:** R39 (instance per mission, shared brain), phase P39

## Context

The BullMQ consumer was constructed with `concurrency: 1`, so a second mission
simply waited. R39 is a locked decision from the brainstorm — *"instance per
mission, shared brain: isolated execution, collective learning"* — and its own
rationale names the consequence: this is *"what makes the fleet view (R21) and
the fleet totals meaningful rather than a list of one."*

## What is derivable, and what is not

**Task-level concurrency IS derived.** `concurrencyFor` reads it off the parent
contract: the budget ceiling divided by the heaviest child's floor bounds what
can be paid for, and the riskiest blast radius in the wave bounds how much of it
should be in flight. Both bounds are properties of the work.

**Mission-level concurrency has no such contract.** A mission has no parent to
read a budget or a blast radius from, and the real bottleneck — one local Ollama
serving constrained decoding — is not something the worker can measure. CPU count
is available and would be misleading: a mission is almost entirely waiting on
model calls, so it is I/O-bound against a resource the host cannot see.

So the magnitude is a policy choice, and this ADR makes it openly rather than
picking a number and justifying it afterwards.

**The SHAPE is derived even though the magnitude is not.** The default must
exceed 1. A default of 1 leaves "instance per mission" false in the shipped
binary while the code looks capable of it — the ornamental shape this project
keeps finding — and leaves the fleet view showing exactly the "list of one" R39
exists to end.

## Decision

`missionConcurrency(env)` returns `WORKER_CONCURRENCY` when it is a positive
integer, and **4** otherwise.

Four is small enough not to thrash a single GPU with simultaneous constrained
decoding, and large enough that concurrency is the normal case rather than a
configuration someone has to discover. It is a default, not a cap: project
principle #3 is *"no arbitrary caps anywhere"*, and the override has no upper
bound.

**An explicit `1` is honoured.** Serialising on purpose is a legitimate operator
choice — debugging an interleaved trail, or running against a model server that
serialises anyway — and "no arbitrary caps" cuts downward as well as upward. A
`Math.max(2, …)` implementation would pass every other test and is killed by its
own distractor.

**Junk, zero, negative and fractional values fall back rather than being
obeyed.** `concurrency: 0` makes a BullMQ consumer accept no jobs at all, so a
typo in an environment variable would silently stop the swarm and look exactly
like an empty queue.

The function takes the environment as an argument rather than reading
`process.env`, so the rule is testable without mutating global state.

## The audit that had to come first

Raising concurrency converts an untested assumption — that nothing in the worker
holds cross-mission state — into a live race. Two module-scope counters exist:
`action-broker.ts` and `context-broker.ts` each keep a monotonic `let` outside
their class.

Both are safe, and the reason is worth recording: every id they build is prefixed
with the `taskId`, and the counter is globally monotonic, so two concurrent
missions cannot produce the same id even when their increments interleave. The
counter needs to be unique *within* a task; it is unique across the process.

Everything else is per-job by construction: `buildWorkerSeams(deps,
contract.missionId)` builds a fresh seam set per mission, including its own
Action Broker and its own append chain.

## Consequences

- **Live, and measured rather than asserted.** Two missions submitted
  back-to-back overlapped **44 seconds** with **10 interleavings** in one ordered
  ledger — a strictly sequential pair switches exactly once. A second pair
  overlapped 95 seconds.
- **Failure isolation was exercised, and by accident rather than by design.** The
  mission intended as the healthy control also surrendered, so the clean
  "one fails, one delivers" case was not produced. What the run did produce is
  the clause itself: mission `0345e303` surrendered at 11:47:23 while
  `d48fdf6e` kept producing events until 11:48:18. One mission's failure did not
  stop the other.
- **The fleet view shows both live**, verified in the real browser: two missions
  reading `RUNNING` simultaneously.
- **One shared fabric, written by both:** 20 ledger events across 2 missions in
  one table, one registry design staffed by both, and a knowledge entry from each
  of the four concurrent missions into a commons holding 68 entries from 48.
- An observation not chased here: the fleet header reads **"44 running"**, which
  is far more than the missions actually in flight. That count appears to include
  historical missions that never reached a terminal state. Recorded rather than
  claimed either way — it is a fleet-totals question, not a concurrency one.
