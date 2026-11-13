import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHT_FROM_ABOVE, WORLD_LIGHT, frameLight, inViewSpace } from './light.js';

const length = (direction: readonly number[]): number => Math.hypot(...direction);

/** A camera looking from `from` at `at`, up being +z, with its view matrix made (as the renderer makes it). */
function cameraFrom(
  from: readonly [number, number, number],
  at: readonly [number, number, number],
) {
  const camera = new PerspectiveCamera(45, 1.5, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(...from);
  camera.lookAt(...at);
  camera.updateMatrixWorld();
  return camera;
}

describe('the light', () => {
  it('is, in the view from above, exactly straight up, whatever the camera is', () => {
    expect(LIGHT_FROM_ABOVE).toEqual([0, 0, 1]);
    const strange = cameraFrom([10, -20, 30], [1, 2, 3]);
    expect(frameLight(true, strange.matrixWorldInverse.elements)).toBe(LIGHT_FROM_ABOVE);
  });

  it('is, in 3D, from the north-west and 45 degrees above the horizon: a direction of length 1', () => {
    const [x, y, z] = WORLD_LIGHT;
    expect(length(WORLD_LIGHT)).toBeCloseTo(1, 15);
    // West is -x and north is +y, in equal parts, and the rise is as much as the run along the ground.
    expect([x, y]).toEqual([-0.5, 0.5]);
    expect(z).toBeCloseTo(Math.hypot(x, y), 15);
    // Azimuth 315 degrees clockwise from north: sin and cos of it, times the run.
    const azimuth = (315 * Math.PI) / 180;
    expect(x).toBeCloseTo(Math.sin(azimuth) * Math.cos(Math.PI / 4), 15);
    expect(y).toBeCloseTo(Math.cos(azimuth) * Math.cos(Math.PI / 4), 15);
  });

  it('is turned into the space of the camera as three turns a direction (an independent working), and keeps its length', () => {
    for (const [from, at] of [
      [
        [0, -100, 100],
        [0, 0, 0],
      ],
      [
        [80, 30, 20],
        [0, 0, 0],
      ],
      [
        [-50, 70, 5],
        [10, -20, 0],
      ],
      [
        [0, 0.01, 100],
        [0, 0, 0],
      ],
    ] as const) {
      const camera = cameraFrom(from, at);
      const ours = frameLight(false, camera.matrixWorldInverse.elements);
      const theirs = new Vector3(...WORLD_LIGHT).transformDirection(camera.matrixWorldInverse);
      expect(ours[0]).toBeCloseTo(theirs.x, 12);
      expect(ours[1]).toBeCloseTo(theirs.y, 12);
      expect(ours[2]).toBeCloseTo(theirs.z, 12);
      expect(length(ours)).toBeCloseTo(1, 12);
    }
  });

  it('does not depend on where the camera is, only on which way it looks', () => {
    const here = cameraFrom([0, -100, 100], [0, 0, 0]);
    const there = cameraFrom([5000, 3000 - 100, 100], [5000, 3000, 0]);
    const a = frameLight(false, here.matrixWorldInverse.elements);
    const b = frameLight(false, there.matrixWorldInverse.elements);
    expect(b[0]).toBeCloseTo(a[0], 12);
    expect(b[1]).toBeCloseTo(a[1], 12);
    expect(b[2]).toBeCloseTo(a[2], 12);
  });

  it('is the light of the world itself for a camera that looks straight down with north up the screen: its space is the world', () => {
    const above = cameraFrom([0, -0.001, 1000], [0, 0, 0]);
    const [x, y, z] = frameLight(false, above.matrixWorldInverse.elements);
    expect(x).toBeCloseTo(WORLD_LIGHT[0], 5);
    expect(y).toBeCloseTo(WORLD_LIGHT[1], 5);
    expect(z).toBeCloseTo(WORLD_LIGHT[2], 5);
  });

  it('turns a direction with a matrix of columns, the translation of it left out', () => {
    // Two turns of 90 degrees about z, and a move that must not count: the x axis goes to y.
    const view = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 100, 200, 300, 1];
    expect(inViewSpace(view, [1, 0, 0])).toEqual([0, 1, 0]);
    expect(inViewSpace(view, [0, 1, 0])).toEqual([-1, 0, 0]);
    expect(inViewSpace(view, [0, 0, 1])).toEqual([0, 0, 1]);
  });
});
