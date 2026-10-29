import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';
import { layoutOf } from './support/layout-snapshot.js';
import { inEveryLayout } from './support/layouts.js';
import { boxOf } from './support/layout.js';

const map = (page: Page) => page.locator('karmania-map-area');
const main = (page: Page) => map(page).locator('main');
const zone = (page: Page) => map(page).locator('.drop-zone');
const label = (page: Page) => map(page).locator('.drop-label');

/** What a drag event did: whether the page took the drag, and what it said would happen. */
interface Outcome {
  readonly prevented: boolean;
  readonly dropEffect: string;
}

/** Fires a drag event on an element, as the browser does for a drag of a file or of some text. */
function fire(
  target: Locator,
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  kind: 'files' | 'text' = 'files',
): Promise<Outcome> {
  return target.evaluate(
    (element, [eventType, dragKind]) => {
      const dataTransfer = new DataTransfer();
      if (dragKind === 'files') {
        dataTransfer.items.add(new File(['x,y\n1,2\n'], 'points.csv', { type: 'text/csv' }));
      } else {
        dataTransfer.setData('text/plain', 'some text');
      }
      // A script cannot make a drag that allows an effect: the browser keeps `dropEffect` at none for
      // a `DataTransfer` that is not part of a real drag. So the property is replaced by one that
      // remembers what the page set it to, which is what the page is responsible for.
      let dropEffect = 'none';
      Object.defineProperty(dataTransfer, 'dropEffect', {
        get: () => dropEffect,
        set: (value: string) => {
          dropEffect = value;
        },
      });
      const event = new DragEvent(eventType, {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer,
      });
      element.dispatchEvent(event);
      return { prevented: event.defaultPrevented, dropEffect };
    },
    [type, kind] as const,
  );
}

test.describe('the drop zone', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('is not shown until files are dragged over the map area', async ({ page }) => {
    await page.goto('/');
    await expect(zone(page)).toBeHidden();
    await fire(main(page), 'dragenter');
    await expect(zone(page)).toBeVisible();
    await expect(label(page)).toHaveText('Drop to import');
  });

  test('is an outline 8 inside the edges: 2 dashed in the accent color, and a label in the middle', async ({
    page,
  }) => {
    for (const [theme, accent] of [
      ['light', 'rgb(26, 86, 196)'],
      ['dark', 'rgb(122, 167, 255)'],
    ] as const) {
      await page.goto(`/?theme=${theme}`);
      await fire(main(page), 'dragenter');
      const area = await boxOf(map(page), 'the map area');
      const outline = await boxOf(zone(page), 'the drop zone');
      expect(outline).toEqual({
        x: area.x + 8,
        y: area.y + 8,
        width: area.width - 16,
        height: area.height - 16,
      });
      const border = await zone(page).evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.borderTopStyle, style.borderTopWidth, style.borderTopColor];
      });
      expect(border).toEqual(['dashed', '2px', accent]);

      const text = await boxOf(label(page), 'the label');
      expect(Math.abs(text.x + text.width / 2 - (outline.x + outline.width / 2))).toBeLessThan(1);
      expect(Math.abs(text.y + text.height / 2 - (outline.y + outline.height / 2))).toBeLessThan(1);
    }
  });

  test('moves and resizes nothing while it is shown, at every size in both themes', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async () => {
      const before = await layoutOf(page, '.drop-zone');
      expect(before.length).toBeGreaterThan(10);

      await fire(main(page), 'dragenter');
      await fire(main(page), 'dragover');
      await expect(zone(page)).toBeVisible();
      expect(await layoutOf(page, '.drop-zone')).toEqual(before);

      await fire(main(page), 'dragleave');
      await expect(zone(page)).toBeHidden();
      expect(await layoutOf(page, '.drop-zone')).toEqual(before);
    });
  });

  test('moves nothing when there is data in the area either', async ({ page }) => {
    await page.goto('/');
    await map(page).evaluate(async (element) => {
      (element as unknown as { datasets: number }).datasets = 4;
      await (element as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    });
    const before = await layoutOf(page, '.drop-zone');
    await fire(main(page), 'dragenter');
    await expect(zone(page)).toBeVisible();
    expect(await layoutOf(page, '.drop-zone')).toEqual(before);
  });

  test('stays while the drag moves from one part of the area to another, and goes when it leaves', async ({
    page,
  }) => {
    await page.goto('/');
    const button = map(page).locator('k-button');
    // The browser fires `dragenter` for the part it moves onto before `dragleave` for the one it leaves.
    await fire(main(page), 'dragenter');
    await fire(button, 'dragenter');
    await fire(main(page), 'dragleave');
    await expect(zone(page)).toBeVisible();
    await fire(button, 'dragleave');
    await expect(zone(page)).toBeHidden();
  });

  test('goes when the files are dropped, and the browser is told to leave them alone', async ({
    page,
  }) => {
    await page.goto('/');
    await fire(main(page), 'dragenter');
    expect(await fire(main(page), 'dragover')).toEqual({ prevented: true, dropEffect: 'copy' });
    expect((await fire(main(page), 'drop')).prevented).toBe(true);
    await expect(zone(page)).toBeHidden();
    // A second drag starts from nothing, however the first ended.
    await fire(main(page), 'dragenter');
    await fire(main(page), 'dragleave');
    await expect(zone(page)).toBeHidden();
  });

  test('ignores a drag that carries no files', async ({ page }) => {
    await page.goto('/');
    expect(await fire(main(page), 'dragenter', 'text')).toMatchObject({ prevented: false });
    expect(await fire(main(page), 'dragover', 'text')).toMatchObject({ prevented: false });
    await expect(zone(page)).toBeHidden();
    expect((await fire(main(page), 'drop', 'text')).prevented).toBe(false);
  });

  test('refuses files dropped anywhere else, so the browser does not open them in place of the app', async ({
    page,
  }) => {
    await page.goto('/');
    const elsewhere = [
      page.locator('karmania-app header.toolbar'),
      page.locator('karmania-panel'),
      page.locator('karmania-app'),
    ];
    for (const place of elsewhere) {
      expect(await fire(place, 'dragover')).toEqual({ prevented: true, dropEffect: 'none' });
      expect((await fire(place, 'drop')).prevented).toBe(true);
    }
    // Nothing is shown for them, and the map area is not what refused.
    await expect(zone(page)).toBeHidden();
    expect(await fire(main(page), 'dragover')).toEqual({ prevented: true, dropEffect: 'copy' });
    // Text dropped elsewhere is the browser's business.
    expect((await fire(page.locator('karmania-panel'), 'drop', 'text')).prevented).toBe(false);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`can be read, and has no serious accessibility violations, in the ${theme} theme`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await fire(main(page), 'dragenter');
      const colors = await zone(page).evaluate((element) => {
        const text = element.querySelector('.drop-label');
        return {
          text: text === null ? '' : getComputedStyle(text).color,
          background: getComputedStyle(element).backgroundColor,
          outline: getComputedStyle(element).borderTopColor,
        };
      });
      expect(contrastBetween(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
      // The outline is a boundary that has to be seen against what is behind it.
      expect(contrastBetween(colors.outline, colors.background)).toBeGreaterThanOrEqual(3);
      await expectNoSeriousViolations(page);
    });
  }
});
