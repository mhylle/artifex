# ADR-0016 — The replay bench alternates its slice, per capability

**Date:** 2026-07-31
**Status:** Accepted
**Context:** R25 (replay benchmarks), defect `c1b3ae71`, R29 AC-0

## Context

`bench.record` had no production caller. Enumerating every non-test reference
across `packages/worker/src` and `packages/api/src` found none, so R25 AC-0's
"when a benchmark set is built" had never happened in the running system. The
live bench held two rows, both written by scripts: one a dogfood stub whose
entire contract is `{"o": "sealed case"}`, the other a case distilled by hand.

Everything downstream starved on that: the Reviewer's calibration probes (R35),
the science loop's cases (R27), and the sealed-bench evaluation R29 AC-0
requires.

Banking cases is straightforward — R25 says what a case is: "every completed task
in the ledger, its contract, its inputs, its verified outcome". Deciding which
slice each case lands in is not.

## The problem with the slice

The dossier calls the sealed bench "a reserved slice of verified missions the
Learning Agent never sees and never trains against". A slice needs a size, and
**nothing the system records can determine what that size should be.** This
project's standing rule is to derive constants from data rather than invent them;
here there is no data to derive from. Pretending otherwise — picking 10% and
writing a paragraph about why 10% is principled — would be worse than choosing
openly.

## Options considered

**A — A fixed fraction (say, reserve 1 in 5).** Rejected: the fraction is
invented, and a hash-into-buckets implementation would make it look derived when
it is not.

**B — Seal the first case of each capability, open everything after.** Rejected:
the sealed slice never grows, so every petition about a capability is decided by
exactly one case forever. A single case is an anecdote, and `evaluateOnSealedBench`
requires unanimity — one case would make unanimity meaningless.

**C — Alternate within each capability, starting sealed.** Chosen.

## Decision

The slice alternates per capability: a capability's first banked case is sealed,
its next open, and so on. The counter is read from what the bench already holds
and advances as a mission's trail is walked, so a mission with ten tasks of one
capability does not seal all ten.

Why this one:

- **Deterministic and replayable.** No randomness, so re-running a trail banks
  the same slices. The ledger's whole value is that replay is faithful.
- **Guaranteed coverage.** Every capability the swarm actually works in gets
  sealed cases, which is precisely what a petition about a capability needs to be
  evaluated against. A global counter would let a high-volume capability decide
  every other capability's slice, and the sealed bench would drift to covering
  only the busy ones. That mutant was written and it initially survived — the
  fixture agreed with it by coincidence, and the test was fixed to distinguish.
- **Reversible.** The slice is a column. Re-slicing is a migration, not a
  redesign, so a later measurement can overturn this without unpicking anything.

An equal split is a larger sealed slice than "reserved" might suggest. That is
accepted deliberately: the sealed bench is the constitutional instrument, its
cases are never spent (scoring does not consume them), and a bench too thin to
reach unanimity is useless in exactly the situation it exists for.

## Consequences

- The bench now grows from real missions. Verified live: a mission banked two
  cases, `sealed, open`, in `hand tools overview` — a capability the bench had
  never covered.
- Failed tasks are never banked. A failed deliverable is a wrong answer, and
  scoring candidates against it would produce a number that looks like a
  measurement.
- Cases key on the RESOLVED capability, not the planner's raw category, for the
  same reason the weak-spot ranking does (`340aa7de`): a bench keyed on raw
  phrasing would never match the category a petition argues about.
- **This does not by itself satisfy R29 AC-0.** Its second clause requires the
  petition to be *evaluated* against the sealed bench, and `evaluateOnSealedBench`
  still has no production caller. The bench now has fuel; the evaluation is the
  next piece.
- The dogfood stub row is left in place, as instructed. It is visible in the
  sealed slice and is a known-bad case, not a secret.
