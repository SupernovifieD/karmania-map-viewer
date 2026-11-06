/**
 * Commands on how a layer looks. A change is checked by the same rules as `validateScene` uses for a style and for
 * contours, and one that is not right (an opacity of 2, a colour that is not `#rrggbb`, a ramp that does not exist)
 * is refused whole: the same document comes back, and the document never holds a style it would not accept.
 */
import { validateContours, validateStyle } from './validate-layers.js';
import type {
  ContourParams,
  Layer,
  LayerColour,
  LayerContours,
  LayerStyle,
  SceneDocument,
} from './types.js';

/** The parts of a style to change; the parts that are not given stay as they are. */
export interface StylePatch {
  readonly colour?: LayerColour;
  readonly opacity?: number;
  readonly pointSize?: number;
  readonly lineWidth?: number;
}

function layerOf(doc: SceneDocument, layerId: string): Layer | undefined {
  return Object.hasOwn(doc.layers, layerId) ? doc.layers[layerId] : undefined;
}

function withLayer(doc: SceneDocument, layer: Layer): SceneDocument {
  return { ...doc, layers: { ...doc.layers, [layer.id]: layer } };
}

/** A colour with the digits of a `#rrggbb` in lower case, which is how the document writes them. */
function normalised(colour: LayerColour): LayerColour {
  return colour.mode === 'single' ? { ...colour, value: colour.value.toLowerCase() } : colour;
}

function sameColour(a: LayerColour, b: LayerColour): boolean {
  if (a.mode === 'single' && b.mode === 'single') {
    return a.value === b.value;
  }
  return (
    a.mode === 'classes' &&
    b.mode === 'classes' &&
    a.column === b.column &&
    a.method === b.method &&
    a.classes === b.classes &&
    a.ramp === b.ramp &&
    a.reverse === b.reverse
  );
}

function sameStyle(a: LayerStyle, b: LayerStyle): boolean {
  return (
    sameColour(a.colour, b.colour) &&
    a.opacity === b.opacity &&
    a.pointSize === b.pointSize &&
    a.lineWidth === b.lineWidth
  );
}

/**
 * Changes the style of a layer by `patch`. A layer that is not there, a patch with anything wrong in it (the style it
 * would make is checked as the document checks one), and a patch that changes nothing are all the same document.
 */
export function setStyle(doc: SceneDocument, layerId: string, patch: StylePatch): SceneDocument {
  const layer = layerOf(doc, layerId);
  if (layer === undefined) {
    return doc;
  }
  const style: LayerStyle = {
    ...layer.style,
    ...(patch.colour === undefined ? {} : { colour: normalised(patch.colour) }),
    ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
    ...(patch.pointSize === undefined ? {} : { pointSize: patch.pointSize }),
    ...(patch.lineWidth === undefined ? {} : { lineWidth: patch.lineWidth }),
  };
  if (validateStyle(style).length > 0 || sameStyle(style, layer.style)) {
    return doc;
  }
  return withLayer(doc, { ...layer, style });
}

function sameContours(a: LayerContours | undefined, b: LayerContours | undefined): boolean {
  return (
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      a.column === b.column &&
      a.interval === b.interval &&
      a.base === b.base &&
      a.indexEvery === b.indexEvery &&
      a.visible === b.visible)
  );
}

/**
 * Sets the contour lines of a layer: how they are made (`params`) and whether they are shown, or takes them away
 * (`null`). The lines themselves are made by the engine (step 20.4); this is what the scene remembers about them.
 * A layer that is not there, contours that are not right, a layer that is itself derived (contours are not made of
 * contours), and a change that changes nothing are all the same document.
 */
export function setContours(
  doc: SceneDocument,
  layerId: string,
  contours: (ContourParams & { readonly visible: boolean }) | null,
): SceneDocument {
  const layer = layerOf(doc, layerId);
  if (layer === undefined || (contours !== null && layer.derived !== undefined)) {
    return doc;
  }
  if (contours === null) {
    if (layer.contours === undefined) {
      return doc;
    }
    return withLayer(doc, {
      id: layer.id,
      datasetId: layer.datasetId,
      name: layer.name,
      visible: layer.visible,
      style: layer.style,
      ...(layer.derived === undefined ? {} : { derived: layer.derived }),
    });
  }
  if (validateContours(contours).length > 0 || sameContours(layer.contours, contours)) {
    return doc;
  }
  return withLayer(doc, { ...layer, contours });
}
