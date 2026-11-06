/** The scene a viewer starts with: nothing in it. */
import { SCENE_VERSION, type SceneDocument } from './types.js';

/**
 * A scene with no layers and no frame. The cameras are placeholders (the map is 2D, looking at the origin of an
 * unknown system): the first fit to data, step 14.12, sets them, and nothing draws before there is a frame.
 */
export function emptyScene(): SceneDocument {
  return {
    version: SCENE_VERSION,
    frame: null,
    viewMode: '2d',
    camera2d: { centre: [0, 0], unitsPerPixel: 1, heading: 0 },
    camera3d: { target: [0, 0, 0], distance: 1000, heading: 0, elevation: 45, fov: 45 },
    verticalExaggeration: 1,
    legend: [],
    layers: {},
    selection: null,
  };
}
