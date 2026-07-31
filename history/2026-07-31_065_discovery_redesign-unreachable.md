# 2026-07-31 · 065 · discovery · Why the redesign rung never fires — two dead routes, found by driving not reading

**What:** Tried to close R28 AC-0 with live evidence and could not. `parent_design_id` went **0 → 0** across two engineered missions. The reason is more interesting than the AC.

**The producer works.** Last iteration built it: `agent_redesign` authors a design derived from the one that failed, with 6 tests and 4 mutants killed. What I could not do is make a live mission *reach* the rung.

**Two dead routes, in layers.**

1. **`budget_exhaustion` is emitted by nothing.** It is the *only* error class `escalation.ts` maps to `agent_redesign`, and grepping outside the type declarations finds no verdict, gate or loop site that ever assigns it. The direct route is dead — the eighth occurrence of a name in the vocabulary with nothing behind it.

2. **The indirect route is narrow, and R36 correctly narrows it further.** The rung is otherwise reached only by climbing one at a time — three consecutive `execution_error` failures on one task. Mission `240dd00e`, engineered to fail hard (an ISBN, page count and publisher for a book that does not exist), was classed as a **specification fault**, so the entry-rung logic jumped straight to `re_decomposition` at index 3 and skipped index 2 entirely.

That second part is the ladder working exactly as R36 specifies. A spec fault should not be answered by redesigning the agent. The consequence is simply that the redesign path is much harder to reach than its position in the ladder suggests, and nothing had ever noticed because nothing had ever tried to reach it.

**The fix, and why it is deliberately not applied yet.** Gate B's mechanical tier already refuses a bundle whose `effortSpent` exceeds the contract ceiling and classes it `verification_failure`. That finding *is* a budget exhaustion by definition, and reclassing it would make the class real, the rung reachable, and R28's lineage produceable on an ordinary overspending mission.

But `effortSpent` is still a hardcoded `1` at the real work seam, so **no live task can exceed its ceiling**. Reclassing now would create a second route that also never fires — which is precisely how the first dead route came to exist. Logged as `e758f460` with that ordering stated, rather than fixed into a shape that would look done and change nothing.

**What this cost and what it bought.** No AC closed. But the before/after count is what forced the question — had I stopped at green tests I would have claimed AC-0 twice over. Two engineered missions produced a defect that explains a whole family of "why does this never happen" questions, and the phase is now `blocked` with the unblock condition written down rather than sitting `pending` and looking like ordinary unfinished work.

**Outcome:** R28 AC-0 still open; `cb939996` unchanged; new defect `e758f460`; P28b blocked with its dependency named.
