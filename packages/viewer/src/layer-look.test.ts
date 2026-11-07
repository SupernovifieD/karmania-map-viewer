import { DEFAULT_LINE_WIDTH, DEFAULT_POINT_SIZE, OTHER_COLOUR } from '@karmania/scene';
import type { Layer } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { layerLook } from './layer-look.js';

const layer = (patch: Partial<Layer> = {}, style: Partial<Layer['style']> = {}): Layer => ({
  id: 'layer-1',
  datasetId: 0,
  name: 'Wells',
  visible: true,
  style: { colour: { mode: 'single', value: '#e69f00' }, opacity: 1, ...style },
  ...patch,
});

describe('layerLook', () => {
  it('is the colour, the opacity and whether the layer is shown, as the scene has them', () => {
    expect(layerLook(layer())).toEqual({
      visible: true,
      opacity: 1,
      colour: '#e69f00',
      pointSize: DEFAULT_POINT_SIZE,
      lineWidth: DEFAULT_LINE_WIDTH,
    });
    const look = layerLook(
      layer({ visible: false }, { opacity: 0.4, colour: { mode: 'single', value: '#009e73' } }),
    );
    expect(look.visible).toBe(false);
    expect(look.opacity).toBe(0.4);
    expect(look.colour).toBe('#009e73');
  });

  it("has the sizes of the style, and the scene's defaults for a kind that has none", () => {
    const look = layerLook(layer({}, { pointSize: 12, lineWidth: 5 }));
    expect([look.pointSize, look.lineWidth]).toEqual([12, 5]);
    const bare = layerLook(layer());
    expect([bare.pointSize, bare.lineWidth]).toEqual([6, 2]);
  });

  it('is one grey for a layer that is coloured by classes, until the classes have colours on the card', () => {
    const classes = layer(
      {},
      {
        colour: {
          mode: 'classes',
          column: 'Au_ppm',
          method: 'equal',
          classes: 7,
          ramp: 'viridis',
          reverse: false,
        },
      },
    );
    expect(layerLook(classes).colour).toBe(OTHER_COLOUR);
  });
});
