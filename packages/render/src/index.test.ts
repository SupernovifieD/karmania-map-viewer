import { describe, expect, it } from 'vitest';
import * as render from './index.js';

describe('@karmania/render', () => {
  it('exposes the renderer and the arithmetic of its buffer and its camera', () => {
    expect(Object.keys(render).sort()).toEqual([
      'DEFAULT_SCALE_LIMITS',
      'KEY_PAN_PIXELS',
      'KEY_ROTATE_DEGREES',
      'KEY_ZOOM_FACTOR',
      'LayerSet',
      'OUTLINE_WIDTH',
      'POINTS_PER_PART',
      'angleAbout',
      'attachController2d',
      'bufferSize',
      'clampScale',
      'colourOf',
      'createRenderer',
      'keyAction',
      'mapToScreen',
      'orthographicFrame',
      'panBy',
      'parseCssColour',
      'rotateAbout',
      'screenToMap',
      'turnBetween',
      'wheelFactor',
      'zoomAt',
    ]);
  });
});
