import { describe, expect, it } from 'vitest';
import * as render from './index.js';

describe('@karmania/render', () => {
  it('exposes the renderer and the arithmetic of its buffer and its camera', () => {
    expect(Object.keys(render).sort()).toEqual([
      'DEFAULT_DISTANCE_LIMITS',
      'DEFAULT_SCALE_LIMITS',
      'KEY_ORBIT_DEGREES',
      'KEY_PAN_PIXELS',
      'KEY_ROTATE_DEGREES',
      'KEY_ZOOM_FACTOR',
      'LayerSet',
      'MAX_CLASSES',
      'NO_VALUE',
      'OUTLINE_WIDTH',
      'POINTS_PER_PART',
      'POLYGON_OUTLINE_WIDTH',
      'SEGMENTS_PER_PART',
      'TRIANGLES_PER_PART',
      'angleAbout',
      'attachController2d',
      'attachController3d',
      'bufferSize',
      'clampDistance',
      'clampScale',
      'colourOf',
      'combineLayers',
      'createRenderer',
      'gatherSegments',
      'keyAction',
      'keyAction3d',
      'mapToScreen',
      'orbit3dBy',
      'orthographicFrame',
      'pan3dBy',
      'panBy',
      'parseCssColour',
      'perspectiveFrame',
      'rotateAbout',
      'screenToMap',
      'turnBetween',
      'wheelFactor',
      'zoom3dAt',
      'zoomAt',
    ]);
  });
});
