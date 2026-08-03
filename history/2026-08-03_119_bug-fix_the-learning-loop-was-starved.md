# 119 — The learning loop was starved at its root

**Date:** 2026-08-03
**Category:** bug-fix

**What:** An audit for the same shape as the Gate B feedback gap found a worse one: **a mission the gate keeps whole could never bank a replay-bench case**, so the sealed bench stayed permanently empty — and the sealed bench is the ground truth the science loop validates candidates against, amendment petitions are evaluated on, and reviewer calibration draws its probes from. Fixed and proven live: `banked 1 bench case(s): sealed`.

**Why:** The owner's point that retries alone will not solve a task, and that *"this is where the learning part of the system is supposed to come in and help improve, so that we can do multiple iterations and learn from each"*. It could not, and this is why.

**Details:**

**The audit, measured against the live ledger rather than the code.** Every event type, every learning store, every accumulation:

    learning stores after 3 missions
      4  agent_design            (accumulating — 'mission' at 3 observations, the evidence bar)
      1  knowledge_entry
      0  benchmark_case          <- the bench
      0  benchmark_case_open
      0  decomposition_template
      0  agent_design_delta

**The learner diagnoses correctly.** `learning.weak_spots_ranked` carried real content — *"2 mission(s) surrendered in this category; compliance is 0/1 (0%) — below the 75% the category is expected to hold; 7 escalations across 1 verdicts — an escalation hot spot"*. It sees the problem precisely. What it could not do was validate a fix, because there was nothing to test against.

**The cause.** `casesFromTrail` banks a case only with a contract, a deliverable, and a passing Gate B verdict — and it read the contract off `task.contracted`. A mission the decompose-or-delegate gate keeps **whole** never contracts a child: it executes at the mission task, whose contract came from intake. Every kept-whole mission was therefore silently skipped. Live confirmation: 1 delivered mission, 0 bench cases, and the executing task never appearing in any `task.contracted`.

This is the third instance of one shape — a mechanism written when every mission decomposed, silently excluding the kept-whole case. `dd2e9d18` was the same thing in three status projections; entry 116 was the same thing in the deliverable.

**The first fix was wrong, and the live run caught it.** It read the contract from `mission.intake_accepted` on the trail. The tests passed. The live mission banked nothing — because **that event is recorded by the control plane, and the worker never appends it**, so it is on the ledger and absent from the trail this walks. A fixture that supplies an event production does not produce proves only that the fixture is generous. The contract is now passed in explicitly from the job, and the fixture no longer contains an event the worker cannot emit.

**Outcome:**

834 worker (+3) + 250 dashboard + 58 api + 71 + 54 + 26 green; all six workspaces build.

Proven live end to end: a mission posted, blocked at intake, answered through the cockpit, delivered — and the worker logged **`banked 1 bench case(s): sealed`**, with `benchmark_case` holding one sealed row where it had held none through every mission before it.

**What this does and does not do.** It restores the supply the learning half needs: with a sealed bench, the science loop can test a candidate, a petition can be evaluated against known answers, and reviewer calibration has probes to plant. It does not by itself make the next mission better — one case is not a bench, and whether accumulated cases actually improve outcomes is unmeasured and should stay that way until there is data.

**Still open, recorded rather than fixed:** `decomposition_template` is still 0 (R31 AC-2's learned recipes have never fired live), `agent_design_delta` is still 0 (no redesign has been recorded), and `ledger-evidence.ts` reads the budget ceiling from `task.contracted` too — so a kept-whole mission contributes no budget-versus-value signal to the weak-spot ranking. That last one is the same shape again and is the next thing to fix.
