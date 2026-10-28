/**
 * Layout checks for the UI tests (section 7.4 of the brief). They measure the page as the
 * browser laid it out, through shadow roots, and fail with a message that names the element
 * and says by how much.
 *
 * - `assertNoOverflow`: nothing sticks out of its container or out of the window.
 * - `assertNoOverlap`, `assertAdjacent`, `assertAligned`: how two or more elements sit.
 */
import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

/** How much a measurement may differ before it is a difference: a sub-pixel is not one. */
const TOLERANCE = 0.5;

/** Something wrong with a layout: which element, and what. */
export interface LayoutProblem {
  readonly element: string;
  readonly problem: string;
}

/** What `assertNoOverflow` checks the window for. */
export interface OverflowOptions {
  /**
   * Whether elements must also be inside the window: `both` (the default, for a page that never
   * scrolls, like the app), `horizontal` (for a page that scrolls down, like the gallery) or
   * `none`.
   */
  readonly window?: 'both' | 'horizontal' | 'none';
}

/**
 * Fails if anything inside `root` overflows:
 *
 * - an element whose content is bigger than its box (`scrollWidth > clientWidth + 1` or the
 *   same for height), unless it is marked `data-scroll-region` (it is meant to scroll) or
 *   `data-truncate` (it cuts its text with an ellipsis);
 * - an element that is visible and sticks out of the window (see `options.window`), unless it is
 *   inside a scroll region, where what is scrolled out of sight is out of sight on purpose.
 *
 * Elements that are not shown are ignored, and so are the document itself and the native
 * controls that scroll their own text.
 */
export async function assertNoOverflow(
  root: Locator,
  options: OverflowOptions = {},
): Promise<void> {
  const problems = await root.evaluate((element, mode): LayoutProblem[] => {
    const found: LayoutProblem[] = [];
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const tolerance = 0.5;

    const describe = (node: Element): string => {
      const label = (n: Element): string =>
        n.tagName.toLowerCase() +
        (n.id === '' ? '' : `#${n.id}`) +
        (n.classList.length > 0 ? `.${[...n.classList].join('.')}` : '');
      const root = node.getRootNode();
      return root instanceof ShadowRoot ? `${label(node)} (in ${label(root.host)})` : label(node);
    };

    const visit = (node: Element, inRegion: boolean): void => {
      const isRegion = node.hasAttribute('data-scroll-region');
      const rects = node.getClientRects();
      const shown = rects.length > 0 && getComputedStyle(node).visibility !== 'hidden';
      const exempt =
        isRegion ||
        node.hasAttribute('data-truncate') ||
        ['HTML', 'BODY', 'INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
      if (shown && !exempt) {
        const across = node.scrollWidth - node.clientWidth;
        const down = node.scrollHeight - node.clientHeight;
        if (across > 1) {
          found.push({
            element: describe(node),
            problem: `its content is ${String(across)}px wider than it is`,
          });
        }
        if (down > 1) {
          found.push({
            element: describe(node),
            problem: `its content is ${String(down)}px taller than it is`,
          });
        }
      }
      if (shown && !inRegion && mode !== 'none') {
        const box = node.getBoundingClientRect();
        if (box.width > 0 || box.height > 0) {
          const outside: string[] = [];
          if (box.left < -tolerance)
            outside.push(`${String(-Math.round(box.left))}px past the left edge`);
          if (box.right > width + tolerance)
            outside.push(`${String(Math.round(box.right - width))}px past the right edge`);
          if (mode === 'both' && box.top < -tolerance)
            outside.push(`${String(-Math.round(box.top))}px past the top edge`);
          if (mode === 'both' && box.bottom > height + tolerance)
            outside.push(`${String(Math.round(box.bottom - height))}px past the bottom edge`);
          if (outside.length > 0) {
            found.push({
              element: describe(node),
              problem: `it is ${outside.join(' and ')} of the window`,
            });
          }
        }
      }
      for (const child of [...(node.shadowRoot?.children ?? []), ...node.children]) {
        visit(child, inRegion || isRegion);
      }
    };

    visit(element, element.closest('[data-scroll-region]') !== null);
    return found;
  }, options.window ?? 'both');
  expect(problems, 'elements that overflow').toEqual([]);
}

/** A locator's box in the window, or a failure that says what was being measured. */
async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} is not shown, so it has no box to measure.`);
  }
  return box;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** Fails if the two elements' boxes overlap. Boxes that only touch do not overlap. */
export async function assertNoOverlap(a: Locator, b: Locator): Promise<void> {
  const [first, second] = [
    await boxOf(a, 'The first element'),
    await boxOf(b, 'The second element'),
  ];
  const across =
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const down =
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  expect(
    across > TOLERANCE && down > TOLERANCE
      ? { overlapWidth: round(across), overlapHeight: round(down) }
      : 'apart',
    'how the two elements overlap',
  ).toBe('apart');
}

/**
 * Fails unless `second` starts exactly where `first` ends (to the left of it, or above it with
 * `axis: 'vertical'`) and the two share some of the other dimension: the map and its panel, the
 * toolbar and what is under it.
 */
export async function assertAdjacent(
  first: Locator,
  second: Locator,
  axis: 'horizontal' | 'vertical' = 'horizontal',
): Promise<void> {
  const [a, b] = [
    await boxOf(first, 'The first element'),
    await boxOf(second, 'The second element'),
  ];
  const gap = axis === 'horizontal' ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
  expect(round(gap), `the gap between the two elements (${axis})`).toBeCloseTo(0, 0);
  expect(Math.abs(gap), `the gap between the two elements (${axis})`).toBeLessThanOrEqual(
    TOLERANCE,
  );
  const shared =
    axis === 'horizontal'
      ? Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      : Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  expect(shared, `how much of the other dimension the two share`).toBeGreaterThan(0);
}

/** The edges `assertAligned` can compare. */
export type Edge =
  'left' | 'right' | 'top' | 'bottom' | 'baseline' | 'horizontal-centre' | 'vertical-centre';

/**
 * Where the first line of text of an element sits: the baseline, in window coordinates. Found
 * from the text's own box and the font's descent, so it works through slots and shadow roots.
 */
function baselineOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const firstText = (node: Node): Text | undefined => {
      for (const child of node.childNodes) {
        if (child instanceof Text && child.textContent.trim() !== '') {
          return child;
        }
      }
      const inside = node instanceof Element ? node.shadowRoot : null;
      for (const child of [...(inside?.childNodes ?? []), ...node.childNodes]) {
        const found = firstText(child);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    };
    const text = firstText(element);
    if (text === undefined) {
      throw new Error('There is no text in this element, so it has no baseline.');
    }
    const range = document.createRange();
    range.selectNodeContents(text);
    const line = range.getClientRects()[0];
    const parent = text.parentElement;
    if (line === undefined || parent === null) {
      throw new Error('The text is not shown, so it has no baseline.');
    }
    const style = getComputedStyle(parent);
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) {
      throw new Error('No canvas to measure the font with.');
    }
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return line.bottom - context.measureText('Hg').fontBoundingBoxDescent;
  });
}

/**
 * Fails unless all of the elements have the same `edge` (a left or right or top or bottom edge,
 * a centre, or the baseline of their text), to within half a pixel.
 */
export async function assertAligned(elements: readonly Locator[], edge: Edge): Promise<void> {
  const positions: number[] = [];
  for (const [index, element] of elements.entries()) {
    if (edge === 'baseline') {
      positions.push(await baselineOf(element));
      continue;
    }
    const box = await boxOf(element, `Element ${String(index + 1)}`);
    positions.push(
      {
        left: box.x,
        right: box.x + box.width,
        top: box.y,
        bottom: box.y + box.height,
        'horizontal-centre': box.x + box.width / 2,
        'vertical-centre': box.y + box.height / 2,
      }[edge],
    );
  }
  const spread = Math.max(...positions) - Math.min(...positions);
  expect(
    spread <= TOLERANCE
      ? 'aligned'
      : { edge, positions: positions.map(round), spread: round(spread) },
    `the ${edge} of ${String(elements.length)} elements`,
  ).toBe('aligned');
}
