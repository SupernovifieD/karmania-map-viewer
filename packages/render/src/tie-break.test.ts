import { Group, Mesh, MeshBasicMaterial, Points, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { TIE_DEPTH, TIE_SLOPE, TIE_UNITS, tieBreak } from './tie-break.js';

const offsetOf = (material: MeshBasicMaterial) => [
  material.polygonOffset,
  material.polygonOffsetFactor,
  material.polygonOffsetUnits,
];

describe('the tie-break of layers in one plane', () => {
  it('moves the triangles of a layer towards the camera by its rank: more for a layer that is higher in the legend', () => {
    const material = new MeshBasicMaterial();
    const layer = new Group().add(new Mesh(undefined, material));
    expect(offsetOf(material)).toEqual([false, 0, 0]);
    tieBreak(layer, 1);
    expect(offsetOf(material)).toEqual([true, -TIE_SLOPE, -TIE_UNITS]);
    tieBreak(layer, 3);
    expect(offsetOf(material)).toEqual([true, -3 * TIE_SLOPE, -3 * TIE_UNITS]);
  });

  it('gives back what the material had at rank 0, which is nothing for most and the offset it was made with for one that has one', () => {
    const plain = new MeshBasicMaterial();
    const depthPass = new MeshBasicMaterial({
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const layer = new Group().add(new Mesh(undefined, plain), new Mesh(undefined, depthPass));
    tieBreak(layer, 2);
    expect(offsetOf(depthPass)).toEqual([true, 1 - 2 * TIE_SLOPE, 1 - 2 * TIE_UNITS]);
    tieBreak(layer, 0);
    expect(offsetOf(plain)).toEqual([false, 0, 0]);
    expect(offsetOf(depthPass)).toEqual([true, 1, 1]);
  });

  it('keeps a material that is offset that much behind another that is not, whatever the rank (they move together)', () => {
    const colour = new MeshBasicMaterial();
    const depthPass = new MeshBasicMaterial({
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const layer = new Group().add(new Mesh(undefined, colour), new Mesh(undefined, depthPass));
    for (const rank of [0, 1, 5]) {
      tieBreak(layer, rank);
      expect(depthPass.polygonOffsetUnits - colour.polygonOffsetUnits).toBe(1);
      expect(depthPass.polygonOffsetFactor - colour.polygonOffsetFactor).toBe(1);
    }
  });

  it('moves what it finds later, in a layer that has made more since: a material that is new has its rank too', () => {
    const first = new MeshBasicMaterial();
    const layer = new Group().add(new Mesh(undefined, first));
    tieBreak(layer, 2);
    const later = new MeshBasicMaterial();
    layer.add(new Mesh(undefined, later));
    expect(offsetOf(later)).toEqual([false, 0, 0]);
    tieBreak(layer, 2);
    expect(offsetOf(later)).toEqual([true, -2 * TIE_SLOPE, -2 * TIE_UNITS]);
  });

  it('moves every material of an object that has a list of them, and an object that has none is left alone', () => {
    const a = new MeshBasicMaterial();
    const b = new MeshBasicMaterial();
    const layer = new Group().add(new Mesh(undefined, [a, b]), new Group());
    tieBreak(layer, 1);
    expect(offsetOf(a)).toEqual([true, -TIE_SLOPE, -TIE_UNITS]);
    expect(offsetOf(b)).toEqual([true, -TIE_SLOPE, -TIE_UNITS]);
  });

  it('gives a marker or a line, which write their own depth, its rank in its own uniform, and leaves its polygon offset alone', () => {
    const material = new ShaderMaterial({ uniforms: { uTieBreak: { value: 0 } } });
    const layer = new Group().add(new Points(undefined, material));
    tieBreak(layer, 4);
    expect(material.uniforms['uTieBreak']?.value).toBe(4);
    expect(material.polygonOffset).toBe(false);
    tieBreak(layer, 0);
    expect(material.uniforms['uTieBreak']?.value).toBe(0);
  });

  it('has a step as a depth that is the step in the depth buffer: its units out of 2 to the 24', () => {
    expect(TIE_DEPTH).toBe(TIE_UNITS * 2 ** -24);
    // A few millionths of the depth range: far less than anything seen, and more than a few steps of rounding.
    expect(TIE_DEPTH).toBeGreaterThan(1e-6);
    expect(TIE_DEPTH).toBeLessThan(1e-5);
  });
});
