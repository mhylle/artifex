# 115 — Restating continues the same mission

**Date:** 2026-08-02
**Category:** code-change

**What:** A surrendered mission can now be **restated in place**: edit the criteria it is graded against and it continues on the same trail, same mission id. Proven live on the owner's stem-cell mission, which went from twice-rejected by Gate A to **delivered** — and the fleet still holds exactly one mission.

**Why:** The owner corrected yesterday's fix. It had offered "Retry with what we learned", which started a **new** mission carrying `priorMissionId`:

> *"it should not create a new mission. we should be using the same mission, but continuing with what we learned. creating a new mission is a waste and gives us too many missions."*

They were right, and the reasoning is architectural rather than cosmetic. The ledger is already the checkpoint a mission resumes from (R41), and a mission is task zero with one contract and one trail. Minting a second mission for a reworded criterion split one piece of work across two trails and grew the fleet by a row every time — on a system the owner had just cleaned precisely because it held too many missions.

**Details:**

**A restatement is an event, not a new commission.** `restate` joins the cockpit actions, recording `operator.restated` in the **`contract`** family rather than `decision` — it changes what the work is graded against, which is a contract event in the taxonomy, not a ruling about one.

**The last restatement wins, and is merged rather than substituted.** The ledger is append-only, so the amendment does not rewrite the intake event: the resumer reads the trail, takes the most recent `operator.restated`, and merges it over the commissioned contract. That is the same rule the fleet projection already uses for status (ADR-0024). Merging matters — a restatement names the criteria and must not silently blank the budget, boundaries or dial the mission was started with, which has its own distractor.

**The subtle half: a restatement invalidates the plan that preceded it.** On resume the loop recovers the prior task tree and does *not* re-plan — right for a mission that was merely interrupted, wrong for one whose specification just changed. Without this the mission would resume the very plan Gate A rejected and be rejected again for the same reason. So `foldPriorTrail` clears contracts, children and verdicts when it walks past a restatement.

What it deliberately does **not** clear: `decided`, `carried` and `escalatedAssumptions`. Those record what a human already answered, and wiping them would send a restated mission back to a question the operator has settled. That has its own distractor too.

**Criterion ids are preserved.** The coverage partition traces a mission criterion to the task holding it by exactly that id, so renumbering would quietly make the restated criterion a different one. A criterion the operator *adds* gets a fresh id.

**Who may restate.** Both the operator and the **requester** (R22). The audience file already drew the line — a requester gets the powers intake promised them and not pause/cancel/annotate, because those are controls over *how* the work is done. Restating changes *what was asked*, which is the requester's own contract. An observer may not.

**Outcome:**

819 worker + 217 dashboard + 58 api + 71 + 54 + 26 green; all six workspaces build.

**Verified end to end in the browser on the owner's own mission.** The criteria box was pre-filled with their original wording (typos and all), it was replaced with *"Lists exactly 3 named algorithms usable for stem cell research, each with a one-paragraph description of what it does"*, and:

    resuming from 20 recorded events
    operator.restated → mission.started → decomposition.decided → agent.staffed
      → task.executed → verifier.staffed → gate_b.verdict_issued → mission.delivered

**28 events, one trail, one mission in the fleet.** The deliverable names three algorithms — iPSC differentiation via Yamanaka factors, SCiP, CRISPR-Cas9 guided differentiation mapping — each with its description, which is exactly what the restated criterion asked for. Gate A had failed that mission twice before.

**Removed rather than left dead:** yesterday's `priorMissionId` path in the dashboard — the draft field, the service wire and its two wire-level tests — because the UI no longer has any route that sets it. The API keeps its support (it is R37 AC-2 and pre-existing), and is now again without a UI caller. That is recorded here rather than pretended away: it is the same find-shape (l) this project keeps meeting, and leaving dead code for a rejected design would be worse.

**Two process notes.** I inlined a Python script containing backticks into a bash command and the shell ate them — the second time today, against my own written rule to use the Write tool for scripts. And one RED run failed with a `ReferenceError` on a variable scoped to a different `describe`; by this project's own rule that means the *test* is wrong, so it was fixed rather than the code, and given a control that asserts the interrogator was never consulted.
