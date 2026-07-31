# 2026-07-31 · 074 · code-change · Decomposition templates learn and are reused — R31 satisfied

**What:** templates are distilled from splits that survive Gate A, offered back as planner guidance, and scored on what they guide. R31 AC-2 satisfied, R31 satisfied, P31 completed. Decision recorded as ADR-0014; defects `68f6c31c` and `2e79255f` resolved.

**A defect found on the way, and the reason to read production code rather than seams.** `createStepwisePlanner` — the planner `runtime.ts` actually wires — destructured `async propose({ contract })` and never touched `rejectedBecause`. The seam declares it, documents exactly why it exists ("what makes the retry AIMED rather than blind"), and the loop passes it. It was dropped at the last step, so **every re-split in the deployed system re-proposed from the bare objective** and rehearsed the rejection it had been handed. Every loop-level fixture honoured the seam; production did not, and a seam's tests cannot see whether the real implementation reads its inputs. Logged as `2e79255f` the moment it was found and fixed in the same iteration.

**Templates are their own store, and that is a deviation worth defending (ADR-0014).** "In the Asset Registry" points literally at `agent_design`, which would have needed no migration. Three reasons not to:
- **R26's fast loop patches `role_instructions` on that table** — a recipe filed there could be silently rewritten mid-mission by an optimiser that believes it is tuning an agent prompt.
- **`bestForCategory` would bid templates as agents.** A template has no capabilities and cannot execute; staffing one fails where it is hardest to diagnose.
- **They are scored on different things** — Gate B pass rate versus whether the guided *split* survived Gate A. One column would average two unrelated measurements into a meaningless number.

So: the registry's *properties* (accumulate, score, down-weight never delete, one per capability) without its *machinery*.

**Three choices inside that, each derived rather than picked.** Keyed by capability, so evidence accumulates per kind of work — with a `unique(capability)` constraint, because two templates for one kind of work fragment the very evidence they exist to gather. `minObservations` defaults to **0**, unlike the registry's 3: an unproven design may be staffed and produce bad work, while an unproven template only adds a sentence the planner may ignore and Gate A still audits the result — a bar of 3 would be its own blocker, since nothing else offers templates. And `remember` **does not overwrite**: the incumbent carries the evidence, the newcomer carries none.

**The producer, without which the criterion's "given" is unreachable.** A split that survives Gate A with no template guiding it is distilled into one, using the objectives that passed as the recipe — evidence, not a model's guess about "how to split this kind of work". A *rejected* split teaches nothing, or the store fills with recipes for producing rejected decompositions.

**Live, both halves of the loop:**

| mission | what happened |
|---|---|
| `3c0923dc` | split, survived Gate A → `decomposition.template_learned`; row created with `observations 0, score null` — unproven, as it should be |
| `d8e07ce4` | `decomposition.template_used` carrying that recipe → survived Gate A → row moves to `observations 1, score 1.0` |

**Verification.** 8 planner tests, 12 store tests, 7 composition tests. 7 mutants against the store, all killed. 607 worker + 150 memory-fabric integration + 156 + 66 + 50 + 26 green, full workspace build.

**Known limitation, inherited rather than introduced:** both live missions keyed their template to capability `mission`, because the planner still invents a category per task and R38's clustering has not converged the taxonomy. A template is only as well-targeted as the capability taxonomy — so fixing the carried "category fragmentation" item improves templates for free, and until then a template is coarser than the criterion intends.

**Outcome:** P31 was one of two blocking phases. **One remains: P19, the four remaining lenses** — the last of the frontend work.
