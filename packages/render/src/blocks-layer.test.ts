import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, EqualDepth, LessDepth } from 'three';
import type { InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { BLOCKS_PER_PART, createBlocksLayer } from './blocks-layer.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';
import { MAX_CLASSES } from './look.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 1,
  colour: '#56b4e9',
  pointSize: 6,
  lineWidth: 2,
};
const FLAT: FrameInfo = {
  pixelRatio: 1,
  viewport: [800, 600],
  flat: true,
  light: [0, 0, 1],
  outline: [0, 0, 0],
};
const SOLID: FrameInfo = { ...FLAT, flat: false };

type Blocks = Extract<RenderBuffers, { kind: 'blocks' }>;

/** `count` blocks of 10 by 20 by 5 in a row, 10 apart along x, from (100, 200, 50). */
const blocks = (count = 3, rotation = 0): Blocks => ({
  kind: 'blocks',
  centres: Float32Array.from({ length: count * 3 }, (_, i) =>
    i % 3 === 0 ? 100 + Math.floor(i / 3) * 10 : i % 3 === 1 ? 200 : 50,
  ),
  spacing: [10, 20, 5],
  rotation,
});

/** A class for each block, which is its own number, and a colour for each of the first 8 classes. */
const numbered = (count: number): ClassColouring => ({
  indices: Uint8Array.from({ length: count }, (_, i) => i % 200),
  colours: Array.from({ length: 8 }, (_, i) => `#${(i * 16).toString(16).padStart(2, '0')}0000`),
});

/** The meshes that draw the colour, one for each part (the depth pass of a layer that is less than opaque is another for each). */
const parts = (layer: ReturnType<typeof createBlocksLayer>): Mesh[] =>
  (layer.object.children as Mesh[]).filter((mesh) => (mesh.material as ShaderMaterial).transparent);
/** The meshes that draw only depth, one for each part. */
const depthPasses = (layer: ReturnType<typeof createBlocksLayer>): Mesh[] =>
  (layer.object.children as Mesh[]).filter(
    (mesh) => !(mesh.material as ShaderMaterial).transparent,
  );
const geometryOf = (mesh: Mesh | undefined) =>
  mesh?.geometry as InstancedBufferGeometry | undefined;
const uniforms = (layer: ReturnType<typeof createBlocksLayer>) =>
  (parts(layer)[0]?.material as ShaderMaterial).uniforms;
const centres = (mesh: Mesh | undefined) => [
  ...((geometryOf(mesh)?.getAttribute('aCentre').array as Float32Array | undefined) ?? []),
];

describe('createBlocksLayer', () => {
  it('is one box with an instance for each block: the centre of each, and nothing else made again for a block', () => {
    const layer = createBlocksLayer(blocks(3), LOOK);
    expect(parts(layer)).toHaveLength(1);
    const geometry = geometryOf(parts(layer)[0]);
    expect(geometry?.instanceCount).toBe(3);
    expect(centres(parts(layer)[0])).toEqual([100, 200, 50, 110, 200, 50, 120, 200, 50]);
    // A box of 24 corners and 36 indices, whatever the number of blocks.
    expect(geometry?.getAttribute('position').count).toBe(24);
    expect(geometry?.index?.count).toBe(36);
  });

  it('has the normal of each corner of the box, which a face is lit by, and the light of the frame, starting straight above', () => {
    const layer = createBlocksLayer(blocks(), LOOK);
    const geometry = geometryOf(parts(layer)[0]);
    const normal = geometry?.getAttribute('normal');
    expect(normal?.count).toBe(24);
    // The top face (the fifth of six, four corners each) faces up.
    expect([normal?.getX(16), normal?.getY(16), normal?.getZ(16)]).toEqual([0, 0, 1]);
    expect(uniforms(layer)['uLight']?.value).toMatchObject({ x: 0, y: 0, z: 1 });
    expect(uniforms(layer)['uAmbient']?.value).toBe(0.25);
    layer.prepareFrame({ ...SOLID, light: [-0.5, 0.5, Math.SQRT1_2] });
    expect(uniforms(layer)['uLight']?.value).toMatchObject({ x: -0.5, y: 0.5, z: Math.SQRT1_2 });
    // The depth pass has the same uniforms, so it discards the same blocks.
    expect(
      (
        depthPasses(createBlocksLayer(blocks(), { ...LOOK, opacity: 0.5 }))[0]
          ?.material as ShaderMaterial
      ).uniforms['uLight'],
    ).toBeDefined();
  });

  it('turns the normal of a face with the block and takes it into the space of the camera, in the shader that lights the block', () => {
    const material = parts(createBlocksLayer(blocks(), LOOK))[0]?.material as ShaderMaterial;
    expect(material.vertexShader).toContain('normalMatrix * facing');
    expect(material.vertexShader).toContain('uTurn.y * normal.x - uTurn.x * normal.y');
    expect(material.fragmentShader).toContain('dot(normalize(vNormal), uLight)');
  });

  it('draws only the top face from above, and every face otherwise', () => {
    const layer = createBlocksLayer(blocks(), LOOK);
    const geometry = geometryOf(parts(layer)[0]);
    layer.prepareFrame(FLAT);
    expect(geometry?.drawRange).toEqual({ start: 24, count: 6 });
    layer.prepareFrame(SOLID);
    expect(geometry?.drawRange.start).toBe(0);
    expect(geometry?.drawRange.count).toBe(Infinity);
    layer.prepareFrame(FLAT);
    expect(geometry?.drawRange).toEqual({ start: 24, count: 6 });
  });

  it('draws the top face from above: its six indices are corners at the top of the box, half its height up', () => {
    const layer = createBlocksLayer(blocks(), LOOK);
    const geometry = geometryOf(parts(layer)[0]);
    layer.prepareFrame(FLAT);
    const { start, count } = geometry?.drawRange ?? { start: 0, count: 0 };
    const index = geometry?.index?.array ?? [];
    const position = geometry?.getAttribute('position');
    const heights = [...index].slice(start, start + count).map((corner) => position?.getZ(corner));
    expect(heights).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it('draws the top face from above before it has been told whether it is: the view is flat until it says it is not', () => {
    const layer = createBlocksLayer(blocks(), LOOK);
    expect(geometryOf(parts(layer)[0])?.drawRange).toEqual({ start: 24, count: 6 });
  });

  it('has the size of a block and its turn, and a turn that is exact for a quarter', () => {
    expect(uniforms(createBlocksLayer(blocks(3, 0), LOOK))['uSize']?.value).toMatchObject({
      x: 10,
      y: 20,
      z: 5,
    });
    expect(uniforms(createBlocksLayer(blocks(3, 0), LOOK))['uTurn']?.value).toMatchObject({
      x: 0,
      y: 1,
    });
    expect(uniforms(createBlocksLayer(blocks(3, 90), LOOK))['uTurn']?.value).toMatchObject({
      x: 1,
      y: 0,
    });
    const slant = uniforms(createBlocksLayer(blocks(3, 30), LOOK))['uTurn']?.value as {
      x: number;
      y: number;
    };
    expect(slant.x).toBeCloseTo(0.5, 12);
    expect(slant.y).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  it('puts the blocks in parts of 100,000, the first at once, as views of the centres and not copies', () => {
    expect(BLOCKS_PER_PART).toBe(100_000);
    const buffers = blocks(BLOCKS_PER_PART + 3);
    const layer = createBlocksLayer(buffers, LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect(layer.step?.()).toBe(false);
    expect(parts(layer).map((mesh) => geometryOf(mesh)?.instanceCount)).toEqual([
      BLOCKS_PER_PART,
      3,
    ]);
    const second = geometryOf(parts(layer)[1])?.getAttribute('aCentre').array;
    expect(second?.buffer).toBe(buffers.centres.buffer);
    expect(second?.byteOffset).toBe(BLOCKS_PER_PART * 3 * 4);
    expect(layer.step?.()).toBe(false);
    expect(parts(layer)).toHaveLength(2);
  });

  it('has nothing to step for few blocks, or exactly a part of them, and nothing to draw for none', () => {
    expect('step' in createBlocksLayer(blocks(3), LOOK)).toBe(false);
    expect('step' in createBlocksLayer(blocks(BLOCKS_PER_PART), LOOK)).toBe(false);
    expect(parts(createBlocksLayer(blocks(0), LOOK))).toHaveLength(0);
  });

  it('shares the one box between the parts', () => {
    const layer = createBlocksLayer(blocks(BLOCKS_PER_PART + 1), LOOK);
    layer.step?.();
    const [first, second] = parts(layer).map((mesh) => geometryOf(mesh));
    expect(first?.getAttribute('position')).toBe(second?.getAttribute('position'));
    expect(first?.index).toBe(second?.index);
  });

  it('draws nothing until it has classes, and the classes of each block as an attribute of its instances', () => {
    const layer = createBlocksLayer(blocks(3), LOOK);
    expect(layer.object.visible).toBe(false);
    layer.setClasses?.(numbered(3));
    expect(layer.object.visible).toBe(true);
    const classes = geometryOf(parts(layer)[0])?.getAttribute('aClass');
    expect([...(classes?.array ?? [])]).toEqual([0, 1, 2]);
    expect(classes?.itemSize).toBe(1);
  });

  it('cuts the classes into the parts as views, and gives a part that is built later the classes that are there', () => {
    const colouring = numbered(BLOCKS_PER_PART + 3);
    const layer = createBlocksLayer(blocks(BLOCKS_PER_PART + 3), LOOK);
    layer.setClasses?.(colouring);
    // The second part is not built yet: when it is, it has its share of the classes.
    layer.step?.();
    const [first, second] = parts(layer).map(
      (mesh) => geometryOf(mesh)?.getAttribute('aClass').array,
    );
    expect(first?.length).toBe(BLOCKS_PER_PART);
    expect(second?.length).toBe(3);
    expect(second?.buffer).toBe(colouring.indices.buffer);
    expect(second?.byteOffset).toBe(BLOCKS_PER_PART);
  });

  it('keeps the classes it has when it is given the same ones with other colours: only the palette changes', () => {
    const layer = createBlocksLayer(blocks(3), LOOK);
    const classes = numbered(3);
    layer.setClasses?.(classes);
    const attribute = geometryOf(parts(layer)[0])?.getAttribute('aClass');
    layer.setClasses?.({ indices: classes.indices, colours: ['#ff0000', '#00ff00'] });
    expect(geometryOf(parts(layer)[0])?.getAttribute('aClass')).toBe(attribute);
    expect(uniforms(layer)['uCount']?.value).toBe(2);
    const palette = uniforms(layer)['uPalette']?.value as { x: number }[];
    expect(palette[0]?.x).toBe(1);
    expect(layer.object.visible).toBe(true);
    layer.setClasses?.({ indices: Uint8Array.from(classes.indices), colours: classes.colours });
    expect(geometryOf(parts(layer)[0])?.getAttribute('aClass')).not.toBe(attribute);
  });

  it('has the colours of the classes in the palette, as many as there are, and no more than it can hold', () => {
    const layer = createBlocksLayer(blocks(3), LOOK);
    layer.setClasses?.({ indices: new Uint8Array(3), colours: ['#ff0000', '#00ff00'] });
    expect(uniforms(layer)['uCount']?.value).toBe(2);
    const palette = uniforms(layer)['uPalette']?.value as { x: number; y: number; z: number }[];
    expect(palette).toHaveLength(MAX_CLASSES);
    expect(palette[0]).toMatchObject({ x: 1, y: 0, z: 0 });
    expect(palette[1]).toMatchObject({ x: 0, y: 1, z: 0 });
    layer.setClasses?.({
      indices: new Uint8Array(3),
      colours: Array.from({ length: MAX_CLASSES + 5 }, () => '#0000ff'),
    });
    expect(uniforms(layer)['uCount']?.value).toBe(MAX_CLASSES);
  });

  it('draws nothing for classes that are not one byte for each block, and takes the classes away when told to', () => {
    const layer = createBlocksLayer(blocks(3), LOOK);
    layer.setClasses?.(numbered(3));
    layer.setClasses?.(numbered(2));
    expect(layer.object.visible).toBe(false);
    expect(geometryOf(parts(layer)[0])?.hasAttribute('aClass')).toBe(false);
    layer.setClasses?.(numbered(4));
    expect(layer.object.visible).toBe(false);
    layer.setClasses?.(numbered(3));
    expect(layer.object.visible).toBe(true);
    layer.setClasses?.(undefined);
    expect(layer.object.visible).toBe(false);
    expect(geometryOf(parts(layer)[0])?.hasAttribute('aClass')).toBe(false);
    expect(uniforms(layer)['uCount']?.value).toBe(0);
  });

  it('takes the opacity of its look, shows or hides, and what is shown is what has classes', () => {
    const layer = createBlocksLayer(blocks(3), { ...LOOK, opacity: 0.4 });
    expect(uniforms(layer)['uOpacity']?.value).toBe(0.4);
    layer.setClasses?.(numbered(3));
    layer.setLook({ ...LOOK, opacity: 0.7, visible: false });
    expect(uniforms(layer)['uOpacity']?.value).toBe(0.7);
    expect(layer.object.visible).toBe(false);
    layer.setLook({ ...LOOK, visible: true });
    expect(layer.object.visible).toBe(true);
    const bare = createBlocksLayer(blocks(3), { ...LOOK, visible: false });
    bare.setClasses?.(numbered(3));
    expect(bare.object.visible).toBe(false);
  });

  it('is drawn with depth, strictly nearer, so that the highest top shows, from either side', () => {
    const material = parts(createBlocksLayer(blocks(), LOOK))[0]?.material as ShaderMaterial;
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.depthFunc).toBe(LessDepth);
    expect(material.side).toBe(DoubleSide);
    expect(material.transparent).toBe(true);
  });

  it('is one pass when it is opaque: no depth pass is drawn, and the colour writes depth, strictly nearer', () => {
    const layer = createBlocksLayer(blocks(BLOCKS_PER_PART + 1), LOOK);
    layer.step?.();
    expect(depthPasses(layer)).toHaveLength(2);
    expect(depthPasses(layer).map((mesh) => mesh.visible)).toEqual([false, false]);
    const material = parts(layer)[0]?.material as ShaderMaterial;
    expect([material.depthWrite, material.depthFunc]).toEqual([true, LessDepth]);
  });

  it('is two passes when it is less than opaque: the depth first, and the colour only where the depth is exactly that, writing none', () => {
    const layer = createBlocksLayer(blocks(BLOCKS_PER_PART + 1), { ...LOOK, opacity: 0.5 });
    layer.step?.();
    expect(depthPasses(layer).map((mesh) => mesh.visible)).toEqual([true, true]);
    const depth = depthPasses(layer)[0]?.material as ShaderMaterial;
    expect(depth.colorWrite).toBe(false);
    expect(depth.depthWrite).toBe(true);
    expect(depth.depthTest).toBe(true);
    expect(depth.depthFunc).toBe(LessDepth);
    // Not offset: the colour is drawn only where its depth is the depth that was written, so that the faces inside the model, which are behind the
    // nearest surface by any amount at all (and at the seams between blocks by none that can be seen), are not blended in: an offset would let them in.
    expect(depth.polygonOffset).toBe(false);
    const colour = parts(layer)[0]?.material as ShaderMaterial;
    expect([colour.depthWrite, colour.depthFunc, colour.polygonOffset]).toEqual([
      false,
      EqualDepth,
      false,
    ]);
  });

  it('puts the position of both passes through the same shader, whose output is declared the same bit for bit', () => {
    const layer = createBlocksLayer(blocks(2), { ...LOOK, opacity: 0.5 });
    const depth = depthPasses(layer)[0]?.material as ShaderMaterial;
    const colour = parts(layer)[0]?.material as ShaderMaterial;
    expect(depth.vertexShader).toBe(colour.vertexShader);
    expect(colour.vertexShader).toContain('invariant gl_Position;');
  });

  it('goes from one pass to two and back as the opacity changes, without being built again', () => {
    const layer = createBlocksLayer(blocks(3), LOOK);
    const before = parts(layer)[0];
    layer.setLook({ ...LOOK, opacity: 0.99 });
    expect(depthPasses(layer).map((mesh) => mesh.visible)).toEqual([true]);
    expect((parts(layer)[0]?.material as ShaderMaterial).depthWrite).toBe(false);
    layer.setLook({ ...LOOK, opacity: 1 });
    expect(depthPasses(layer).map((mesh) => mesh.visible)).toEqual([false]);
    expect((parts(layer)[0]?.material as ShaderMaterial).depthWrite).toBe(true);
    expect(parts(layer)[0]).toBe(before);
  });

  it('draws a part later with the pass that the opacity then has', () => {
    const layer = createBlocksLayer(blocks(BLOCKS_PER_PART + 1), { ...LOOK, opacity: 0.5 });
    expect(depthPasses(layer).map((mesh) => mesh.visible)).toEqual([true]);
    layer.step?.();
    expect(depthPasses(layer).map((mesh) => mesh.visible)).toEqual([true, true]);
  });

  it('gives the depth pass the same blocks and the same geometry, and discards what the colour pass does, so that what is not drawn hides nothing', () => {
    const layer = createBlocksLayer(blocks(3), { ...LOOK, opacity: 0.5 });
    const depth = depthPasses(layer)[0];
    const colour = parts(layer)[0];
    expect(depth?.geometry).toBe(colour?.geometry);
    const [dm, cm] = [depth?.material as ShaderMaterial, colour?.material as ShaderMaterial];
    expect(dm.uniforms['uCount']).toBe(cm.uniforms['uCount']);
    expect(dm.uniforms['uSize']).toBe(cm.uniforms['uSize']);
    expect(dm.vertexShader).toBe(cm.vertexShader);
    expect(dm.fragmentShader).toContain('discard');
    expect(dm.fragmentShader).toContain('uCount');
  });

  it('frees every part and its materials when it is disposed', () => {
    const layer = createBlocksLayer(blocks(BLOCKS_PER_PART + 1), LOOK);
    layer.step?.();
    const freed: string[] = [];
    for (const [i, mesh] of parts(layer).entries()) {
      mesh.geometry.addEventListener('dispose', () => freed.push(`geometry ${String(i)}`));
    }
    (parts(layer)[0]?.material as ShaderMaterial).addEventListener('dispose', () =>
      freed.push('material'),
    );
    (depthPasses(layer)[0]?.material as ShaderMaterial).addEventListener('dispose', () =>
      freed.push('depth material'),
    );
    layer.dispose();
    expect(freed.sort()).toEqual(['depth material', 'geometry 0', 'geometry 1', 'material']);
    expect(layer.object.children).toHaveLength(0);
  });
});
