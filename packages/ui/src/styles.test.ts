/// <reference types="node" />
/**
 * No magic numbers in the UI: the CSS of a component and the shared style sheets use tokens
 * for every color, length and duration, and so does the CSS of the app that is built from them.
 * This reads each source file's styles and fails on a raw color, or a length or duration with a
 * unit, outside `var(...)`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Where the styles are: the components, and the app that uses them. */
const roots = [new URL('.', import.meta.url), new URL('../../app/src/', import.meta.url)];

/** Every source file that has styles, with those styles. */
function styles(): [string, string][] {
  const found: [string, string][] = [];
  const visit = (directory: URL): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) {
        visit(url);
      } else if (entry.name.endsWith('.css') && entry.name !== 'tokens.css') {
        found.push([entry.name, readFileSync(url, 'utf8')]);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const source = readFileSync(url, 'utf8');
        for (const match of source.matchAll(/css`([\s\S]*?)`/g)) {
          found.push([entry.name, match[1] ?? '']);
        }
      }
    }
  };
  roots.forEach(visit);
  return found;
}

/** The CSS with comments, and everything inside `var(...)`, taken out. */
function bare(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var\([^)]*\)/g, 'var()');
}

describe('the styles of the UI', () => {
  const all = styles();

  it('are found', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('use no raw colors', () => {
    for (const [file, css] of all) {
      expect(bare(css), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch)\(/);
    }
  });

  it('use no raw lengths or durations, other than zero', () => {
    for (const [file, css] of all) {
      const raw = bare(css).match(/(?<![\w.-])(?!0(?:px|ms|s)?\b)\d*\.?\d+(px|ms|s|rem|em)\b/g);
      expect(raw, file).toBeNull();
    }
  });
});
