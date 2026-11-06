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
import { sampleScene } from './test-support/documents.js';

const everything: SceneDocument = sampleScene();

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
