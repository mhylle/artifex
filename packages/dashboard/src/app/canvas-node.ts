/**
 * One node on the canvas (R15), rendering itself and its children.
 *
 * Recursive by design: a mission's tree is arbitrarily deep, so the component
 * that draws a node is the same one that draws its subtree. Collapse state lives
 * here rather than in the projection — it is a property of *looking*, not of the
 * mission, and the tree must stay a pure function of the ledger.
 */
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import type { TaskNode, TaskStatus } from './mission-tree';

export interface Glyph {
  readonly icon: string;
  readonly label: string;
}

/** Every status the projection can produce — the list the accessibility tests iterate. */
export const ALL_TASK_STATUSES = [
  'contracted',
  'staffed',
  'executing',
  'verified',
  'failed',
  'bounced',
] as const satisfies readonly TaskStatus[];

const GLYPHS: Record<TaskStatus, Glyph> = {
  contracted: { icon: '◇', label: 'contracted' },
  staffed: { icon: '◈', label: 'staffed' },
  executing: { icon: '▶', label: 'executing' },
  verified: { icon: '✓', label: 'verified' },
  failed: { icon: '✕', label: 'failed' },
  bounced: { icon: '⚠', label: 'bounced' },
};

/**
 * The icon and words for a state.
 *
 * Both are always present. Colour is applied in CSS on top of these, never
 * instead of them — see the tests, which assert distinctness of icons and
 * labels independently.
 */
export function nodeGlyph(status: TaskStatus): Glyph {
  // An unrecognised status is stated rather than rendered blank: a node with no
  // marking reads as "nothing happened here", which is the one thing it is not.
  return GLYPHS[status] ?? { icon: '?', label: `unknown (${String(status)})` };
}

@Component({
  selector: 'app-canvas-node',
  standalone: true,
  imports: [CanvasNode],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './canvas-node.html',
  styleUrl: './canvas-node.css',
})
export class CanvasNode {
  readonly node = input.required<TaskNode>();
  readonly selectedTaskId = input<string | null>(null);
  readonly selectTask = output<string>();
  /** Drill into this subtree — the affordance the breadcrumb needs to exist. */
  readonly focusTask = output<string>();

  /** View state only. Collapsing hides nothing from the ledger. */
  readonly collapsed = signal(false);

  glyph(status: TaskStatus): Glyph {
    return nodeGlyph(status);
  }

  toggle(): void {
    this.collapsed.update((value) => !value);
  }
}
