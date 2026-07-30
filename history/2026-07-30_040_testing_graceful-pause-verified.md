# 2026-07-30 · 040 · testing · The graceful pause, finally verified — by changing the instrument, not retrying the click

**What:** Closed R17 AC-1, the last open criterion on an otherwise-finished requirement: *"any worker already running finishes its current attempt rather than being killed mid-attempt — pausing is graceful."* No production code changed; this closed a **verification** gap, not a code gap.

**Why it had resisted:** Three separate browser attempts failed the same way, recorded as friction `63aff355`. A tier-1 task finishes faster than a click's round-trip, so the pause always arrived *before* the attempt started. That configuration demonstrates the opposite of the criterion — a pause preventing work, rather than a pause sparing work already in flight.

**How it was solved:** not a faster click, but a different instrument. The **latch** built for R32's concurrency tests — a `work` seam that blocks until released — holds one attempt open for as long as the test needs, so the operator's pause can be made to arrive *during* it. The same tool that proved two siblings were inside `work` simultaneously answers a completely different question here.

`packages/worker/src/mission-loop.pause.test.ts` pauses from inside the work seam itself, then asserts:

- the in-flight attempt still produced `task.executed` **and** a Gate B verdict — it was neither aborted nor discarded;
- `task.paused` followed at the **next** attempt boundary;
- `work` was called exactly once, so the attempt was not restarted;
- the trail still carries the completed deliverable, so a resume (R41) does not pay for it twice.

Two distractors keep it honest in both directions: a pause arriving *before* the first attempt must prevent execution entirely (so "never execute" cannot pass), and an unpaused mission must still deliver with the control seam genuinely consulted (so "always stop" and "never ask" both fail).

**Mutation checking mattered more than usual here.** All four tests passed on first run — the runtime's control check was already at the attempt boundary, exactly where gracefulness requires it — so there was no RED to trust. Three mutants, all killed:

| mutant | tests killed |
|---|---|
| re-check the signal *after* execution, discarding the completed attempt — the exact "killed mid-attempt" behaviour the criterion forbids | 2 |
| never ask the control seam | 4 |
| treat `paused` as `run` | 3 |

**Outcome:** R17 satisfied in full, phase P17 closed with its sub-tasks, friction `63aff355` resolved. 512 tests green.

The generalisable lesson is logged as its own insight: **when a UI route cannot reach a state, move the observation point to the seam and hold the state open — do not repeat the click hoping for better timing.** A criterion about timing or interleaving is usually unreachable from outside, because the UI cannot control when an internal boundary is crossed. What changes is where the claim is observed, not what is claimed — and the distractors plus the mutation pass are what stop that from becoming an excuse.

One honest note recorded on the phase: AC-1 is the single exception to this project's browser-verification rule, and it is marked as such rather than quietly counted as a UI-verified criterion. Everything else in R17 — pause, resume, cancel, budget grant, dial turn — was driven through the cockpit against the live local stack.
