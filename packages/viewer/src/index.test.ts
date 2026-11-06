import { describe, expect, it } from 'vitest';
import * as viewer from './index.js';

describe('@karmania/viewer', () => {
  it('exposes the viewer element', () => {
    expect(Object.keys(viewer)).toEqual(['KarmaniaViewer']);
  });
});
