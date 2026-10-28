import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconShapes, isIconName } from './icons.js';

describe('the icons', () => {
  it('are listed once each, in order', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    expect([...ICON_NAMES]).toEqual([...ICON_NAMES].sort());
  });

  it('each have a drawing made of shapes, without the svg element around it', () => {
    for (const name of ICON_NAMES) {
      const shapes = iconShapes(name);
      expect(shapes, name).toMatch(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/);
      expect(shapes, name).not.toMatch(/<svg|<\/svg|<script|<!--|\bon[a-z]+=/i);
    }
  });

  it('are recognised by name, and nothing else is', () => {
    expect(isIconName('upload')).toBe(true);
    expect(isIconName('Upload')).toBe(false);
    expect(isIconName('')).toBe(false);
    expect(isIconName('constructor')).toBe(false);
  });
});
