import { describe, expect, it } from 'vitest';
import { parseCssColour } from './css-colour.js';

describe('parseCssColour', () => {
  it('reads rgb() and rgba(), with commas and with spaces and a slash', () => {
    expect(parseCssColour('rgb(233, 236, 240)')).toEqual({ r: 233, g: 236, b: 240, a: 1 });
    expect(parseCssColour('rgba(14, 16, 19, 0.5)')).toEqual({ r: 14, g: 16, b: 19, a: 0.5 });
    expect(parseCssColour('rgb(14 16 19)')).toEqual({ r: 14, g: 16, b: 19, a: 1 });
    expect(parseCssColour('rgb(14 16 19 / 0.25)')).toEqual({ r: 14, g: 16, b: 19, a: 0.25 });
    expect(parseCssColour('rgb(14 16 19 / 50%)')).toEqual({ r: 14, g: 16, b: 19, a: 0.5 });
    expect(parseCssColour('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('reads color(srgb ...), which is what a mix comes out as, in 0 to 1 and not 0 to 255', () => {
    const colour = parseCssColour('color(srgb 0.5 0.25 1)');
    expect(colour).toEqual({ r: 127.5, g: 63.75, b: 255, a: 1 });
    expect(parseCssColour('color(srgb 1 0 0 / 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it('ignores the case and the space round it', () => {
    expect(parseCssColour('  RGB(1, 2, 3)  ')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColour('COLOR(SRGB 0 0 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('keeps a channel in range and an alpha from 0 to 1', () => {
    expect(parseCssColour('rgb(300, 256, 0)')).toEqual({ r: 255, g: 255, b: 0, a: 1 });
    expect(parseCssColour('rgba(1, 2, 3, 7)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColour('color(srgb 2 0 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('says undefined for anything that is not a computed colour: a name, a hex colour, nothing, rubbish', () => {
    for (const text of [
      '',
      'red',
      '#e9ecf0',
      'transparent',
      'rgb(1, 2)',
      'rgb(a, b, c)',
      'hsl(0 0% 0%)',
      'rgb(1 2 3',
      'color(display-p3 1 0 0)',
      'rgba(1, 2, 3, 0.5, 4)',
    ]) {
      expect(parseCssColour(text), JSON.stringify(text)).toBeUndefined();
    }
  });
});
