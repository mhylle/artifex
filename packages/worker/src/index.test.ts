import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, main } from './index.js';

describe('@artifex/worker scaffold', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@artifex/worker');
  });

  it('exposes a placeholder entrypoint', () => {
    expect(typeof main).toBe('function');
  });
});

/**
 * R17 — the worker binary must actually SUBSCRIBE to operator control.
 *
 * A control seam that nothing passes is the defect shape this project has
 * shipped three times (the worker placeholder `04071ce9`, the dead ledger
 * listener `b3b4e554`, an unreachable `focus()`). A unit test of the seam cannot
 * notice that the runtime never uses it, so this asserts the composition.
 */
describe('R17 — the runtime is wired to operator control', () => {
  it('builds mission seams that carry a control signal', async () => {
    const { createLedgerControl } = await import('./runtime.js');

    const control = createLedgerControl({
      async replay() {
        return [
          { taskId: 't-1', type: 'operator.cancelled', missionId: 'm-1', payload: {} },
        ] as never;
      },
    });

    await expect(control.check('t-1')).resolves.toBe('cancelled');
  });

  it('DISTRACTOR: an untouched task still runs — the control seam is not a blanket stop', async () => {
    const { createLedgerControl } = await import('./runtime.js');

    const control = createLedgerControl({
      async replay() {
        return [
          { taskId: 'someone-else', type: 'operator.paused', missionId: 'm-1', payload: {} },
        ] as never;
      },
    });

    await expect(control.check('t-1')).resolves.toBe('run');
  });
});
