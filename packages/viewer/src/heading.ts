import type { SceneDocument } from '@karmania/scene';

/**
 * The heading the map is looking at, in degrees clockwise from grid north: that of the camera of the view that is shown, the 2D camera's in 2D and the
 * 3D camera's in 3D (section 9.5 of the brief: heading is shared by the two views, and a switch keeps it, but each camera holds its own until then).
 */
export function headingOf(
  scene: Pick<SceneDocument, 'viewMode'> & {
    camera2d: Pick<SceneDocument['camera2d'], 'heading'>;
    camera3d: Pick<SceneDocument['camera3d'], 'heading'>;
  },
): number {
  return scene.viewMode === '3d' ? scene.camera3d.heading : scene.camera2d.heading;
}
