/**
 * The layer of the contour lines of a layer (brief 10.3 and 11.6): a layer of its own, derived from its source, listed directly under it in the
 * legend, which takes the lines the engine made as its dataset. The engine makes the lines (a new dataset each time); this says which layer shows
 * them, so that the style a person gave the lines (their colour, opacity, width) stays when they are made again with other settings.
 */
import { withoutLayers } from './commands-layers.js';
import { nextId } from './ids.js';
import type { Layer, LegendNode, SceneDocument } from './types.js';

/** The colour the lines of contours have when they are first made: a brown, as on a topographic map, that shows on the light and on the dark map. */
export const CONTOURS_COLOUR = '#a0713f';

/** The layer made from `sourceLayer` as contours, if it has one. */
function contoursOf(doc: SceneDocument, sourceLayer: string): Layer | undefined {
  return Object.values(doc.layers).find(
    (layer) => layer.derived?.kind === 'contours' && layer.derived.sourceLayer === sourceLayer,
  );
}

/** The legend with `id` put directly after `after`, in whichever group `after` is in (or at the top level). */
function placedAfter(legend: readonly LegendNode[], after: string, id: string): LegendNode[] {
  return legend.flatMap((node): LegendNode[] => {
    if (node.type === 'layer') {
      return node.id === after ? [node, { type: 'layer', id }] : [node];
    }
    const at = node.children.indexOf(after);
    return [
      at < 0
        ? node
        : {
            ...node,
            children: [...node.children.slice(0, at + 1), id, ...node.children.slice(at + 1)],
          },
    ];
  });
}

/**
 * Makes the layer that shows the contour lines of `sourceLayer` show the dataset `datasetId` (the lines the engine made), or takes it away
 * (`null`). Without such a layer one is made, directly under its source in the legend (in its group, if it has one), visible if the contours
 * of the source are, and in a style of its own: one brown colour, solid, one pixel wide. With one, it is given the dataset and the `name` and
 * keeps its place and its style, which are the person's. A source that is not a layer, or is itself made from another layer (contours are not made of contours),
 * a dataset that is not a whole number of 0 or more, and what is already so, are the same document.
 */
export function setContoursLayer(
  doc: SceneDocument,
  sourceLayer: string,
  datasetId: number | null,
  name?: string,
): SceneDocument {
  const source = Object.hasOwn(doc.layers, sourceLayer) ? doc.layers[sourceLayer] : undefined;
  if (source === undefined || source.derived !== undefined) {
    return doc;
  }
  const existing = contoursOf(doc, sourceLayer);
  if (datasetId === null) {
    return existing === undefined ? doc : withoutLayers(doc, new Set([existing.id]));
  }
  if (typeof datasetId !== 'number' || !Number.isInteger(datasetId) || datasetId < 0) {
    return doc;
  }
  const called = typeof name === 'string' && name !== '' ? name : undefined;
  if (existing !== undefined) {
    const next = { ...existing, datasetId, name: called ?? existing.name };
    return next.datasetId === existing.datasetId && next.name === existing.name
      ? doc
      : { ...doc, layers: { ...doc.layers, [existing.id]: next } };
  }
  const taken = new Set([
    ...Object.keys(doc.layers),
    ...doc.legend.flatMap((node) => (node.type === 'group' ? [node.id] : [])),
  ]);
  const id = nextId('layer', taken);
  const layer: Layer = {
    id,
    datasetId,
    name: called ?? `Contours of ${source.name}`,
    visible: source.contours?.visible ?? true,
    style: { colour: { mode: 'single', value: CONTOURS_COLOUR }, opacity: 1, lineWidth: 1 },
    derived: { kind: 'contours', sourceLayer },
  };
  return {
    ...doc,
    layers: { ...doc.layers, [id]: layer },
    legend: placedAfter(doc.legend, sourceLayer, id),
  };
}
