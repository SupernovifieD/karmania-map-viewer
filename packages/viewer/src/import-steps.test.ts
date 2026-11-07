import { describe, expect, it } from 'vitest';
import { describeStep, FIRST_STEP, IMPORT_STEPS, stepAfter, stepBefore } from './import-steps.js';

describe('the steps of the import wizard', () => {
  it('are file, mapping, nodata, CRS and review, in that order', () => {
    expect(IMPORT_STEPS.map((step) => step.id)).toEqual([
      'file',
      'mapping',
      'nodata',
      'crs',
      'review',
    ]);
    expect(FIRST_STEP).toBe('file');
  });

  it('lead from each to the next and back, and stop at the ends', () => {
    expect(stepAfter('file')).toBe('mapping');
    expect(stepAfter('crs')).toBe('review');
    expect(stepAfter('review')).toBeUndefined();
    expect(stepBefore('review')).toBe('crs');
    expect(stepBefore('mapping')).toBe('file');
    expect(stepBefore('file')).toBeUndefined();
  });

  it('are described by their place and name', () => {
    expect(describeStep('file')).toBe('Step 1 of 5: File');
    expect(describeStep('review')).toBe('Step 5 of 5: Review');
  });
});
