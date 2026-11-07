/**
 * How a layer is to look, as the renderer is told: the parts of the scene's style that the card needs, with the colour already
 * chosen. `LayerLook` changes when a person changes the style, and `FrameInfo` changes with the screen and the theme, so that
 * a layer is not built again for either.
 */

/** What a layer looks like. */
export interface LayerLook {
  readonly visible: boolean;
  /** 0 to 1. */
  readonly opacity: number;
  /** `#rrggbb`: the one colour of the layer. */
  readonly colour: string;
  /** The size of a point marker, in CSS pixels. */
  readonly pointSize: number;
  /** The width of a line, in CSS pixels. */
  readonly lineWidth: number;
}

/** What is true of the screen and the theme when a frame is drawn. */
export interface FrameInfo {
  /** Device pixels to a CSS pixel. */
  readonly pixelRatio: number;
  /**
   * Whether the view is flat (2D): then the height of a thing within a layer does not show, because a layer is one colour, and a layer that
   * is half opaque must not be darker where its own parts overlap, which parts at different heights would make.
   */
  readonly flat: boolean;
  /** The size of the drawing buffer, in device pixels (what a layer that is drawn in screen space needs to turn clip space into pixels). */
  readonly viewport: readonly [number, number];
  /** The colour of outlines, `[r, g, b]` each from 0 to 1 in sRGB: the colour of the text, which contrasts with the map. */
  readonly outline: readonly [number, number, number];
}

/** The class of an element that has no value to put in a class: what the engine's class index says. Such an element is not drawn. */
export const NO_VALUE = 255;

/**
 * The most classes whose colours a layer can hold: the 20 categories and "Other" that the engine makes at most, and room. An element
 * of a class beyond what the layer has a colour for is not drawn, as one with no value is not.
 */
export const MAX_CLASSES = 32;

/** What colours the elements of a layer that is coloured by classes: the class of each element, and the colour of each class. */
export interface ClassColouring {
  /** One for each element of the dataset, in its order (a grid's cells are in lattice order, `i` fastest): its class, or `NO_VALUE`. */
  readonly indices: Uint8Array;
  /** `#rrggbb` for each class, in the order of the classes; at most `MAX_CLASSES`. */
  readonly colours: readonly string[];
}

/** A layer's colour as three numbers from 0 to 1, in sRGB, as the shaders take it. */
export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * `#rrggbb` as `[r, g, b]` from 0 to 1 in sRGB (no conversion to linear: the shaders write colours as they are). A colour that is not
 * `#rrggbb` is mid grey, which is seen and is wrong, and not an error that stops the map: the scene only holds `#rrggbb`.
 */
export function colourOf(hex: string): Rgb {
  const match = HEX.exec(hex);
  if (match === null) {
    return [0.5, 0.5, 0.5];
  }
  const [, r = '80', g = '80', b = '80'] = match;
  return [parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255];
}
