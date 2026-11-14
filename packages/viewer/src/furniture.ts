/**
 * What the furniture over the map shows, worked out from the scene (section 10.2 of the brief): which way the north arrow's needle
 * points and what the scale bar says. It is made again whenever the camera, the view or the map's coordinate system change, and
 * `sameFurniture` says whether anything the furniture shows is different, so that a pan (which changes neither) draws nothing again.
 */
import type { CrsInfo } from '@karmania/engine';
import { scaleBar } from '@karmania/scene';
import type { SceneDocument, ScaleBarModel } from '@karmania/scene';
import { headingOf } from './heading.js';
import { mapCrsText } from './map-crs-text.js';
import { mapLabel } from './map-label.js';
import type { MapCrsText } from './map-crs-text.js';
import { unitsOf } from './map-units.js';

/** What the furniture shows. */
export interface Furniture {
  /** The heading of the camera of the view that is shown, in degrees clockwise from grid north: the north arrow's needle turns with it. */
  readonly heading: number;
  /** The scale bar, or why there is none. */
  readonly scale: ScaleBarModel;
  /** What the status chip's button says of the map's coordinate system. */
  readonly crs: MapCrsText;
  /** What the map is called for those who cannot see it: the canvas's accessible name. */
  readonly label: string;
}

/**
 * The furniture for the scene as it is. `info` is what the definitions say of the code of the map's coordinate system (see `unitsOf`):
 * the scale bar is measured in its units.
 */
export function furnitureOf(state: SceneDocument, info: CrsInfo | null | undefined): Furniture {
  return {
    heading: headingOf(state),
    scale: scaleBar({
      viewMode: state.viewMode,
      units: unitsOf(state.frame, info),
      unitsPerPixel: state.camera2d.unitsPerPixel,
    }),
    crs: mapCrsText(state.frame, info),
    label: mapLabel(state),
  };
}

/** Whether two scale bars look the same: the same bar of the same width (to the pixel), or the same reason for none. */
function sameScale(a: ScaleBarModel, b: ScaleBarModel): boolean {
  if (a.kind === 'bar' && b.kind === 'bar') {
    return a.label === b.label && Math.round(a.widthPx) === Math.round(b.widthPx);
  }
  return a.kind === 'none' && b.kind === 'none' && a.reason === b.reason;
}

/** Whether what two furnitures show is the same. */
export function sameFurniture(a: Furniture, b: Furniture): boolean {
  return (
    a.heading === b.heading &&
    sameScale(a.scale, b.scale) &&
    a.crs.label === b.crs.label &&
    a.crs.title === b.crs.title &&
    a.label === b.label
  );
}
