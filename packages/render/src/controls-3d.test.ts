import type { Camera3d } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISTANCE_LIMITS,
  clampDistance,
  orbit3dBy,
  pan3dBy,
  zoom3dAt,
} from './controls-3d.js';
import type { Camera3dChange } from './controls-3d.js';

const SIZE = { width: 800, height: 400 };
const camera = (patch: Partial<Camera3d> = {}): Camera3d => ({
  target: [100, 200, 300],
  distance: 200,
  heading: 0,
  elevation: 0,
  fov: 90,
  ...patch,
});
const apply = (view: Camera3d, change: Camera3dChange | undefined): Camera3d => ({
  ...view,
  ...change,
});

function pointOnTargetPlane(view: Camera3d, x: number, y: number) {
  const heading = (view.heading * Math.PI) / 180;
  const elevation = (view.elevation * Math.PI) / 180;
  const right = [Math.cos(heading), -Math.sin(heading), 0];
  const up = [
    Math.sin(heading) * Math.sin(elevation),
    Math.cos(heading) * Math.sin(elevation),
    Math.cos(elevation),
  ];
  const halfHeight = view.distance * Math.tan((view.fov * Math.PI) / 360);
  const across = ((2 * x) / SIZE.width - 1) * halfHeight * (SIZE.width / SIZE.height);
  const above = (1 - (2 * y) / SIZE.height) * halfHeight;
  return view.target.map(
    (value, axis) => value + (right[axis] ?? 0) * across + (up[axis] ?? 0) * above,
  );
}

describe('orbit3dBy', () => {
  it('turns by half a degree per pixel for this viewport and follows an upward drag', () => {
    expect(orbit3dBy(camera({ heading: 10, elevation: 20 }), SIZE, 40, -30)).toEqual({
      heading: 352,
      elevation: 33.5,
    });
  });

  it('normalises the heading and holds elevation short of either pole', () => {
    expect(orbit3dBy(camera({ heading: 350, elevation: 80 }), SIZE, -40, -100)?.heading).toBe(8);
    expect(orbit3dBy(camera({ elevation: 80 }), SIZE, 0, -100)?.elevation).toBe(89);
    expect(orbit3dBy(camera({ elevation: -80 }), SIZE, 0, 100)?.elevation).toBe(-89);
  });

  it('does nothing for no movement or a viewport or movement that cannot be used', () => {
    expect(orbit3dBy(camera(), SIZE, 0, 0)).toBeUndefined();
    expect(orbit3dBy(camera(), { width: 0, height: 400 }, 1, 1)).toBeUndefined();
    expect(orbit3dBy(camera(), SIZE, NaN, 1)).toBeUndefined();
  });
});

describe('pan3dBy', () => {
  it('moves in the screen plane at the target, with the map following the pointer', () => {
    // At a 90-degree field of view the 400-pixel-high target plane is 400 units high: one unit per pixel.
    const target = pan3dBy(camera(), SIZE, 40, 30)?.target;
    expect(target?.[0]).toBeCloseTo(60, 12);
    expect(target?.[1]).toBeCloseTo(200, 12);
    expect(target?.[2]).toBeCloseTo(330, 12);
  });

  it('uses heading and elevation for the screen axes', () => {
    const change = pan3dBy(camera({ heading: 90, elevation: 30 }), SIZE, 40, 20)?.target;
    expect(change?.[0]).toBeCloseTo(110, 12);
    expect(change?.[1]).toBeCloseTo(240, 12);
    expect(change?.[2]).toBeCloseTo(300 + 20 * Math.cos(Math.PI / 6), 12);
  });

  it('scales with distance, field of view and viewport height', () => {
    const base = pan3dBy(camera(), SIZE, 10, 0)?.target?.[0] ?? 0;
    expect(pan3dBy(camera({ distance: 400 }), SIZE, 10, 0)?.target?.[0]).toBeCloseTo(
      100 + 2 * (base - 100),
      12,
    );
    expect(pan3dBy(camera(), { width: 800, height: 800 }, 10, 0)?.target?.[0]).toBeCloseTo(
      100 + (base - 100) / 2,
      12,
    );
  });

  it('does nothing for no movement or unusable input', () => {
    expect(pan3dBy(camera(), SIZE, 0, 0)).toBeUndefined();
    expect(pan3dBy(camera(), { width: 800, height: NaN }, 1, 1)).toBeUndefined();
  });
});

describe('zoom3dAt', () => {
  it('changes the distance and keeps the target-plane point under the pointer', () => {
    const view = camera({ heading: 35, elevation: 40, fov: 60 });
    const before = pointOnTargetPlane(view, 650, 100);
    const zoomed = apply(view, zoom3dAt(view, SIZE, 0.25, 650, 100, DEFAULT_DISTANCE_LIMITS));
    expect(zoomed.distance).toBe(50);
    const after = pointOnTargetPlane(zoomed, 650, 100);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(after[axis]).toBeCloseTo(before[axis] ?? 0, 10);
    }
  });

  it('keeps the target at the middle and stops at either distance limit', () => {
    expect(zoom3dAt(camera(), SIZE, 0.5, 400, 200, DEFAULT_DISTANCE_LIMITS)).toEqual({
      target: [100, 200, 300],
      distance: 100,
    });
    expect(clampDistance(0.1, { min: 1, max: 10 })).toBe(1);
    expect(clampDistance(100, { min: 1, max: 10 })).toBe(10);
    expect(zoom3dAt(camera({ distance: 1 }), SIZE, 0.5, 0, 0, { min: 1, max: 10 })).toBeUndefined();
    expect(zoom3dAt(camera({ distance: 10 }), SIZE, 2, 0, 0, { min: 1, max: 10 })).toBeUndefined();
  });

  it('does nothing for an unusable factor, pointer or viewport', () => {
    for (const factor of [0, -1, 1, NaN, Infinity]) {
      expect(zoom3dAt(camera(), SIZE, factor, 10, 20, DEFAULT_DISTANCE_LIMITS)).toBeUndefined();
    }
    expect(zoom3dAt(camera(), SIZE, 0.5, NaN, 20, DEFAULT_DISTANCE_LIMITS)).toBeUndefined();
    expect(
      zoom3dAt(camera(), { width: 0, height: 400 }, 0.5, 10, 20, DEFAULT_DISTANCE_LIMITS),
    ).toBeUndefined();
  });
});
