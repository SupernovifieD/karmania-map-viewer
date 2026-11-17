import { describe, expect, it } from 'vitest';
import * as viewer from './index.js';

describe('@karmania/viewer', () => {
  it('exposes the viewer element, the function that puts one in a page, and the engine with what loads a dataset into it', () => {
    expect(Object.keys(viewer).sort()).toEqual([
      'ComposeError',
      'EngineDisposedError',
      'EngineError',
      'ExportError',
      'ExportFontError',
      'KarmaniaViewer',
      'PngError',
      'blocks',
      'createEngine',
      'createViewer',
      'grid',
      'lines',
      'mesh',
      'points',
      'polygons',
    ]);
  });
});
