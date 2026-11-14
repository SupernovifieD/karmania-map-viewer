import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, LessDepth } from 'three';
import type { InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_CLASSES } from './look.js';
import type { FrameInfo, LayerLook } from './look.js';
import { SEGMENTS_PER_PART, createLinesLayer, gatherSegments } from './lines-layer.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 0.5,
  colour: '#0072b2',
  pointSize: 6,
  lineWidth: 3,
};
const INFO: FrameInfo = {
  pixelRatio: 2,
  viewport: [1600, 1200],
  flat: true,
  light: [0, 0, 1],
  outline: [0, 0, 0],
};

/** `count` segments, each from vertex `i` to vertex `i + 1`, along the x axis. */
const lines = (count: number): Extract<RenderBuffers, { kind: 'lines' }> => ({
  kind: 'lines',
  positions: Float32Array.from({ length: (count + 1) * 3 }, (_, i) => (i % 3 === 0 ? i / 3 : 0)),
  segments: Uint32Array.from({ length: count * 2 }, (_, i) => Math.floor(i / 2) + (i % 2)),
  segmentLine: new Uint32Array(count),
});

/** How many times the attribute has been marked to be sent to the card again. */
const versionOf = (attribute: unknown): number =>
  (attribute as { version: number } | undefined)?.version ?? 0;

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
  it('writes the depth of the plane of the ribbon it lies in only in 3D: the material of the view from above is as it was, and the two share their uniforms', () => {
    const layer = createLinesLayer(lines(2), LOOK);
    const flat = parts(layer)[0]?.material as ShaderMaterial;
    expect(flat.fragmentShader).not.toContain('gl_FragDepth');
    expect(flat.vertexShader).not.toContain('vStartV');
    layer.prepareFrame({ ...INFO, flat: false });
    const solid = parts(layer)[0]?.material as ShaderMaterial;
    expect(solid).not.toBe(flat);
    expect(solid.fragmentShader).toContain('gl_FragDepth = tiedDepth(plane)');
    expect(solid.fragmentShader).toContain('ribbonNormal(vStartV, vEndV)');
    expect(solid.vertexShader).toContain('vStartV');
    expect(solid.uniforms).toBe(flat.uniforms);
    expect(solid.fragmentShader.indexOf('planeDepth(vStartV')).toBeLessThan(
      solid.fragmentShader.indexOf('discard;'),
    );
    layer.prepareFrame({ ...INFO, flat: true });
    expect(parts(layer)[0]?.material).toBe(flat);
  });

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

  describe('coloured by classes', () => {
    /** `count` segments of lines of 2 segments each (segments 0 and 1 are line 0, 2 and 3 are line 1, ...). */
    const twoEach = (count: number): Extract<RenderBuffers, { kind: 'lines' }> => ({
      ...lines(count),
      segmentLine: Uint32Array.from({ length: count }, (_, i) => Math.floor(i / 2)),
    });
    const colours = (n: number) =>
      Array.from({ length: n }, (_, i) => `#${(i * 16).toString(16).padStart(2, '0')}0000`);
    const classOf = (mesh: Mesh | undefined) =>
      (mesh?.geometry as InstancedBufferGeometry | undefined)?.getAttribute('aClass');

    it('is in the colour of the layer until it is given classes, and when they are taken away', () => {
      const layer = createLinesLayer(twoEach(4), LOOK);
      expect(uniforms(layer)['uClassed']?.value).toBe(0);
      expect(classOf(parts(layer)[0])).toBeUndefined();
      layer.setClasses?.({ indices: Uint8Array.of(0, 1), colours: colours(2) });
      expect(uniforms(layer)['uClassed']?.value).toBe(1);
      layer.setClasses?.(undefined);
      expect(uniforms(layer)['uClassed']?.value).toBe(0);
      expect(uniforms(layer)['uCount']?.value).toBe(0);
      // The attribute is left where it is (the shader does not read it, `uClassed`): replacing or deleting it would leave its buffer on the card.
      expect(classOf(parts(layer)[0])).toBeDefined();
    });

    it('gives each segment the class of its line, and the colours of the classes go in the palette', () => {
      const layer = createLinesLayer(twoEach(5), LOOK);
      layer.setClasses?.({
        indices: Uint8Array.of(3, 255, 1),
        colours: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'],
      });
      // Segments 0 and 1 are line 0, 2 and 3 line 1 (no value), 4 line 2.
      expect([...(classOf(parts(layer)[0])?.array ?? [])]).toEqual([3, 3, 255, 255, 1]);
      expect(classOf(parts(layer)[0])?.itemSize).toBe(1);
      expect(uniforms(layer)['uCount']?.value).toBe(4);
      const palette = uniforms(layer)['uPalette']?.value as { x: number; y: number; z: number }[];
      expect(palette).toHaveLength(MAX_CLASSES);
      expect(palette[2]).toMatchObject({ x: 0, y: 0, z: 1 });
    });

    it('holds no more colours than it has room for', () => {
      const layer = createLinesLayer(twoEach(2), LOOK);
      layer.setClasses?.({ indices: new Uint8Array(1), colours: colours(MAX_CLASSES + 4) });
      expect(uniforms(layer)['uCount']?.value).toBe(MAX_CLASSES);
    });

    it('gives each part the classes of its own segments, and a part put on later its share', () => {
      const layer = createLinesLayer(twoEach(SEGMENTS_PER_PART + 3), LOOK);
      const lineCount = Math.ceil((SEGMENTS_PER_PART + 3) / 2);
      layer.setClasses?.({
        indices: Uint8Array.from({ length: lineCount }, (_, i) => i % 197),
        colours: colours(8),
      });
      layer.step?.();
      const [first, second] = parts(layer).map((mesh) => classOf(mesh)?.array);
      expect(first).toHaveLength(SEGMENTS_PER_PART);
      expect(second).toHaveLength(3);
      // The last segment of the first part is segment 99,999, of line 49,999; the first of the second is segment 100,000, of line 50,000.
      expect(first?.[0]).toBe(0);
      expect(first?.[SEGMENTS_PER_PART - 1]).toBe(Math.floor((SEGMENTS_PER_PART - 1) / 2) % 197);
      expect(second?.[0]).toBe((SEGMENTS_PER_PART / 2) % 197);
      expect(second?.[2]).toBe((SEGMENTS_PER_PART / 2 + 1) % 197);
    });

    it('is in the colour of the layer for classes that stop short of a line that has segments, and covers lines that have none', () => {
      const layer = createLinesLayer(twoEach(4), LOOK);
      layer.setClasses?.({ indices: Uint8Array.of(0, 1), colours: colours(2) });
      expect(uniforms(layer)['uClassed']?.value).toBe(1);
      layer.setClasses?.({ indices: Uint8Array.of(0), colours: colours(2) });
      expect(uniforms(layer)['uClassed']?.value).toBe(0);
      // More classes than lines is as it should be: a line with no segment has a class and nothing to draw it in.
      layer.setClasses?.({ indices: Uint8Array.of(0, 1, 2, 3), colours: colours(4) });
      expect(uniforms(layer)['uClassed']?.value).toBe(1);
    });

    it('keeps the attributes when it is given the same classes with other colours: only the palette changes', () => {
      const layer = createLinesLayer(twoEach(4), LOOK);
      const indices = Uint8Array.of(0, 1);
      layer.setClasses?.({ indices, colours: colours(2) });
      const attribute = classOf(parts(layer)[0]);
      layer.setClasses?.({ indices, colours: ['#ff0000'] });
      expect(classOf(parts(layer)[0])).toBe(attribute);
      expect(uniforms(layer)['uCount']?.value).toBe(1);
      // Other classes with the same values: put into the same attribute, and sent again.
      const version = versionOf(attribute);
      layer.setClasses?.({ indices: Uint8Array.from(indices), colours: colours(2) });
      expect(classOf(parts(layer)[0])).toBe(attribute);
      expect(versionOf(attribute)).toBeGreaterThan(version);
    });

    it('puts new classes into the attribute it has and has them sent to the card again, and writes nothing to the classes it was given', () => {
      const layer = createLinesLayer(twoEach(4), LOOK);
      const first = Uint8Array.of(0, 1);
      layer.setClasses?.({ indices: first, colours: colours(3) });
      const attribute = classOf(parts(layer)[0]);
      const version = versionOf(attribute);
      const second = Uint8Array.of(2, 0);
      layer.setClasses?.({ indices: second, colours: colours(3) });
      expect(classOf(parts(layer)[0])).toBe(attribute);
      // Each segment has the class of its line: two lines of two segments, so 2, 2, 0, 0.
      expect([...(attribute?.array ?? [])]).toEqual([2, 2, 0, 0]);
      expect(versionOf(attribute)).toBeGreaterThan(version);
      expect([...first]).toEqual([0, 1]);
    });

    it('keeps the width, the opacity and the draw order of one colour', () => {
      const layer = createLinesLayer(twoEach(4), LOOK);
      layer.setClasses?.({ indices: Uint8Array.of(0, 1), colours: colours(2) });
      layer.prepareFrame(INFO);
      layer.setLook({ ...LOOK, colour: '#112233', opacity: 0.25, lineWidth: 5 });
      expect(uniforms(layer)['uOpacity']?.value).toBe(0.25);
      expect(uniforms(layer)['uWidth']?.value).toBe(10);
      expect(uniforms(layer)['uColour']?.value).toMatchObject({
        x: 17 / 255,
        y: 34 / 255,
        z: 51 / 255,
      });
      expect(uniforms(layer)['uDepthScale']?.value).toBe(0);
    });
  });
});
