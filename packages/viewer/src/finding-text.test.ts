import type { Finding } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import { said, withoutNotDrawn } from './finding-text.js';

const finding = (message: string, hint?: string): Finding =>
  ({
    code: 'x',
    severity: 'warning',
    message,
    ...(hint === undefined ? {} : { hint }),
    count: 1,
    examples: [],
  }) as unknown as Finding;

describe('what a finding says', () => {
  it('is its message and its hint', () => {
    expect(said(finding('It is a grid.', 'Change the system.'), 'otherwise')).toBe(
      'It is a grid. Change the system.',
    );
  });

  it('is its message alone when it has no hint, or an empty one', () => {
    expect(said(finding('It is a grid.'), 'otherwise')).toBe('It is a grid.');
    expect(said(finding('It is a grid.', ''), 'otherwise')).toBe('It is a grid.');
  });

  it('is what is given when there is no finding', () => {
    expect(said(undefined, 'otherwise')).toBe('otherwise');
  });
});

describe('a reason without the engine’s opening', () => {
  it('has "Not drawn: " taken off the front, and only there', () => {
    expect(withoutNotDrawn('Not drawn: A local grid has no place.')).toBe(
      'A local grid has no place.',
    );
    expect(withoutNotDrawn('Not drawn:   spaced')).toBe('spaced');
    expect(withoutNotDrawn('It is Not drawn: here.')).toBe('It is Not drawn: here.');
    expect(withoutNotDrawn('Plain.')).toBe('Plain.');
  });
});
