/**
 * What a layer of the scene looks like to the renderer: its style, made into the one colour, the sizes and the opacity that the card
 * needs. A layer coloured by classes is drawn in one grey until its class colours are on the card (the palette comes in
 * step 16.13).
 */
import type { LayerLook } from '@karmania/render';
import { DEFAULT_LINE_WIDTH, DEFAULT_POINT_SIZE, OTHER_COLOUR } from '@karmania/scene';
import type { Layer } from '@karmania/scene';

/** The look of `layer`: shown or hidden, its opacity, its colour, and its sizes (the defaults of the scene for what its kind has none of). */
export function layerLook(layer: Layer): LayerLook {
  const { colour, opacity, pointSize, lineWidth } = layer.style;
  return {
    visible: layer.visible,
    opacity,
    colour: colour.mode === 'single' ? colour.value : OTHER_COLOUR,
    pointSize: pointSize ?? DEFAULT_POINT_SIZE,
    lineWidth: lineWidth ?? DEFAULT_LINE_WIDTH,
  };
}
