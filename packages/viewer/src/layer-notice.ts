/**
 * The words that the Legend tab gives for a layer that the pipeline says is not on the map, when the frame's own verdict (the engine's `display` findings, which the
 * legend model has) does not say it: preparing it failed, the renderer does not draw that kind of data, or the classes of its style could not be worked out
 * (a column that is not there, or is not numbers). Each begins `Not drawn:`, as the engine's words for the frame do.
 */
import { noticeOfFindings } from '@karmania/scene';
import type { LayerNotice } from '@karmania/scene';
import type { LayerState } from './layer-pipeline.js';

const NOT_DRAWN = 'Not drawn: ';

/** The words for a layer in `state`, or `undefined` for one that is drawn or is being prepared. */
export function layerNotice(state: LayerState): LayerNotice | undefined {
  switch (state.status) {
    case 'failed':
      return {
        message: `${NOT_DRAWN}preparing this dataset for the map failed.`,
        hint: `Load the file again. If it fails again, that is a fault of the program and not of the data. The program said: “${state.message}”.`,
      };
    case 'unsupported':
      return { message: `${NOT_DRAWN}the map does not draw this kind of data yet.` };
    case 'not_drawn': {
      const notice = noticeOfFindings(state.findings);
      return notice.message.startsWith(NOT_DRAWN)
        ? notice
        : { ...notice, message: `${NOT_DRAWN}${notice.message}` };
    }
    case 'drawn':
    case 'preparing':
      return undefined;
  }
}
