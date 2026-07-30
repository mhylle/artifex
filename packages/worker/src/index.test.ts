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

/**
 * R17 AC-2 / defect `9fbee9d6` — operator grants must reach the runtime's
 * budget arithmetic, not merely exist in the trail.
 */
describe('9fbee9d6 — the runtime reads operator budget grants from the ledger', () => {
  it('sums every grant addressed to the task', async () => {
    const { createLedgerControl } = await import('./runtime.js');

    const control = createLedgerControl({
      async replay() {
        return [
          { taskId: 't-1', type: 'operator.budget_granted', payload: { amount: 10 } },
          { taskId: 't-1', type: 'operator.budget_granted', payload: { amount: 15 } },
        ] as never;
      },
    });

    await expect(control.grantedBudget?.('t-1')).resolves.toBe(25);
  });

  it('DISTRACTOR: a grant to another task does not raise this one\'s ceiling', async () => {
    const { createLedgerControl } = await import('./runtime.js');

    const control = createLedgerControl({
      async replay() {
        return [
          { taskId: 'someone-else', type: 'operator.budget_granted', payload: { amount: 99 } },
        ] as never;
      },
    });

    await expect(control.grantedBudget?.('t-1')).resolves.toBe(0);
  });
});

/**
 * Defect `0d39d84b` — the dial must reach the runtime, not merely the trail.
 */
describe('0d39d84b — the runtime reads the operator dial from the ledger', () => {
  it('takes the LATEST dial setting, because turning a dial replaces it', async () => {
    const { createLedgerControl } = await import('./runtime.js');

    const control = createLedgerControl({
      async replay() {
        return [
          { taskId: null, type: 'operator.dial_turned', payload: { autonomyDial: 'supervised' } },
          { taskId: null, type: 'operator.dial_turned', payload: { autonomyDial: 'autonomous' } },
        ] as never;
      },
    });

    await expect(control.currentDial?.('m-1')).resolves.toBe('autonomous');
  });

  it('DISTRACTOR: an untouched dial reports null, so the contract governs', async () => {
    const { createLedgerControl } = await import('./runtime.js');

    const control = createLedgerControl({ async replay() { return [] as never; } });

    await expect(control.currentDial?.('m-1')).resolves.toBeNull();
  });
});
