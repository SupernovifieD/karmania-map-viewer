import { afterEach, describe, expect, it, vi } from 'vitest';
import { forceThemeFromAddress } from './theme.js';

/** A page at an address with a search part, whose root element keeps its data attributes in the object returned. */
function pageAt(search: string): Record<string, string> {
  const dataset: Record<string, string> = {};
  vi.stubGlobal('location', { search });
  vi.stubGlobal('document', { documentElement: { dataset } });
  return dataset;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('forceThemeFromAddress', () => {
  it('sets the theme that the address asks for', () => {
    const light = pageAt('?theme=light');
    forceThemeFromAddress();
    expect(light).toEqual({ theme: 'light' });
    const dark = pageAt('?theme=dark');
    forceThemeFromAddress();
    expect(dark).toEqual({ theme: 'dark' });
  });

  it('finds the theme among other parts of the address', () => {
    const dataset = pageAt('?size=large&theme=dark&x=1');
    forceThemeFromAddress();
    expect(dataset).toEqual({ theme: 'dark' });
  });

  it('leaves the system preference in charge for any other value, or none', () => {
    for (const search of ['', '?theme=', '?theme=blue', '?theme=Light', '?theme', '?themes=dark']) {
      const dataset = pageAt(search);
      forceThemeFromAddress();
      // Strictly: a property that was set to `undefined` is not "left alone" (it would read `data-theme="undefined"`).
      expect(dataset, search).toStrictEqual({});
    }
  });
});
