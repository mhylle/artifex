# 2026-07-31 · 080 · discovery · The planner can now see the registry — and the measurement corrected my own diagnosis

**What:** `knownCapabilities()` now reaches the planner at planning time. The live result is **weak**, and chasing it produced something more valuable than the fix: evidence that the diagnosis in defect `340aa7de` was wrong about the present.

**The change.** The loop passes what the registry holds through `decompose` into `createStepwisePlanner`'s **detail** probe — the one where `category` is answered. Kept out of the count probe on purpose: how many subtasks there are and what they are *called* are separate questions, and a long registry leaking into the count would inflate or deflate the split. Phrased as a suggestion with an explicit "if none of these fit, name a new capability", because an enum would converge the taxonomy instantly and end the learning R23/R38 exist for — the same reason this project bans example phrasings in judge prompts.

**The live result, reported as what it is.** Two missions on different subjects needing the same capability produced `economic definition` (reused across two subtasks), `scientific definitions`, and `scientific writing`. One genuine reuse where the same pair previously produced two names. **That is a single data point, not convergence.**

**The correction, which is the real finding.** Four subtasks produced **zero** new designs — but that was already true before the change:

```
select date_trunc('hour', created_at), count(*) from agent_design
 where category not like 'verification.%' group by 1 order by 1 desc;
 04:00 | 3      <- the last new producer design
 02:00 | 1
```

No producer design has been minted since 04:00, spanning both this iteration's missions and the previous one's. `resolveCapability` was **already** absorbing new proposals onto existing capabilities at staffing time. So the claim I logged last iteration — that designs proliferate one per task — was wrong about the present. The 24 categories are historical accumulation from when `designIdFor` mixed in the task id; the 1.07 ratio measured a **backlog, not a live rate**.

Two iterations of reasoning rested on that ratio. It was a real measurement of the wrong thing, and only running the same measurement *again after a change* exposed it — a before/after where the "before" turned out to already have the property I was trying to create.

**What actually still needs answering.** The live symptom that blocks R29 is not design proliferation, it is that weak spots show `observations: 1`. But `scientific terminology` now carries **10** observations, well past the evidence bar. So the open question is narrower and different: does `rankWeakSpots` bucket by the **resolved capability** the registry uses, or by the planner's raw `contract.category`? If it groups on the raw name, every mission is its own bucket however well staffing clusters — and the defect is in the ranker, not the taxonomy. Measured next, not assumed.

**Verification.** 9 new tests (4 planner + 2 composition + 3 from the prior schema work), 5 mutants all killed — including one turning the capability list into a closed vocabulary and one dropping the loop's hand-off entirely. 655 worker + 160 + 66 + 50 + 26 green, full workspace build, two live missions.

**Outcome:** a sound change that is **not demonstrated to fix anything**, and a corrected diagnosis that redirects the next iteration at the ranker rather than at the planner. The defect stays open with its framing rewritten.
