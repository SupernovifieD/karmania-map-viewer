/**
 * The camera of the exported picture (section 10.6 of the brief): the picture shows **at least the area that is visible on screen**, with the same
 * centre, heading and view (and the same elevation, in 3D); the other dimension extends as the aspect ratio of the picture requires. It is worked out for
 * the rectangle of the map in the picture and not for the whole picture (the legend takes the rest), and from the size of the map on screen. Plain
 * arithmetic, with no clock and no DOM. This is not `cameraTo2d` or `cameraTo3d` (which change the view) and not a fit (which changes where it looks).
 */
import type { Size } from './export-layout.js';
import type { Camera2d, Camera3d } from './types.js';

/**
 * The widest vertical field of view that an export gives a perspective camera, in degrees. A picture that is much taller than the screen is wide would need
 * a lens near 180 degrees, which stretches what is at the sides, so beyond this the camera is moved back and the lens stays at this.
 */
export const MAX_EXPORT_FOV = 120;

const RADIANS = Math.PI / 180;

function usable(size: Size, name: string): void {
  if (!(
    size.width > 0 &&
    size.height > 0 &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height)
  )) {
    throw new RangeError(`The ${name} has no size.`);
  }
}

/**
 * The 2D camera of an export. `screen` is the map on screen in CSS pixels, `map` the rectangle of the map in the picture in pixels of the picture, and
 * `scale` is `dpi / 96`, so the map is `map / scale` CSS pixels, and each of them is `unitsPerPixel` map units: the units to a pixel are those of the screen
 * times how much more the screen is across (or high) than the picture is, whichever is more, so that neither side shows less.
 *
 * @throws RangeError for a size that is not a positive number, or a scale that is not (a mistake of the caller).
 */
export function exportCamera2d(camera: Camera2d, screen: Size, map: Size, scale: number): Camera2d {
  usable(screen, 'screen');
  usable(map, 'map in the picture');
  if (!(scale > 0 && Number.isFinite(scale))) {
    throw new RangeError('The scale is not a positive number.');
  }
  const factor = Math.max(screen.width / (map.width / scale), screen.height / (map.height / scale));
  return { ...camera, unitsPerPixel: camera.unitsPerPixel * factor };
}

/**
 * The 3D camera of an export: the target, heading and elevation are the camera's, and the lens is widened so that the vertical half extent at the target
 * is the screen's or more, and so is the horizontal one: `tan(fov / 2)` is that of the screen times how much wider the screen's aspect ratio is than the
 * picture's, if it is. Past `MAX_EXPORT_FOV` the lens stays at it and the camera is moved back from the target by what the lens would have shown more. A
 * picture of the aspect ratio of the screen, or a wider one, is shown with the camera as it is.
 *
 * @throws RangeError for a size that is not a positive number (a mistake of the caller).
 */
export function exportCamera3d(camera: Camera3d, screen: Size, map: Size): Camera3d {
  usable(screen, 'screen');
  usable(map, 'map in the picture');
  const wider = screen.width / screen.height / (map.width / map.height);
  if (wider <= 1) {
    return camera;
  }
  const half = Math.tan((camera.fov * RADIANS) / 2) * wider;
  const widest = Math.tan((MAX_EXPORT_FOV * RADIANS) / 2);
  if (half <= widest) {
    return { ...camera, fov: (2 * Math.atan(half)) / RADIANS };
  }
  return { ...camera, fov: MAX_EXPORT_FOV, distance: (camera.distance * half) / widest };
}
