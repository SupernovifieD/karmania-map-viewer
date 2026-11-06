/**
 * Commands on the layers: each is a pure function from a document to the next one, and never changes the document it
 * is given. A command that names a layer that is not there (an event that came after the layer was removed) changes
 * nothing, and gives back the very document it was given, which is how a store knows that nothing happened.
 */
import { LAYER_COLOURS, defaultStyle, type DatasetBrief } from './defaults.js';
import { DATASET_KINDS } from './choices.js';
import { nextId, ordinalOf } from './ids.js';
import { isRecord } from './problems.js';
import type { Layer, LegendNode, SceneDocument } from './types.js';

/** A dataset a layer is made for: what the engine says of it when it is loaded (its `Summary` has all of this). */
export interface NewDataset extends DatasetBrief {
  readonly id: number;
  readonly name: string;
}

/** Whether a column is what the engine gives: an object with a name that is text and not empty, and a type that is text. */
function wellFormedColumn(column: unknown): boolean {
  return (
    isRecord(column) &&
    typeof column['name'] === 'string' &&
    column['name'] !== '' &&
    typeof column['type'] === 'string'
  );
}

/**
 * Whether a dataset is what the engine gives: a whole id of 0 or more, a kind there is, a name that is text, and a
 * list of columns that are each what the engine gives (a layer is coloured by the name of one, which a layer must have).
 */
function wellFormed(dataset: NewDataset): boolean {
  return (
    Number.isInteger(dataset.id) &&
    dataset.id >= 0 &&
    DATASET_KINDS.includes(dataset.kind) &&
    typeof dataset.name === 'string' &&
    Array.isArray(dataset.columns) &&
    dataset.columns.every(wellFormedColumn)
  );
}

/**
 * Adds a layer for each dataset, on top of the legend and not in a group, visible, in its default style (the first of
 * the datasets lowest, as if they were added one at a time). The layer is named for the dataset, and is
 * `layer-N` with N one more than the highest there is among all the ids of layers and groups; the colour it gets
 * is the one of that number. **A dataset that is not what the engine gives** (an id that is not a whole number of 0 or
 * more, a kind that there is not, a column with no name) refuses all of them, and nothing to add is the same document.
 */
export function addLayers(doc: SceneDocument, datasets: readonly NewDataset[]): SceneDocument {
  if (datasets.length === 0 || !datasets.every(wellFormed)) {
    return doc;
  }
  const layers: Record<string, Layer> = { ...doc.layers };
  const legend: LegendNode[] = [...doc.legend];
  const taken = new Set([
    ...Object.keys(layers),
    ...doc.legend.flatMap((node) => (node.type === 'group' ? [node.id] : [])),
  ]);
  for (const dataset of datasets) {
    const id = nextId('layer', taken);
    taken.add(id);
    layers[id] = {
      id,
      datasetId: dataset.id,
      name: dataset.name,
      visible: true,
      style: defaultStyle(dataset, ordinalOf(id, LAYER_COLOURS.length)),
    };
    legend.unshift({ type: 'layer', id });
  }
  return { ...doc, layers, legend };
}

/**
 * Takes out every layer of the dataset, and the layers that are made from them (contours of a layer that is gone have
 * nothing to be made from), from the layers and from the legend, a group staying where it is even if it is left
 * empty. The selection is cleared if it was in a layer that went. Nothing to take out is the same document.
 */
export function removeLayersOfDataset(doc: SceneDocument, datasetId: number): SceneDocument {
  const gone = new Set(
    Object.values(doc.layers)
      .filter((layer) => layer.datasetId === datasetId)
      .map((layer) => layer.id),
  );
  if (gone.size === 0) {
    return doc;
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const layer of Object.values(doc.layers)) {
      if (
        layer.derived !== undefined &&
        gone.has(layer.derived.sourceLayer) &&
        !gone.has(layer.id)
      ) {
        gone.add(layer.id);
        grew = true;
      }
    }
  }
  const layers = Object.fromEntries(Object.entries(doc.layers).filter(([id]) => !gone.has(id)));
  const legend = doc.legend.flatMap((node): LegendNode[] => {
    if (node.type === 'layer') {
      return gone.has(node.id) ? [] : [node];
    }
    return [{ ...node, children: node.children.filter((id) => !gone.has(id)) }];
  });
  const selected = doc.selection !== null && gone.has(doc.selection.layerId);
  return { ...doc, layers, legend, selection: selected ? null : doc.selection };
}

/** Shows or hides a layer. A layer that is not there, or that already is so, is the same document. */
export function setVisible(doc: SceneDocument, layerId: string, visible: boolean): SceneDocument {
  const layer = Object.hasOwn(doc.layers, layerId) ? doc.layers[layerId] : undefined;
  if (layer === undefined || layer.visible === visible) {
    return doc;
  }
  return { ...doc, layers: { ...doc.layers, [layerId]: { ...layer, visible } } };
}

/**
 * Shows or hides every layer in a group, which is how the checkbox of a group works (whether a group looks
 * checked, unchecked or in between is for the legend model to say, from its layers). A group that is not there, or
 * whose layers are all so already, is the same document.
 */
export function setGroupVisible(
  doc: SceneDocument,
  groupId: string,
  visible: boolean,
): SceneDocument {
  const group = doc.legend.find((node) => node.type === 'group' && node.id === groupId);
  if (group?.type !== 'group') {
    return doc;
  }
  let changed = false;
  const layers: Record<string, Layer> = { ...doc.layers };
  for (const id of group.children) {
    const layer = layers[id];
    if (layer !== undefined && layer.visible !== visible) {
      layers[id] = { ...layer, visible };
      changed = true;
    }
  }
  return changed ? { ...doc, layers } : doc;
}
