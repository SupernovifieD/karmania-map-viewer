import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, EqualDepth, LessDepth } from 'three';
import type { InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { BLOCKS_PER_PART, BLOCKS_PER_STEP, createBlocksLayer } from './blocks-layer.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';
import { MAX_CLASSES, NO_VALUE } from './look.js';

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
/** How many times an attribute has been sent to the card (three counts the times that `needsUpdate` was set). */
const versionOf = (attribute: unknown): number =>
  (attribute as { version: number } | undefined)?.version ?? 0;
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

  it('cuts the classes into the parts as copies of its own, and gives a part that is built later the classes that are there', () => {
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
    expect([...(second ?? [])]).toEqual([...colouring.indices.subarray(BLOCKS_PER_PART)]);
    expect([...(first ?? []).slice(0, 4)]).toEqual([...colouring.indices.subarray(0, 4)]);
    // Copies, not views: an attribute is written to when other classes come, and the classes are the caller's (the pipeline keeps them).
    expect(first?.buffer).not.toBe(colouring.indices.buffer);
    expect(second?.buffer).not.toBe(colouring.indices.buffer);
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
    // Other classes go into the attribute it has, which is sent to the card again: a new attribute would leave the card's buffer of the old one
    // behind, as three frees a buffer only when the geometry that holds its attribute is disposed.
    const version = versionOf(attribute);
    layer.setClasses?.({ indices: Uint8Array.from([2, 1, 0]), colours: classes.colours });
    const after = geometryOf(parts(layer)[0])?.getAttribute('aClass');
    expect(after).toBe(attribute);
    expect([...(after?.array ?? [])]).toEqual([2, 1, 0]);
    expect(versionOf(after)).toBeGreaterThan(version);
  });

  it('never writes into the classes it is given, though it writes other classes into its own attribute', () => {
    const layer = createBlocksLayer(blocks(3), LOOK);
    const first = Uint8Array.from([0, 1, 2]);
    layer.setClasses?.({ indices: first, colours: ['#ff0000', '#00ff00', '#0000ff'] });
    const second = Uint8Array.from([2, 2, 2]);
    layer.setClasses?.({ indices: second, colours: ['#ff0000', '#00ff00', '#0000ff'] });
    expect([...first]).toEqual([0, 1, 2]);
    expect([...second]).toEqual([2, 2, 2]);
    first[0] = 1;
    expect([...(geometryOf(parts(layer)[0])?.getAttribute('aClass').array ?? [])]).toEqual([
      2, 2, 2,
    ]);
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
    const attribute = geometryOf(parts(layer)[0])?.getAttribute('aClass');
    layer.setClasses?.(numbered(2));
    expect(layer.object.visible).toBe(false);
    expect(uniforms(layer)['uCount']?.value).toBe(0);
    layer.setClasses?.(numbered(4));
    expect(layer.object.visible).toBe(false);
    layer.setClasses?.(numbered(3));
    expect(layer.object.visible).toBe(true);
    layer.setClasses?.(undefined);
    expect(layer.object.visible).toBe(false);
    expect(uniforms(layer)['uCount']?.value).toBe(0);
    // The attribute is not taken away (it is not drawn, and the next classes go into it, so that its buffer on the card is not left behind).
    expect(geometryOf(parts(layer)[0])?.getAttribute('aClass')).toBe(attribute);
    layer.setClasses?.(numbered(3));
    expect(layer.object.visible).toBe(true);
    expect(geometryOf(parts(layer)[0])?.getAttribute('aClass')).toBe(attribute);
    expect([...(attribute?.array ?? [])]).toEqual([0, 1, 2]);
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

/** A dense model of `nx` by `ny` by `nz` blocks of 10 metres, with its centres in lattice order (`i` fastest) and its size said. */
const dense = (
  nx: number,
  ny: number,
  nz: number,
): Blocks & { dims: [number, number, number] } => ({
  kind: 'blocks',
  centres: Float32Array.from({ length: nx * ny * nz * 3 }, (_, at) => {
    const block = Math.floor(at / 3);
    const [i, j, k] = [block % nx, Math.floor(block / nx) % ny, Math.floor(block / (nx * ny))];
    return [i * 10 + 5, j * 10 + 5, k * 10 + 5][at % 3] ?? 0;
  }),
  spacing: [10, 10, 10],
  rotation: 0,
  dims: [nx, ny, nz],
});

/** The same class (with a colour) for every block, or `classes` where given. */
const every = (count: number, kind = 0): ClassColouring => ({
  indices: new Uint8Array(count).fill(kind),
  colours: ['#ff0000', '#00ff00'],
});

/** Works the layer through until it has nothing left to make (a dense model makes its instances a part at a time, between frames); how many times it was asked. */
function settle(layer: ReturnType<typeof createBlocksLayer>): number {
  let calls = 1;
  while (layer.step?.() === true) {
    calls += 1;
  }
  return calls;
}

const instanceCount = (layer: ReturnType<typeof createBlocksLayer>): number =>
  parts(layer).reduce((sum, mesh) => sum + (geometryOf(mesh)?.instanceCount ?? 0), 0);

const centresOfInstances = (mesh: Mesh | undefined): number[] => [
  ...((geometryOf(mesh)?.getAttribute('aCentre').array as Float32Array | undefined) ?? []),
];

const masksOf = (mesh: Mesh | undefined): number[] => [
  ...((geometryOf(mesh)?.getAttribute('aExposed').array as Uint8Array | undefined) ?? []),
];

describe('createBlocksLayer: a dense model, by its exposed faces', () => {
  it('draws nothing until it has classes, and says that it has work to do when it has them: its instances are made then', () => {
    const layer = createBlocksLayer(dense(3, 3, 3), LOOK);
    expect(uniforms(layer)['uMasked']?.value).toBe(1);
    expect(typeof layer.step).toBe('function');
    expect(layer.object.visible).toBe(false);
    expect(instanceCount(layer)).toBe(0);
    layer.setClasses?.(every(27));
    expect(layer.object.visible).toBe(true);
    // Not drawn until the instances are made, which is a part of the work between frames.
    expect(parts(layer)[0]?.visible).toBe(false);
    settle(layer);
    expect(parts(layer)[0]?.visible).toBe(true);
  });

  it('leaves out the block that is inside a model, which no face of it shows from, and keeps the 26 that are on its outside', () => {
    const layer = createBlocksLayer(dense(3, 3, 3), LOOK);
    layer.setClasses?.(every(27));
    settle(layer);
    expect(instanceCount(layer)).toBe(26);
    // The middle block, the 14th (index 13), has its centre at (15, 15, 15): none of the instances is there.
    const centres = centresOfInstances(parts(layer)[0]);
    const at = Array.from({ length: 26 }, (_, n) => centres.slice(n * 3, n * 3 + 3));
    expect(at.some(([x, y, z]) => x === 15 && y === 15 && z === 15)).toBe(false);
    expect(at.some(([x, y, z]) => x === 5 && y === 5 && z === 5)).toBe(true);
  });

  it('says which faces show with a bit for each: a corner has three, an edge four, a face of the model five, and the faces between blocks are not there', () => {
    const layer = createBlocksLayer(dense(3, 3, 3), LOOK);
    layer.setClasses?.(every(27));
    settle(layer);
    const masks = masksOf(parts(layer)[0]);
    const bits = (mask: number): number =>
      [0, 1, 2, 3, 4, 5].filter((bit) => (mask >> bit) % 2 === 1).length;
    // 8 corners with 3 faces, 12 edges with 2... as each block counts: a corner block shows 3 of its faces, an edge block 2, a face block 1.
    const counts = masks.map(bits);
    expect(counts.filter((n) => n === 3)).toHaveLength(8);
    expect(counts.filter((n) => n === 2)).toHaveLength(12);
    expect(counts.filter((n) => n === 1)).toHaveLength(6);
    // The first block, (0, 0, 0): its -x, -y and -z faces (bits 1, 3 and 5) show, and +x, +y, +z, which have blocks beside them, do not.
    expect(masks[0]).toBe(2 + 8 + 32);
  });

  it('shows the faces that look at a block that is not drawn: a block with no value is a hole, and its neighbours have a face to it', () => {
    const layer = createBlocksLayer(dense(3, 3, 3), LOOK);
    const classes = every(27);
    classes.indices[13] = NO_VALUE;
    layer.setClasses?.(classes);
    settle(layer);
    // All 26 that are drawn are on the outside or beside the hole, and the hole has six blocks beside it, each with a face to it.
    expect(instanceCount(layer)).toBe(26);
    const masks = masksOf(parts(layer)[0]);
    const centres = centresOfInstances(parts(layer)[0]);
    const maskAt = (x: number, y: number, z: number): number | undefined => {
      for (let n = 0; n < masks.length; n += 1) {
        if (centres[n * 3] === x && centres[n * 3 + 1] === y && centres[n * 3 + 2] === z) {
          return masks[n];
        }
      }
      return undefined;
    };
    // The block at (0.., 1, 1) is beside the hole along +x: its +x face (bit 0) shows now, as well as its own -x face (bit 1).
    expect(maskAt(5, 15, 15)).toBe(1 + 2);
    // The one at (2, 1, 1) is beside it along -x: its -x face (bit 1) shows, and its +x face (bit 0), as it is on the model's side.
    expect(maskAt(25, 15, 15)).toBe(1 + 2);
    // The one over it, at (1, 1, 2): its -z face (bit 5) looks at the hole, and its +z face (bit 4) is on the outside.
    expect(maskAt(15, 15, 25)).toBe(16 + 32);
  });

  it('draws a block whose class has no colour as one that is not drawn: its neighbours have a face to it', () => {
    const layer = createBlocksLayer(dense(3, 1, 1), LOOK);
    const classes = every(3);
    // Two colours: the class 5 of the middle block has none.
    classes.indices[1] = 5;
    layer.setClasses?.(classes);
    settle(layer);
    expect(instanceCount(layer)).toBe(2);
    // The block at (0, 0, 0): +x (bit 0) shows because the block beside it is not drawn; and the rest do, as there is nothing beside them.
    expect(masksOf(parts(layer)[0])[0]).toBe(63);
  });

  it('makes its instances a part at a time, with the neighbours right across the edge of a part', () => {
    // 101,000 blocks in a row of 1 by 1000 by 101: two parts of 100,000 and 1,000.
    const [nx, ny, nz] = [101, 1000, 1];
    const layer = createBlocksLayer(dense(nx, ny, nz), LOOK);
    layer.setClasses?.(every(nx * ny * nz));
    const steps = settle(layer);
    expect(parts(layer)).toHaveLength(2);
    // The instances of a part are made BLOCKS_PER_STEP blocks at a time: 4 steps for the 100,000 and 1 for the 1,000 (the second part is built by
    // the first of the steps that it is waited for).
    expect(steps).toBe(Math.ceil(BLOCKS_PER_PART / BLOCKS_PER_STEP) + 1);
    // One layer of 101 by 1000 blocks: every block shows its top and its bottom, the blocks on the rim show a side or two, and the inside shows 2 faces.
    expect(instanceCount(layer)).toBe(nx * ny);
    const all = parts(layer).flatMap((mesh) => masksOf(mesh));
    expect(all.filter((mask) => mask === 16 + 32)).toHaveLength((nx - 2) * (ny - 2));
    // A block of the first part whose neighbour (in +y) is in the second part has no +y face: the one at the last row of the part is index 99,999,
    // which is (i = 99999 % 101 = 100? 99,999 = 990 * 101 + 9): its +y neighbour is the block 100,100, in the second part.
    const first = masksOf(parts(layer)[0]);
    expect(first).toHaveLength(100_000);
    expect(((first[99_999] ?? 0) & 4) === 4).toBe(false);
  });

  it('does no more than BLOCKS_PER_STEP blocks of work in a step, so that the work of a frame does not grow with the model, and is ready when the last of them is done', () => {
    const [nx, ny, nz] = [100, 100, 10];
    const layer = createBlocksLayer(dense(nx, ny, nz), LOOK);
    layer.setClasses?.(every(nx * ny * nz));
    // The first part is 100,000 blocks: a quarter of it each step, ready at the fourth.
    for (let step = 1; step <= 3; step += 1) {
      layer.step?.();
      expect(parts(layer)[0]?.visible, `after step ${String(step)}`).toBe(false);
    }
    layer.step?.();
    expect(parts(layer)[0]?.visible).toBe(true);
    expect(BLOCKS_PER_STEP).toBeLessThan(BLOCKS_PER_PART);
  });

  it('lets go of what it was making when other classes come, and makes the instances of the new ones', () => {
    const layer = createBlocksLayer(dense(100, 100, 10), LOOK);
    layer.setClasses?.(every(100_000));
    layer.step?.();
    layer.step?.();
    // Half done for these classes; the next are of a model with a hole, and nothing that was made for the first is used.
    const other = every(100_000);
    other.indices.fill(NO_VALUE, 0, 50_000);
    layer.setClasses?.(other);
    expect(parts(layer)[0]?.visible).toBe(false);
    // The part is drawn when its instances are ready, and the first time it is it has to be for the classes that the layer has now: what was half made
    // for the others would be finished, and drawn, a frame or two before the instances of these, if it was not let go (the instances that are there at
    // the end are the same either way, since the part is made again, so it is the first picture that is looked at).
    let steps = 0;
    while (parts(layer)[0]?.visible !== true && steps < 20) {
      layer.step?.();
      steps += 1;
    }
    expect(parts(layer)[0]?.visible).toBe(true);
    // The first 50,000 blocks (5 layers of 100 by 100) are not drawn, so layers 5 to 9 are the model. What shows is the whole of layer 5 (its bottom is
    // open), the whole of layer 9 (its top), and the 396 blocks round the edge of each of the three between (2 * 100 + 2 * 98): 21,188 instances. The
    // model of the first classes had 23,168 (its layer 0 and layer 9 whole, and 396 for each of 8 between), the lowest at 5 metres, so neither the count
    // nor the lowest block could be the same if any of what was made for them was kept.
    expect(instanceCount(layer)).toBe(21_188);
    const mesh = parts(layer)[0];
    const heights = centresOfInstances(mesh).filter((_, n) => n % 3 === 2);
    expect(Math.min(...heights)).toBe(55);
    // The bottoms that show are those of layer 5 and no others: 100 by 100 of them.
    expect(masksOf(mesh).filter((mask) => (mask & 32) === 32)).toHaveLength(100 * 100);
  });

  it('makes its instances again when other classes come, and keeps them when the same ones come with other colours', () => {
    const layer = createBlocksLayer(dense(3, 3, 3), LOOK);
    const first = every(27);
    layer.setClasses?.(first);
    settle(layer);
    const attribute = geometryOf(parts(layer)[0])?.getAttribute('aCentre');
    layer.setClasses?.({ indices: first.indices, colours: ['#0000ff', '#ffff00'] });
    expect(layer.step?.() ?? false).toBe(false);
    expect(geometryOf(parts(layer)[0])?.getAttribute('aCentre')).toBe(attribute);
    // Other classes: a model with a hole in it.
    const second = every(27);
    second.indices[13] = NO_VALUE;
    layer.setClasses?.(second);
    expect(parts(layer)[0]?.visible).toBe(false);
    settle(layer);
    expect(parts(layer)[0]?.visible).toBe(true);
    expect(geometryOf(parts(layer)[0])?.getAttribute('aCentre')).not.toBe(attribute);
    // The same classes with fewer colours: the blocks of the class that has none are not drawn, so the instances are made again.
    layer.setClasses?.({ indices: second.indices, colours: ['#ff0000'] });
    expect(parts(layer)[0]?.visible).toBe(false);
  });

  it('puts new instances in a geometry of their own and frees the one they replace, leaving the box that every part uses to the others', () => {
    const layer = createBlocksLayer(dense(3, 3, 3), { ...LOOK, opacity: 0.5 });
    layer.setClasses?.(every(27));
    settle(layer);
    const old = geometryOf(parts(layer)[0]);
    const corners = old?.getAttribute('position');
    let freed = 0;
    old?.addEventListener('dispose', () => {
      freed += 1;
    });
    // The block at a corner of the model is taken out: 25 of the 26 on the outside are left.
    const hole = every(27);
    hole.indices[0] = NO_VALUE;
    layer.setClasses?.(hole);
    expect(freed).toBe(0);
    settle(layer);
    const next = geometryOf(parts(layer)[0]);
    expect(next).not.toBe(old);
    expect(freed).toBe(1);
    expect(next?.instanceCount).toBe(25);
    // Both passes draw the new one, with the box (its corners are the same attribute, not made again) and nothing of the old instances.
    expect(depthPasses(layer)[0]?.geometry).toBe(next);
    expect(next?.getAttribute('position')).toBe(corners);
    expect(old?.hasAttribute('position')).toBe(false);
    // And it is drawn as the others of the layer are: from above, only the tops.
    layer.prepareFrame(FLAT);
    expect(next?.drawRange).toEqual({ start: 24, count: 6 });
    layer.setClasses?.(every(27));
    layer.prepareFrame(SOLID);
    settle(layer);
    expect(geometryOf(parts(layer)[0])?.drawRange.count).toBe(Infinity);
  });

  it('draws the depth pass and the colour pass of a part when its instances are there, and neither before', () => {
    const layer = createBlocksLayer(dense(2, 2, 2), { ...LOOK, opacity: 0.5 });
    layer.setClasses?.(every(8));
    expect([parts(layer)[0]?.visible, depthPasses(layer)[0]?.visible]).toEqual([false, false]);
    settle(layer);
    expect([parts(layer)[0]?.visible, depthPasses(layer)[0]?.visible]).toEqual([true, true]);
    layer.setLook({ ...LOOK, opacity: 1 });
    expect([parts(layer)[0]?.visible, depthPasses(layer)[0]?.visible]).toEqual([true, false]);
  });

  it('puts a face that is not shown outside the clip volume in the shader, from the normal of the corner and the bit of its face', () => {
    const material = parts(createBlocksLayer(dense(2, 2, 2), LOOK))[0]?.material as ShaderMaterial;
    expect(material.vertexShader).toContain('attribute float aExposed;');
    expect(material.vertexShader).toContain('mod(floor(aExposed / exp2(face)), 2.0) < 0.5');
    expect(material.vertexShader).toContain('gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    // A sparse model is not masked: all its faces are drawn, as before.
    expect(uniforms(createBlocksLayer(blocks(3), LOOK))['uMasked']?.value).toBe(0);
  });
});
