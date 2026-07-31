# 2026-07-31 · 072 · code-change · Rubber-stamping is measured — R35 satisfied, and the known-bad probe was caught

**What:** probes are planted from the sealed bench and run through the real Gate B. R35 AC-1 satisfied, R35 satisfied, P35 completed, defect `2eeef21f` resolved.

**Why this one mattered more than most dead mechanisms.** `probeMisses` had scored probes in both directions since P35's first pass, and `seams.calibration.probes?.()` had been read by the mission loop the whole time — nothing implemented `probes`. ADR-0010's unanimity sampling has a stated limit (`627cd71c`): it cannot catch a judge that contradicts itself the same way every time, because every sample agrees. Only a known answer can. So this was the one measurement that closes that hole rather than widening it.

**The known-bad construction, and why not the obvious one.** An **empty deliverable** would be refused by Gate B's mechanical tier with no model involved — a probe built that way reports a healthy catch rate while the semantic tier, where rubber-stamping actually happens, goes untested. Instead a known-bad probe pairs one sealed case's contract with **another case's verified answer**: it fabricates nothing (every byte is an answer the system itself verified), and it can only be caught by reading the answer against the criteria.

**The planter refuses rather than inventing.** One case has nothing to borrow from; two cases with identical answers would produce a probe labelled "fail" whose deliverable is correct, scoring the reviewer a miss for being right. Both plant no bad probe. Known-**good** probes are planted too — the tier-2 judges have shown a 58% false-bounce rate (ADR-0010), and a calibration measuring only leniency would have missed all of it.

**Probes are RUN, not declared.** The seam used to return `{taskId, expected}`, which could never have measured anything: `probeMisses` matches those ids against verdicts, and no verdict for a synthetic task would ever exist. It now returns work, and the loop reviews each probe with the same `gateB` and the same judges. Probes are deliberately kept out of the re-review sample, the fold-up and the track records — there is no point asking a second opinion about a case whose answer is known, and synthetic work must not contaminate real measurements. The probe bundle is shaped so the mechanical tier stays quiet (effort at the contract floor, a token action where tools were granted), or a known-good probe would fail for a bookkeeping reason and be scored a miss against a reviewer that did nothing wrong.

**A fixture that was relabelling, not planting.** The existing calibration fixture returned `{taskId: MISSION_ID, expected}` — the id of the task the loop actually ran. That is not a planted probe; it scores whatever the mission happened to do. It passed for two iterations because nothing implemented `probes`, so the shape was never exercised. Fixed at the fixture, and said so in it.

**Live, mission `e8077776`:**

```
probesPlanted  : 4
probesProcessed: 2
probeResults   : [ {expected: pass, actual: pass}, {expected: fail, actual: fail} ]
misses         : []
```

The known-bad probe was **caught**. Zero misses, and demonstrably zero rather than vacuous — which is why `probeResults` records every processed probe and not only the failures.

**Two bounds, recorded rather than assumed away.**
- The live reviewer caught the bad probe, so no miss was recorded. The miss-recording clause is proven against the real composition by the calibration fixture test, which now drives a genuinely planted probe.
- **2 of 4 probes were unevaluable.** One sealed case carries `{"o": "sealed case"}` where a contract belongs — a stub from an early R25 dogfood script — and the bench has **no live producer at all**. Logged as defect `c1b3ae71`. The naive fix is to delete the offending row; deliberately not done, because R25's whole design is that nothing which optimises against a benchmark may also own it, and removing cases that produce inconvenient results is the first step toward owning it. Instead `probesPlanted` and `probesProcessed` are both recorded, so a bench full of unusable cases can never report zero misses and read as a perfectly calibrated reviewer. The second sealed case used here was distilled by hand from a genuinely verified task in the ledger — real ground truth, but me doing what the system should do for itself.

**Verification.** 9 new planter tests + 5 composition tests; 6 mutants, 5 killed and 1 proved equivalent (the single-case guard is subsumed by the identical-answer guard — noted in the code so nobody removes the wrong one). 582 worker + 139 memory-fabric integration + 156 + 66 + 50 + 26 green, full workspace build, two live missions.

**Outcome:** R35 satisfied; P35 was one of the four blocking phases. Three remain: P19, P31, P33.
