# 2026-07-31 · 073 · code-change · Gate A's sixth clause, built on the footing the revert taught

**What:** "sane use of the decompose-or-delegate gate" is built, wired and live. R33 AC-0 satisfied, R33 satisfied, P33 completed, defect `bf62266d` resolved.

**The revert was right, and it named the fix.** The check was never in doubt: a "split" producing exactly ONE child is the gate's decision made incoherently — it pays a planning round-trip and a fold-up to hand the same work to the same single agent. Applied unconditionally it broke 53 fixtures, because the loop's documented default when no gate is wired is "always split". The clause was faulting the planner for the loop's own default: right for production, wrong for a supported configuration.

**The fix is not where it looked.** The tempting move is to change R31's default to keep-whole for single-criterion contracts, which would make one-child splits impossible. `bf62266d` was explicit that this is a question about R31, not Gate A — so instead the clause is scoped to plans where a gate **actually decided**. `decomposition.decided` already recorded *what* was decided on both paths; what it never recorded was *who*. Distinguishing a real gate decision from the loop's fallback by matching rationale prose would be a convention; `decidedBy: 'gate' | 'default'` is a fact.

Both directions of insane use are audited: a gate that split into one child, and a plan that split into several when the gate said keep whole. A gate that **threw** records as `default` — an outage is not a decision, and faulting the planner for it would blame it for the backend.

**Two mutants survived the pure function's own tests**, and both are the house failure shape:
- The loop never passing the decision to Gate A at all — 589 tests green, clause inert.
- A thrown gate reported as having decided — 589 tests green.

Neither was visible from `gate-a-full.test.ts`, because a pure function's tests cannot see whether anything calls it. `gate-a-composition.test.ts` drives the real `runMission` and kills both. Reverting to the unconditional clause now fails 53 tests, so the original revert reason is a guard rather than a memory.

**Live**, mission `7cc3ad72`: `decomposition.decided` carries `decidedBy: gate` in production, and Gate A audited a real gate decision — two children, split, sane — and passed it. **Honest split:** live proves the wiring reaches production and that the clause can say yes; the FAULT direction is pinned by the composition tests against the real `runMission`, because producing a live one-child gate split would mean controlling what the planner proposes.

**Verification.** 11 new tests (7 pure + 4 composition); 7 mutants run, 7 killed, two only after the composition tests existed. 593 worker + 156 + 66 + 50 + 26 green, full workspace build.

**Outcome:** all six clauses the dossier names are now checked on every real decomposition. P33 was one of three blocking phases; two remain — P31 (decomposition templates) and P19 (the four remaining lenses).
