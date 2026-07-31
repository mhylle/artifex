# ADR-0024 — The last terminal event decides a mission's status, and both delivery events count

**Status:** Accepted
**Date:** 2026-07-31
**Context:** defect `dd2e9d18`, R21 (fleet view), R22 (audience scoping), R37 AC-0, R41

## Context

Mission Control's header read **47 running** while nothing was in flight. Measuring before choosing separated two explanations that had been conflated:

```
reported running                                    : 47
delivered but NOT folded -> shown as running        : 21
no terminal event at all -> genuinely no outcome    : 26
unaccounted for                                     :  0
```

Both were true, roughly half each.

The 21 are a real bug with a clear history. R37 AC-0 added `mission.delivered` as *"one terminal event for EVERY delivered mission"*, because a mission the decompose-or-delegate gate keeps **whole** never folds and so delivered with no terminal event at all. Three projections predate that event and were never taught about it:

| Projection | Surface |
|---|---|
| `LedgerRepository.listMissions` | the fleet rail and its header |
| `buildMissionTree` | the mission detail header |
| `buildRequesterView` | R22's requester-facing outcome |

Find-shape (k) at three sites. It showed up live as a flat contradiction on one screen: the rail said DELIVERED and the detail header said SURRENDERED for the same mission.

A second bug rode along in the fleet projection only. It accumulated two booleans and let surrender win any tie, on the reasoning that *"reporting the cheerier of two outcomes is how a dashboard starts lying"*. That was right while a mission ran exactly once. R41 made *surrendered → answered → delivered* an ordinary history, and there the cheerier outcome is simply the current one — reporting the older state is the same lie facing the other way.

## Decision

**A mission's status is its most recent terminal event, and both `mission.folded` and `mission.delivered` mean delivered.**

```sql
(ARRAY_AGG(type ORDER BY seq DESC) FILTER (
  WHERE type IN ('mission.folded', 'mission.delivered', 'mission.surrendered')
))[1] AS last_terminal
```

The two event-folding projections already processed events in order, so they needed only the missing case — plus clearing the blockers a superseded surrender had recorded, since a delivered mission has got past them.

**Both delivery events are honoured rather than swapped, and that is the measured part.** 46 missions carry `mission.folded`, 42 carry `mission.delivered`, 20 carry both. Keying purely on the newer event would have flipped 26 historical missions back to running and made the number *worse than the defect being fixed*. That anti-regression has its own distractor test so the shortcut cannot be taken later.

## Evidence

Candidate rules evaluated against the live ledger **before** any code changed, then re-run through the real API after:

```
CURRENT  {"running":47,"delivered":46,"surrendered":74}
FIX1     {"running":26,"delivered":67,"surrendered":74}
FIX1+2   {"running":26,"delivered":68,"surrendered":73}   <- shipped
22 missions change: 21 running->delivered, 1 surrendered->delivered
```

Every change moves in the correct direction; none moves the wrong way. Verified in Chrome via Playwright: the header reads "167 missions · 26 running", and mission `63498d62` — which surrendered, was answered and then delivered — reads DELIVERED in both the rail and the detail header.

RED first at all three sites; 7 killing mutants.

## Consequences

- The fleet header, the mission detail header and the requester view can no longer disagree about the same mission.
- A resumed mission is reported by its current outcome, which is what makes R41 legible to an operator.
- `MissionSummaryRow` carries `last_terminal` instead of two booleans, because a pair of accumulated flags cannot express "the last one".

## What this deliberately does NOT fix

The remaining **26** are missions with no terminal event at all: zero with activity in the last 10 minutes, oldest ~19 hours, 9 never even picked up off the queue. They are dead runs from crashed or restarted workers.

**Nothing writes an event when a worker dies**, so the ledger cannot distinguish "running" from "abandoned". That is not a query problem and no smarter projection solves it. The candidate — a startup sweep appending a corrective `mission.abandoned`, since a mission with no terminal event cannot be in flight once the process that owned it is gone — invents no threshold and matches the fabric's own guardrail (*"never fix a row — append a corrective event"*). It needs its own measurement and ADR, and is left open on `dd2e9d18` rather than half-built here.

A staleness threshold on `lastEventAt` was rejected on sight: it is exactly the hardcoded constant standing in for a measurement that this project keeps finding.
