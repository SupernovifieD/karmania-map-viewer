/**
 * One layer made of several: a fill and its outline, say. It is one object in the scene, steps all its parts, looks as each part is
 * told, and frees them all.
 */
import { Group } from 'three';
import type { LayerObject } from './layer-set.js';
import type { FrameInfo, LayerLook } from './look.js';

/** How a layer of several parts is made: the parts, in the order they are drawn, and the look that each of them is given. */
export interface Combination {
  /** In the order they are drawn: the first is under the next. */
  readonly parts: readonly LayerObject[];
  /** The look of the part `index`, from the look of the layer. */
  lookOf(index: number, look: LayerLook): LayerLook;
}

/** The layer of `combination`. The parts are given their looks when it is looked at and not before: make them with the look of the layer. */
export function combineLayers(combination: Combination): LayerObject {
  const { parts } = combination;
  const group = new Group();
  for (const part of parts) {
    group.add(part.object);
  }
  const building = parts.filter((part) => part.step !== undefined);
  const layer: LayerObject = {
    object: group,
    setLook(look) {
      parts.forEach((part, index) => {
        part.setLook(combination.lookOf(index, look));
      });
    },
    prepareFrame(info: FrameInfo) {
      for (const part of parts) {
        part.prepareFrame(info);
      }
    },
    dispose() {
      group.clear();
      for (const part of parts) {
        part.dispose();
      }
    },
  };
  if (building.length === 0) {
    return layer;
  }
  // Each part that is still being built is stepped until it says it is done, and the layer is being built while any is.
  const left = new Set(building);
  return {
    ...layer,
    step() {
      for (const part of [...left]) {
        if (part.step?.() !== true) {
          left.delete(part);
        }
      }
      return left.size > 0;
    },
  };
}
