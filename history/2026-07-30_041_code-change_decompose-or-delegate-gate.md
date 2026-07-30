# 2026-07-30 · 041 · code-change · The decompose-or-delegate gate — atomization becomes a decision, not a reflex

**What:** Built R31 AC-0 and AC-1. The Orchestrator now asks, at every node, whether to split at all — and records the answer either way. Work judged too entangled to divide is kept whole and handed to one agent on the node's full budget.

**Why:** A locked decision from the brainstorm that was never built. The dossier is blunt about the cost: work that is inherently sequential and constraint-entangled is measurably *damaged* by splitting, −39% to −70% in controlled studies. Until now the Orchestrator always split. The judgement existed only as an implicit fallback — if the planner could produce nothing but the parent's own objective, the parent became its own single child — which is the right reading of "this does not decompose", but is a side effect rather than a decision, and nothing in the trail said a choice had been made.

**Details:**

- `DecompositionGate` is an optional seam. Absent, the loop behaves exactly as every caller did before — **but the default is still recorded**, with a rationale saying so. A default that recorded nothing would leave every mission claiming a judgement nobody made.
- A gate that throws also defaults to splitting: a seam that cannot answer must not cost the mission.
- The schema's boolean is `keepWhole`, not `split`, deliberately. The safe default is to split, so an absent or malformed field reads as `false`. A `split` field would fail the other way and quietly collapse the swarm into a single agent whenever the model hesitated.
- The gate runs on the **evaluative** tier, not the worker tier — "should this be split" is a judgement about the shape of the work, and fold-up already taught this project that evaluative questions belong a tier above the doing (insight `1aad1dd5`).
- The decision is skipped on resume: it is already in the trail, and re-deciding could reach a different answer than the tree that was actually built.
- **Gate A is skipped for a kept-whole node** — it grades a decomposition, and there is none. The work is still verified at Gate B, which is the point: keeping work whole changes who does it, never whether it is checked.
- **No fold-up either.** There are no siblings to reconcile, and folding a single deliverable would spend a model call to rephrase it — rephrasing being exactly the damage keeping the work whole was meant to avoid.

**The larger budget is derived, not invented.** An unsplit node simply keeps its own ceiling instead of dividing it by `effortShare`. In the live run below the kept-whole agent held 30 effort-units where a split child would have received 12.

**The trap, and the test that guards it.** `runChild` recurses when a contract is not atomic. A kept-whole node carrying several criteria would be found non-atomic one level down and split anyway — the gate would appear to work while changing nothing at all. `runChild` therefore takes an `asLeaf` flag that makes the gate's decision binding, and a distractor asserts that one agent worked the parent's own objective.

**Verification.** 12 new tests; **521 green**. Mutants killed: the gate consulted but its answer ignored (5 tests), no decision recorded when no gate is configured (1), `asLeaf` ignored so a kept-whole node splits anyway (1), the decision filed against the mission rather than the node (1), and a kept-whole node skipping Gate B (4).

**Browser-verified on two live missions, chosen so the gate had a real choice:**

| mission | decision | children | ceiling |
|---|---|---|---|
| "Compose a single limerick where every line must rhyme and scan with the others." | **keep_whole** | 0 | 30 (full) |
| "Describe two unrelated kitchen tools: the whisk and the colander." | **split** | 2 | 12 each |

gemma4:12b's own rationale for the limerick: *"The creation of a limerick requires a continuous line of reasoning where each line's constraints (rhyme and meter) are interdependent on the previous lines."* For the tools: *"The tasks are explicitly described as unrelated and represent two distinct objects with separate functions."* The decision and its rationale are reviewable in the ledger explorer lens.

The limerick mission **surrendered** — three Gate B verdicts, all fail. That is a tier-1 capability limit, not a gate defect, and it is worth recording as the honest outcome: the reviewer refused work the worker could not do, rather than passing it.

**A defect this surfaced.** A kept-whole mission contracts no children, so the canvas had nothing to draw and displayed *"No tasks contracted yet."* on a mission that had run three attempts and been verified three times — the canvas being quietly less complete than the ledger, which `mission-tree.ts` itself calls the one thing it must never be. The canvas now names the decision and its rationale instead, with distractors ensuring a genuinely-unstarted mission still says so and a split mission still shows its nodes.

**R31 AC-2 is left unsatisfied** (defect `68f6c31c`): it requires decomposition templates from the Asset Registry, which is R23 and does not exist — `registry.bestForCategory()` returns `null` unconditionally. R31 stays `draft` and P31 stays pending until R23 lands.
