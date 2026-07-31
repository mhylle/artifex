# ADR-0025 — A mission nobody is running is recorded as abandoned

**Status:** Accepted
**Date:** 2026-07-31
**Context:** defect `dd2e9d18` (remaining half), R21, ADR-0024

## Context

ADR-0024 fixed the half of the fleet count that was a stale projection: 47 → 26. The residue was a different problem entirely, and no smarter query could touch it.

**26 missions had no terminal event at all** — zero with activity in the last 10 minutes, oldest ~19 hours, 9 never even picked up off the queue. They were dead runs from crashed or restarted workers.

Find-shape (w): **a state the system can enter but has no event to describe.** Nothing writes an event when a worker is killed, so the ledger holds no fact either way and every projection over it must say "running" — truthfully, and uselessly. The header claimed 26 missions were running while **zero** were in flight.

## Decision

**At worker boot, a mission with no outcome on the ledger and no job on the queue is recorded as `mission.abandoned`.**

The fabric's own guardrail says what to do with a record that has become wrong: *never fix a row — append a corrective event*. This is that, applied to a fact nobody was in a position to write at the time.

The rule **invents no threshold**, which is the whole point. It does not ask "has this been quiet for N minutes" — a number nobody could derive, and the hardcoded-constant-standing-in-for-a-measurement shape this project keeps finding. It asks a question with a definite answer at a moment when the answer is knowable: *is anything running this?*

**Both halves are load-bearing, and the second came from checking the live queue before designing rather than after.** A sweep keyed on the ledger alone would abandon a mission the API enqueued moments before this worker booted — work that is about to happen, not work that died. The pre-design check found 0 of the 26 in a live queue state, with a control proving the queue was reachable (155 completed jobs); it also produced the exclusion rule that makes the sweep safe.

The sweep reads the fleet through **the same projection the header uses**, not a second query. Two definitions of "running" is precisely what this defect was made of.

## Why this is safe to do automatically

**A mistaken abandonment is self-correcting.** Status is the last *status-bearing* event, and `mission.started` is in that set — so a mission that does run afterwards reads as running again. On an append-only trail that is the difference between a correctable mistake and a permanent lie, and it is why this needs no human confirmation step.

Making that true required widening the status fold in all three projections to include `mission.started`, not only the terminal events. The claim is asserted by tests in the fabric and the mission tree, and both are mutation-proven — dropping `mission.started` from the set kills them.

Fail-safe throughout, per the memory-fabric guardrail that a bootstrap scan must never throw out of the hook: **if the queue cannot be reached, the sweep does nothing.** Not establishing what is live is not the same as establishing that something is dead, and degrading to "abandon everything" would be far worse than the defect.

## `abandoned` is its own status, not a surrender

A surrender is a decision the system made and can explain; an abandonment is a death it can only notice afterwards. Collapsing them would tell an operator the system decided something it never decided. The badge is grey rather than red for the same reason: nothing went wrong with the *work*.

Consequences of the new value, each handled deliberately:

- **The learning loop skips abandoned missions**, exactly as it skips running ones. A mission that died because a container was killed has partial verdicts that are evidence about infrastructure, not about the work — feeding them to the learner would let a crashed process be ranked as a weak spot in a capability. This was caught by the type checker, not by the tests: the widened union broke `MissionIndex`, and the fix turned out to be a real semantic decision rather than a signature change.
- `MissionSummary`, `MissionStatus`, the API's `MissionSummary`, the requester view's `outcome` and `MissionIndex` all widened — five sites, which is itself the find-shape (k) warning that this union wants a single home.

## Evidence

```
before the sweep:  {"delivered":68,"surrendered":73,"running":26}
worker boot log :  "recorded 26 abandoned mission(s) from a previous run"
after the sweep :  {"delivered":68,"surrendered":73,"abandoned":26}   (total 167, unchanged)
second boot     :  no sweep line — the sweep fires once, not every restart
```

In Chrome via Playwright: **"167 missions · 0 running"**, rail badges tallying abandoned 26 / delivered 68 / surrendered 73.

And the live distractor that the old behaviour still works: a brand-new mission posted after the change ran intake → decomposition → staffing → execution → Gate B → **delivered**.

RED first; 6 killing mutants (sweep every status; ignore the queue; treat an unreachable queue as "nothing is live"; drop `mission.started` from the status set in the fabric and in the mission tree; collapse `abandoned` into `surrendered`).

## Bounds, stated rather than implied

- **The sweep proves "nobody is running this", not "this will never run".** A mission abandoned here can still be resumed by an operator; that is what the self-correction is for.
- **Its call site in `main()` is verified live, not by a test.** The function is unit- and mutation-tested, but nothing asserts that the deployable binary calls it — the exact shape of defect `04071ce9`. What stands in for that test is the boot log of the real worker and the live before/after above.
- The 9 missions that never emitted `mission.started` have no objective on the trail, so the rail shows their id. That is honest rather than a gap: nothing ever told the ledger what they were for.
