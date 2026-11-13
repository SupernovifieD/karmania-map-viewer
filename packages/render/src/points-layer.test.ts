import type { RenderBuffers } from '@karmania/engine/display';
import { LessDepth } from 'three';
import type { Points, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_CLASSES } from './look.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';
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
  light: [0, 0, 1],
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
  it('writes the depth of the plane it lies in only in 3D: the material of the view from above is as it was, and the two share their uniforms', () => {
    const layer = createPointsLayer(points(3), LOOK);
    const flat = parts(layer)[0]?.material as ShaderMaterial;
    expect(flat.fragmentShader).not.toContain('gl_FragDepth');
    expect(flat.vertexShader).not.toContain('vCentre');
    layer.prepareFrame({ ...INFO, flat: false });
    const solid = parts(layer)[0]?.material as ShaderMaterial;
    expect(solid).not.toBe(flat);
    expect(solid.fragmentShader).toContain('gl_FragDepth = tiedDepth(plane)');
    expect(solid.vertexShader).toContain('vCentre');
    expect(solid.uniforms).toBe(flat.uniforms);
    // The change from pixel to pixel is worked out before the first discard, where every pixel of a block of four runs it.
    expect(solid.fragmentShader.indexOf('planeDepth(vCentre')).toBeLessThan(
      solid.fragmentShader.indexOf('discard;'),
    );
    layer.prepareFrame({ ...INFO, flat: true });
    expect(parts(layer)[0]?.material).toBe(flat);
  });

  it('gives a part that is built later the material of the view it is in, and frees both materials', () => {
    const layer = createPointsLayer(points(POINTS_PER_PART + 2), LOOK);
    layer.prepareFrame({ ...INFO, flat: false });
    layer.step?.();
    const [first, second] = parts(layer);
    expect(second?.material).toBe(first?.material);
    expect((second?.material as ShaderMaterial).fragmentShader).toContain('gl_FragDepth');
    const freed: string[] = [];
    (first?.material as ShaderMaterial).addEventListener('dispose', () => freed.push('3d'));
    layer.dispose();
    expect(freed).toEqual(['3d']);
  });

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

  it('puts the first part at once and the rest a part at a time, each of 100,000 points, until all are on', () => {
    expect(POINTS_PER_PART).toBe(100_000);
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

  it('has the depth test that draws a marker only if it is strictly nearer than one that is there, and writes depth', () => {
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

  describe('coloured by classes', () => {
    /** A class for each point, which is its own number, and colours for the first 8 classes. */
    const numbered = (count: number): ClassColouring => ({
      indices: Uint8Array.from({ length: count }, (_, i) => i % 200),
      colours: Array.from(
        { length: 8 },
        (_, i) => `#${(i * 16).toString(16).padStart(2, '0')}0000`,
      ),
    });
    const classAttribute = (part: Points | undefined) => part?.geometry.getAttribute('aClass');

    it('is in the colour of the layer until it is given classes, and when they are taken away', () => {
      const layer = createPointsLayer(points(3), LOOK);
      expect(uniforms(layer)['uClassed']?.value).toBe(0);
      expect(classAttribute(parts(layer)[0])).toBeUndefined();
      layer.setClasses?.(numbered(3));
      expect(uniforms(layer)['uClassed']?.value).toBe(1);
      layer.setClasses?.(undefined);
      expect(uniforms(layer)['uClassed']?.value).toBe(0);
      expect(uniforms(layer)['uCount']?.value).toBe(0);
      expect(classAttribute(parts(layer)[0])).toBeUndefined();
    });

    it('has the class of each point as an attribute of its vertex, and the colours of the classes in the palette', () => {
      const layer = createPointsLayer(points(3), LOOK);
      layer.setClasses?.({
        indices: Uint8Array.of(2, 0, 255),
        colours: ['#ff0000', '#00ff00', '#0000ff'],
      });
      expect([...(classAttribute(parts(layer)[0])?.array ?? [])]).toEqual([2, 0, 255]);
      expect(classAttribute(parts(layer)[0])?.itemSize).toBe(1);
      expect(uniforms(layer)['uCount']?.value).toBe(3);
      const palette = uniforms(layer)['uPalette']?.value as { x: number; y: number; z: number }[];
      expect(palette).toHaveLength(MAX_CLASSES);
      expect(palette[0]).toMatchObject({ x: 1, y: 0, z: 0 });
      expect(palette[2]).toMatchObject({ x: 0, y: 0, z: 1 });
    });

    it('holds no more colours than it has room for', () => {
      const layer = createPointsLayer(points(3), LOOK);
      layer.setClasses?.({
        indices: new Uint8Array(3),
        colours: Array.from({ length: MAX_CLASSES + 5 }, () => '#0000ff'),
      });
      expect(uniforms(layer)['uCount']?.value).toBe(MAX_CLASSES);
    });

    it('cuts the classes into the parts as views, and gives a part that is put on later its share', () => {
      const colouring = numbered(POINTS_PER_PART + 3);
      const layer = createPointsLayer(points(POINTS_PER_PART + 3), LOOK);
      layer.setClasses?.(colouring);
      layer.step?.();
      const [first, second] = parts(layer).map((part) => classAttribute(part)?.array);
      expect(first?.length).toBe(POINTS_PER_PART);
      expect(second?.length).toBe(3);
      expect(second?.buffer).toBe(colouring.indices.buffer);
      expect(second?.byteOffset).toBe(POINTS_PER_PART);
    });

    it('is in the colour of the layer for classes that are not one byte for each point', () => {
      const layer = createPointsLayer(points(3), LOOK);
      layer.setClasses?.(numbered(3));
      layer.setClasses?.(numbered(2));
      expect(uniforms(layer)['uClassed']?.value).toBe(0);
      expect(classAttribute(parts(layer)[0])).toBeUndefined();
      layer.setClasses?.(numbered(4));
      expect(uniforms(layer)['uClassed']?.value).toBe(0);
    });

    it('keeps the attribute when it is given the same classes with other colours: only the palette changes', () => {
      const layer = createPointsLayer(points(3), LOOK);
      const colouring = numbered(3);
      layer.setClasses?.(colouring);
      const attribute = classAttribute(parts(layer)[0]);
      layer.setClasses?.({ indices: colouring.indices, colours: ['#ff0000', '#00ff00'] });
      expect(classAttribute(parts(layer)[0])).toBe(attribute);
      expect(uniforms(layer)['uCount']?.value).toBe(2);
      expect(uniforms(layer)['uClassed']?.value).toBe(1);
      layer.setClasses?.({
        indices: Uint8Array.from(colouring.indices),
        colours: colouring.colours,
      });
      expect(classAttribute(parts(layer)[0])).not.toBe(attribute);
    });

    it('does not change what it looks like in one colour: the layer colour, size and opacity are as they were', () => {
      const layer = createPointsLayer(points(3), LOOK);
      layer.setClasses?.(numbered(3));
      layer.setLook({ ...LOOK, colour: '#112233', opacity: 0.5, pointSize: 10 });
      expect(uniforms(layer)['uFill']?.value).toMatchObject({
        x: 17 / 255,
        y: 34 / 255,
        z: 51 / 255,
      });
      expect(uniforms(layer)['uOpacity']?.value).toBe(0.5);
      expect(uniforms(layer)['uClassed']?.value).toBe(1);
    });
  });
});
