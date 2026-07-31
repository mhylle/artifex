# 098 — One recipe answered every mission, and a defect I filed was retracted

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defect `c09b15c6` retracted with the measurement that refutes it, and defect `16532469` found and fixed: decomposition templates were keyed on the mission role, so 26 of 26 retrievals returned the same osmosis/diffusion recipe whatever the mission was about.

**Why:** The iteration opened with a plan written at the end of the previous one — fold duplicate registry rows, then make an exact capability match win. Both halves were premises, not conclusions, and re-measuring them is what the discipline requires.

**Details:**

**The retraction.** `c09b15c6` recorded a real observation: the planner is told *"reuse one of those as the category"*, complied verbatim on mission `feb66cf8` with a genuine registry row, and was staffed as `technical writing`. I filed it as find-shape (r) — an instruction the code overrides — and proposed a two-step remedy.

The decisive measurement was not about names. For every proposal the remedy would reroute, I asked `bestForCategory` about **both** targets:

    LOSES a proven bid = 27 occurrences,  GAINS a bid = 0,  neither = 1
    control: of 11 categories queried, 2 bid and 9 did not — the lookup separates

Every reroute moved work from a category with 8–17 observations to one that cannot clear the 3-observation evidence bar: from *reuse a proven incumbent* to *author a fresh design*. R38 AC-1 reads *"an adequate incumbent is reused rather than a new design being authored — reuse beats creation whenever the record supports it."* **The proposed fix contradicted the criterion the defect was filed to protect.**

The other premise failed too. Grouping the registry by its own notion of significant tokens found **2 duplicate groups in 38 capabilities**, and only one appeared among the eleven rerouted cases. The duplicate-fold migration would have addressed one case in eleven, on a premise never tested.

So the defect is retracted, its record left visible, and the residual concern — whether `technical writing` is the right home for `Technical Description / Instructional Content`, two names sharing only a modifier — stays where it already lives, as ADR-0019's stated non-fix.

**The find.** Chasing an oddity noticed in passing on mission `c24efc3e` — a physics mission guided by a recipe about osmosis — turned up something larger. The loop keyed decomposition templates on `capabilityOf(parent.category)`, and task zero's category is always `MISSION_CATEGORY`:

    decomposition.template_used  by capability: mission = 26, nothing else
    decomposition.template_learned:             mission = 1, "technical writing" = 1
    decomposition_template rows: "mission" (obs 27, score 0.926) | "technical writing" (obs 0, NEVER USED)

One recipe answered every mission the system had ever run. Its 0.926 score over 27 observations is a spurious aggregate — find-shape (n) — because it was the only candidate and so was credited with every outcome it was present for.

This contradicts R31 AC-2's own given: *"a decomposition template in the Asset Registry matching **the kind of work**"*. `mission` is a role Artifex stamps on itself, not a kind of work. **The codebase already draws this exact line** — `proposableCapabilities` filters `MISSION_CATEGORY` and the `verification.` namespace from the registry's capability list because they are *"written by Artifex rather than proposed by anyone"* — and the template store shared that key space with no such filter. Find-shape (b). The comment above the lookup even asserted the intended behaviour: *"templates accumulate per kind of work rather than per task"* — find-shape (h), true when written, false for the dominant case.

`templateKeyFor` now returns null for structural categories on **both** the read and write paths, filtering the raw category *before* normalisation for the same reason `ledger-evidence.ts` does: `capabilityOf` rewrites punctuation, so `verification.x` becomes `verification x` and slips past a prefix test applied afterwards.

**The AC-2 composition tests were rewritten, not extended.** All six drove the template through task zero — the one given the criterion excludes. The fixture now nests: a three-criterion mission makes `depthBound` 3 and hands a two-criterion child down, so the loop recurses and decomposes a node carrying a real capability. The tests assert *which* key was asked for, not merely that something was.

5 mutants killed, each verified to change behaviour first. The valuable pair guards only the write, or only the read — proving the halves are independently tested, since an asymmetric fix would fill the store with rows nothing can retrieve. The ordering mutant is killed by a distractor written for it, which is why that reasoning is a property rather than a comment.

**Outcome:**

755 worker (+3) + 175 + 66 + 50 + 26 green; all six workspaces build; worker rebuilt, restarted, queue drained before measuring.

Live before/after, with the control that makes the zero demonstrable — the eleven most recent splitting missions had an unbroken run of template uses, and the first mission after the fix broke it **while still splitting**, so the lookup path was reached:

    2026-07-31T10:37Z  4779d9fa  no template   <- after the fix, and it DID split
    2026-07-31T10:12Z  c24efc3e  template USED
    2026-07-31T10:09Z  ac952a34  template USED
       ... 9 more, all USED
    total decomposition.template_used: 26 before, 26 after

**Bounds, stated rather than rounded up.** The positive half — a template firing for a real capability — is proven by composition test through `runMission`, not live: exactly one sub-decomposition exists in the whole ledger, so the given is rare rather than unreachable. And no outcome harm was ever measured for the old behaviour: the template fired for all 26 missions, so the ledger holds no control group and nothing can be attributed to it. The defect was that the key is structurally wrong and the criterion's given was unreached — not that missions demonstrably failed because of it.

The existing `mission` row is left in place rather than deleted (invariant #5); nothing looks it up now.
