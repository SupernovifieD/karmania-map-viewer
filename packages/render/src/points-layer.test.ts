import type { RenderBuffers } from '@karmania/engine/display';
import { LessDepth } from 'three';
import type { Points, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { FrameInfo, LayerLook } from './look.js';
import { OUTLINE_WIDTH, POINTS_PER_PART, createPointsLayer } from './points-layer.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 0.75,
  colour: '#e69f00',
  pointSize: 6,
  lineWidth: 2,
};
const INFO: FrameInfo = {
  pixelRatio: 2,
  viewport: [800, 600],
  flat: true,
  outline: [0.1, 0.2, 0.3],
};

const points = (count: number): Extract<RenderBuffers, { kind: 'points' }> => ({
  kind: 'points',
  positions: Float32Array.from({ length: count * 3 }, (_, i) => i),
});

/** The parts of the layer, which are the objects in its group. */
const parts = (layer: ReturnType<typeof createPointsLayer>): Points[] =>
  layer.object.children as Points[];
const uniforms = (layer: ReturnType<typeof createPointsLayer>) =>
  (parts(layer)[0]?.material as ShaderMaterial).uniforms;

describe('createPointsLayer', () => {
  it('puts a layer of few points in one part, and has nothing to step', () => {
    const layer = createPointsLayer(points(10), LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect('step' in layer).toBe(false);
    expect(parts(layer)[0]?.geometry.getAttribute('position').count).toBe(10);
  });

  it('has no part for no points, and a layer of exactly one part is one part', () => {
    expect(parts(createPointsLayer(points(0), LOOK))).toHaveLength(0);
    const whole = createPointsLayer(points(POINTS_PER_PART), LOOK);
    expect(parts(whole)).toHaveLength(1);
    expect('step' in whole).toBe(false);
  });

  it('puts the first part at once and the rest a part at a time, each of 250,000 points, until all are on', () => {
    expect(POINTS_PER_PART).toBe(250_000);
    const layer = createPointsLayer(points(2 * POINTS_PER_PART + 5), LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect(layer.step?.()).toBe(true);
    expect(parts(layer)).toHaveLength(2);
    expect(layer.step?.()).toBe(false);
    expect(parts(layer)).toHaveLength(3);
    expect(parts(layer).map((part) => part.geometry.getAttribute('position').count)).toEqual([
      POINTS_PER_PART,
      POINTS_PER_PART,
      5,
    ]);
    // Asked again after it is done, it adds nothing.
    expect(layer.step?.()).toBe(false);
    expect(parts(layer)).toHaveLength(3);
  });

  it('gives the card a view of the positions, not a copy: the part is the bytes it covers', () => {
    const buffers = points(POINTS_PER_PART + 3);
    const layer = createPointsLayer(buffers, LOOK);
    layer.step?.();
    const [first, second] = parts(layer).map(
      (part) => part.geometry.getAttribute('position').array,
    );
    expect(first?.buffer).toBe(buffers.positions.buffer);
    expect(second?.buffer).toBe(buffers.positions.buffer);
    expect(first?.byteOffset).toBe(0);
    expect(second?.byteOffset).toBe(POINTS_PER_PART * 3 * 4);
    expect(second?.length).toBe(9);
    // The last point of the second part is the last point there is.
    expect(second?.[8]).toBe((POINTS_PER_PART + 3) * 3 - 1);
  });

  it('draws a marker only if it is strictly nearer than one that is there: one at the same height does not overdraw it', () => {
    const material = parts(createPointsLayer(points(3), LOOK))[0]?.material as ShaderMaterial;
    expect(material.depthFunc).toBe(LessDepth);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(true);
  });

  it('is not culled by a box, since none was worked out', () => {
    const layer = createPointsLayer(points(10), LOOK);
    expect(parts(layer).every((part) => !part.frustumCulled)).toBe(true);
  });

  it('is drawn in the colour, opacity and visibility of its look, and takes a new look without being built again', () => {
    const layer = createPointsLayer(points(10), LOOK);
    const before = parts(layer)[0];
    expect(uniforms(layer)['uFill']?.value).toMatchObject({ x: 230 / 255, y: 159 / 255, z: 0 });
    expect(uniforms(layer)['uOpacity']?.value).toBe(0.75);
    expect(layer.object.visible).toBe(true);
    layer.setLook({ ...LOOK, colour: '#009e73', opacity: 0.2, visible: false });
    expect(uniforms(layer)['uFill']?.value).toMatchObject({ x: 0, y: 158 / 255, z: 115 / 255 });
    expect(uniforms(layer)['uOpacity']?.value).toBe(0.2);
    expect(layer.object.visible).toBe(false);
    expect(parts(layer)[0]).toBe(before);
  });

  it('is as big as its size in CSS pixels times the pixel ratio of the frame, with an outline of a CSS pixel and the colour the frame says', () => {
    const layer = createPointsLayer(points(10), LOOK);
    layer.prepareFrame(INFO);
    expect(uniforms(layer)['uDiameter']?.value).toBe(12);
    expect(uniforms(layer)['uOutlineWidth']?.value).toBe(OUTLINE_WIDTH * 2);
    expect(OUTLINE_WIDTH).toBe(1);
    expect(uniforms(layer)['uOutline']?.value).toMatchObject({ x: 0.1, y: 0.2, z: 0.3 });
    // A new size is a new diameter at the ratio of the frame, and a new ratio is a new diameter at the size.
    layer.setLook({ ...LOOK, pointSize: 10 });
    expect(uniforms(layer)['uDiameter']?.value).toBe(20);
    layer.prepareFrame({ ...INFO, pixelRatio: 1 });
    expect(uniforms(layer)['uDiameter']?.value).toBe(10);
    expect(uniforms(layer)['uOutlineWidth']?.value).toBe(1);
  });

  it('frees every part and its material when it is disposed', () => {
    const layer = createPointsLayer(points(POINTS_PER_PART + 1), LOOK);
    layer.step?.();
    const freed: string[] = [];
    for (const [i, part] of parts(layer).entries()) {
      part.geometry.addEventListener('dispose', () => freed.push(`geometry ${String(i)}`));
    }
    (parts(layer)[0]?.material as ShaderMaterial).addEventListener('dispose', () =>
      freed.push('material'),
    );
    layer.dispose();
    expect(freed.sort()).toEqual(['geometry 0', 'geometry 1', 'material']);
    expect(parts(layer)).toHaveLength(0);
  });
});
