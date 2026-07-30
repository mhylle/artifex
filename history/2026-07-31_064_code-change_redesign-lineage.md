# 2026-07-31 · 064 · code-change · The rung that did nothing — `agent_redesign` finally redesigns

**What:** Found and built the missing producer for design lineage. R28 AC-0 is **not** claimed; the reason is at the bottom and it is about evidence, not about the code.

**The find.** R28's clade score is an observation-weighted recursive CTE over `parent_design_id`, and AC-0 could never be satisfied because **no design had ancestors**. Tracing why: `reparent` was called only from its own test, and `AssetRegistryRepository.upsert` had accepted and persisted `parent_design_id` all along — **the column was always writable; nothing ever supplied it.**

The producer was already in the vocabulary and did nothing. `agent_redesign` is a rung of the escalation ladder — it is even in the real intake ladder that every mission gets — and grepping the worker found no site that enacted it. The loop climbed past and staffed the same design again. Find-shape (d) once more: a name in the taxonomy with no behaviour behind it.

**Enacting it is exactly where lineage is born.** A redesign is by definition derived from the design that failed:

- `staff({ redesignFrom })` **never reuses** an incumbent. Every other rung changes who or how much runs; this is the one that changes the *design*, so reusing would leave the rung doing nothing — which is what it did before.
- The new id derives from the parent's (`capability#redesign-of-<parent>`). `designIdForCapability` is deterministic per capability, so without this a second design for the same capability would land on the parent's own id and the lineage would be a **self-edge**. Deriving keeps it deterministic, so the same redesign of the same design always lands on the same id and a replay stays faithful.
- Registration carries `parentDesignId`, explicitly `null` for an origin rather than absent — the registry stores "this is an origin" instead of leaving the column to whatever a previous write happened to put there.

**Two mutants worth the round.** A redesign that reuses the incumbent anyway (three tests), and — more interesting — ordinary staffing that *acquires* a parent (four tests). The second matters because inventing lineage is worse than lacking it: the clade query would aggregate it as though it were real, and a design would inherit a track record it never earned.

**Why AC-0 is not claimed.** The rung is in the real ladder at index 2, and the live mission run to exercise it only climbed to index 0 before finishing — `parent_design_id` went 0 → 0. A mission must fail Gate B three times to reach it, and the reliable Gate-B-failure objective delivered after two. So: proven at unit level, reachable in principle, **not observed live**. `cb939996` records exactly what would close it — a live climb to the rung, the count moving off zero, and a clade score computed over a real two-generation lineage.

**Verification.** 6 tests, 4 mutants killed, 495 worker + 66 green, full workspace build, live before/after count on the real database (which is what showed the gap rather than hiding it).

**Outcome:** the producer exists and is proven; R28 AC-0 stays open pending live evidence.
