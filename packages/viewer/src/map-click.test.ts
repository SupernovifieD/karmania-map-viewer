import { describe, expect, it } from 'vitest';
import { CLICK_SLOP, createClickDetector } from './map-click.js';
import type { PointerPress } from './map-click.js';

const press = (over: Partial<PointerPress> = {}): PointerPress => ({
  pointerId: 1,
  isPrimary: true,
  button: 0,
  clientX: 100,
  clientY: 200,
  ...over,
});

describe('a click on the map', () => {
  it('is a press and a release in one place of the primary button on the map, and says where', () => {
    const detector = createClickDetector();
    detector.down(press(), true);
    expect(detector.up(press())).toEqual({ x: 100, y: 200 });
  });

  it('is where the pointer is let go, when that is a little way from where it came down', () => {
    const detector = createClickDetector();
    detector.down(press(), true);
    expect(detector.up(press({ clientX: 102, clientY: 203 }))).toEqual({ x: 102, y: 203 });
  });

  it('is not one when the pointer has moved more than the slop: that is a drag', () => {
    const detector = createClickDetector();
    detector.down(press(), true);
    expect(detector.up(press({ clientX: 100 + CLICK_SLOP, clientY: 200 }))).toBeDefined();
    detector.down(press(), true);
    expect(detector.up(press({ clientX: 100 + CLICK_SLOP + 0.5, clientY: 200 }))).toBeUndefined();
    detector.down(press(), true);
    expect(detector.up(press({ clientX: 103, clientY: 203 }))).toBeUndefined();
  });

  it('is not one of any button but the primary one of the first pointer', () => {
    const detector = createClickDetector();
    for (const other of [{ button: 1 }, { button: 2 }, { isPrimary: false }]) {
      detector.down(press(other), true);
      expect(detector.up(press(other))).toBeUndefined();
    }
  });

  it('is not one on what is laid over the map', () => {
    const detector = createClickDetector();
    detector.down(press(), false);
    expect(detector.up(press())).toBeUndefined();
  });

  it('is not one when another pointer lets go (a pinch), or the press was taken away, or there was no press', () => {
    const detector = createClickDetector();
    detector.down(press({ pointerId: 1 }), true);
    expect(detector.up(press({ pointerId: 2 }))).toBeUndefined();
    detector.down(press(), true);
    detector.cancel();
    expect(detector.up(press())).toBeUndefined();
    expect(detector.up(press())).toBeUndefined();
  });

  it('is one press, one click: the release is spent, and a press on the map after one that was not is a click', () => {
    const detector = createClickDetector();
    detector.down(press(), true);
    expect(detector.up(press())).toBeDefined();
    expect(detector.up(press())).toBeUndefined();
    detector.down(press(), false);
    detector.down(press(), true);
    expect(detector.up(press())).toBeDefined();
  });
});
