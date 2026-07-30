/**
 * R15 AC-1 — state is carried by border + icon + text label, NEVER colour alone.
 *
 * This is a binding rule from `solution/observability.html` ("state = border +
 * icon + label, never color alone"), not a preference. An operator who is
 * colour-blind, or reading a screenshot in greyscale, or looking at a projector
 * with the gamma wrong, must still be able to tell a verified task from a failed
 * one. Colour is an accelerator, never the carrier.
 */
import { describe, expect, it } from 'vitest';

import { ALL_TASK_STATUSES, nodeGlyph } from './canvas-node';
import type { TaskStatus } from './mission-tree';

describe('R15 AC-1 — every state is legible without colour', () => {
  it('gives every status both an icon and a text label', () => {
    for (const status of ALL_TASK_STATUSES) {
      const glyph = nodeGlyph(status);
      expect(glyph.icon.length, `${status} needs an icon`).toBeGreaterThan(0);
      expect(glyph.label.length, `${status} needs a label`).toBeGreaterThan(0);
    }
  });

  it('DISTRACTOR: no two statuses share an icon', () => {
    // One icon reused across states would push the entire distinction onto
    // colour — passing the test above while failing the actual requirement.
    const icons = ALL_TASK_STATUSES.map((s) => nodeGlyph(s).icon);

    expect(new Set(icons).size).toBe(icons.length);
  });

  it('DISTRACTOR: no two statuses share a label', () => {
    const labels = ALL_TASK_STATUSES.map((s) => nodeGlyph(s).label);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('DISTRACTOR: the label names the state, so it survives being read aloud', () => {
    // A label like "•" or "1" is technically distinct and tells a screen-reader
    // user nothing.
    for (const status of ALL_TASK_STATUSES) {
      expect(nodeGlyph(status).label.toLowerCase()).toContain(status.slice(0, 4));
    }
  });

  it('falls back to a stated unknown rather than rendering a blank node', () => {
    const glyph = nodeGlyph('something-new' as TaskStatus);

    expect(glyph.icon.length).toBeGreaterThan(0);
    expect(glyph.label.length).toBeGreaterThan(0);
  });
});
