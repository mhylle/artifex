/**
 * Every mechanism must be reachable from the deployable process.
 *
 * This repo's most expensive recurring defect is a correct, tested mechanism
 * that nothing in the running system calls. It has now happened five times:
 * `packages/worker`'s `main()` was a placeholder while the P13 dogfood passed
 * 20/20 (`cd18baa0`); the science loop is built only by its own test
 * (`a1288794`); and `ActionBroker`, `LearningProjection` and
 * `evaluateOnSealedBench` have no production caller at all (`635b7a9f`). Three
 * of those belong to requirements marked SATISFIED, because acceptance criteria
 * and defect counts cannot see reachability — the tests pass, the pillars are
 * green, and the process never runs the code.
 *
 * So the check becomes a test rather than a habit. A habit found these; a test
 * is what stops the sixth.
 *
 * **The rule is deliberately narrow, because a broad one would be noise.** Only
 * exported CLASSES, and only the ones nothing else constructs or names. A class
 * is the right unit: it exists to be instantiated, so a class no production file
 * mentions is unreachable in a way a pure function is not — a helper called
 * solely by its own module is ordinary, and flagging those would produce a list
 * nobody reads.
 *
 * `*Error` classes are excluded for the same reason. They are thrown where they
 * are defined and usually caught structurally rather than by name, so "nothing
 * else mentions it" is the normal, correct state for an error type.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Mechanisms known to be unreachable, each tied to the open defect that says so.
 *
 * This is not a suppression list. Every entry is a defect somebody has to fix,
 * and an entry whose defect is closed should fail this test — which is the point:
 * the list is how a known gap stays visible instead of becoming a habit.
 */
const KNOWN_UNREACHABLE: ReadonlyArray<{ readonly name: string; readonly defect: string }> = [
  // `ActionBroker` was listed here from ADR-0015 until 2026-07-31, when the four
  // missing links were closed (R13 AC-0): intake grants by blast radius,
  // `worker-seams.ts` constructs the broker, and the work seam reaches it. The
  // anti-rot assertion below is what forced this entry out — it failed the
  // moment the broker gained a production caller, which is the allowlist
  // working rather than breaking.
  {
    name: 'LearningProjection',
    defect:
      'SUPERSEDED, not a gap — recorded like `createModelPlanner` rather than ' +
      'deleted. R11 built it as the v0 boundary proof ("proves the boundary that ' +
      'later admits the full science loop"), and R27 brought the projection the ' +
      'system actually learns from: `LedgerEvidenceSource`, wired in `index.ts` ' +
      'and in `buildScienceLoop`. Its report is genuinely unread — `tierBumps` ' +
      'and `errorClasses` appear nowhere outside the class itself. R11 AC-0 is ' +
      'proven on the LIVE path by `projection-read-only.test.ts`, which makes the ' +
      'same behavioural argument this class pioneered: hand the component a store ' +
      'that really can write, and assert it never does.',
  },
];

function productionSources(dir: string, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      productionSources(path, out);
      continue;
    }
    // `.d.ts` is excluded with the tests: a declaration file re-states a symbol
    // without calling it, so counting it as a reference would make every built
    // package vouch for its own dead code.
    if (!path.endsWith('.ts') || path.endsWith('.test.ts') || path.endsWith('.d.ts')) continue;
    out.push([path, readFileSync(path, 'utf8')]);
  }
  return out;
}

function unreachableClasses(): string[] {
  const sources: Array<[string, string]> = [];
  for (const pkg of readdirSync(`${REPO}packages`)) {
    try {
      productionSources(`${REPO}packages/${pkg}/src`, sources);
    } catch {
      // A package without a `src` directory is not a finding.
    }
  }

  const unreachable: string[] = [];
  for (const [file, src] of sources) {
    for (const match of src.matchAll(/^export (?:abstract )?class (\w+)/gm)) {
      const name = match[1]!;
      if (name.endsWith('Error')) continue;
      const mentioned = new RegExp(`\\b${name}\\b`);
      if (!sources.some(([other, text]) => other !== file && mentioned.test(text))) {
        unreachable.push(name);
      }
    }
  }
  return unreachable;
}

describe('every exported class is reachable from some other production file', () => {
  it('finds no unreachable class that is not a known, defect-tracked gap', () => {
    const known = new Set(KNOWN_UNREACHABLE.map((entry) => entry.name));
    const surprises = unreachableClasses().filter((name) => !known.has(name));

    expect(surprises, 'a mechanism nothing constructs — wire it or log a defect and list it here').toEqual([]);
  });

  it('every KNOWN_UNREACHABLE entry is still unreachable, so the list cannot rot', () => {
    // The failure mode of any allowlist: an entry gets fixed, nobody removes it,
    // and the list slowly stops describing reality until it is only noise. If a
    // listed class becomes reachable, this fails and the entry must go.
    const unreachable = new Set(unreachableClasses());
    const stale = KNOWN_UNREACHABLE.filter((entry) => !unreachable.has(entry.name)).map((e) => e.name);

    expect(stale, 'these are wired now — delete them from KNOWN_UNREACHABLE').toEqual([]);
  });

  it('DISTRACTOR: the scan actually finds classes, so an empty result is not a pass', () => {
    // Every assertion above is satisfied by a scanner that returns nothing —
    // a broken glob, a wrong repo root, a regex that matches no `export class`.
    // Iteration 70's orphan sweep produced exactly that kind of lie in reverse,
    // reporting `staff` and `capabilityOf` as uncalled because a heredoc had
    // mangled `\b` in its regex. So the scan is asserted to see the codebase.
    const sources: Array<[string, string]> = [];
    for (const pkg of readdirSync(`${REPO}packages`)) {
      try {
        productionSources(`${REPO}packages/${pkg}/src`, sources);
      } catch { /* no src */ }
    }

    expect(sources.length).toBeGreaterThan(50);
    const classes = sources.flatMap(([, src]) => [...src.matchAll(/^export (?:abstract )?class (\w+)/gm)]);
    expect(classes.length).toBeGreaterThan(10);
  });

  it('DISTRACTOR: a class REFERENCED only by a test still counts as unreachable', () => {
    // The whole point: a scan that counted test files would call a
    // test-only class reachable and report nothing — which is precisely how
    // three requirements came to be marked satisfied.
    //
    // The example USED to be `ActionBroker`, constructed four times in
    // `action-broker.test.ts` and nowhere else. It is wired now
    // (`worker-seams.ts`, R13 AC-0), and this assertion is what noticed —
    // the anti-rot check failed the moment the broker gained a production
    // caller, which is the allowlist working rather than breaking.
    //
    // `LearningProjection` carries the property now. It is SUPERSEDED rather
    // than pending (defect `a1288794`), so it will not be wired away, which
    // makes it a stable subject for this distractor.
    expect(unreachableClasses()).toContain('LearningProjection');
  });
});
