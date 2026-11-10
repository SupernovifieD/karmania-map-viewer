import type { Camera3d } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { orbit3dBy, pan3dBy } from './controls-3d.js';

const SIZE = { width: 800, height: 400 };
const camera = (patch: Partial<Camera3d> = {}): Camera3d => ({
  target: [100, 200, 300],
  distance: 200,
  heading: 0,
  elevation: 0,
  fov: 90,
  ...patch,
});

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
