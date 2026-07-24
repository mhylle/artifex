import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@artifex/shared-types scaffold', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@artifex/shared-types');
  });
});
