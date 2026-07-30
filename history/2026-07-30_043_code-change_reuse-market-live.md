# 2026-07-30 · 043 · code-change · The reuse market goes live — "reuse first, creation second" was broken at three points

**What:** Built R38 AC-1. The Asset Registry now actually influences staffing: a design authored on a no-bid is registered, Gate B's verdict folds into its track record, and once the evidence bar is met the next task of that kind **reuses** it instead of authoring a fresh specialist. Resolves defect `41f7555c`, which recorded the registry as correct but inert.

**Why it needed three fixes at once.** Reading the code rather than the roadmap found the reuse path broken at three independent points — any two fixed alone still leaves a system that always authors a fresh agent:

1. **`designIdFor` derived the id from `contract.taskId`**, so every task minted a different design id even within one category — while its own comment claimed it derived from the category. The registry could have filled with a hundred one-observation rows and never reached the evidence bar for any of them.
2. **A newly authored design was never persisted.** Nothing could ever bid, because nothing was ever registered.
3. **No outcome was ever recorded**, so `bestForCategory`'s bar (`observations >= 3`) could never be met however much the registry held.

That is why wiring the read path alone was refused as a token gesture in the previous entry: it would have returned `null` forever.

**Details:**

- The design id is now an FNV-1a hash of the category, laid out as a v4-shaped uuid. A hash rather than a lookup table because the taxonomy is **open** — categories are proposed by the planner at runtime, so nothing can enumerate them ahead of time.
- `staff()` registers what it authors, with failure swallowed: the registry is a cost lever, not a dependency, and a fabric outage must degrade the swarm to "always author" rather than stop it working.
- The mission loop folds Gate B's verdict into the track record — **pass = 1, fail = 0**, derived from the verdict rather than invented, because that verdict is the only measurement of a design the system actually has.
- `createMissionSeams` gained a `registry` parameter; `index.ts` passes the real `AssetRegistryRepository`.

**One existing test had encoded the defect.** `agent-creator.test.ts` asserted that two no-bids in the same category produce *different* design ids. Its real intent — a no-bid must not silently adopt an incumbent's identity — is preserved and now asserted directly; the per-task uniqueness clause was the bug written down as a requirement, and the rewrite says so in place.

**Verification.** 9 new tests, **533 green**. Mutants: design id back to task-derived (3 tests), authored design never registered (14), reuse resetting the version to 1 (2), every category collapsing to one id (1), Gate B outcome never recorded (1).

**Live evidence — five identical missions**, "Explain what a bicycle bell is for", against real Ollama and Postgres:

| run | design | version | how |
|---|---|---|---|
| 1–3 | `6e25f754` | v1 | authored on no-bid, all landing on **one** registry row |
| 4 | `6e25f754` | **v3** | **reused** — the evidence bar was met |
| 5 | `6e25f754` | v3 | reused |

Browser-confirmed in the workforce lens: `6e25f754-bd1d-4059-8ab9-dc1d668f534d v3`, 100% compliant.

**Two things this surfaced, logged rather than folded in:**

**`upsert` bumps the version on every re-registration** even when nothing changed (defect `fe690036`). Runs 1–3 moved the row v1→v2→v3 while registering identical content — three advances with no delta, no evidence and no measurement, which is exactly what R23's ratchet exists to prevent. It also makes the version useless as a join key for clade scores, and `staff()` compounds it by reporting `version: 1` without reading back what was stored, so the ledger and the registry disagree.

**The composition root is untested** (friction logged). The "unwired input" mutant — `index.ts` passing `undefined` instead of the registry — produced only `TS6133: 'assets' is declared but its value is never read`. That is incidental: had `assets` been used elsewhere, the mutant would have compiled cleanly and no test would have failed, while the entire reuse market silently reverted. Only the manual live run catches it today. The fix direction is to extract seam assembly out of `main()` so it can be asserted without starting a worker.

**R38's other three criteria remain open** — clustering into capability categories (AC-0), typed building blocks plus effort scaling (AC-2), and the systematic-no-bid surrender signal (AC-3) — as does all of R28. R38 stays `draft`.
