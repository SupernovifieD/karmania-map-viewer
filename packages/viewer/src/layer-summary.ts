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
function reasonOf(state: LayerState): string | undefined {
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
