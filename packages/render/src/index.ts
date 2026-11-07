/**
 * `@karmania/render`: the renderer of the map. three.js is used here and nowhere else; the rest sees `createRenderer`.
 */
export { bufferSize } from './buffer-size.js';
export type { BufferSize } from './buffer-size.js';
export { createRenderer } from './renderer.js';
export type { RenderStats, Renderer } from './renderer.js';
