/**
 * Commands on the frame (the map's coordinate system and origin) and on the selection. As for the other commands,
 * a value that is not right is refused and gives back the same document, and so does a change that changes nothing.
 */
import type { Frame } from '@karmania/engine/display';
import type { CrsRef } from '@karmania/engine/types';
import { emptyScene } from './empty.js';
import type { SceneDocument, SceneSelection } from './types.js';
import { validateFrame } from './validate.js';
import { validateSelection } from './validate-legend.js';

function sameCrs(a: CrsRef, b: CrsRef): boolean {
  if (a.kind === 'epsg' && b.kind === 'epsg') {
    return a.code === b.code;
  }
  return a.kind === 'local' && b.kind === 'local' && a.units === b.units;
}

function sameFrame(a: Frame | null, b: Frame | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    sameCrs(a.mapCrs, b.mapCrs) &&
    a.source === b.source &&
    a.origin.every((value, i) => value === b.origin[i])
  );
}

/** A copy of the frame, so that nothing that holds the one it was given can change the document's. */
function copyOf(frame: Frame): Frame {
  const crs: CrsRef =
    frame.mapCrs.kind === 'epsg'
      ? { kind: 'epsg', code: frame.mapCrs.code }
      : { kind: 'local', units: frame.mapCrs.units };
  return {
    mapCrs: crs,
    origin: [frame.origin[0], frame.origin[1], frame.origin[2]],
    source: frame.source,
  };
}

/**
 * Sets the frame the map is drawn in, or `null` for none. **When the map's coordinate system changes** (to another,
 * or from or to none) **the cameras go back to their placeholders**, since a camera is in the units of the system and
 * a centre in metres means nothing in degrees; the viewer fits to the data after (step 14.12). A new origin or source
 * in the same system leaves them where they are. A frame that is not right, and one that is the one there is, are the
 * same document.
 */
export function setFrame(doc: SceneDocument, frame: Frame | null): SceneDocument {
  if (validateFrame(frame).length > 0 || sameFrame(doc.frame, frame)) {
    return doc;
  }
  const copy = frame === null ? null : copyOf(frame);
  const sameSystem = copy !== null && doc.frame !== null && sameCrs(doc.frame.mapCrs, copy.mapCrs);
  if (sameSystem) {
    return { ...doc, frame: copy };
  }
  const { camera2d, camera3d } = emptyScene();
  return { ...doc, frame: copy, camera2d, camera3d };
}

/**
 * Picks an element of a layer (from 0), or clears the pick with `null`. A layer that is not there, an element that
 * is not a whole number of 0 or more, and the pick there already is, are all the same document.
 */
export function setSelection(doc: SceneDocument, selection: SceneSelection | null): SceneDocument {
  if (validateSelection(selection, new Set(Object.keys(doc.layers))).length > 0) {
    return doc;
  }
  const now = doc.selection;
  const same =
    selection === null
      ? now === null
      : now !== null && now.layerId === selection.layerId && now.element === selection.element;
  if (same) {
    return doc;
  }
  return {
    ...doc,
    selection:
      selection === null ? null : { layerId: selection.layerId, element: selection.element },
  };
}
