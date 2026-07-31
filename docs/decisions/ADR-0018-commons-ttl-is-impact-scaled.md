# ADR-0018 — A published entry's lifetime is scaled by impact

**Date:** 2026-07-31
**Status:** Accepted
**Context:** R24 AC-2 (knowledge is mortal), defect `913ead75`

## Context

Corroboration now fires live — 4 entries re-derived by genuine strangers — so
entries are eligible for publication for the first time. Nothing calls `publish`,
and it cannot be called without deciding how long a published entry lives.

R24 AC-2: *"given a published entry whose expiry has passed, when a worker
requests it through the broker, then it is not served as current fact — it must
re-validate or decay out, because stale certainty is worse than honest absence."*

Everything downstream already exists. `retrieve` labels an entry past its expiry
as `expired` with `current: false`, and the broker serves only entries labelled
`published`. So an expired entry stops being served with no further work. The
single missing input is the lifetime.

## The problem

**Nothing the system records determines how long a fact stays true.** The ledger
knows when a claim was made and by whom; it does not and cannot know whether the
boiling point of water will change. This project's standing rule is to derive
constants from data rather than invent them, and here there is no data to derive
from — so per the rule, the choice is made openly rather than picked and
justified afterwards.

## Decision

**The lifetime is scaled by `impact`, and the SHAPE of that scaling is derived
from AC-2's own sentence even though the magnitudes are not.**

"Stale certainty is worse than honest absence" is a statement about cost. Where
being wrong costs more, stale certainty costs more — so a **high-impact entry
expires SOONER than a low-impact one**, not later. That is the opposite of the
intuitive reading, where important facts feel like they deserve longer lives, and
it is the reading the requirement actually supports: `impact` is derived from
blast radius, which already says what being wrong costs.

The magnitudes are a policy choice, stated as such:

- **low impact — 7 days.** Long enough to be reused across many missions, short
  enough that a fact must be re-earned within an ordinary working cadence.
- **high impact — 1 day.** Short enough that a costly claim is re-derived often.

**Publication requires corroboration for both impact levels**, though the store
only enforces it for high. R24's admission flow is "guilty until proven useful",
and publishing a low-impact entry the moment it is submitted would make
quarantine a formality for most of the commons. A corroborated entry has been
found twice by different designs; that is the earned bar. An uncorroborated
low-impact entry stays in quarantine, still usable through the broker with its
`unproven` label, exactly as AC-0 requires.

## Consequences

- Both numbers are one argument to `publish(entryId, ttlSeconds)` and one column
  in the row. Re-timing is a value change, not a redesign — this is reversible in
  the strongest sense.
- AC-2's expiry path becomes reachable for the first time: until now no entry had
  ever been published, so nothing could ever expire.
- A high-impact entry that is not re-derived within a day decays out. That is the
  intended behaviour and it is the aggressive end of the trade-off; if it proves
  too aggressive in practice, the evidence for changing it will be entries
  decaying and being re-published repeatedly, which is measurable in a way this
  decision could not be made from in advance.
- The comment in `worker-seams.ts` already said the commons "publishes on
  corroboration (R24)" while nothing did. That was a stale comment describing an
  intended design; this makes it true rather than deleting it.
