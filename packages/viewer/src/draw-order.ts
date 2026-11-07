/**
 * The order the layers of the scene are drawn in (section 9.4 of the brief): from the bottom of the legend to the top, so that what is
 * higher in the list is drawn last and is on top. A group is a folder, and its layers are where it is, in its own order.
 */
import type { LayerId, SceneDocument } from '@karmania/scene';

/** The ids of the layers of `doc` from the first to be drawn (the bottom of the legend) to the last (the top). */
export function drawOrder(doc: SceneDocument): LayerId[] {
  const topToBottom = doc.legend.flatMap((node) =>
    node.type === 'layer' ? [node.id] : node.children,
  );
  return topToBottom.reverse();
}
