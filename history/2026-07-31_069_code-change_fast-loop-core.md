# 2026-07-31 · 069 · code-change · The fast loop's core, guard and store — bounds derived, reach bounded three times

**What:** R26's decision core (`fast-loop.ts`), its constitutional guard (`checkFastLoopReach`) and its store (migration 0008, `hot_fix`) are built and proven. Decision recorded as ADR-0013. Phase P26 created and linked. **R26 is not satisfied** — see the outcome.

**Four bounds, none of them invented.**

- **"Repeatedly"** is the contract's own `stoppingConditions.stallLimit`, already the system's answer to "how many times is repeatedly?" (R36's stall counter asks the same question about attempts). A second number would be two answers to one question.
- **The evaluation window** is the number of observations the baseline rests on, so before and after are compared over equal evidence.
- **The prediction** is the rate the same category already achieves on its *other* criteria — falsifiable and measured, not chosen. Peers are pooled rather than averaged per criterion so a one-observation criterion cannot outvote a thirty-observation one (R28's weighting argument). With no peers it degrades to "strictly better than baseline" and *says so* via `basis`; the store refuses a `peer_criteria` prediction that isn't strictly below its baseline and a `strict_improvement` one that isn't equal, so neither can smuggle in a number.
- **No significance threshold at all.** AC-1's revert condition is "does not move", and any magnitude attached to that would be a constant with nothing behind it.

**A hole the tests found, not the design.** A window that closes only by *filling* never closes once the patched category stops appearing — so the hot-fix would outlive the mission that made it, the one outcome AC-1 exists to prevent. The window now also closes when the mission ends, and an under-filled close reverts. The first version of that test drove the wrong input; fixed at the test, and recorded in it.

**The revert bar is the baseline, not the prediction.** Reverting a fix that moved the rate but fell short of an ambitious prediction would discard a real improvement, and AC-1 doesn't ask for that. The prediction still earns its keep: a fix that improved without reaching it is exactly the partial result R27's science loop turns into a hypothesis.

**Reach bounded three times, in three places that fail independently** — the type (`layer` is the literal `'worker'`), an allow-list guard, and CHECK constraints on the store. AC-2 says "by construction, not by convention", and a rule that holds because every call site remembers it is a convention.

**Two masking failures, both found by mutants rather than review** — the second consecutive entry to record this shape:
- A **blocklist** guard (`refuse meta and core`) survived all 27 worker tests, because the `kind` check refused the fixture before the `layer` check was ever reached. The distractor now uses an unknown layer with a *permitted* kind — the Orchestrator's role instructions.
- Making **`previous_value` nullable** survived all 127 integration tests, because every fixture supplied one. That column is the entire reason a revert needs no human, so the store must *refuse* the row rather than merely never receive it.

**A NUL byte got into the source** from a bash heredoc — `${o.category} ${o.criterionId}` became `${o.category}\x00${o.criterionId}`, invisible in every editor. The composite key is now `JSON.stringify([...])`, which is unambiguous regardless of what a category or criterion id contains. Third time a heredoc has corrupted a TS template literal in this project.

**Verification.** 27 worker unit tests + 19 integration tests added. 22 mutants run, 22 killed (two only after fixing the masked distractors above). 537 worker + 128 memory-fabric integration + 156 + 66 + 50 + 26 green, full workspace build.

**Outcome:** the pieces exist and are proven; **nothing calls them**. Logged as defect `188c6892` (high) against my own work at the moment of creation rather than leaving it to be discovered later — a deferral that is not an unsatisfied requirement in the system of record is invisible to the doneness gate, which is the `cd18baa0` failure shape. R26 stays unsatisfied until the mission loop fires the fast loop and a live mission shows a hot-fix applied and auto-reverted.
