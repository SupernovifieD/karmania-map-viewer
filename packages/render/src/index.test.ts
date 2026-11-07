import { describe, expect, it } from 'vitest';
import * as render from './index.js';

describe('@karmania/render', () => {
  it('exposes the renderer and the arithmetic of its buffer', () => {
    expect(Object.keys(render).sort()).toEqual(['bufferSize', 'createRenderer']);
  });
});
