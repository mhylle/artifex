# 110 — A mission nobody is running is recorded as abandoned

**Date:** 2026-07-31
**Category:** code-change

**What:** The last open defect (`dd2e9d18`) is closed. The fleet header went **47 → 26 → 0 running**, verified in the real browser. **Four of five doneness pillars are now green** — phases, acceptance criteria, defects, completed-phase integrity — with all 41 requirements reading `satisfied`. Only the architecture-drift pillar remains red, for a re-verified tooling reason. ADR-0025.

**Why:** Find-shape (w): a state the system can enter but has no event to describe. Nothing writes an event when a worker is killed, so 26 dead missions sat at "running" while **zero** were in flight.

**Details:**

**The premise was checked against the live queue before anything was designed**, and that check did more than confirm the plan — it produced the rule that makes the sweep safe. Of the 26 missions with no terminal event, **0** were in a live BullMQ state, with a control proving the queue was reachable (155 completed jobs). But a sweep keyed on the ledger alone would abandon a mission the API enqueued moments before the worker booted — work that is about to happen, not work that died. So the rule needs both halves: **no outcome on the ledger AND no job on the queue.**

**No threshold is invented**, which was the whole point. The rule does not ask "quiet for how long" — a number nobody could derive, and the hardcoded-constant-standing-in-for-a-measurement shape this project keeps finding. It asks a question with a definite answer at the one moment the answer is knowable: *is anything running this?* At worker boot, a mission with no outcome and no job is owned by a process that no longer exists.

**Safe to do automatically because it is self-correcting.** Status is the last *status-bearing* event, and `mission.started` is in that set — so a mission wrongly swept reads as running again the moment it actually runs. On an append-only trail that is the difference between a correctable mistake and a permanent lie. Making that true meant widening the status fold in all three projections, and it is mutation-proven at two of them.

Fail-safe throughout: **if the queue cannot be reached, the sweep does nothing.** Not establishing what is live is not the same as establishing that something is dead.

**`abandoned` is its own status, not a surrender.** A surrender is a decision the system made and can explain; an abandonment is a death it can only notice afterwards. The badge is grey rather than red — nothing went wrong with the *work*.

**The type checker found a semantic decision the tests could not.** Widening the union broke `MissionIndex`, which turned out to mean: should the learning loop mine abandoned missions? No — a mission that died because a container was killed carries evidence about infrastructure, not about the work, and feeding it to the learner would let a crashed process be ranked as a weak spot in a capability. Caught by `npm run build`, then fixed RED-first with its own test.

**Outcome:**

814 + 183 + 71 + 54 + 26 unit and 172 memory-fabric integration, all green. RED first at every site; **6 killing mutants** this iteration (sweep every status; ignore the queue; treat an unreachable queue as "nothing is live"; drop `mission.started` from the status set, in the fabric and in the mission tree; collapse `abandoned` into `surrendered`).

**Verified by restarting the real binary, not by a harness:**

    before   {"delivered":68,"surrendered":73,"running":26}
    boot log "recorded 26 abandoned mission(s) from a previous run"
    after    {"delivered":68,"surrendered":73,"abandoned":26}   total 167, unchanged
    2nd boot no sweep line — it fires once, not every restart

In Chrome via Playwright: **"167 missions · 0 running"**, rail badges tallying abandoned 26 / delivered 68 / surrendered 73.

**And the live distractor that the old behaviour still works:** a brand-new mission posted after the change ran intake → decomposition → staffing → execution → Gate B → **delivered**.

That run also produced an observation worth recording honestly: it raised **only low-stakes questions and never blocked**. Earlier measurement found a high-stakes question in 8 of 8 trials, but that was two colour-naming inputs; this is a different input, n=1. The correct statement is therefore **usually, not always** — the earlier claim is narrowed, not overturned.

**The drift pillar, re-verified rather than trusted:** a fat scan reports `24 components / 7 scanned files · missing 0, orphaned 6, stale 0`, and all six orphans are `packages/dashboard/src/app/*` files — three of which were edited in this session with their tests green. `missing 0` is the tell: if the inventory were really the codebase, hundreds of files would lack a component. **The drift is in the measuring instrument.** The six references are true, and deleting them to turn the pillar green would be defect `cd18baa0` exactly.
