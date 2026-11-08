import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { camera, dispatch, withData } from './support/render.js';

/** The map area's box and the north arrow's, on the page. */
const area = (page: Page): Locator => page.locator('karmania-map-area main');
const arrow = (page: Page): Locator => page.locator('karmania-north-arrow');
const button = (page: Page): Locator => arrow(page).getByRole('button');

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} is not shown.`);
  }
  return box;
}

const turn = (page: Page, heading: number): Promise<void> =>
  dispatch(page, { type: 'setCamera', patch: { camera2d: { heading } } });

/**
 * Where the needle's tip is on the page, from the middle of the button: the tip of the arrowhead (20, 14 in the drawing, which is 40 by 40
 * and turns about its middle), taken through the transform that the browser has made of the needle.
 */
function tipFromMiddle(page: Page): Promise<{ dx: number; dy: number }> {
  return arrow(page).evaluate((element) => {
    const svg = element.shadowRoot?.querySelector('svg');
    const group = element.shadowRoot?.querySelector('g');
    if (!svg || !group) {
      throw new Error('There is no needle.');
    }
    const matrix = group.getScreenCTM();
    if (matrix === null) {
      throw new Error('The needle is not drawn.');
    }
    const at = (x: number, y: number) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      return point.matrixTransform(matrix);
    };
    const [tip, middle] = [at(20, 14), at(20, 20)];
    return { dx: tip.x - middle.x, dy: tip.y - middle.y };
  });
}

test.describe('the north arrow', () => {
  test('is not there with no data, where the map area is its empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('karmania-map-area k-empty-state')).toBeVisible();
    await expect(arrow(page)).toHaveCount(0);
  });

  test('is 40 by 40, at the top on the right, 16 inside the edges of the map', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    const [map, box] = [await boxOf(area(page), 'the map'), await boxOf(arrow(page), 'the arrow')];
    expect(box.width).toBe(40);
    expect(box.height).toBe(40);
    expect(box.y - map.y).toBe(16);
    expect(map.x + map.width - (box.x + box.width)).toBe(16);
  });

  test('turns its needle with the heading, and says the angle in its name', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await expect(button(page)).toHaveAccessibleName('Reset to north. North is up');
    for (const [heading, angle, name] of [
      [30, -30, 'Reset to north. Map turned 30° from north'],
      [90, -90, 'Reset to north. Map turned 90° from north'],
      [350, 10, 'Reset to north. Map turned 350° from north'],
      [0, 0, 'Reset to north. North is up'],
    ] as const) {
      await turn(page, heading);
      await expect(page.locator('karmania-north-arrow g')).toHaveAttribute(
        'data-angle',
        String(angle),
      );
      await expect(button(page)).toHaveAccessibleName(name);
    }
  });

  test('points where north is on the screen, which is the way the map is turned from it', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    // The top of the map faces `heading` clockwise from north, so north is `heading` anticlockwise from the top: for 90 (east at the top),
    // north is on the left; for 180 it is at the bottom.
    for (const [heading, dx, dy] of [
      [0, 0, -1],
      [90, -1, 0],
      [180, 0, 1],
      [270, 1, 0],
    ] as const) {
      await turn(page, heading);
      await expect
        .poll(async () => {
          const tip = await tipFromMiddle(page);
          const length = Math.hypot(tip.dx, tip.dy);
          return [Math.round(tip.dx / length), Math.round(tip.dy / length)];
        })
        .toEqual([dx, dy]);
    }
  });

  test('does not move when the map is turned: only the needle does', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    const before = await boxOf(arrow(page), 'the arrow');
    await turn(page, 137);
    await expect(page.locator('karmania-north-arrow g')).toHaveAttribute('data-angle', '-137');
    expect(await boxOf(arrow(page), 'the arrow')).toEqual(before);
  });

  test('puts north up when it is pressed, and leaves the centre and the scale as they are', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [1234, 5678], unitsPerPixel: 3, heading: 75 } },
    });
    await button(page).click();
    await expect.poll(async () => (await camera(page)).heading).toBe(0);
    const after = await camera(page);
    expect(after.centre).toEqual([1234, 5678]);
    expect(after.unitsPerPixel).toBe(3);
  });

  test('does it from the keyboard too, with Enter and with Space', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    for (const key of ['Enter', 'Space']) {
      await turn(page, 45);
      await button(page).focus();
      await page.keyboard.press(key);
      await expect.poll(async () => (await camera(page)).heading, key).toBe(0);
    }
  });

  test('is a stop of the keyboard after the map, with a ring of 2 pixels and a tooltip', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    // The map area has the keyboard, and Tab goes on to the arrow, which is the first of what is over the map.
    await area(page).focus();
    await page.keyboard.press('Tab');
    await expect(button(page)).toBeFocused();
    const outline = await button(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline).toEqual({ width: '2px', style: 'solid' });
    await expect(page.locator('karmania-north-arrow k-tooltip .tip')).toBeVisible();
    await expect(page.locator('karmania-north-arrow k-tooltip .tip')).toHaveText('Reset to north');
    // The name begins with the tooltip's words, so a description of them would be read out twice.
    await expect(button(page)).not.toHaveAttribute('aria-description', /.*/);
  });

  test('is not the map: pressing it does not start a drag of the map', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await turn(page, 0);
    const before = await camera(page);
    const box = await boxOf(arrow(page), 'the arrow');
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x - 100, box.y + 100, { steps: 4 });
    await page.mouse.up();
    expect(await camera(page)).toEqual(before);
  });
});
