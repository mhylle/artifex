# 121 — Six faults between a contract and a deliverable

**Date:** 2026-08-04
**Category:** bug-fix

**What:** Six defects on the path from an accepted contract to a usable artefact, five of them found by running the system rather than by reading it. Mission `ef7b7b75` went from *surrendering at intake* to *producing the requested pseudocode*; it still fails Gate B, and the reason it fails is now a model-capability limit rather than an architecture fault.

**Why:** The standing complaint was that the system diagnoses its own failure and then does not act on the diagnosis. That turned out to be true in three separate places, none of which was the retry channel everyone suspected.

**Details:**

**1. The token bound was raised on the wrong helper.** `runtime.ts` has *two* `gen` helpers — `createCandidateSeams` (the bench) and `createMissionSeams` (production). `DELIVERABLE_TOKENS` was threaded into the first; the work probe lives in the second. **The compiler found it, not a test** — `Expected 3 arguments, but got 4` — after the suite had gone green 845/845. The prior claim that the truncation fix was live was wrong.

Fixing it exposed a second fault of the same shape: the bench probe uses the same `AnswerSchema` and the same work framing as production, so leaving it on the 4096 default meant **every candidate was graded on answers truncated at a length production never truncates at**. `experimentPlan` already refuses an uneven split because "a different bench is a different exam"; the token bound is part of that exam. Both now use `DELIVERABLE_TOKENS`; judges keep the tight default, which is what turns a small model's runaway into a fast attributable failure.

*Live:* the earlier Gate B red flag — *"the 'sections' part of the JSON object is truncated/incomplete"* — did not recur in any of five runs.

**2. R28's ratchet had no production caller.** `AssetRegistryRepository.proposeDelta` — score and simplicity against the incumbent, row-locked, every outcome written to `agent_design_delta` — was complete, correct, and reached by nothing but its own tests. The science loop appended `learning.candidate_evaluated` for an adopted candidate and **stopped there**, so `agent_design_delta` was empty after every mission and no measured win had ever changed a design. Seventh instance of find-shape (l) this session.

Nothing had to be invented: a hot-fix already names `targetAssetId` and `patchedValue`, and the bench already produced the score. `adoption-ratchet.ts` maps between them; `index.ts` calls it and records `learning.design_delta_proposed`, including a `refused` outcome when the ratchet throws — most often R28 AC-2 legitimately declining a design with no validation harness. **A degrade that is not recorded is indistinguishable from a clean result.**

Not yet observed live: no resolved hot-fix candidate has been produced since (`window closed with no observations`). The path is wired and unit-proven; it is state (3) — *reachable but not yet observed*.

**3. The result had no lens.** The new event would have landed on the ledger with nothing showing it — find-shape (o), caught in the same change rather than a later sweep. `DesignDeltaView` + a "Registry ratchet" panel. The percent is rounded **in the lens**, not the template, because a rule in a component expression cannot be mutated.

**4. A missing field returned 500 instead of the sentence that explains it.** `request.operator.trim()` read the field before checking it existed, so a control POST that used `actor` (the name the *ledger event* uses) crashed the endpoint. The guard's own message — "a cockpit action must name the operator performing it" — was unreachable in exactly the case it was written for. Find-shape (h).

**5. A restatement blanked every specialist.** The resumer spread the whole `operator.restated` payload over the contract. That payload carries the operator's `note`, the worker view forbids undeclared properties, and so:

    specialist refused the contract: it is not a worker view — /note: unexpected property

Three staffings, three refusals, ladder exhausted, **no task executed**. The comment above the spread already said a restatement "must not silently blank the budget, boundaries or dial"; the spread implemented none of it. Now an **allow-list** (`objective`, `acceptanceCriteria`) in `restated-contract.ts` — extracted from the provider factory it used to live inside, because a rule that cannot be tested is how this shipped.

**6. The planner was graded on a rule nobody told it.** Gate A demands "exactly one responsibility with one verifiable outcome". That sentence lives in `reviewer.ts` and in comments — **never in the planner's prompt**, which asks only for subtasks that are INDEPENDENT, DISTINCT and COVERING. Those are different properties: a split can be perfectly distinct and covering while every leaf bundles three jobs. Gate A said so twice on one mission, including on the re-split that was handed the first rejection verbatim:

    "Researching data and composing a document are two distinct responsibilities."
    "…a 'research and define' compound task rather than a single unit of work."

The bar is now in **both** planner probes. The count probe needs it as much as the outline: a model that does not know leaves must be single-responsibility picks too few of them.

**7. The retry answered the reviewer instead of the task.** The retry channel worked — `priorFindings` reached the work seam — but the instruction after it was *"Fix what is named above before anything else"*, and a tier-1 model read "fix" as naming the **deliverable**. It returned critique of an attempt the reader had never seen. Now: write it again, from the beginning, in full; the points are faults to avoid, not a list to reply to; do not describe, critique or revise the previous attempt. No example phrasings — the rule is stated structurally.

**Outcome:**

861 worker (+16) · 254 dashboard (+4) · 67 api (+7) · 71 · 26 — all green; six workspaces build. 17 mutants across the five new suites, **all killed**. Two RED runs were wrong before they were right (a constant that was never exported, so `toBe(undefined)` compared undefined to undefined; a planner fixture with no `acceptanceCriteria`) — both caught by the run, not by review.

**Live, on one mission carried forward by restatement rather than replaced:**

| run | outcome |
|---|---|
| before | surrendered at intake |
| after answering intake | Gate A rejected the split twice |
| after the `note` fix | Gate A **passed** on the re-split |
| after the planner fix | executed twice, both judged |

Attempt 1 returned `"ACCEPTANCE CRITERIA NOT MET / Reason: … / Revision: …"`. Attempt 2, under the new retry framing, returned:

    PROCEDURE: iPSC_TO_CARDIOMYOCYTE:
    1. INITIALIZATION SETPOINT — Verify presence of Oct4, Sox2 …
    3. EARLY LINEAGE SPECIFICATION — If Nkx2-5 levels rise >10-fold AND …

Numbered stages, decision rules, observable signals — the artefact the contract asked for, from the same model on the same task.

**It still fails Gate B, and that is the honest part.** `redFlags: ["None"]` — nothing structurally wrong — but the intent judge refused it because the biology is wrong (`Early_Growth_Auxin` is a plant hormone; `Nap-c` is not a marker). That is `qwen3.5:2b` being a 2-billion-parameter model asked about cardiac differentiation, caught by the gate that exists to catch it. **The architecture now delivers the right KIND of artefact and correctly refuses a wrong one.** Making the content right is a model-tier question, not a defect.
