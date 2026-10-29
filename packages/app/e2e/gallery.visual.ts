/**
 * A photograph of every state of every component in the gallery, at three window sizes in
 * both themes. Run with `pnpm test:visual` (it needs Docker); `pnpm test:visual:update` takes
 * them again, and the new pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { photograph, reveal } from './support/screenshots.js';
import type { Shot } from './support/screenshots.js';

test.use({ reducedMotion: 'reduce' });

const gallery = (page: Page, selector: string): Locator => page.locator(selector);
const section = (page: Page, name: string): Locator =>
  gallery(page, `karmania-gallery [data-section="${name}"]`);

/** The 32 pixel button of a variant with an icon and words. */
const button = (page: Page, variant: string, kind = 'icon-text', size = '32'): Locator =>
  gallery(
    page,
    `div[data-variant="${variant}"][data-size="${size}"][data-kind="${kind}"] k-button`,
  );

/** Shows the whole section. */
const wholeSection = (name: string) => async (page: Page) => {
  const target = section(page, name);
  await reveal(target);
  return [target];
};

/** Focuses with the keyboard, which is what makes the focus ring show. */
async function focusByKeyboard(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press('Shift');
  await target.focus();
}

const buttonStates = (variant: string): Shot[] => [
  {
    name: `button-${variant}-hover`,
    show: async (page) => {
      const target = button(page, variant);
      await reveal(target);
      await target.hover();
      return [target];
    },
  },
  {
    name: `button-${variant}-pressed`,
    show: async (page) => {
      const target = button(page, variant);
      await reveal(target);
      await target.hover();
      await page.mouse.down();
      return [target];
    },
  },
  {
    name: `button-${variant}-focus`,
    show: async (page) => {
      const target = button(page, variant);
      await reveal(target);
      await focusByKeyboard(page, target.locator('button'));
      return [target];
    },
  },
];

/** A tooltip showing, with the control it belongs to. */
const tooltipShot = (name: string, id: string, how: 'hover' | 'focus'): Shot => ({
  name,
  padding: 12,
  show: async (page) => {
    const host = gallery(page, `karmania-gallery #${id}`);
    await reveal(host);
    if (how === 'hover') {
      await host.hover();
    } else {
      await focusByKeyboard(page, host.locator('button'));
    }
    return [host.locator('k-button'), host.locator('.tip')];
  },
});

/** The dialog of a gallery demo, opened with its button; the dialog is what is photographed. */
const dialogShot = (
  name: string,
  id: string,
  prepare: (page: Page, dialog: Locator) => Promise<void> = () => Promise.resolve(),
  padding = 8,
): Shot => ({
  name,
  padding,
  show: async (page) => {
    const demo = gallery(page, `karmania-gallery #${id}`);
    await reveal(demo);
    await demo.locator(':scope > k-button').click();
    const dialog = demo.locator('dialog');
    await dialog.waitFor();
    // The rest of the gallery is hidden, so that what shows round the dialog, under the
    // dimming, does not change with what else the gallery shows.
    await page.locator('karmania-gallery').evaluate((host) => {
      host.style.visibility = 'hidden';
    });
    await dialog.evaluate((element) => {
      element.style.visibility = 'visible';
    });
    await prepare(page, dialog);
    return [dialog];
  },
});

const tab = (page: Page, id: string): Locator =>
  gallery(page, `karmania-gallery #panel-tabs [role="tab"][data-id="${id}"]`);

const SHOTS: Shot[] = [
  { name: 'icons', show: wholeSection('icons') },
  { name: 'buttons', show: wholeSection('buttons') },
  ...['primary', 'secondary', 'ghost'].flatMap(buttonStates),
  {
    name: 'button-icon-only-focus',
    show: async (page) => {
      const target = button(page, 'secondary', 'icon-only', '28');
      await reveal(target);
      await focusByKeyboard(page, target.locator('button'));
      return [target];
    },
  },
  {
    name: 'tabs-panel',
    show: async (page) => {
      const target = gallery(page, 'karmania-gallery #panel-tabs');
      await reveal(target);
      return [target];
    },
  },
  {
    name: 'tabs-panel-data',
    show: async (page) => {
      const target = gallery(page, 'karmania-gallery #panel-tabs');
      await reveal(target);
      await tab(page, 'data').click();
      await page.mouse.move(0, 0);
      return [target];
    },
  },
  {
    name: 'tabs-focus',
    show: async (page) => {
      const target = gallery(page, 'karmania-gallery #panel-tabs');
      await reveal(target);
      await focusByKeyboard(page, tab(page, 'legend'));
      return [target];
    },
  },
  {
    name: 'tabs-hover',
    show: async (page) => {
      const target = gallery(page, 'karmania-gallery #panel-tabs');
      await reveal(target);
      await tab(page, 'data').hover();
      return [target];
    },
  },
  {
    name: 'tabs-crowded',
    show: async (page) => {
      const target = gallery(page, 'karmania-gallery #crowded-tabs');
      await reveal(target);
      return [target];
    },
  },
  ...['action-tabs', 'crowded-action-tabs'].map((id): Shot => ({
    name: id === 'action-tabs' ? 'tabs-actions' : 'tabs-actions-crowded',
    show: async (page) => {
      const target = gallery(page, `karmania-gallery #${id}`);
      await reveal(target);
      return [target];
    },
  })),
  tooltipShot('tooltip-icon', 'tip-icon', 'hover'),
  tooltipShot('tooltip-describes', 'tip-describes', 'focus'),
  tooltipShot('tooltip-long', 'tip-long', 'hover'),
  tooltipShot('tooltip-below', 'tip-below', 'hover'),
  tooltipShot('tooltip-left', 'tip-left', 'hover'),
  tooltipShot('tooltip-clipped', 'tip-clipped', 'hover'),
  ...['full', 'message', 'small'].map((variant): Shot => ({
    name: `empty-${variant}`,
    show: async (page) => {
      const target = gallery(page, `karmania-gallery #empty-${variant}`);
      await reveal(target);
      return [target];
    },
  })),
  ...['select', 'input', 'progress', 'checkbox'].map((kind): Shot => ({
    name: `fields-${kind}`,
    show: async (page) => {
      const target = gallery(page, `karmania-gallery #fields-${kind}`);
      await reveal(target);
      return [target];
    },
  })),
  ...[
    ['select-focus', 'select-default', 'select'],
    ['select-compact-focus', 'select-compact', 'select'],
    ['input-focus', 'input-default', 'input'],
    ['input-error-focus', 'input-error', 'input'],
    ['checkbox-focus', 'check-on', 'input'],
  ].map(([name, id, control]): Shot => ({
    name: name ?? '',
    show: async (page) => {
      const target = gallery(page, `karmania-gallery #${id ?? ''}`);
      await reveal(target);
      await focusByKeyboard(page, target.locator(control ?? ''));
      return [target];
    },
  })),
  ...['first', 'middle', 'last', 'crowded'].map((where): Shot => ({
    name: `steps-${where}`,
    show: async (page) => {
      const target = gallery(page, `karmania-gallery #steps-${where}`);
      await reveal(target);
      return [target];
    },
  })),
  ...['few', 'many'].map((which): Shot => ({
    name: `table-${which}`,
    show: async (page) => {
      const target = gallery(page, `karmania-gallery #table-${which}`);
      await reveal(target);
      await target.locator('.rows [role="row"]').first().waitFor();
      return [target];
    },
  })),
  {
    // Down 1,234 rows and all the way to the right: the header and the row numbers stay in view.
    name: 'table-many-scrolled',
    show: async (page) => {
      const target = gallery(page, 'karmania-gallery #table-many');
      await reveal(target);
      await target.locator('.viewport').evaluate((element) => {
        element.scrollTo(element.scrollWidth, 1233 * 28);
      });
      await target.locator('.rows [role="rowheader"]', { hasText: /^\s*1235\s*$/ }).waitFor();
      return [target];
    },
  },
  dialogShot('dialog-short', 'dialog-short'),
  dialogShot(
    'dialog-short-close-focus',
    'dialog-short',
    async (page, dialog) => {
      await page.keyboard.press('Shift');
      await dialog.locator('header k-button').focus();
      // Room round the dialog for the tooltip that opens above the button.
    },
    40,
  ),
  dialogShot('dialog-note', 'dialog-note'),
  dialogShot('dialog-fill', 'dialog-fill'),
  dialogShot('dialog-long', 'dialog-long'),
  dialogShot('dialog-long-scrolled', 'dialog-long', async (_page, dialog) => {
    await dialog.locator('.body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  }),
];

for (const shot of SHOTS) {
  test(`the state "${shot.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, '/gallery.html', shot);
  });
}
