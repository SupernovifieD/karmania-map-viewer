import { describe, expect, it } from 'vitest';
import { rampGradient, safeColour } from './legend-swatch.js';

describe('safeColour', () => {
  it('keeps a colour of six hex digits, in lower case', () => {
    expect(safeColour('#0072b2')).toBe('#0072b2');
    expect(safeColour('#E69F00')).toBe('#e69f00');
  });

  it('makes anything else no colour, so that a document cannot put its own text into a style', () => {
    for (const text of [
      '',
      '#fff',
      '#12345g',
      '#1234567',
      'red',
      'url(x)',
      '#aabbcc; background: red',
    ]) {
      expect(safeColour(text), text).toBe('transparent');
    }
  });
});

describe('rampGradient', () => {
  it('is stripes of one width with hard edges, left to right', () => {
    expect(rampGradient(['#000000', '#ffffff'])).toBe(
      'linear-gradient(to right, #000000 0% 50%, #ffffff 50% 100%)',
    );
  });

  it('is one stripe of the whole width for one colour', () => {
    expect(rampGradient(['#0072b2'])).toBe('linear-gradient(to right, #0072b2 0% 100%)');
  });

  it('writes the edges of seven classes with four decimals at most, the last at exactly 100', () => {
    const gradient = rampGradient([
      '#000001',
      '#000002',
      '#000003',
      '#000004',
      '#000005',
      '#000006',
      '#000007',
    ]);
    expect(gradient).toBe(
      'linear-gradient(to right, #000001 0% 14.2857%, #000002 14.2857% 28.5714%, #000003 28.5714% 42.8571%, #000004 42.8571% 57.1429%, #000005 57.1429% 71.4286%, #000006 71.4286% 85.7143%, #000007 85.7143% 100%)',
    );
  });

  it('is no colour for no classes, and no colour for a stripe that is not a colour', () => {
    expect(rampGradient([])).toBe('transparent');
    expect(rampGradient(['#000000', 'red'])).toBe(
      'linear-gradient(to right, #000000 0% 50%, transparent 50% 100%)',
    );
  });
});
