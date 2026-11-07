import { describe, expect, it } from 'vitest';
import * as viewer from './index.js';

describe('@karmania/viewer', () => {
  it('exposes the viewer element and the function that puts one in a page', () => {
    expect(Object.keys(viewer).sort()).toEqual(['KarmaniaViewer', 'createViewer']);
  });
});
