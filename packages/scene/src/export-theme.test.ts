/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPORT_COLOURS, EXPORT_FURNITURE, EXPORT_TYPE, LEGEND_ROW } from './export-theme.js';
import { MAP_BACKGROUNDS } from './palettes.js';

const tokens = readFileSync(new URL('../../ui/src/tokens.css', import.meta.url), 'utf8');

/** The light theme's value of a custom property: the first of its declarations in the stylesheet, which is the one in `:root`. */
function light(name: string): string | undefined {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(tokens)?.[1]?.toLowerCase();
}

/** A size of the type scale in pixels. */
function px(name: string): number | undefined {
  const found = new RegExp(`${name}:\\s*(\\d+)px`).exec(tokens)?.[1];
  return found === undefined ? undefined : Number(found);
}

describe('the colours of the exported picture', () => {
  it('are the light colours of the stylesheet, so that they cannot drift from it', () => {
    expect(EXPORT_COLOURS).toEqual({
      surface: light('--k-surface'),
      map: light('--k-surface-map'),
      raised: light('--k-surface-raised'),
      text: light('--k-text'),
      muted: light('--k-text-muted'),
      border: light('--k-border-strong'),
      divider: light('--k-border'),
      accent: light('--k-accent'),
    });
  });

  it('have the same map as the backgrounds of the map', () => {
    expect(EXPORT_COLOURS.map).toBe(MAP_BACKGROUNDS.light);
  });
});

describe('the type of the exported picture', () => {
  it('is the sizes and lines of the stylesheet’s type scale', () => {
    expect(EXPORT_TYPE.name).toEqual({
      size: px('--k-font-size-body'),
      line: px('--k-line-height-body'),
    });
    expect(EXPORT_TYPE.class).toEqual({
      size: px('--k-font-size-secondary'),
      line: px('--k-line-height-secondary'),
    });
    expect(EXPORT_TYPE.caption).toEqual({
      size: px('--k-font-size-caption'),
      line: px('--k-line-height-caption'),
    });
  });

  it('puts Inter first, as the stylesheet does', () => {
    expect(EXPORT_TYPE.family.startsWith('Inter,')).toBe(true);
    expect(tokens).toMatch(/--k-font-sans:\s*'Inter',/);
  });
});

describe('the furniture of the exported picture', () => {
  it('has the border width and the corner radius of the stylesheet', () => {
    expect(EXPORT_FURNITURE).toEqual({
      border: px('--k-border-width'),
      radius: px('--k-radius-lg'),
    });
  });
});

describe('the rows of the exported legend', () => {
  it('fit their swatches and their text: a row is at least as high as the line of its text, and a ramp is wider than it is high', () => {
    expect(LEGEND_ROW.layer).toBeGreaterThanOrEqual(EXPORT_TYPE.name.line);
    expect(LEGEND_ROW.group).toBeGreaterThanOrEqual(EXPORT_TYPE.name.line);
    expect(LEGEND_ROW.class).toBeGreaterThanOrEqual(EXPORT_TYPE.class.line);
    expect(LEGEND_ROW.swatch).toBeLessThanOrEqual(LEGEND_ROW.layer);
    expect(LEGEND_ROW.classSwatch).toBeLessThanOrEqual(LEGEND_ROW.class);
    expect(LEGEND_ROW.rampWidth).toBeGreaterThan(LEGEND_ROW.rampHeight);
  });

  it('are on the 4 pixel grid, as every length of the interface is', () => {
    for (const value of [
      LEGEND_ROW.layer,
      LEGEND_ROW.group,
      LEGEND_ROW.class,
      LEGEND_ROW.swatch,
      LEGEND_ROW.rampWidth,
      LEGEND_ROW.rampHeight,
      LEGEND_ROW.classSwatch,
      LEGEND_ROW.indent,
      LEGEND_ROW.gap,
      LEGEND_ROW.countGap,
    ]) {
      expect(value % 4, String(value)).toBe(0);
    }
  });
});
