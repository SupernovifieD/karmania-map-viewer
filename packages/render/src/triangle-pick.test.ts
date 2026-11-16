import { Group, Mesh } from 'three';
import type { BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { createTrianglePicker } from './triangle-pick.js';

/** Six triangles on a strip of 8 vertices at (i, 0, 0), (i, 1, 0). */
const POSITIONS = Float32Array.from({ length: 24 }, (_, i) =>
  i % 3 === 0 ? Math.floor(i / 6) : i % 3 === 1 ? Math.floor(i / 3) % 2 : 0,
);
const TRIANGLES = Uint32Array.from({ length: 18 }, (_, i) => Math.floor(i / 3) + (i % 3));

function setup(owners?: Uint32Array, depthWrite = false) {
  const parent = new Group();
  const own = new Mesh();
  parent.add(own);
  const layer = { value: 0 };
  const picker = createTrianglePicker(
    {
      positions: POSITIONS,
      triangles: TRIANGLES,
      ...(owners === undefined ? {} : { owners }),
      parent,
      depthWrite,
    },
    layer,
  );
  const pickGroup = (): Group => parent.children.find((child) => child !== own) as Group;
  const parts = (): Mesh[] => pickGroup().children as Mesh[];
  const attribute = (part: Mesh | undefined, name: string): number[] => [
    ...((part?.geometry.getAttribute(name) as BufferAttribute | undefined)?.array ?? []),
  ];
  return { parent, own, layer, picker, pickGroup, parts, attribute };
}

describe('createTrianglePicker', () => {
  it("shows triangles of their own in place of the layer's, each of its three vertices with the element it is of, and puts the layer's back", () => {
    const { own, picker, pickGroup, parts, attribute } = setup();
    expect(own.visible).toBe(true);
    const back = picker.show(undefined, 6);
    expect(own.visible).toBe(false);
    expect(pickGroup().visible).toBe(true);
    expect(parts()).toHaveLength(1);
    const [part] = parts();
    // The first triangle has the vertices 0, 1, 2 of the strip, and every vertex says it is of the triangle 0; the second 1, 2, 3 and is of 1.
    expect(attribute(part, 'aElement')).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5,
    ]);
    expect(attribute(part, 'position').slice(0, 9)).toEqual([...POSITIONS.subarray(0, 9)]);
    expect(attribute(part, 'position').slice(9, 18)).toEqual([...POSITIONS.subarray(3, 12)]);
    back();
    expect(own.visible).toBe(true);
    expect(pickGroup().visible).toBe(false);
  });

  it('says the owner of each triangle when it has them, and the layer number to the material it writes with', () => {
    const { picker, layer, parts, attribute } = setup(Uint32Array.of(7, 7, 7, 9, 9, 9));
    layer.value = 3;
    picker.show(undefined, 6);
    expect(attribute(parts()[0], 'aElement').filter((_, i) => i % 3 === 0)).toEqual([
      7, 7, 7, 9, 9, 9,
    ]);
    const material = parts()[0]?.material as unknown as {
      uniforms: Record<string, { value: number }>;
    };
    expect(material.uniforms['uPickLayer']).toBe(layer);
  });

  it('draws what the layer has drawn in the order it draws it, and only that: the triangles of a layer by class, and the part of a layer that is built', () => {
    const { picker, parts, attribute } = setup();
    // By class: the triangles 4, 1, 3 in that order.
    picker.show({ order: Uint32Array.of(4, 1, 3), version: 1 }, 6);
    expect(attribute(parts()[0], 'aElement').filter((_, i) => i % 3 === 0)).toEqual([4, 1, 3]);
    // Not by class, with two triangles on the card: the first two.
    picker.show(undefined, 2);
    expect(attribute(parts()[0], 'aElement').filter((_, i) => i % 3 === 0)).toEqual([0, 1]);
    // None on the card: nothing to show.
    picker.show(undefined, 0);
    expect(parts()).toHaveLength(0);
  });

  it('makes the triangles again only when what the layer draws has changed', () => {
    const { picker, parts } = setup();
    const order = Uint32Array.of(0, 1);
    picker.show({ order, version: 1 }, 6)();
    const first = parts()[0]?.geometry;
    picker.show({ order, version: 1 }, 6)();
    expect(parts()[0]?.geometry).toBe(first);
    picker.show({ order, version: 2 }, 6)();
    expect(parts()[0]?.geometry).not.toBe(first);
    const second = parts()[0]?.geometry;
    picker.show({ order: Uint32Array.of(0, 1), version: 2 }, 6)();
    expect(parts()[0]?.geometry).not.toBe(second);
  });

  it('writes depth as the layer does, and frees what it made', () => {
    const solid = setup(undefined, true);
    solid.picker.show(undefined, 6);
    expect((solid.parts()[0]?.material as unknown as { depthWrite: boolean }).depthWrite).toBe(
      true,
    );
    const thin = setup(undefined, false);
    thin.picker.show(undefined, 6);
    expect((thin.parts()[0]?.material as unknown as { depthWrite: boolean }).depthWrite).toBe(
      false,
    );
    const freed: string[] = [];
    thin.parts()[0]?.geometry.addEventListener('dispose', () => freed.push('geometry'));
    thin.picker.dispose();
    expect(freed).toEqual(['geometry']);
    expect(thin.parent.children).toEqual([thin.own]);
  });

  it('leaves out a vertex that is not there as NaN, which draws nothing', () => {
    const parent = new Group();
    const picker = createTrianglePicker(
      {
        positions: Float32Array.of(0, 0, 0, 1, 0, 0),
        triangles: Uint32Array.of(0, 1, 5),
        parent,
        depthWrite: false,
      },
      { value: 0 },
    );
    picker.show(undefined, 1);
    const part = (parent.children[0] as Group).children[0] as Mesh;
    const places = [...(part.geometry.getAttribute('position') as BufferAttribute).array];
    expect(places.slice(0, 6)).toEqual([0, 0, 0, 1, 0, 0]);
    expect(places.slice(6).every(Number.isNaN)).toBe(true);
  });

  it('grows by whole parts while the layer is being built, keeping the parts that are made, and is made again whole for anything else', () => {
    // 250,000 triangles on a strip: three parts of 100,000, the last of 50,000.
    const count = 250_000;
    const strip = Uint32Array.from({ length: count * 3 }, (_, i) => Math.floor(i / 3) + (i % 3));
    const positions = Float32Array.from({ length: (count + 2) * 3 }, (_, i) => i);
    const parent = new Group();
    const picker = createTrianglePicker(
      { positions, triangles: strip, parent, depthWrite: false },
      { value: 0 },
    );
    const parts = (): Mesh[] => (parent.children[0] as Group).children as Mesh[];
    picker.show(undefined, 100_000);
    expect(parts()).toHaveLength(1);
    const first = parts()[0]?.geometry;
    picker.show(undefined, 200_000);
    expect(parts()).toHaveLength(2);
    expect(parts()[0]?.geometry).toBe(first);
    picker.show(undefined, count);
    expect(parts()).toHaveLength(3);
    expect(parts()[0]?.geometry).toBe(first);
    expect(parts()[2]?.geometry.getAttribute('position').count).toBe(50_000 * 3);
    // The numbers of the triangles in the part that was added go on from the ones before it.
    expect((parts()[2]?.geometry.getAttribute('aElement') as BufferAttribute).array[0]).toBe(
      200_000,
    );
    // The same number again changes nothing; a layer by class, or fewer triangles than there were, is made again.
    picker.show(undefined, count);
    expect(parts()[0]?.geometry).toBe(first);
    picker.show({ order: Uint32Array.of(5, 4), version: 1 }, count);
    expect(parts()).toHaveLength(1);
    expect(parts()[0]?.geometry).not.toBe(first);
    const second = parts()[0]?.geometry;
    picker.show(undefined, 100_000);
    expect(parts()[0]?.geometry).not.toBe(second);
  });
});
