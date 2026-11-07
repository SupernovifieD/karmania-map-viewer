/**
 * Keeps the layers of the scene to the datasets that are loaded: a layer for each dataset, and none for a dataset
 * that is gone. The viewer calls it whenever its list of datasets changes, so that the scene is the one place that
 * says what there is to draw (nothing is drawn yet; the renderer reads the scene).
 */
import type { NewDataset, SceneStore } from '@karmania/scene';

/**
 * Makes the layers of `scene` match `datasets`, with the commands of the scene: the layers of a dataset that is no longer
 * in the list are removed, and a layer is added, in its default style and on top, for each dataset that has none. Layers that
 * stay are not touched (their style, their visibility and their place in the legend are the person's). Calling it again
 * with the same datasets changes nothing.
 */
export function syncDatasets(scene: SceneStore, datasets: readonly NewDataset[]): void {
  const loaded = new Set(datasets.map((dataset) => dataset.id));
  const layered = new Set(Object.values(scene.getState().layers).map((layer) => layer.datasetId));
  for (const id of layered) {
    if (!loaded.has(id)) {
      scene.dispatch({ type: 'removeLayersOfDataset', datasetId: id });
    }
  }
  // Nothing to add is the same document, which tells no one.
  scene.dispatch({
    type: 'addLayers',
    datasets: datasets.filter((dataset) => !layered.has(dataset.id)),
  });
}
