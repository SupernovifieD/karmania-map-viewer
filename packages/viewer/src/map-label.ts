/**
 * What the map is called for those who cannot see it (section 10.2 of the brief): the name of the picture the canvas is, kept current as the
 * view, the layers and the heading change, for example `Map, 2D view, 3 layers, turned 30° from north`.
 */
import { northArrow } from '@karmania/scene';
import type { SceneDocument } from '@karmania/scene';

/** How many layers, in words. */
function layersIn(count: number): string {
  return count === 0 ? 'no layers' : `${String(count)} ${count === 1 ? 'layer' : 'layers'}`;
}

/**
 * The name of the map for the scene as it is: the view, how many layers there are, and how the map is turned from north. The view is the scene's
 * `viewMode`, and the renderer draws 2D until M18, so a scene in 3D is named so while 2D is what is drawn.
 */
export function mapLabel(
  scene: Pick<SceneDocument, 'viewMode' | 'layers'> & {
    camera2d: Pick<SceneDocument['camera2d'], 'heading'>;
  },
): string {
  const arrow = northArrow(scene.camera2d.heading);
  return [
    'Map',
    `${scene.viewMode === '3d' ? '3D' : '2D'} view`,
    layersIn(Object.keys(scene.layers).length),
    arrow.northUp ? 'north up' : `turned ${String(arrow.degrees)}° from north`,
  ].join(', ');
}

/** What the keys do on the map in the 2D view, for a screen reader to be told when the map has the keyboard. */
export const KEYS_2D =
  'The arrow keys move the map. Plus and minus zoom in and out. Shift with the left or right arrow turns the map by 15 degrees. 0 puts north up. Home fits the map to the data.';

/** What the keys do on the map in the 3D view, for a screen reader to be told when the map has the keyboard. */
export const KEYS_3D =
  'The arrow keys orbit the map. Shift with an arrow pans the map. Plus and minus zoom in and out. Home fits the map to the data.';
