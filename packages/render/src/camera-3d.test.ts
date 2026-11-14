import type { BBox } from '@karmania/engine/types';
import type { Camera3d } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { perspectiveFrame } from './camera-3d.js';

const camera = (patch: Partial<Camera3d> = {}): Camera3d => ({
  target: [1000, 2000, 100],
  distance: 500,
  heading: 0,
  elevation: 0,
  fov: 45,
  ...patch,
});
const extent: BBox = { min: [900, 1900, 50], max: [1100, 2100, 150] };
const size = { width: 800, height: 400 };

describe('perspectiveFrame', () => {
  it('puts the target relative to the origin and the camera opposite the heading', () => {
    const north = perspectiveFrame(camera(), [900, 1500, 50], size, extent);
    expect(north.target).toEqual([100, 500, 50]);
    expect(north.position).toEqual([100, 0, 50]);
    const east = perspectiveFrame(camera({ heading: 90 }), [900, 1500, 50], size, extent);
    expect(east.position[0]).toBeCloseTo(-400, 12);
    expect(east.position[1]).toBeCloseTo(500, 12);
  });

  it('raises a positive elevation and never changes the z-up vector', () => {
    const frame = perspectiveFrame(camera({ elevation: 30 }), [900, 1500, 50], size, extent);
    expect(frame.position[1]).toBeCloseTo(500 - 500 * Math.cos(Math.PI / 6), 12);
    expect(frame.position[2]).toBeCloseTo(50 + 250, 12);
    expect(frame.up).toEqual([0, 0, 1]);
  });

  it('uses the viewport aspect and is never degenerate before layout', () => {
    expect(perspectiveFrame(camera(), [0, 0, 0], size, extent).aspect).toBe(2);
    expect(perspectiveFrame(camera(), [0, 0, 0], { width: 0, height: 0 }, extent).aspect).toBe(1);
  });

  it('applies vertical exaggeration about the origin to the target and the clipping extent', () => {
    const plain = perspectiveFrame(camera({ elevation: 45 }), [900, 1500, 50], size, extent);
    const tall = perspectiveFrame(camera({ elevation: 45 }), [900, 1500, 50], size, extent, 5);
    expect(plain.target[2]).toBe(50);
    expect(tall.target[2]).toBe(250);
    expect(tall.far - tall.near).toBeGreaterThan(plain.far - plain.near);
  });

  it('puts every corner of a fitted extent between near and far, with room on both sides', () => {
    const view = camera({ distance: 1000, heading: 25, elevation: 35 });
    const frame = perspectiveFrame(view, [900, 1500, 50], size, extent, 3);
    const forward = frame.target.map(
      (value, axis) => (value - (frame.position[axis] ?? 0)) / view.distance,
    );
    for (const x of [extent.min[0], extent.max[0]]) {
      for (const y of [extent.min[1], extent.max[1]]) {
        for (const z of [extent.min[2], extent.max[2]]) {
          const point = [x - 900, y - 1500, (z - 50) * 3];
          const depth = point.reduce(
            (sum, value, axis) =>
              sum + (value - (frame.position[axis] ?? 0)) * (forward[axis] ?? 0),
            0,
          );
          expect(depth).toBeGreaterThan(frame.near);
          expect(depth).toBeLessThan(frame.far);
        }
      }
    }
  });

  it('has usable clipping planes for a point and no known extent', () => {
    const frame = perspectiveFrame(camera(), [1000, 2000, 100], size, null);
    expect(frame.near).toBeGreaterThan(0);
    expect(frame.far).toBeGreaterThan(frame.near);
    expect(frame.near).toBeLessThan(camera().distance);
    expect(frame.far).toBeGreaterThan(camera().distance);
  });
});
