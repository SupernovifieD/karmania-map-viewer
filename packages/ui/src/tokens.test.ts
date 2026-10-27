/// <reference types="node" />
/**
 * Checks the design tokens as written in `tokens.css`: the scales are the ones the brief
 * sets, light and dark have the same colors in the same places, every text and boundary
 * color is readable on every surface, and the documentation lists exactly the tokens there are.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../../../docs/design-tokens.md', import.meta.url), 'utf8');

interface Rule {
  readonly condition: string | undefined;
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, string>;
}

function declarationsOf(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) {
      found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return found;
}

/** Reads the rules of a style sheet, one level of `@media` deep. */
function rulesOf(text: string, condition?: string): Rule[] {
  const rules: Rule[] = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf('{', from);
    if (open === -1) {
      return rules;
    }
    const header = text.slice(from, open).trim();
    let depth = 1;
    let close = open + 1;
    while (depth > 0 && close < text.length) {
      depth += text[close] === '{' ? 1 : text[close] === '}' ? -1 : 0;
      close += 1;
    }
    const body = text.slice(open + 1, close - 1);
    if (header.startsWith('@media')) {
      rules.push(...rulesOf(body, header.slice('@media'.length).trim()));
    } else {
      rules.push({ condition, selector: header, declarations: declarationsOf(body) });
    }
    from = close;
  }
}

const rules = rulesOf(css.replace(/\/\*[\s\S]*?\*\//g, ''));

function ruleFor(selector: string, condition?: string): Rule {
  const found = rules.find((r) => r.selector === selector && r.condition === condition);
  if (found === undefined) {
    throw new Error(`tokens.css has no rule for ${selector}`);
  }
  return found;
}

const root = ruleFor(':root').declarations;
const darkBySystem = ruleFor(
  ":root:not([data-theme='light'])",
  '(prefers-color-scheme: dark)',
).declarations;
const darkForced = ruleFor(":root[data-theme='dark']").declarations;

const COLORS = [
  '--k-surface',
  '--k-surface-raised',
  '--k-surface-map',
  '--k-text',
  '--k-text-muted',
  '--k-border',
  '--k-border-strong',
  '--k-accent',
  '--k-on-accent',
  '--k-danger',
  '--k-warning',
  '--k-info',
] as const;

const light = new Map(COLORS.map((name) => [name, root.get(name) ?? '']));
const dark = new Map(COLORS.map((name) => [name, darkBySystem.get(name) ?? '']));

function value(name: string): string {
  const found = root.get(name);
  if (found === undefined) {
    throw new Error(`${name} is not defined`);
  }
  return found;
}

describe('the scales', () => {
  it('spacing is 2, 4, 8, 12, 16, 24, 32 and 48', () => {
    const steps = [2, 4, 8, 12, 16, 24, 32, 48];
    expect(steps.map((px) => value(`--k-space-${String(px)}`))).toEqual(
      steps.map((px) => `${String(px)}px`),
    );
    expect([...root.keys()].filter((k) => k.startsWith('--k-space-'))).toHaveLength(steps.length);
  });

  it('type has the five sizes with their line heights, and two weights', () => {
    const scale = {
      caption: [12, 16],
      secondary: [13, 20],
      body: [14, 20],
      'section-title': [16, 24],
      'dialog-title': [20, 28],
    } as const;
    for (const [name, [size, line]] of Object.entries(scale)) {
      expect(value(`--k-font-size-${name}`)).toBe(`${String(size)}px`);
      expect(value(`--k-line-height-${name}`)).toBe(`${String(line)}px`);
    }
    expect([value('--k-weight-regular'), value('--k-weight-medium')]).toEqual(['400', '500']);
    expect([...root.keys()].filter((k) => k.startsWith('--k-weight-'))).toHaveLength(2);
    expect(value('--k-font-sans')).toMatch(/^'Inter', system-ui/);
  });

  it('radii, control heights, focus and motion are as set', () => {
    expect([value('--k-radius-sm'), value('--k-radius-md'), value('--k-radius-lg')]).toEqual([
      '4px',
      '6px',
      '8px',
    ]);
    expect([
      value('--k-control-height-compact'),
      value('--k-control-height'),
      value('--k-hit-target'),
    ]).toEqual(['28px', '32px', '32px']);
    expect([value('--k-focus-width'), value('--k-focus-offset')]).toEqual(['2px', '2px']);
    expect([value('--k-motion-duration'), value('--k-motion-easing')]).toEqual([
      '150ms',
      'ease-out',
    ]);
  });

  it('layers rise from base to tooltip', () => {
    const layers = ['base', 'sticky', 'overlay', 'dialog', 'tooltip'].map((name) =>
      Number(value(`--k-z-${name}`)),
    );
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
    expect(new Set(layers).size).toBe(5);
  });

  it('motion is off when the user asks for less of it', () => {
    const reduced = ruleFor(':root', '(prefers-reduced-motion: reduce)').declarations;
    expect(reduced.get('--k-motion-duration')).toBe('0ms');
  });
});

describe('light and dark', () => {
  it('give every color a plain #rrggbb value, so that it can be measured', () => {
    for (const theme of [light, dark]) {
      for (const name of COLORS) {
        expect(theme.get(name), name).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('are the same colors whether dark comes from the system or is forced', () => {
    for (const name of COLORS) {
      expect(darkForced.get(name), name).toBe(darkBySystem.get(name));
    }
    expect([...darkBySystem.keys()].sort()).toEqual([...COLORS].sort());
  });

  it('differ from each other in every color', () => {
    for (const name of COLORS) {
      expect(dark.get(name), name).not.toBe(light.get(name));
    }
  });

  it('force a color scheme on the root when asked to', () => {
    expect(ruleFor(":root[data-theme='dark']").declarations.get('color-scheme')).toBe('dark');
    expect(ruleFor(":root[data-theme='light']").declarations.get('color-scheme')).toBe('light');
    expect(root.get('color-scheme')).toBe('light dark');
  });
});

/** Relative luminance of a #rrggbb color, as WCAG defines it. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

describe.each([
  ['light', light],
  ['dark', dark],
])('contrast in %s', (_, theme) => {
  const get = (name: string): string => theme.get(name as (typeof COLORS)[number]) ?? '';
  const surfaces = ['--k-surface', '--k-surface-raised', '--k-surface-map'];

  it('is 4.5:1 or more for text, and for the colors that mark a state, on every surface', () => {
    for (const surface of surfaces) {
      for (const text of [
        '--k-text',
        '--k-text-muted',
        '--k-accent',
        '--k-danger',
        '--k-warning',
        '--k-info',
      ]) {
        expect(contrast(get(text), get(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('is 3:1 or more for the boundary of a control, on every surface', () => {
    for (const surface of surfaces) {
      expect(contrast(get('--k-border-strong'), get(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it('is 4.5:1 or more for text on the accent', () => {
    expect(contrast(get('--k-on-accent'), get('--k-accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the decorative divider visible, but gentler than the control boundary', () => {
    const divider = contrast(get('--k-border'), get('--k-surface'));
    expect(divider).toBeGreaterThan(1.1);
    expect(divider).toBeLessThan(contrast(get('--k-border-strong'), get('--k-surface')));
  });
});

describe('the documentation', () => {
  const defined = [...root.keys()].filter((name) => name.startsWith('--k-'));
  const documented = [...docs.matchAll(/`(--k-[a-z0-9-]+)`/g)].map((m) => m[1] ?? '');

  it('lists every token that is defined', () => {
    expect(defined.filter((name) => !documented.includes(name))).toEqual([]);
  });

  it('lists no token that is not defined', () => {
    expect([...new Set(documented)].filter((name) => !defined.includes(name))).toEqual([]);
  });
});
