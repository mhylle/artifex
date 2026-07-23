#!/usr/bin/env node
// AI Layer — SessionStart hook. Surfaces current project state so a cold start
// orients fast. Fail-safe by contract: never throws, always exits 0.
import { readFileSync } from 'node:fs';

try {
  let out = 'Artifex — session start\n';
  try {
    const ac = readFileSync('CLAUDE-activeContext.md', 'utf8');
    const m = ac.match(/## Where We Are([\s\S]*?)(?:\n## |$)/);
    if (m) out += '\nWhere we are:\n' + m[1].trim() + '\n';
  } catch { /* activeContext missing — ignore */ }
  out +=
    '\nReminders:\n' +
    '  - Read CLAUDE-activeContext.md for the authoritative current state.\n' +
    '  - This is a tasktracker project ("Artifex"): run getProjectReadiness and set an active task before any artifact-producing work.\n' +
    '  - Honor the 7 invariants (ARCHITECTURE.md); each package has its own CLAUDE.md.\n' +
    '  - Install deps via the package manager (npm install / ng add) — never hand-edit package.json.\n';
  process.stdout.write(out);
} catch { /* a SessionStart hook must never break the session */ }
process.exit(0);
