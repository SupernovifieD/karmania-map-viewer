/// <reference types="node" />
/**
 * Checks the base styles as files: the font is self-hosted and licensed, the shared rules
 * are the ones components adopt, and all motion goes through the motion token.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sharedStyles } from './shared-styles.js';

const here = new URL('.', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, here), 'utf8');

describe('the font', () => {
  const fonts = read('fonts.css');
  const files = [...fonts.matchAll(/url\('(\.\/fonts\/[^']+)'\)/g)].map((m) => m[1] ?? '');

  it('is Inter in two files, both in the repository and both small', () => {
    expect(files).toEqual([
      './fonts/inter-latin-ext-wght-normal.woff2',
      './fonts/inter-latin-wght-normal.woff2',
    ]);
    for (const file of files) {
      expect(existsSync(new URL(file, here)), file).toBe(true);
      expect(statSync(new URL(file, here)).size, file).toBeLessThan(150_000);
    }
    expect(fonts.match(/font-family: 'Inter'/g)).toHaveLength(2);
  });

  it('is not fetched from anywhere else', () => {
    for (const name of readdirSync(here).filter((f) => f.endsWith('.css'))) {
      expect(read(name), name).not.toMatch(/url\(\s*['"]?(https?:)?\/\//);
    }
  });

  it('comes with its license, which the Open Font License requires', () => {
    const license = read('fonts/OFL.txt');
    expect(license).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    expect(license).toMatch(/Copyright 2016 The Inter Project Authors/);
  });

  it('is the font the tokens name', () => {
    expect(read('tokens.css')).toMatch(/--k-font-sans: 'Inter',/);
  });
});

describe('the shared rules', () => {
  it('are the text of shared.css, for components to adopt', () => {
    expect(sharedStyles.cssText).toBe(read('shared.css'));
  });

  it('size boxes by their border, show the focus ring, and make controls follow the font', () => {
    const shared = read('shared.css');
    expect(shared).toMatch(/box-sizing: border-box/);
    expect(shared).toMatch(/:focus-visible\s*\{[^}]*var\(--k-focus-width\)[^}]*var\(--k-accent\)/);
    expect(shared).toMatch(/font: inherit/);
  });

  it('are part of the base styles, along with the font', () => {
    const base = read('base.css');
    expect(base).toMatch(/@import '\.\/fonts\.css'/);
    expect(base).toMatch(/@import '\.\/shared\.css'/);
    expect(base).toMatch(/font-variant-numeric: tabular-nums/);
  });
});

describe('motion', () => {
  const sources = readdirSync(here)
    .filter((f) => /\.(css|ts)$/.test(f) && !f.endsWith('.test.ts') && f !== 'tokens.css')
    .map((f) => [f, read(f)] as const);

  it('is always as long as the motion token says, which is nothing for people who ask for less', () => {
    for (const [name, text] of sources) {
      for (const match of text.matchAll(/(transition|animation)[^;{}]*;/g)) {
        const declaration = match[0];
        if (!/^(transition|animation)-(property|timing-function|delay)/.test(declaration)) {
          expect(declaration, `${name}: ${declaration}`).toMatch(/var\(--k-motion-duration\)|none/);
        }
      }
    }
  });
});
