#!/usr/bin/env node
// AI Layer — self-improving Stop hook. Nudges the end-of-session sync ritual so
// learnings and state don't evaporate. Fail-safe: never throws, always exits 0.
try {
  process.stdout.write(
    [
      'Artifex — before stopping, if this session did meaningful work:',
      '  - Update CLAUDE-activeContext.md (where we are / next options).',
      '  - Add a history/ entry for any real state transition (bump history/.counter, add the index row).',
      '  - Mirror key new facts to auto memory; log tasktracker defects/learnings/frictions as insights (not chat narrative).',
      '  - Commit AND push (origin -> github.com/mhylle/artifex).',
      '  (/update-memory-bank does the first three.)',
      '',
    ].join('\n'),
  );
} catch { /* never block a stop */ }
process.exit(0);
