import { describe, expect, it } from 'vitest';
import {
  MAX_PICK_ELEMENT,
  MAX_PICK_LAYERS,
  PICK_FRAGMENT_GLSL,
  decodePick,
  encodePick,
} from './pick.js';

describe('the four bytes of a pixel of the picking target', () => {
  it('say the layer and the element that were written, from 0 each', () => {
    expect(encodePick(0, 0)).toEqual([1, 0, 0, 1]);
    expect(encodePick(2, 255)).toEqual([0, 1, 0, 3]);
    expect(encodePick(0, 1_204)).toEqual([0xb5, 4, 0, 1]);
    expect(decodePick([0xb5, 4, 0, 1])).toEqual({ rank: 0, element: 1_204 });
    expect(decodePick([1, 0, 0, 1])).toEqual({ rank: 0, element: 0 });
  });

  it('are nothing where nothing was drawn, whatever the other bytes say', () => {
    expect(decodePick([0, 0, 0, 0])).toBeUndefined();
    expect(decodePick([9, 9, 9, 0])).toBeUndefined();
    expect(decodePick([])).toBeUndefined();
  });

  it('give back what was written for every layer and for the numbers at the edges of each byte', () => {
    const elements = [0, 1, 254, 255, 256, 65_534, 65_535, 65_536, 1_000_000, MAX_PICK_ELEMENT];
    for (const rank of [0, 1, 127, MAX_PICK_LAYERS - 1]) {
      for (const element of elements) {
        const bytes = encodePick(rank, element);
        expect(bytes, `${String(rank)}, ${String(element)}`).toBeDefined();
        expect(decodePick(bytes ?? [])).toEqual({ rank, element });
        // No byte is more than a byte, and the alpha is never 0 (which is nothing).
        expect(bytes?.every((b) => b >= 0 && b <= 255)).toBe(true);
        expect(bytes?.[3]).toBeGreaterThan(0);
      }
    }
  });

  it('are not made for a layer or an element that does not fit, or is not a whole number', () => {
    expect(encodePick(MAX_PICK_LAYERS, 0)).toBeUndefined();
    expect(encodePick(-1, 0)).toBeUndefined();
    expect(encodePick(0, MAX_PICK_ELEMENT + 1)).toBeUndefined();
    expect(encodePick(0, -1)).toBeUndefined();
    expect(encodePick(0.5, 0)).toBeUndefined();
    expect(encodePick(0, Number.NaN)).toBeUndefined();
  });
});

describe('the shader that writes an element', () => {
  it('writes none that three bytes cannot say, instead of another that they can: the limit in the shader is the limit of the encoding', () => {
    // The shader's number is the element plus one: it has to be no more than the largest element plus one, and an element beyond is discarded.
    expect(PICK_FRAGMENT_GLSL).toContain(`if (n > ${String(MAX_PICK_ELEMENT + 1)}.0) {`);
    expect(PICK_FRAGMENT_GLSL).toMatch(/if \(n > \d+\.0\) \{\s*discard;\s*\}/);
    // The largest element is written as it is said (blue 255 and one less than full in the others: 0xfffffe + 1 = 0xffffff), and the next is not an element.
    expect(encodePick(0, MAX_PICK_ELEMENT)).toEqual([255, 255, 255, 1]);
    expect(encodePick(0, MAX_PICK_ELEMENT + 1)).toBeUndefined();
  });
});
