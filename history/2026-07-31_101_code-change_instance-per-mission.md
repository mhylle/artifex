# 101 — Instance per mission: R39 closes, and the gate's blind spot had a second filter

**Date:** 2026-07-31
**Category:** code-change

**What:** R39 satisfied on live evidence — two missions running genuinely concurrently over one shared Memory Fabric, verified in the ledger and in the browser. And the doneness gate's blind spot turned out to be a conjunction: `linked` **AND** `approved`, so approving R30/R39 last iteration did not expose them as claimed.

**Why:** Iteration 86 found R30 and R39 hiding in `draft` and asserted that approving them "correctly turns the acceptance-criteria pillar red". That was a prediction, written at the end of an iteration, never re-measured.

**Details:**

**The prediction was false, and the correction is the useful part.** The first `getProjectDoneness` run after approving both requirements still reported the acceptance-criteria pillar **green**, with five ACs unsatisfied. `listRequirementTaskLinks` returned **0 links** for each: the gate counts *"linked, approved"* requirements, and approving an unlinked requirement moves it from one invisible state to another. Creating phases P30 and P39 is what finally exposed them — measured this time, not asserted:

    ✗ phases: 2 of 56 phase(s) not completed
    ✗ acceptance-criteria: 5 unsatisfied acceptance criterion(s) across 2 linked, approved requirement(s)

`approved` was the filter I found; `linked` was the one I did not look for. The rule this earns: **when a fix is supposed to change an aggregate, re-run the aggregate rather than asserting that it moved.**

**R39 itself.** The consumer was `concurrency: 1`, so a second mission simply waited and the fleet view could only show the "list of one" the requirement exists to end.

The audit came before the change, because raising concurrency converts an untested assumption into a live race. Two module-scope counters exist (`action-broker.ts`, `context-broker.ts`) and both are safe: every id they build is prefixed with the `taskId` and the counter is globally monotonic, so interleaved increments cannot collide. Everything else is per-job — `buildWorkerSeams(deps, missionId)` builds a fresh seam set, its own Action Broker, its own append chain.

The value is an operator choice and ADR-0021 says so openly. Task-level concurrency **is** derived — `concurrencyFor` reads budget and blast radius off the parent contract — but a mission has no parent to read from, and the bottleneck is one local Ollama the worker cannot measure. What **is** derived is the shape: the default must exceed 1, or "instance per mission" is false in the shipped binary while the code looks capable of it.

RED first this time, correcting iteration 86's inversion: four failing tests before the implementation existed. 4 mutants killed, including one that would let the override only go *up* — an explicit `1` is honoured, because serialising on purpose is legitimate and "no arbitrary caps" cuts downward too.

**Outcome:**

766 worker (+4) + 175 + 71 + 54 + 26 green; all six workspaces build; worker rebuilt and restarted.

Live, measured against the local stack:

    A 5f01c1b8  11:40:10.854 .. 11:40:58.675  (12 events)
    B 155feaa6  11:40:10.940 .. 11:40:54.444  (8 events)
    overlap: 44s -> CONCURRENT
    interleavings in one ordered ledger: 10   (a sequential pair switches exactly 1)

    shared ledger: 20 events from 2 missions in ONE table
    registry: 1 design staffed in both missions
    commons: one entry from each of the four concurrent missions (68 entries, 48 missions)

The fleet view was checked in the real browser during the run: two missions reading `RUNNING` simultaneously.

**Failure isolation was exercised, and by accident.** A deliberately doomed mission was paired with a healthy control — and the control surrendered on its own merits, so the clean "one fails, one delivers" case was never produced. That is a negative result about the test, not the feature. What the run did produce is the clause itself: `0345e303` surrendered at 11:47:23 while `d48fdf6e` kept producing events until 11:48:18. One mission's failure did not stop the other.

**Recorded, not chased:** the fleet header reads "44 running" with two missions actually in flight. It most likely counts every mission with a `mission.started` and no terminal event — which this session has created many of, by restarting the worker mid-mission. Logged as `dd2e9d18` with the hypothesis explicitly marked unmeasured, because whether "running" should exclude interrupted missions is a definitional question deserving its own measurement.
