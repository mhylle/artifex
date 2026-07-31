# 082 — The registry offered the planner roles it assigns itself, and the model pasted the offer back

**Date:** 2026-07-31
**Category:** bug-fix

**What:** `knownCapabilities()` returned every `agent_design` row — including the `verification.` namespace and the `mission` role — to both `staff()`'s resolver and the planner's naming guidance. Added `proposableCapabilities`, filtered at both consumers, moved the two structural names into `@artifex/shared-types` so the API and the worker cannot drift apart, and taught `capabilityOf` to treat a semicolon like a slash. Then re-measured defect `ad116ead` and found its proposed fix is wrong.

**Why:** Iteration 66 started showing the registry to the planner, and iteration 67's probe of the ledger turned up two categories that were literally chunks of the suggestion sentence. Chasing the writer found something larger than a data-quality bug.

The registry stores every design it has ever staffed. Two of those categories are written by Artifex, not proposed by anyone: `verification.<capability>` by `verifierCapabilityOf`, and `mission` by the API at intake on task zero. Measured live, they were not a rounding error — 11 of 35 stored categories were verification capabilities, and the single highest-observation entry was the mission role with 57. Since `resolveCapability` returns the first candidate sharing any token and the registry orders by observations, the mission role was tried first on every staffing decision, and a producer's proposal could be resolved onto a verification capability — hiring the design that exists to check the work to do the work. The planner, meanwhile, was being invited to name a subtask `mission` or `research.dogfood.1785397657889`.

**Details:**

The filter is not a hand-written blocklist of observed junk; it is the two places the code writes a category itself, each derived from the constant that writes it. `MISSION_CATEGORY` and `VERIFICATION_CATEGORY_PREFIX` now live in `shared-types/src/common.ts` and are used by `verifierCapabilityOf`, by `proposableCapabilities`, and by the API's intake service — a literal in each package would let a rename pass silently, which is the shape that produced `340aa7de`.

The paste is handled at the normaliser. `planner.ts` renders the list as a `'; '`-joined sentence, and the model copied part of it into `category`; the ledger holds `scientific writing; verification.scientific_writing`. Cleaning the list removes the `verification.*` half of that specific paste but cannot stop pasting, so `capabilityOf` now takes the first segment on `/` **or** `;`. A category naming several capabilities is a paste, and the planner's first answer is the one it meant.

The composition matters more than the function: a pure function's own tests cannot see whether anything calls it. Both consumers are asserted against a registry returning the live shape (mission role first, a verifier in the middle). The planner-side test initially proved nothing — the calibration fixture's decomposition gate answers `keepWhole: true`, so the planner was never called and the captured list stayed `undefined`. The `toBeDefined` guard caught it; without that guard the real assertion would have run against nothing and looked green. Recorded in the test: the test was wrong, not the loop.

11 mutants, all killed: dropping either half of the filter (5 fail each); loosening either match from prefix/equality to substring; re-sorting instead of filtering, which would destroy the observation ordering that IS the evidence tie-break; falling back to the raw list when the filter empties it; removing the filter from `staff()`; removing it from the loop; and losing the semicolon rule, the slash rule, or first-segment order in `capabilityOf`.

**Outcome:**

677 worker tests (up from 662) + 160 + 66 + 50 + 26 green; all six workspaces build. Live, after restart: the registry's 35 categories become 23 proposable, and a fresh mission staffed five agents all under `technical writing` — no paste, no structural role.

The re-measurement is the more valuable half, and it kills the plan this iteration was supposed to set up. Defect `ad116ead` proposed running the historical fallback through `resolveCapability`. Re-measured against the cleaned list, that gives `raw=105 → normalised=90 → resolved=57` — and the merges are wrong: `hand tools overview` absorbing `Rail Travel Overview` and `Kitchen Tools - Whisk`, `mechanical engineering` absorbing `Marine Engineering / Sailing Basics`, a maintenance-analysis bucket swallowing `Analytic Number Theory` and `Comparative Analysis / Culinary Logic`. Merging on the tokens `analysis`, `overview`, `engineering`. That bias is defensible when staffing one proposal at a time and catching mistakes downstream at the evidence bar; it is not defensible in a ranking whose entire output is a claim about which capability is weak. It would have arrived looking like a 46% improvement.

The second candidate was measured and also fails: `agent.staffed` carries `designId`, and joining to the design's registered category gives 81 raw buckets → 22, but 140 of 220 staffings have no registry row (100 ledger design ids against 37 rows). Every orphan was first seen on 2026-07-30, under the old `designIdFor` scheme that mixed in the task id — historical, not a live registration failure, and still two thirds of the history discarded.

`ad116ead` is rewritten around a strict-evidence ladder instead: the event's own capability, then the design's registered category, then normalisation — every rung something actually recorded, with semantic resolution explicitly rejected as a guess. Honest ceiling: 105 → 90.

One new defect from the live run, `e34d178e`: `resolveCapability` normalises the proposal but compares against RAW registry categories, so `writing` never matches `Writing`. Today's mission was staffed correctly *because of* that case mismatch, not because of the rule — 8+ capitalised historical rows are unreachable for reuse. Filed low, because new rows are always normalised, and filed with an explicit warning not to fix it alone: symmetrising the comparison without tightening the token rule makes the over-merge above worse.
