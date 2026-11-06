import type { Frame } from '@karmania/engine/display';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  COLOUR_MODES,
  SCENE_VERSION,
  VERTICAL_EXAGGERATIONS,
  VIEW_MODES,
  type DerivedLayer,
  type Layer,
  type LayerColour,
  type LayerContours,
  type LayerStyle,
  type LegendNode,
  type SceneDocument,
} from './index.js';

const frame: Frame = {
  mapCrs: { kind: 'epsg', code: 32640 },
  origin: [512000, 4012000, 0],
  source: 'auto',
};

/** A document that uses every field of the contract of section 11.6, so that the compiler checks its shape. */
const everything: SceneDocument = {
  version: 1,
  frame,
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

describe('the types of the scene document (section 11.6)', () => {
  it('has the version of the contract, which is 1', () => {
    expect(SCENE_VERSION).toBe(1);
    expectTypeOf<SceneDocument['version']>().toEqualTypeOf<1>();
    expect(everything.version).toBe(SCENE_VERSION);
  });

  it('names the ways of viewing, the exaggerations and the ways of colouring, as the contract does', () => {
    expect([...VIEW_MODES]).toEqual(['2d', '3d']);
    expect([...VERTICAL_EXAGGERATIONS]).toEqual([1, 2, 3, 5, 10]);
    expect([...COLOUR_MODES]).toEqual(['single', 'classes']);
    expectTypeOf<SceneDocument['viewMode']>().toEqualTypeOf<'2d' | '3d'>();
    expectTypeOf<SceneDocument['verticalExaggeration']>().toEqualTypeOf<1 | 2 | 3 | 5 | 10>();
  });

  it('has a frame that is the engine`s, or null, and a selection that is a layer and an element, or null', () => {
    expectTypeOf<SceneDocument['frame']>().toEqualTypeOf<Frame | null>();
    expectTypeOf<SceneDocument['selection']>().toEqualTypeOf<{
      readonly layerId: string;
      readonly element: number;
    } | null>();
  });

  it('has a legend of layers and groups, and a colour that is single or by classes', () => {
    expectTypeOf<LegendNode['type']>().toEqualTypeOf<'layer' | 'group'>();
    expectTypeOf<LayerColour['mode']>().toEqualTypeOf<'single' | 'classes'>();
    const group = everything.legend[1];
    expect(group?.type === 'group' && group.children).toEqual(['layer-2', 'layer-3']);
  });

  it('has optional point size, line width, contours and derivation', () => {
    expectTypeOf<LayerStyle['pointSize']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LayerStyle['lineWidth']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Layer['contours']>().toEqualTypeOf<LayerContours | undefined>();
    expectTypeOf<Layer['derived']>().toEqualTypeOf<DerivedLayer | undefined>();
    expect(everything.layers['layer-2']?.style.lineWidth).toBeUndefined();
  });

  it('cannot be changed in place, and has no field that is undefined on purpose', () => {
    // The compiler is the test: each `@ts-expect-error` below fails the typecheck if the line stops being an error.
    // The function is not called, so the shared document above is never touched.
    const compileOnly = (doc: SceneDocument, layer: Layer): Layer => {
      // @ts-expect-error a document is replaced, never changed.
      doc.viewMode = '2d';
      // @ts-expect-error nor are its cameras and their tuples.
      doc.camera2d.centre[0] = 0;
      // @ts-expect-error nor its legend.
      doc.legend[0] = { type: 'layer', id: 'layer-9' };
      // @ts-expect-error exactOptionalPropertyTypes: a field that is not there is absent, not undefined.
      return { ...layer, derived: undefined };
    };
    expect(typeof compileOnly).toBe('function');
  });
});
