/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The viewer has to run on a page under a strict Content Security Policy, one that has no `'unsafe-inline'` for styles (step 23.3). Such a policy refuses a `style`
 * attribute that is written as text, whether the page has it in its HTML, a template gives it (`style="..."`, `style=${text}`), or a script sets it
 * (`setAttribute('style', ...)`), and allows the style of an element to be set through its CSSOM (`element.style.left = ...`, `setProperty`). Lit's `styleMap` writes
 * its first render as text, so it is no better: `setStyle` of `@karmania/ui` is what a template uses. The page of `embed-csp.e2e.ts` shows what the browser does with the
 * built viewer; this scans the sources, so that a line that would be refused cannot be added in a part of the interface that the page does not open.
 */

/** The lines of `source` that write a style as text (the line numbers, from 1, with the line). */
function textStyleWrites(source: string): string[] {
  const found: string[] = [];
  source.split('\n').forEach((line, index) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) {
      return;
    }
    const bad =
      // style="...", style='...', and style=${...} that is not setStyle(...).
      /\bstyle=["']/.test(line) ||
      /\bstyle=\$\{(?!\s*setStyle\()/.test(line) ||
      /setAttribute\(\s*['"]style['"]/i.test(line) ||
      /<style[\s>]/.test(line) ||
      /\bstyleMap\b/.test(line);
    if (bad) {
      found.push(`${String(index + 1)}: ${code}`);
    }
  });
  return found;
}

const packages = fileURLToPath(new URL('../../', import.meta.url));

/** The sources of the packages that are shipped, without their tests, as paths from `packages/`. */
function sources(folder = ''): string[] {
  return readdirSync(join(packages, folder)).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === 'e2e' || name === 'test-results') {
      return [];
    }
    const path = join(folder, name);
    if (statSync(join(packages, path)).isDirectory()) {
      return sources(path);
    }
    return /\/src\/.*\.ts$/.test(`/${path}`) && !/\.(test|e2e|visual|perf|axe)\.ts$/.test(path)
      ? [path]
      : [];
  });
}

describe('a style written as text', () => {
  it('is found in a template, in a script and in a style element, and not in what sets the style through the element', () => {
    const bad = [
      '<div style="width: 1px"></div>',
      "<div style='width: 1px'></div>",
      '<div style=${`width: ${width}px`}></div>',
      '<div style=${style}></div>',
      "element.setAttribute('style', 'width: 1px');",
      'return html`<style>.a { color: red }</style>`;',
      '<div style=${styleMap({ width })}></div>',
    ];
    for (const line of bad) {
      expect(textStyleWrites(line), line).toHaveLength(1);
    }
    const good = [
      '<div style=${setStyle({ width: `${String(width)}px` })}></div>',
      '<div style=${ setStyle(entry.colour === null ? {} : { background }) }></div>',
      'element.style.left = `${String(x)}px`;',
      "element.style.setProperty('--columns', '3');",
      'probe.style.cssText = `position: absolute`;',
      '// style="width: 1px" is what a strict policy refuses',
      ' * A `style=${text}` is refused.',
    ];
    for (const line of good) {
      expect(textStyleWrites(line), line).toEqual([]);
    }
  });

  it('is nowhere in the sources of the packages', () => {
    const files = sources();
    // It looks at the sources of the five packages (a scan that finds none would find no fault).
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((path) => path.endsWith('viewer/src/legend-tab.ts'))).toBe(true);
    expect(files.some((path) => path.endsWith('ui/src/components/table.ts'))).toBe(true);
    const faults = files.flatMap((path) =>
      textStyleWrites(readFileSync(join(packages, path), 'utf8')).map((line) => `${path}:${line}`),
    );
    expect(faults).toEqual([]);
  });
});
