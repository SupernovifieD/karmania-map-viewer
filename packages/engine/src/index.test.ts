import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@karmania/engine', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@karmania/engine');
  });
});
