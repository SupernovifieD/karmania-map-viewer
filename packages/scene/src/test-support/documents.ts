/** Documents and ways to spoil them, for the tests of the scene. Not part of the package. */
import type { Frame } from '@karmania/engine/display';
import type { SceneDocument } from '../types.js';

/** The frame of the sample: UTM zone 40 north. */
export const SAMPLE_FRAME: Frame = {
  mapCrs: { kind: 'epsg', code: 32640 },
  origin: [512000, 4012000, 0],
  source: 'auto',
};

/** A document that uses every field of the contract (section 11.6) and is valid. */
export function sampleScene(): SceneDocument {
  return {
    version: 1,
    frame: SAMPLE_FRAME,
    viewMode: '3d',
    camera2d: { centre: [512345.12, 4012345.67], unitsPerPixel: 0.5, heading: 30 },
    camera3d: {
      target: [512345.12, 4012345.67, 12],
      distance: 900,
      heading: 30,
      elevation: 35,
      fov: 45,
    },
    verticalExaggeration: 5,
    legend: [
      { type: 'layer', id: 'layer-1' },
      {
        type: 'group',
        id: 'group-1',
        name: 'Survey',
        collapsed: false,
        children: ['layer-2', 'layer-3'],
      },
    ],
    layers: {
      'layer-1': {
        id: 'layer-1',
        datasetId: 1,
        name: 'Topography',
        visible: true,
        style: {
          colour: {
            mode: 'classes',
            column: 'z',
            method: 'equal',
            classes: 7,
            ramp: 'viridis',
            reverse: false,
          },
          opacity: 1,
          lineWidth: 2,
        },
        contours: { column: 'z', interval: 10, base: 0, indexEvery: 5, visible: true },
      },
      'layer-2': {
        id: 'layer-2',
        datasetId: 2,
        name: 'Assays',
        visible: false,
        style: { colour: { mode: 'single', value: '#e69f00' }, opacity: 1, pointSize: 6 },
      },
      'layer-3': {
        id: 'layer-3',
        datasetId: 3,
        name: 'Contours of Topography (every 10)',
        visible: true,
        style: { colour: { mode: 'single', value: '#0072b2' }, opacity: 1, lineWidth: 2 },
        derived: { kind: 'contours', sourceLayer: 'layer-1' },
      },
    },
    selection: { layerId: 'layer-2', element: 0 },
  };
}

/** Marks a place to be taken out by {@link spoil}. */
export const ABSENT = Symbol('absent');

function isList(node: unknown): node is readonly unknown[] {
  return Array.isArray(node);
}

function isFields(node: unknown): node is Readonly<Record<string, unknown>> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/**
 * A copy of `node` with `value` at `path` (keys and places in lists), or with that place taken out if it is
 * {@link ABSENT}. A place that is not there is a mistake in the test, and throws.
 */
export function spoil(node: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) {
    return value;
  }
  if (isList(node) && typeof head === 'number') {
    const copy = [...node];
    copy[head] = spoil(node[head], rest, value);
    return copy;
  }
  if (isFields(node) && typeof head === 'string') {
    const { [head]: inside, ...others } = node;
    if (rest.length === 0 && value === ABSENT) {
      return others;
    }
    return { ...node, [head]: spoil(inside, rest, value) };
  }
  throw new Error(`The test spoils a place that is not there: ${String(head)}`);
}
