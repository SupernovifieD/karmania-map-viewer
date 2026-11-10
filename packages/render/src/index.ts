/**
 * `@karmania/render`: the renderer of the map. three.js is used here and nowhere else; the rest sees `createRenderer`.
 */
export { bufferSize } from './buffer-size.js';
export { mapToScreen, orthographicFrame, screenToMap } from './camera-2d.js';
export type { DepthRange, OrthographicFrame, Size } from './camera-2d.js';
export { perspectiveFrame } from './camera-3d.js';
export type { PerspectiveFrame } from './camera-3d.js';
export { parseCssColour } from './css-colour.js';
export type { Rgba } from './css-colour.js';
export type { BufferSize } from './buffer-size.js';
export { createRenderer } from './renderer.js';
export type { RenderStats, Renderer, RendererOptions, RendererView } from './renderer.js';
export { attachController2d } from './controller-2d.js';
export type { Controller2d, Controller2dOptions } from './controller-2d.js';
export {
  DEFAULT_SCALE_LIMITS,
  KEY_PAN_PIXELS,
  KEY_ROTATE_DEGREES,
  KEY_ZOOM_FACTOR,
  angleAbout,
  clampScale,
  keyAction,
  panBy,
  rotateAbout,
  turnBetween,
  wheelFactor,
  zoomAt,
} from './controls-2d.js';
export type { CameraChange, KeyAction, KeyInput, ScaleLimits } from './controls-2d.js';
export { orbit3dBy, pan3dBy } from './controls-3d.js';
export type { Camera3dChange } from './controls-3d.js';
export { LayerSet } from './layer-set.js';
export type { Container, LayerMaker, LayerObject, LayerOutcome } from './layer-set.js';
export { OUTLINE_WIDTH, POINTS_PER_PART } from './points-layer.js';
export { MAX_CLASSES, NO_VALUE, colourOf } from './look.js';
export type { ClassColouring, FrameInfo, LayerLook, Rgb } from './look.js';
export { SEGMENTS_PER_PART, gatherSegments } from './lines-layer.js';
export { TRIANGLES_PER_PART } from './triangle-parts.js';
export { POLYGON_OUTLINE_WIDTH } from './polygons-layer.js';
export { combineLayers } from './layer-combine.js';
export type { Combination } from './layer-combine.js';
