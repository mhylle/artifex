# 2026-07-30 · 046 · code-change · The early surrender signal, and clustering that does not yet cluster

**What:** Built R38 AC-3 (systematic no-bids raise an early capability-gap signal) and the clustering machinery for AC-0. AC-3 is satisfied on live evidence; **AC-0 is not**, and the live run is what showed why.

## AC-3 — the signal is early, or it is nothing

A capability audit runs after Gate A and **before a single task executes**: each child's category is probed against the registry, and when *every* child no-bids, `staffing.capability_gap` is appended naming the unserved capabilities.

Two decisions carry the criterion:

- **It is a warning, never a refusal.** A first mission in a new domain no-bids on everything by definition; refusing to run would leave the swarm unable to acquire a capability it does not have. The mission proceeds, informed.
- **Systematic, not incidental.** One unserved capability among served ones is ordinary — it is how a new specialist enters the registry — and warning on it would fire on almost every mission and mean nothing. The signal requires *all* children to no-bid, and a distractor pins that.

**Live evidence**, mission `96cbda91`:

```
capability_gap raised: 1
  noBids 3 of 3 | capabilities: ['instructional writing', 'physics', 'writing implements the marker']
  BEFORE first execution: True
```

## AC-0 — clustering works, and still does not clear the bar

`capabilityOf` normalises a free-text category to its first segment, lowercased and depunctuated; `designIdFor` hashes that instead of the raw string. A unit test takes 10 categories from 3 capability families down to **3 designs**, and mutants removing clustering or collapsing everything onto one capability are both killed.

Then the live mission produced **3 tasks and 3 distinct designs**:

```
Instructional Writing / Technical Description
Physics/Chemistry of Writing Materials
Writing Implements: The Marker
```

Three unrelated first segments, so nothing clusters — and the third is not a capability at all, it is a restatement of the task. The normalisation is *passive*: it can only merge categories the planner happened to name with a shared prefix, and within one mission it rarely does.

**What is actually missing is active clustering** — resolving each proposed category against capabilities the registry *already knows*, minting a new one only when nothing is close. That is what makes a taxonomy converge, and what the dossier means by the taxonomy being a learnable asset rather than whatever the planner said this time. AC-0 stays unsatisfied, logged as `eee34306`.

This is the value of the browser/live rule stated plainly: the unit test was green and the mechanism was correct, and the requirement was still unmet. A fixture proved the function; only real data proved the *feature*.

**Verification.** 12 new tests, **508 unit + 67 integration green**. Five mutants killed: clustering removed (2 tests), clustering collapsing everything (8), empty category yielding `""` rather than a named fallback (1), the signal firing on any no-bid rather than a systematic one (1), and the signal raised late rather than before execution (3).

**AC-2 was deliberately left out of scope.** It requires both typed building blocks *and* effort scaling; the second half needs a multi-worker consumer that does not exist, and shipping a `workerCount` nothing reads would be the "value written that nothing reads" shape this project has hit six times. It is better done whole.
