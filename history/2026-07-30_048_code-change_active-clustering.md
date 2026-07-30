# 2026-07-30 · 048 · code-change · Active clustering — five tasks, one design

**What:** Closed R38 AC-0 (defect `eee34306`). Clustering resolves each proposed category against the capabilities the registry already holds, instead of normalising a string in isolation.

**Why the previous attempt failed, in one line:** normalising a category cannot merge names the planner never repeated — and it never repeats them, because it invents a fresh phrase per subtask.

**Details:**

- `resolveCapability(proposed, known)` matches on a shared token after crude singularisation ("tools" → "tool"). A stemmer would be a dependency earning its keep on nothing: these are short noun phrases invented seconds earlier, and the only inflection that matters in practice is the plural.
- `AssetRegistryRepository.knownCapabilities()` returns them **evidence-ordered**, by total observations. So a proposal that could join two capabilities joins the better-established one, and the tie-break is the system's own measured history rather than alphabetical luck.
- Staffing now bids on, and registers under, the resolved capability. The registry's distinct categories *are* the taxonomy — storing the planner's raw phrasing would make `knownCapabilities` a list of one-off strings that can never cluster.
- The rule deliberately errs toward **merging**: the criterion asks for materially fewer designs, a slightly-wrong reuse is caught downstream by the evidence bar and the clade score, and a taxonomy growing by one entry per task can never accumulate evidence at all. No numeric threshold was invented.

**Falsifiable live evidence — identical mission text, before and after:**

| | before (`77b83c64`) | after (`d23304ba`) |
|---|---|---|
| tasks | 5 | 5 |
| distinct designs | **5** | **1** |

The planner was no more consistent the second time — "Hand Tools Overview", "Hand Tool Education", "Hand Tools", "Hand Tools", "Woodworking Tools" — and all five resolved onto `hand tools overview`, which now carries **5 observations**. That is the first time one design has reached the evidence bar from a single mission, which is exactly what *"a thousand tasks might need twelve designs"* is for.

**A surviving mutant found a real gap.** Five mutants; four killed (known capabilities ignored, everything absorbed by the first capability, singularisation removed, registration storing raw text). The fifth — staffing bidding on the **raw category** instead of the resolved capability — passed every test. It would have silently reverted reuse to always-author, because a bid on the planner's phrasing can never match a design registered under a capability, while the suite stayed green. A test was added; the mutant now dies. That is the third time in this project a surviving mutant has exposed an untested claim.

**Two tests were rewritten rather than deleted.** `reuse-market.test.ts` asserted `bestForCategory` received `'research.sub-question'` — the raw string. Their describes name the properties (*creation feeds the market*, *the market is consulted before anything is authored*), and both still hold; only which string is passed changed. The mechanism moved, the property did not, so the assertions were rewritten in place with the reasoning left there. Fourth occurrence of that pattern.

**Verification.** 8 new tests, **278 worker + 67 integration green**, all suites green.

**R38 AC-2 remains** — typed building blocks *and* effort scaling. It is the last open criterion on this requirement, and it is deliberately unstarted rather than half-done: effort scaling needs a consumer that honours a worker count, and `runtime.ts`'s `author` seam is still a hardcoded template string.
