/**
 * Commands on the layers: each is a pure function from a document to the next one, and never changes the document it
 * is given. A command that names a layer that is not there (an event that came after the layer was removed) changes
 * nothing, and gives back the very document it was given, which is how a store knows that nothing happened.
 */
import { defaultStyle, type DatasetBrief } from './defaults.js';
import { nextId, numberOf } from './ids.js';
import type { Layer, LegendNode, SceneDocument } from './types.js';

/** A dataset a layer is made for: what the engine says of it when it is loaded (its `Summary` has all of this). */
export interface NewDataset extends DatasetBrief {
  readonly id: number;
  readonly name: string;
}

/**
 * Adds a layer for each dataset, on top of the legend and not in a group, visible, in its default style (the first of
 * the datasets lowest, as if they were added one at a time). The layer is named for the dataset, and is
 * `layer-N` with N one more than the highest there is; the colour it gets is the one of that number.
 */
export function addLayers(doc: SceneDocument, datasets: readonly NewDataset[]): SceneDocument {
  if (datasets.length === 0) {
    return doc;
  }
  const layers: Record<string, Layer> = { ...doc.layers };
  const legend: LegendNode[] = [...doc.legend];
  for (const dataset of datasets) {
    const id = nextId('layer', Object.keys(layers));
    layers[id] = {
      id,
      datasetId: dataset.id,
      name: dataset.name,
      visible: true,
      style: defaultStyle(dataset, numberOf(id) - 1),
    };
    legend.unshift({ type: 'layer', id });
  }
  return { ...doc, layers, legend };
}
