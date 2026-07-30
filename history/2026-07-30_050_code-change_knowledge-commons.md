# 2026-07-30 · 050 · code-change · The Knowledge Commons — guilty until proven useful

**What:** Built R24, the third and last memory-fabric store. Unlike R23, this one was genuinely unbuilt: no table, no repository, nothing referencing it.

**Why the rules are constraints, not conventions.** The dossier is explicit that this is a functional requirement rather than hygiene — measured attacks corrupt shared knowledge stores at poison rates under 0.1% through entirely normal-looking interactions, and a hallucinated fact from one confused worker propagates through retrieval exactly like a poisoned record. So the store's three rules live in the database, following the ledger's append-only trigger and the registry's non-empty `justified_by`:

- **Sourced** — a producing design, a mission and a non-empty evidence array are required to insert at all. A finding with no evidence is a rumour.
- **Earned** — status is a closed set, and nothing may be born published. There is deliberately **no admission path that skips quarantine**; a "trusted" flag is the first thing an attacker, or a hurried caller, would reach for, and a distractor asserts the API surface offers none.
- **Mortal** — `status = 'published'` implies `expires_at IS NOT NULL`, enforced by the database, so no code path can publish something that never has to be re-checked.

**Three judgement calls worth recording:**

1. **Quarantined findings are served, not withheld** — with `label: 'unproven'` showing. Withholding them entirely would waste work the swarm already paid for; the criterion asks for the label, not for silence.
2. **An expired entry is still retrievable, just not current** (`current: false`). Hiding it reads as "nobody ever found this" and invites the same work again.
3. **Low-impact findings publish on their own verified provenance.** Requiring a stranger's re-derivation for everything would mean nothing was ever shared — the impact field exists precisely to say what being wrong costs.

**Verification.** 14 new tests against real PostgreSQL; **81 integration + 292 worker green**. They passed on first run, so the mutation pass was the only real check. Six mutants; five killed immediately — high-impact publishing without corroboration, the producer corroborating itself, expired entries served as current, quarantined served without its label, expired entries hidden rather than surfaced as lapsed.

**The sixth survived, and it was worth having.** "Self-corroboration counts toward the stranger rule" passed every test, because `corroborate()` already refuses self-corroboration so the filter inside `publish` was pure defence-in-depth that nothing exercised. It still matters: the store's rule is *a stranger found it again*, not *`corroborate()` was polite about it*, and a direct write, a bulk import or an upstream bug could plant one. A test now inserts a self-corroboration straight into the row and asserts publication is still refused. Fourth time a surviving mutant has exposed an untested claim.

**Two things stated plainly rather than glossed.**

**The store is inert** (defect `753bc6dd`, high). Nothing calls `submit` — a finding originates "inside a verified task", and `task.executed` carries only `{ answer }`, the same gap as `d0d555db`. Nothing calls `retrieve` — `context-broker.ts` is the broker AC-2 names, and it does not know the commons exists. Wiring retrieval alone was **deliberately refused**: the broker would consult an always-empty store, exactly as wiring the reuse market's read half before outcomes were recorded would have returned `null` forever. R40 is the producer for both. This is logged in the same iteration rather than discovered three later, which is what happened with the Asset Registry.

**R24 has no UI surface** — nothing in Mission Control shows the commons, so its criteria are verified at the database. Same standing exception as R23, recorded on the phase rather than counted as browser-verified.
