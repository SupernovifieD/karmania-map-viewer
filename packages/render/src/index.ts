/**
 * `@karmania/render`: the renderer of the map. three.js is used here and nowhere else; the rest sees `createRenderer`.
 */
export { bufferSize } from './buffer-size.js';
export { mapToScreen, orthographicFrame, screenToMap } from './camera-2d.js';
export type { DepthRange, OrthographicFrame, Size } from './camera-2d.js';
export { parseCssColour } from './css-colour.js';
export type { Rgba } from './css-colour.js';
export type { BufferSize } from './buffer-size.js';
export { createRenderer } from './renderer.js';
export type { RenderStats, Renderer } from './renderer.js';
