# 2026-07-30 · 042 · code-change · The Asset Registry's ratchet — assets advance one validated delta at a time

**What:** Built R23. The Asset Registry now records every proposed change as an itemized delta keyed to the ledger evidence that justified it, advances only on measured improvement, and keeps retired assets searchable.

**Why the starting point was not what the plan assumed:** a partial Asset Registry already existed — versioned agent designs, clade scores, `bestForCategory`, `recordOutcome`, `deactivate`. Orienting rather than trusting the roadmap showed that **none of R23's three criteria actually held**:

- `upsert` was a **wholesale rewrite** — it overwrote instructions and capabilities together and bumped the version, with no link to any evidence (AC-0 asks for an itemized delta keyed to ledger events).
- There was **no ratchet at all**; any proposal was accepted (AC-1).
- `deactivate` set `active = false` while `bestForCategory` filtered `active = true`, so a retired design was not down-weighted, it was **excluded** (AC-2 asks for it to remain retrievable at reduced weight).

**Details:**

Migration `0004_asset_ratchet.js` adds `agent_design_delta`: the itemized `changes`, the `justified_by` ledger event ids, both scores, both simplicity measures, the outcome, and the reason. Two rules are enforced as **database constraints rather than conventions**, matching how the ledger enforces append-only: `outcome IN ('adopted','reverted')`, and `justified_by` must be a non-empty array — *only measured wins enter*.

`proposeDelta` is the ratchet, and it runs in one transaction with `SELECT … FOR UPDATE`. Two concurrent proposals against one asset would otherwise both read the same incumbent and both adopt — two deltas at a time, which is exactly what a ratchet forbids.

Four decisions worth recording:

1. **A reverted delta is still written.** A ratchet that forgets its rejections cannot explain why an asset stopped moving, and the Learning Agent would re-propose the same losing change forever.
2. **An unproven incumbent is not a tie.** Treating a null clade score as zero would invent evidence; treating it as unbeatable would freeze every new design at its first draft. It adopts, and the recorded reason says why.
3. **Simplicity is derived from the asset** — instruction length plus capability count — rather than declared by the proposer, who would otherwise simply assert that their change is simpler.
4. **"Reduced weight" is expressed as ordering, not a multiplier.** `search` returns retired designs ranked below every active peer whatever their scores. A multiplier would be a number the evidence cannot justify, and this project does not invent constants.

**Verification.** 12 new tests, all against a real PostgreSQL — a ratchet that only holds in memory is not a ratchet. **52 integration tests green**, 521 unit tests green. The tests passed on first run, so the mutation pass was the only real check; six mutants, each killed by exactly one test:

| mutant | killed |
|---|---|
| equal adopts (the ratchet turns on a tie) | 1 |
| simplicity tie-break removed | 1 |
| wholesale rewrite — unnamed fields blanked | 1 |
| search excludes retired designs | 1 |
| search ignores retirement in its ordering | 1 |
| unproven incumbent treated as zero | 1 |

**Outcome:** R23 satisfied, P23 closed — with two things stated plainly rather than glossed.

**This requirement has no browser evidence.** Nothing in Mission Control reads the Asset Registry, so its criteria are verified at the database. That is a real exception to the project's UI rule and is recorded as one.

**And the registry is currently inert** (defect `41f7555c`, high). The read path has a genuine consumer — `agent-creator.ts:99` calls `bestForCategory`, so reuse-first staffing is really implemented — but `runtime.ts:262` stubs it to `null`, and nothing calls `recordOutcome`, `proposeDelta` or `search` outside tests. Wiring the read alone would achieve nothing, which is why it was not done as a token gesture: `bestForCategory` requires `observations >= 3`, and with no outcome recording it would return `null` forever. The two halves land together in R28 (clade scores, where an outcome is recorded after Gate B) and R38 (the reuse market, where the composition root is wired). The browser evidence this requirement cannot yet produce is a second mission in the same category reusing a proven design, visible as the same `designId` and version twice in the workforce lens.

One correction to the plan carried forward: **R23 does not unblock R31 AC-2.** That criterion needs *decomposition templates*; this registry stores *agent designs*. Template storage remains unbuilt and defect `68f6c31c` stands unchanged.
