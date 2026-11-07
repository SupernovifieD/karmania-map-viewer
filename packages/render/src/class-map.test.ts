import { describe, expect, it } from 'vitest';
import { classesOfPieces, coversOwners } from './class-map.js';
import { NO_VALUE } from './look.js';

describe('classesOfPieces', () => {
  it('gives each piece the class of the element it belongs to', () => {
    const classes = Uint8Array.of(7, 8, 9);
    const owners = Uint32Array.of(0, 0, 2, 1, 2);
    expect([...classesOfPieces(classes, owners, 0, 5)]).toEqual([7, 7, 9, 8, 9]);
  });

  it('takes the pieces from where it is told to, for the part of a layer that is built', () => {
    const classes = Uint8Array.of(7, 8, 9);
    const owners = Uint32Array.of(0, 0, 2, 1, 2);
    expect([...classesOfPieces(classes, owners, 2, 2)]).toEqual([9, 8]);
    expect([...classesOfPieces(classes, owners, 4, 1)]).toEqual([9]);
  });

  it('has no value for a piece of an element that the classes do not reach, and for a piece that is not there', () => {
    const classes = Uint8Array.of(7, 8);
    expect([...classesOfPieces(classes, Uint32Array.of(0, 5, 1), 0, 3)]).toEqual([7, NO_VALUE, 8]);
    // Asked for more pieces than there are: the missing ones have no value.
    expect([...classesOfPieces(classes, Uint32Array.of(1), 0, 3)]).toEqual([8, NO_VALUE, NO_VALUE]);
  });

  it('keeps the class 255 that the classes themselves have for an element with no value', () => {
    expect([...classesOfPieces(Uint8Array.of(NO_VALUE, 1), Uint32Array.of(0, 1), 0, 2)]).toEqual([
      NO_VALUE,
      1,
    ]);
  });

  it('is empty for no pieces, and for a count below none', () => {
    expect(classesOfPieces(Uint8Array.of(1), Uint32Array.of(0), 0, 0)).toHaveLength(0);
    expect(classesOfPieces(Uint8Array.of(1), Uint32Array.of(0), 0, -3)).toHaveLength(0);
  });
});

describe('coversOwners', () => {
  it('is true when there is a class for every element that a piece belongs to, and for elements with no piece', () => {
    expect(coversOwners(Uint8Array.of(1, 2, 3), Uint32Array.of(0, 2, 1))).toBe(true);
    expect(coversOwners(Uint8Array.of(1, 2, 3, 4, 5), Uint32Array.of(0, 2, 1))).toBe(true);
    expect(coversOwners(new Uint8Array(0), new Uint32Array(0))).toBe(true);
  });

  it('is false when a piece belongs to an element that has no class', () => {
    expect(coversOwners(Uint8Array.of(1, 2), Uint32Array.of(0, 2))).toBe(false);
    expect(coversOwners(new Uint8Array(0), Uint32Array.of(0))).toBe(false);
  });
});
