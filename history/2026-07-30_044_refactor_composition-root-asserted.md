# 2026-07-30 · 044 · refactor · Registration stops pretending to be a ratchet, and the composition root becomes testable

**What:** Two fixes that both came out of the previous iteration's live run rather than from the plan — defect `fe690036` (registration bumping the version) and the friction that no test could assert what the worker binary wires.

## Registration is idempotent, and never overwrites an incumbent

`upsert` carried `version = agent_design.version + 1` on conflict. Once staffing began registering every design it authored (R38), an unchanged design was re-registered on every no-bid: five identical live missions moved one design **v1 → v2 → v3** with no delta, no evidence and no measurement — precisely what R23's ratchet exists to prevent, and it made `version` useless as the key a clade score is attributed to.

The fix went further than "stop bumping". A conflict now changes **nothing at all, not even the content**: `ON CONFLICT (design_id) DO NOTHING`, then read the row back. A no-bid that authored *different* instructions for a category that already holds an asset must not silently replace it — that is a wholesale rewrite with no evidence, which R23 AC-0 forbids. The only route to changing an existing asset is `proposeDelta`, which carries a measurement and records why.

The read-back fixes the second half too: `staff()` reported a hard-coded `version: 1` for anything it authored, so the ledger recorded a version that had never done the work. `register` now returns the stored version and `staff()` reports it.

**Live evidence.** After the fix, another mission in the same category staffed `6e25f754` and the registry read:

```
6e25f754-bd1d-4059-8ab9-dc1d668f534d | version 3 | observations 7 | clade 0.86
```

Version held at 3 while observations kept accumulating. Before the fix, each run bumped it. The `agent.staffed` event now reports v3, so ledger and registry agree.

## The composition root, asserted

`main()` built its dependencies inline and then started a BullMQ consumer, so nothing could test what it wired without booting a worker. That made `index.ts` simultaneously the least-tested file in the repo and the one where a single missing argument disables a whole feature — not hypothetically: the Asset Registry was a null-bidding stub for the project's entire life (defect `41f7555c`) with every suite green.

Assembly now lives in `worker-seams.ts` as an exported `buildWorkerSeams(deps, missionId)`. Dependencies are named structurally (`AssetStore`, `ControlReader`), so the worker still binds no database driver.

**The mutant that motivated this now fails properly.** Last iteration, passing no registry produced only `TS6133: 'assets' is declared but its value is never read` — incidental, and it would have compiled silently had `assets` been referenced elsewhere. It now fails **4 tests**.

| mutant | tests killed |
|---|---|
| registry not passed (the original) | 4 |
| `register` returns void instead of the stored version | 1 |
| control seam replaced by a permanent `'run'` | 1 |
| `main()` reverts to an inline null-bidding stub | 1 |

That last mutant matters as much as the rest: extracting an assembly the binary does not use would recreate `04071ce9`, where the logic was proven end to end while the deployed process was still a placeholder. A test reads `index.ts` and asserts it imports `buildWorkerSeams` and no longer contains the inline stub. Crude, but it is what makes the other seven tests mean anything about what ships.

**Verification.** 11 new tests, **541 green** (55 integration). Both defects resolved.

## A pattern worth naming

**For the second iteration running, an existing test had a defect written into it as a requirement.** Last time it was "two no-bids in the same category produce different design ids"; this time "upsert bumps the version on re-registration". Both were rewritten in place, preserving the intent stated in their own describe block — *don't adopt an incumbent's identity*, *don't create a second row* — with the change explained where a future reader will find it, rather than the test being deleted.

The tell in both cases was the same: the test asserted a *mechanism* where the describe named a *property*. When those two disagree, the mechanism is the thing that has drifted.
