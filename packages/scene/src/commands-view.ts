/**
 * Commands on how the map is looked at: the view, the exaggeration of heights and the two cameras. As for the other
 * commands, a value that is not right is refused whole and gives back the same document, and a change that changes
 * nothing is the same document. Two values are made right and not refused, because the brief says what they are: the
 * elevation of the 3D camera is held between -89 and 89 degrees (section 9.5), and a heading is turned into the
 * degrees from 0 up to 360 that it is the same direction as.
 */
import { VERTICAL_EXAGGERATIONS, VIEW_MODES } from './types.js';
import { validateCamera2d, validateCamera3d } from './validate.js';
import type { Camera2d, Camera3d, SceneDocument, VerticalExaggeration, ViewMode } from './types.js';

/** Looks at the map from above (`2d`) or in perspective (`3d`). Anything else, or the view it has, is the same document. */
export function setViewMode(doc: SceneDocument, mode: ViewMode): SceneDocument {
  if (!VIEW_MODES.includes(mode) || doc.viewMode === mode) {
    return doc;
  }
  return { ...doc, viewMode: mode };
}

/** Multiplies the heights in 3D by `factor`: 1, 2, 3, 5 or 10. Anything else, or the factor it has, is the same document. */
export function setVerticalExaggeration(
  doc: SceneDocument,
  factor: VerticalExaggeration,
): SceneDocument {
  if (!VERTICAL_EXAGGERATIONS.includes(factor) || doc.verticalExaggeration === factor) {
    return doc;
  }
  return { ...doc, verticalExaggeration: factor };
}

/** The degrees from 0 up to, not including, 360 that point the same way as `degrees`; anything not a number is left for the check to refuse. */
export function normalHeading(degrees: number): number {
  return Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : degrees;
}

/** The elevation held between -89 and 89 degrees; anything not a number is left for the check to refuse. */
export function heldElevation(degrees: number): number {
  return Number.isFinite(degrees) ? Math.min(89, Math.max(-89, degrees)) : degrees;
}

/** The parts of the cameras to change; a part that is given may itself have only some of its fields. */
export interface CameraPatch {
  readonly camera2d?: Partial<Camera2d>;
  readonly camera3d?: Partial<Camera3d>;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  // Both are the right length by now: a centre or a target of any other length was refused.
  return a.every((value, i) => value === b[i]);
}

/**
 * Moves the cameras by `patch`. A heading that is given is turned into 0 up to 360 and an elevation held between -89 and 89;
 * any other value that is not right (a scale, a distance or a field of view that is not above 0, a position that
 * is not a number) refuses the whole change, which is then the same document, as is a change that changes nothing.
 */
export function setCamera(doc: SceneDocument, patch: CameraPatch): SceneDocument {
  let camera2d: Camera2d = doc.camera2d;
  let camera3d: Camera3d = doc.camera3d;
  if (patch.camera2d !== undefined) {
    const part = patch.camera2d;
    camera2d = {
      centre: part.centre ?? doc.camera2d.centre,
      unitsPerPixel: part.unitsPerPixel ?? doc.camera2d.unitsPerPixel,
      heading: part.heading === undefined ? doc.camera2d.heading : normalHeading(part.heading),
    };
    if (validateCamera2d(camera2d).length > 0) {
      return doc;
    }
  }
  if (patch.camera3d !== undefined) {
    const part = patch.camera3d;
    camera3d = {
      target: part.target ?? doc.camera3d.target,
      distance: part.distance ?? doc.camera3d.distance,
      heading: part.heading === undefined ? doc.camera3d.heading : normalHeading(part.heading),
      // A valid document's elevation is already held, so holding it again when it is not given changes nothing.
      elevation: heldElevation(part.elevation ?? doc.camera3d.elevation),
      fov: part.fov ?? doc.camera3d.fov,
    };
    if (validateCamera3d(camera3d).length > 0) {
      return doc;
    }
  }
  const same2d =
    sameNumbers(camera2d.centre, doc.camera2d.centre) &&
    camera2d.unitsPerPixel === doc.camera2d.unitsPerPixel &&
    camera2d.heading === doc.camera2d.heading;
  const same3d =
    sameNumbers(camera3d.target, doc.camera3d.target) &&
    camera3d.distance === doc.camera3d.distance &&
    camera3d.heading === doc.camera3d.heading &&
    camera3d.elevation === doc.camera3d.elevation &&
    camera3d.fov === doc.camera3d.fov;
  return same2d && same3d ? doc : { ...doc, camera2d, camera3d };
}
