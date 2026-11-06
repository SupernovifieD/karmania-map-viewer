/**
 * The scene document, version 1: everything that decides what the map shows and how, as plain data.
 *
 * It is the single source of truth: the renderer, the overlays, the legend and the export read it, and every
 * action of a person is a command that makes a new one (`commands.ts`). It holds no dataset, no buffer and no
 * DOM state, so it can be stored, compared, validated and given back to a viewer. Everything is `readonly`: a
 * document is never changed, only replaced.
 *
 * The types come from the engine and from nowhere else (`import type`, so no engine code is loaded).
 */
import type { ClassMethod, Frame } from '@karmania/engine/display';

/** The version of the document this package writes and reads. */
export const SCENE_VERSION = 1;

/** Names a layer in the document. Layers have ids of their own, so a dataset can be shown twice. */
export type LayerId = string;

/** Names a group in the legend. A group never has the id of a layer. */
export type GroupId = string;

/** Names a ramp of colours, one of `RAMPS` (step 14.4). */
export type RampId = string;

/** How the map is shown: from straight above, or in perspective. */
export const VIEW_MODES = ['2d', '3d'] as const;

/** `2d` is orthographic and straight down, `3d` is a perspective view that can be orbited. */
export type ViewMode = (typeof VIEW_MODES)[number];

/** The factors the heights can be multiplied by in 3D. */
export const VERTICAL_EXAGGERATIONS = [1, 2, 3, 5, 10] as const;

/** A factor of `VERTICAL_EXAGGERATIONS`. It is applied about the origin's height. */
export type VerticalExaggeration = (typeof VERTICAL_EXAGGERATIONS)[number];

/**
 * The view from above. Values are absolute, in map units of the frame (`frame.mapCrs`), and not relative to
 * the origin of the frame.
 */
export interface Camera2d {
  /** The point of the map at the middle of the picture: x east, y north. */
  readonly centre: readonly [number, number];
  /** Map units to a pixel on the screen; more is further away. Greater than 0. */
  readonly unitsPerPixel: number;
  /** Degrees clockwise from grid north: the direction the top of the picture faces. */
  readonly heading: number;
}

/**
 * The perspective view. Values are absolute, in map units, and not relative to the origin of the frame; the
 * height is not multiplied by the vertical exaggeration here.
 */
export interface Camera3d {
  /** The point the camera looks at and turns about: x east, y north, z up. */
  readonly target: readonly [number, number, number];
  /** From the target to the camera, in map units. Greater than 0. */
  readonly distance: number;
  /** Degrees clockwise from grid north: the direction the camera looks along, seen from above. */
  readonly heading: number;
  /** Degrees above the horizon, from -89 to 89, so that the view never flips and up is always +z. */
  readonly elevation: number;
  /** The vertical field of view, in degrees, greater than 0 and less than 180. */
  readonly fov: number;
}

/** The two ways a layer gets its colour. */
export const COLOUR_MODES = ['single', 'classes'] as const;

/** One colour for everything in the layer. `value` is `#rrggbb`; the commands write it in lower case. */
export interface SingleColour {
  readonly mode: 'single';
  readonly value: string;
}

/** A colour for each class of a column: `method` divides `column` into at most `classes`, coloured from `ramp`. */
export interface ClassColour {
  readonly mode: 'classes';
  readonly column: string;
  readonly method: ClassMethod;
  /** How many classes are asked for, an integer from 2 to 20; fewer can come of a column with few values. */
  readonly classes: number;
  readonly ramp: RampId;
  /** Whether the ramp is used from its last colour to its first. */
  readonly reverse: boolean;
}

/** How a layer is coloured. */
export type LayerColour = SingleColour | ClassColour;

/** How a layer looks. */
export interface LayerStyle {
  readonly colour: LayerColour;
  /** 0 is invisible and 1 is solid. */
  readonly opacity: number;
  /** Points only: the width of a marker, in pixels, from 2 to 24. */
  readonly pointSize?: number;
  /** Lines and contours only: the width in pixels, from 1 to 8. */
  readonly lineWidth?: number;
}

/**
 * What contour lines of a layer are made with. The same four numbers the engine's `contours()` takes
 * (section 11.5 of the brief; the engine gets the type itself in step 20.4).
 */
export interface ContourParams {
  /** Grids only: the column the heights are in. */
  readonly column?: string;
  /** The height between two lines, greater than 0. */
  readonly interval: number;
  /** A height that has a line; the others are `base + k * interval`. */
  readonly base: number;
  /** Every this many lines is an index line, drawn heavier; an integer, 1 or more. */
  readonly indexEvery: number;
}

/** The contour lines of a layer, and whether they are shown. */
export interface LayerContours extends ContourParams {
  readonly visible: boolean;
}

/** A layer that is made from another layer and not from a dataset of its own: only contours so far. */
export interface DerivedLayer {
  readonly kind: 'contours';
  /** The layer the lines were made from. */
  readonly sourceLayer: LayerId;
}

/** One dataset as it is shown on the map. */
export interface Layer {
  readonly id: LayerId;
  /** The engine's id of the dataset it shows. */
  readonly datasetId: number;
  readonly name: string;
  readonly visible: boolean;
  readonly style: LayerStyle;
  readonly contours?: LayerContours;
  readonly derived?: DerivedLayer;
}

/** A layer in the legend. */
export interface LegendLayerNode {
  readonly type: 'layer';
  readonly id: LayerId;
}

/** A folder of layers in the legend, one level deep. */
export interface LegendGroupNode {
  readonly type: 'group';
  readonly id: GroupId;
  readonly name: string;
  readonly collapsed: boolean;
  /** Top to bottom, as in the legend. */
  readonly children: readonly LayerId[];
}

/** An entry of the legend's top level: a layer, or a group with layers in it. */
export type LegendNode = LegendLayerNode | LegendGroupNode;

/** The element a person picked on the map. */
export interface SceneSelection {
  readonly layerId: LayerId;
  /** The number of the element in its dataset, from 0. */
  readonly element: number;
}

/** The whole scene. */
export interface SceneDocument {
  readonly version: typeof SCENE_VERSION;
  /** The map's coordinate system and origin; `null` until the first dataset that can be drawn. */
  readonly frame: Frame | null;
  readonly viewMode: ViewMode;
  readonly camera2d: Camera2d;
  readonly camera3d: Camera3d;
  readonly verticalExaggeration: VerticalExaggeration;
  /** Top to bottom: the first is on top, and is drawn last. Every layer is in it, once, directly or in a group. */
  readonly legend: readonly LegendNode[];
  readonly layers: Readonly<Record<LayerId, Layer>>;
  readonly selection: SceneSelection | null;
}
