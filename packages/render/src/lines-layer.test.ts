import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, LessDepth } from 'three';
import type { InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { FrameInfo, LayerLook } from './look.js';
import { SEGMENTS_PER_PART, createLinesLayer, gatherSegments } from './lines-layer.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 0.5,
  colour: '#0072b2',
  pointSize: 6,
  lineWidth: 3,
};
const INFO: FrameInfo = { pixelRatio: 2, viewport: [1600, 1200], flat: true, outline: [0, 0, 0] };

/** `count` segments, each from vertex `i` to vertex `i + 1`, along the x axis. */
const lines = (count: number): Extract<RenderBuffers, { kind: 'lines' }> => ({
  kind: 'lines',
  positions: Float32Array.from({ length: (count + 1) * 3 }, (_, i) => (i % 3 === 0 ? i / 3 : 0)),
  segments: Uint32Array.from({ length: count * 2 }, (_, i) => Math.floor(i / 2) + (i % 2)),
  segmentLine: new Uint32Array(count),
});

const parts = (layer: ReturnType<typeof createLinesLayer>): Mesh[] =>
  layer.object.children as Mesh[];
const uniforms = (layer: ReturnType<typeof createLinesLayer>) =>
  (parts(layer)[0]?.material as ShaderMaterial).uniforms;

describe('gatherSegments', () => {
  const positions = Float32Array.of(0, 0, 0, 10, 0, 1, 10, 5, 2, 20, 5, 3);
  const segments = Uint32Array.of(0, 1, 1, 2, 2, 3);

  it('is the two ends of each segment, three numbers each, from the vertices that it names', () => {
    const { starts, ends } = gatherSegments(positions, segments, 0, 3);
    expect([...starts]).toEqual([0, 0, 0, 10, 0, 1, 10, 5, 2]);
    expect([...ends]).toEqual([10, 0, 1, 10, 5, 2, 20, 5, 3]);
  });

  it('is those of a range of the segments, and none for an empty or a backwards range', () => {
    const middle = gatherSegments(positions, segments, 1, 3);
    expect([...middle.starts]).toEqual([10, 0, 1, 10, 5, 2]);
    expect([...middle.ends]).toEqual([10, 5, 2, 20, 5, 3]);
    expect(gatherSegments(positions, segments, 2, 2).starts).toHaveLength(0);
    expect(gatherSegments(positions, segments, 3, 1).ends).toHaveLength(0);
  });

  it('is NaN at both ends of a segment that names a vertex that is not there, which draws nothing, and only for that segment', () => {
    const { starts, ends } = gatherSegments(
      positions,
      Uint32Array.of(0, 1, 1, 9, 9, 0, 2, 3),
      0,
      4,
    );
    expect([...starts.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([...starts.subarray(3, 9)].every(Number.isNaN)).toBe(true);
    expect([...ends.subarray(3, 9)].every(Number.isNaN)).toBe(true);
    expect([...starts.subarray(9, 12)]).toEqual([10, 5, 2]);
    expect([...ends.subarray(9, 12)]).toEqual([20, 5, 3]);
  });

  it('is NaN for a range that goes past the segments there are', () => {
    const { starts } = gatherSegments(positions, segments, 2, 5);
    expect([...starts.subarray(0, 3)]).toEqual([10, 5, 2]);
    expect([...starts.subarray(3)].every(Number.isNaN)).toBe(true);
  });
});

describe('createLinesLayer', () => {
  it('puts a layer of few segments in one part with one instance for each, and has nothing to step', () => {
    const layer = createLinesLayer(lines(10), LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect('step' in layer).toBe(false);
    expect((parts(layer)[0]?.geometry as InstancedBufferGeometry).instanceCount).toBe(10);
  });

  it('has no part for no segments', () => {
    expect(parts(createLinesLayer(lines(0), LOOK))).toHaveLength(0);
  });

  it('puts the first part at once and the rest a part at a time, 100,000 segments each', () => {
    expect(SEGMENTS_PER_PART).toBe(100_000);
    const layer = createLinesLayer(lines(2 * SEGMENTS_PER_PART + 7), LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect(layer.step?.()).toBe(true);
    expect(layer.step?.()).toBe(false);
    expect(layer.step?.()).toBe(false);
    expect(
      parts(layer).map((part) => (part.geometry as InstancedBufferGeometry).instanceCount),
    ).toEqual([SEGMENTS_PER_PART, SEGMENTS_PER_PART, 7]);
  });

  it('makes each instance from the ends of its segment', () => {
    const layer = createLinesLayer(lines(3), LOOK);
    const geometry = parts(layer)[0]?.geometry as InstancedBufferGeometry;
    expect([...geometry.getAttribute('aStart').array]).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect([...geometry.getAttribute('aEnd').array]).toEqual([1, 0, 0, 2, 0, 0, 3, 0, 0]);
    // Four corners of a quad and two triangles.
    expect(geometry.getAttribute('corner').count).toBe(4);
    expect(geometry.index?.count).toBe(6);
  });

  it('is drawn in the colour, opacity and visibility of its look, and takes a new look without being built again', () => {
    const layer = createLinesLayer(lines(2), LOOK);
    const before = parts(layer)[0];
    expect(uniforms(layer)['uColour']?.value).toMatchObject({ x: 0, y: 114 / 255, z: 178 / 255 });
    expect(uniforms(layer)['uOpacity']?.value).toBe(0.5);
    layer.setLook({ ...LOOK, colour: '#d55e00', opacity: 1, visible: false });
    expect(uniforms(layer)['uColour']?.value).toMatchObject({ x: 213 / 255, y: 94 / 255, z: 0 });
    expect(uniforms(layer)['uOpacity']?.value).toBe(1);
    expect(layer.object.visible).toBe(false);
    expect(parts(layer)[0]).toBe(before);
  });

  it('is as wide as its width in CSS pixels times the pixel ratio, in a viewport of the size of the buffer', () => {
    const layer = createLinesLayer(lines(2), LOOK);
    layer.prepareFrame(INFO);
    expect(uniforms(layer)['uWidth']?.value).toBe(6);
    expect(uniforms(layer)['uViewport']?.value).toMatchObject({ x: 1600, y: 1200 });
    layer.setLook({ ...LOOK, lineWidth: 5 });
    expect(uniforms(layer)['uWidth']?.value).toBe(10);
    layer.prepareFrame({ ...INFO, pixelRatio: 1 });
    expect(uniforms(layer)['uWidth']?.value).toBe(5);
  });

  it('draws a fragment only if it is strictly nearer than one that is there, and both faces of the quad of a segment', () => {
    const material = parts(createLinesLayer(lines(2), LOOK))[0]?.material as ShaderMaterial;
    expect(material.depthFunc).toBe(LessDepth);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(DoubleSide);
    expect(material.transparent).toBe(true);
  });

  it('puts every part of the layer at one depth in the flat view, and keeps their heights otherwise', () => {
    const layer = createLinesLayer(lines(2), LOOK);
    layer.prepareFrame(INFO);
    expect(uniforms(layer)['uDepthScale']?.value).toBe(0);
    layer.prepareFrame({ ...INFO, flat: false });
    expect(uniforms(layer)['uDepthScale']?.value).toBe(1);
  });

  it('frees every part and its material when it is disposed', () => {
    const layer = createLinesLayer(lines(SEGMENTS_PER_PART + 1), LOOK);
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
