/**
 * Screenshots of the states of the UI (section 7.4): each state is photographed at every
 * window size in both themes, and compared with the baseline in `e2e/screenshots`.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { inEveryLayout } from './layouts.js';

/** One state of the UI to photograph. */
export interface Shot {
  /** Names the screenshots: `<name>-<width>x<height>-<theme>.png`. */
  readonly name: string;
  /**
   * Puts the page in the state, and returns what is to be photographed: the picture is the box
   * around all of it. Interactions (hover, focus) must come after anything that scrolls.
   */
  readonly show: (page: Page) => Promise<readonly Locator[]>;
  /** Pixels of the page around what is photographed. Defaults to 8, room for a focus ring. */
  readonly padding?: number;
}

/** Scrolls an element to the middle of the window, so there is room around it. */
export async function reveal(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  });
}

/** The box, in the window, around all of `targets`, with `padding`, kept inside the window. */
async function clipAround(page: Page, targets: readonly Locator[], padding: number) {
  const boxes = [];
  for (const target of targets) {
    const box = await target.boundingBox();
    if (box === null) {
      throw new Error('Something to photograph is not shown.');
    }
    boxes.push(box);
  }
  const left = Math.min(...boxes.map((box) => box.x)) - padding;
  const top = Math.min(...boxes.map((box) => box.y)) - padding;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + padding;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + padding;
  const size = page.viewportSize();
  const [width, height] = [size?.width ?? right, size?.height ?? bottom];
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  return { x, y, width: Math.min(right, width) - x, height: Math.min(bottom, height) - y };
}

/** Photographs a state at every window size in both themes, and compares each with its baseline. */
export async function photograph(page: Page, path: string, shot: Shot): Promise<void> {
  await inEveryLayout(page, path, async (layout) => {
    const targets = await shot.show(page);
    const clip = await clipAround(page, targets, shot.padding ?? 8);
    await expect(page).toHaveScreenshot(`${shot.name}-${layout.name}.png`, { clip });
  });
}
