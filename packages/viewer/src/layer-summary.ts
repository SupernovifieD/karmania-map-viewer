/**
 * What the map area says of the layers as a whole (section 10.2 of the brief): how many are being prepared and how far along, and, once
 * none is being prepared and none can be drawn, why each cannot. The pipeline knows where each layer is; this is what a person is told.
 */
import { said } from './finding-text.js';
import type { LayerState } from './layer-pipeline.js';

export interface LayerSummary {
  /** How many layers are being prepared. */
  readonly preparing: number;
  /** How far along the layers are altogether, from 0 to 1: a layer that is ready counts whole. 0 for no layers. */
  readonly progress: number;
  /** One sentence for each layer that cannot be drawn, when there is at least one layer, none is being prepared, and none is drawn; else none. */
  readonly reasons: readonly string[];
}

/** Why a layer that is not drawn is not. */
export function reasonOf(state: LayerState): string | undefined {
  switch (state.status) {
    case 'not_drawn':
      return said(state.findings[0], 'It cannot be drawn in the coordinate system of the map.');
    case 'failed':
      return state.message;
    case 'unsupported':
      return 'This kind of data is not drawn yet.';
    case 'preparing':
    case 'drawn':
      return undefined;
  }
}

/** No reasons, as one array, so that a page that has none is not told of a new one each time it is looked at. */
const NONE: readonly string[] = [];

/**
 * Why each dataset whose layer is not drawn is not, by the dataset's number: for the Data tab's summary, which says so with the reason and the hint.
 * A layer that is being prepared or is drawn has nothing to say. `layers` says which dataset each layer is of; a dataset with several layers
 * that are not drawn has the first one's reason.
 */
export function datasetNotices(
  states: ReadonlyMap<string, LayerState>,
  layers: Readonly<Record<string, { readonly datasetId: number } | undefined>>,
): ReadonlyMap<number, string> {
  const notices = new Map<number, string>();
  for (const [id, state] of states) {
    const dataset = layers[id]?.datasetId;
    const reason = reasonOf(state);
    if (dataset !== undefined && reason !== undefined && !notices.has(dataset)) {
      notices.set(dataset, reason);
    }
  }
  return notices;
}

/** Whether two sets of notices say the same: so that what is given to the panel is the same object while it does, and the panel is not drawn again for nothing. */
export function sameNotices(
  a: ReadonlyMap<number, string>,
  b: ReadonlyMap<number, string>,
): boolean {
  return a.size === b.size && [...a].every(([dataset, reason]) => b.get(dataset) === reason);
}

export function summariseLayers(states: Iterable<LayerState>): LayerSummary {
  const all = [...states];
  const preparing = all.filter(
    (state): state is Extract<LayerState, { status: 'preparing' }> => state.status === 'preparing',
  );
  const ready = all.length - preparing.length;
  const progress =
    all.length === 0
      ? 0
      : (ready + preparing.reduce((sum, state) => sum + state.fraction, 0)) / all.length;
  const settled =
    all.length > 0 && preparing.length === 0 && all.every((s) => s.status !== 'drawn');
  return {
    preparing: preparing.length,
    progress,
    reasons: settled
      ? all.flatMap((state) => {
          const reason = reasonOf(state);
          return reason === undefined ? [] : [reason];
        })
      : NONE,
  };
}
