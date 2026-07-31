# 095 — A stranger re-derives it

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Corroboration in the Knowledge Commons now fires live (defect `913ead75`, R24 AC-1) — 4 entries corroborated by genuine strangers, up from 0. The defect's framing was corrected first: the missing caller was a symptom, and the cause was that a caller could never have worked. **Publication is still not wired**, and that half is stated rather than rounded up.

**Why:** R24 AC-1 says a high-impact finding is refused promotion "unless an agent that did not produce it has independently re-derived it — a stranger must find it again." Nothing ever corroborated anything, so every entry sat in quarantine permanently.

**Details:**

The fuel check came first, as it has for three iterations running. The commons was not empty: **56 entries from 11 designs, 0 published**. So there was plenty to corroborate and the blocker was elsewhere.

It was the claim's identity. `mission-loop` submits ``claim: `${child.objective} ${JSON.stringify(deliverable)}` ``, which embeds the free-text model answer, and against the live store:

    claims produced by TWO OR MORE DIFFERENT designs:  0
    claims appearing more than once:                   1  (3 entries, all ONE design)

Zero, and not by chance — two agents who independently find the same fact write different words, so their claim strings can never be equal. AC-1 asks for re-derivation of a *fact*; the identity in use was a claim about a *string*. House find-shapes (f) and (m) together: a seam whose shape cannot work, and a trigger whose condition is unreachable in practice. The one repeated claim made the point sharply — the same design stated the boiling point of water three times, which is self-repetition and precisely what `corroborate` already refuses.

Keying on the question was measured to have fuel before anything was built: 48 distinct questions, **2 answered by two different designs**, **4 repeated by one design alone**. Both sides of AC-1's distinction present in real data, so the rule could be tested against reality rather than a fixture.

`strangersFor(question, byDesignId)` returns quarantined entries on the same question from another design — 5 integration tests against a real Postgres. The caller runs after a Gate B pass and *before* the task's own submit, so a design is never offered its own entry, and records `knowledge.corroborated`. 5 worker composition tests. The store's rules needed no change: `corroborate` already refuses the producer and `publish` already refuses an un-re-derived high-impact entry.

10 mutants, 5 killed across both layers — searching by the claim (the original defect), corroboration removed, the ledger record dropped, the store no longer excluding the producer, and the store offering published entries. One mutant of mine was badly written and is recorded as such rather than counted: `stranger.entryId ?? "e-any"` differs only when the id is nullish, and the loop only iterates strangers that have one.

Two fixture mistakes were caught and fixed, both recorded in the tests: design ids are `uuid` columns and the first fixtures used readable strings that Postgres rejected outright.

**Outcome:**

741 worker + 175 + 66 + 50 + 26 green, plus 164 memory-fabric integration tests; all six workspaces build; rebuilt, restarted, queue drained before measuring.

Live, from a repeat mission on osmosis and diffusion — an honest input, the same question asked again:

    knowledge.corroborated  x4   (2 high-impact, 2 low)
    corroborated entries: 0 -> 4, every one with is_stranger = true

    claim                                    producer     corroborated_by  stranger
    Write a one-sentence definition of diffu  b9d912e8...  596dbd6f...         t
    Write a one-sentence definition of diffu  4bbbdc42...  596dbd6f...         t
    Write a one-sentence definition of osmos  4bbbdc42...  b9d912e8...         t

**The half not done.** Nothing calls `publish`. R24 AC-2 requires a published entry to expire, so publication needs a TTL, and **no data in the system determines one**. That is a choice to make openly in an ADR rather than a number picked and justified afterwards, so it is deferred with its reason. High-impact entries are now corroborated and therefore eligible; the lifetime decision is the remaining work, and the defect stays open for it.
