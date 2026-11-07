import { BufferAttribute, Group, Mesh, ShaderMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createClassedTriangles } from './class-triangles.js';
import { MAX_CLASSES, NO_VALUE } from './look.js';

/** Six triangles on a strip of 8 vertices. */
const TRIANGLES = Uint32Array.from({ length: 18 }, (_, i) => Math.floor(i / 3) + (i % 3));
const positions = () =>
  new BufferAttribute(
    Float32Array.from({ length: 24 }, (_, i) => i),
    3,
  );

function setup(owners?: Uint32Array) {
  const parent = new Group();
  const attribute = positions();
  const made: { material: ShaderMaterial; colour: Vector3 }[] = [];
  const classed = createClassedTriangles({
    positions: attribute,
    triangles: TRIANGLES,
    ...(owners === undefined ? {} : { owners }),
    parent,
    make: () => {
      const colour = new Vector3();
      const entry = {
        material: new ShaderMaterial({ uniforms: { uColour: { value: colour } } }),
        colour,
      };
      made.push(entry);
      return entry;
    },
  });
  return { parent, attribute, made, classed };
}

const meshes = (parent: Group): Mesh[] => parent.children as Mesh[];
const indicesOf = (mesh: Mesh | undefined): number[] => [...(mesh?.geometry.index?.array ?? [])];
const colours = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `#${((i + 1) * 32).toString(16).padStart(2, '0')}0000`);

describe('createClassedTriangles', () => {
  it('has a mesh for each class that has triangles, with the triangles of that class and no others', () => {
    const { parent, classed } = setup();
    // Triangles 0 to 5 are of the classes 2 2 0 1 0 2.
    expect(classed.set({ indices: Uint8Array.of(2, 2, 0, 1, 0, 2), colours: colours(3) })).toBe(
      true,
    );
    // Sorted by class, in the order they were in: class 0 has triangles 2 and 4, class 1 has 3, class 2 has 0, 1 and 5.
    expect(meshes(parent).map((mesh) => indicesOf(mesh))).toEqual([
      [2, 3, 4, 4, 5, 6],
      [3, 4, 5],
      [0, 1, 2, 1, 2, 3, 5, 6, 7],
    ]);
  });

  it('shares the positions of the layer between the meshes: the card has them once', () => {
    const { parent, attribute, classed } = setup();
    classed.set({ indices: Uint8Array.of(0, 1, 0, 1, 0, 1), colours: colours(2) });
    for (const mesh of meshes(parent)) {
      expect(mesh.geometry.getAttribute('position')).toBe(attribute);
    }
  });

  it('gives each mesh a view of one sorted list of triangles and not a copy of its own', () => {
    const { parent, classed } = setup();
    classed.set({ indices: Uint8Array.of(1, 0, 1, 0, 1, 0), colours: colours(2) });
    const [first, second] = meshes(parent).map((mesh) => mesh.geometry.index?.array);
    expect(first?.buffer).toBe(second?.buffer);
    expect(first?.byteOffset).toBe(0);
    expect(second?.byteOffset).toBe(9 * 4);
  });

  it('leaves out a triangle with no value, and one of a class beyond what a layer holds', () => {
    const { parent, classed } = setup();
    classed.set({
      indices: Uint8Array.of(NO_VALUE, 0, MAX_CLASSES, 0, 31, NO_VALUE),
      colours: colours(2),
    });
    // Only the classes 0 and 31 have a mesh; class 31 has no colour here (two are given), so it is not shown.
    expect(meshes(parent).map((mesh) => indicesOf(mesh))).toEqual([
      [1, 2, 3, 3, 4, 5],
      [4, 5, 6],
    ]);
    expect(meshes(parent).map((mesh) => mesh.visible)).toEqual([true, false]);
  });

  it('colours each class, with the colour of the class and no other, and shows a class that has one', () => {
    const { parent, made, classed } = setup();
    classed.set({
      indices: Uint8Array.of(0, 1, 2, 0, 1, 2),
      colours: ['#ff0000', '#00ff00', '#0000ff'],
    });
    expect(made.map(({ colour }) => [colour.x, colour.y, colour.z])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(meshes(parent).map((mesh) => mesh.visible)).toEqual([true, true, true]);
  });

  it('does not show a class that the colours do not reach', () => {
    const { parent, classed } = setup();
    classed.set({ indices: Uint8Array.of(0, 1, 2, 0, 1, 2), colours: ['#ff0000', '#00ff00'] });
    expect(meshes(parent).map((mesh) => mesh.visible)).toEqual([true, true, false]);
  });

  it('takes the classes of the elements the triangles belong to, when it is told which', () => {
    // Three polygons of two triangles each; the polygons are of the classes 1, no value and 0.
    const owners = Uint32Array.of(0, 0, 1, 1, 2, 2);
    const { parent, classed } = setup(owners);
    expect(classed.set({ indices: Uint8Array.of(1, NO_VALUE, 0), colours: colours(2) })).toBe(true);
    expect(meshes(parent).map((mesh) => indicesOf(mesh))).toEqual([
      [4, 5, 6, 5, 6, 7],
      [0, 1, 2, 1, 2, 3],
    ]);
  });

  it('does not use classes that are not one for each triangle, or that stop short of an element, and draws none by class', () => {
    const { parent, classed } = setup();
    expect(classed.set({ indices: Uint8Array.of(0, 1), colours: colours(2) })).toBe(false);
    expect(classed.set({ indices: new Uint8Array(7), colours: colours(2) })).toBe(false);
    expect(meshes(parent)).toHaveLength(0);
    const owned = setup(Uint32Array.of(0, 0, 1, 1, 2, 2));
    expect(owned.classed.set({ indices: Uint8Array.of(0, 1), colours: colours(2) })).toBe(false);
    expect(meshes(owned.parent)).toHaveLength(0);
    // More classes than polygons is fine.
    expect(owned.classed.set({ indices: Uint8Array.of(0, 1, 0, 1), colours: colours(2) })).toBe(
      true,
    );
  });

  it('takes its meshes away, and frees them, when it is given other classes or none', () => {
    const { parent, classed } = setup();
    classed.set({ indices: Uint8Array.of(0, 1, 0, 1, 0, 1), colours: colours(2) });
    const freed: string[] = [];
    for (const [i, mesh] of meshes(parent).entries()) {
      mesh.geometry.addEventListener('dispose', () => freed.push(`geometry ${String(i)}`));
      (mesh.material as ShaderMaterial).addEventListener('dispose', () =>
        freed.push(`material ${String(i)}`),
      );
    }
    expect(classed.set(undefined)).toBe(false);
    expect(meshes(parent)).toHaveLength(0);
    expect(freed.sort()).toEqual(['geometry 0', 'geometry 1', 'material 0', 'material 1']);
    // And other classes are other meshes.
    classed.set({ indices: Uint8Array.of(0, 0, 0, 0, 0, 0), colours: colours(1) });
    expect(meshes(parent)).toHaveLength(1);
    classed.set({ indices: Uint8Array.of(1, 1, 1, 1, 1, 1), colours: colours(2) });
    expect(meshes(parent)).toHaveLength(1);
    expect(indicesOf(meshes(parent)[0])).toHaveLength(18);
  });

  it('keeps its meshes when it is given the same classes with other colours: only the colours change', () => {
    const { parent, made, classed } = setup();
    const indices = Uint8Array.of(0, 1, 0, 1, 0, 1);
    classed.set({ indices, colours: ['#ff0000', '#00ff00'] });
    const before = meshes(parent).slice();
    classed.set({ indices, colours: ['#0000ff'] });
    expect(meshes(parent)).toEqual(before);
    expect(made[0]?.colour.z).toBe(1);
    expect(meshes(parent).map((mesh) => mesh.visible)).toEqual([true, false]);
    classed.set({ indices: Uint8Array.from(indices), colours: colours(2) });
    expect(meshes(parent)).not.toEqual(before);
  });

  it('frees everything when it is disposed', () => {
    const { parent, classed } = setup();
    classed.set({ indices: Uint8Array.of(0, 1, 0, 1, 0, 1), colours: colours(2) });
    const freed: string[] = [];
    meshes(parent)[0]?.geometry.addEventListener('dispose', () => freed.push('geometry'));
    classed.dispose();
    expect(freed).toEqual(['geometry']);
    expect(meshes(parent)).toHaveLength(0);
  });

  it('has no mesh for no triangles', () => {
    const parent = new Group();
    const classed = createClassedTriangles({
      positions: positions(),
      triangles: new Uint32Array(0),
      parent,
      make: () => ({ material: new ShaderMaterial(), colour: new Vector3() }),
    });
    expect(classed.set({ indices: new Uint8Array(0), colours: colours(2) })).toBe(true);
    expect(parent.children).toHaveLength(0);
  });
});
