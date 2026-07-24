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
