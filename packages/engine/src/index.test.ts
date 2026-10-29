import { describe, expect, it } from 'vitest';
import { groupFiles, PACKAGE_NAME } from './index.js';

describe('@karmania/engine', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@karmania/engine');
  });

  it('exposes the grouping of files, which a page needs to know which sidecar goes with which file', () => {
    const csv = new File(['x,y'], 'points.csv');
    const projection = new File(['PROJCS[]'], 'POINTS.prj');
    expect(groupFiles([csv, projection])).toEqual([{ file: csv, sidecars: [projection] }]);
  });
});
