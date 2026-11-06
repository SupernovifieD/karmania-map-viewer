/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_BACKGROUNDS, MIN_GRAPHIC_CONTRAST, contrastOnMaps } from './palettes.js';
import { rampById } from './ramps.js';

const tokens = readFileSync(new URL('../../ui/src/tokens.css', import.meta.url), 'utf8');

function palette(id: string): readonly string[] {
  return rampById(id)?.colours ?? [];
}

/** The colours of a palette that have less than 3 to 1 on the light map, and on the dark map. */
function weak(id: string): { light: string[]; dark: string[] } {
  const colours = palette(id);
  const under = (theme: 'light' | 'dark'): string[] =>
    colours.filter((c) => contrastOnMaps(c)[theme] < MIN_GRAPHIC_CONTRAST);
  return { light: under('light'), dark: under('dark') };
}

describe('the backgrounds of the map', () => {
  it('are the --k-surface-map of the stylesheet: light first, then dark twice (by the system and by the setting)', () => {
    const found = [...tokens.matchAll(/--k-surface-map:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) =>
      m[1]?.toLowerCase(),
    );
    expect(found).toEqual([MAP_BACKGROUNDS.light, MAP_BACKGROUNDS.dark, MAP_BACKGROUNDS.dark]);
  });
});

describe('contrastOnMaps', () => {
  it('gives the contrast with each map, as an independent calculation does (to two decimals)', () => {
    // From a separate Python implementation of the WCAG formula, not from this code.
    const expected: [string, number, number][] = [
      ['#000000', 17.72, 1.1],
      ['#e69f00', 1.9, 8.46],
      ['#56b4e9', 1.95, 8.26],
      ['#009e73', 2.89, 5.57],
      ['#f0e442', 1.12, 14.41],
      ['#0072b2', 4.38, 3.67],
      ['#d55e00', 3.26, 4.93],
      ['#cc79a7', 2.58, 6.22],
    ];
    for (const [colour, light, dark] of expected) {
      const found = contrastOnMaps(colour);
      expect([colour, Number(found.light.toFixed(2)), Number(found.dark.toFixed(2))]).toEqual([
        colour,
        light,
        dark,
      ]);
    }
  });

  it('is a mistake to give it a colour that is not #rrggbb', () => {
    expect(() => contrastOnMaps('red')).toThrow(TypeError);
  });
});

describe('the categorical palettes against both maps (step 14.4c; the record is in docs/decisions.md)', () => {
  it('Okabe-Ito: black is lost on the dark map, and five of its colours are under 3 to 1 on the light map', () => {
    expect(palette('okabe-ito')).toHaveLength(8);
    expect(weak('okabe-ito')).toEqual({
      light: ['#e69f00', '#56b4e9', '#009e73', '#cc79a7', '#f0e442'],
      dark: ['#000000'],
    });
  });

  it('Paired: eight of its twelve colours are under 3 to 1 on the light map, and one on the dark map', () => {
    expect(palette('paired')).toHaveLength(12);
    const found = weak('paired');
    expect([found.light.length, found.dark]).toEqual([8, ['#6a3d9a']]);
  });

  it('Okabe-Ito has no colour that is lost on both maps, so an outline of one kind is always enough', () => {
    const both = palette('okabe-ito').filter((c) => {
      const { light, dark } = contrastOnMaps(c);
      return light < MIN_GRAPHIC_CONTRAST && dark < MIN_GRAPHIC_CONTRAST;
    });
    expect(both).toEqual([]);
  });

  it('the black and the white that an outline can be have a contrast of 3 to 1 or more with the map they are on', () => {
    expect(contrastOnMaps('#000000').light).toBeGreaterThan(MIN_GRAPHIC_CONTRAST);
    expect(contrastOnMaps('#ffffff').dark).toBeGreaterThan(MIN_GRAPHIC_CONTRAST);
  });
});
