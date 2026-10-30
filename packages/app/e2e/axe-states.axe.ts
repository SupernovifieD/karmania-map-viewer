/**
 * axe over every state that is photographed, in both themes, and the app's at the smallest window
 * as well, where panels and dialogs scroll. Nothing is allowed through: a violation of any kind,
 * serious or not, fails the state and says which rule, where, and in which theme and window.
 *
 * It takes a few minutes, so it is its own project and is not part of `pnpm test:e2e`:
 *
 *     pnpm test:axe
 *
 * A state of the gallery is checked in the section of the gallery it is in, since the whole page is
 * a good deal slower to check than the part of it that the state is about; the page as a whole is
 * checked once in each theme. The states of the app are checked as a whole.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { PATH as DATA_TAB_PATH, SHOTS as DATA_TAB } from './states/data-tab.js';
import { PATH as GALLERY_PATH, SHOTS as GALLERY } from './states/gallery.js';
import { PATH as SHELL_PATH, SHOTS as SHELL } from './states/shell.js';
import { PATH as WIZARD_PATH, SHOTS as WIZARD } from './states/wizard.js';
import { THEMES, VIEWPORTS } from './support/layouts.js';
import type { Shot } from './support/screenshots.js';

test.use({ reducedMotion: 'reduce' });

/** What a violation says, for a failure message: enough to find it and to know what it is. */
interface Found {
  readonly state: string;
  readonly theme: string;
  readonly window: string;
  readonly rule: string;
  readonly impact: string | null | undefined;
  readonly help: string;
  readonly where: readonly string[];
}

/** The section of the gallery that something is in, looking out of any element with a tree of its own. */
function sectionOf(target: Locator): Promise<string | null> {
  return target.evaluate((element) => {
    let node: Node | null = element;
    while (node !== null) {
      const section = node instanceof Element ? node.closest('[data-section]') : null;
      if (section !== null) {
        return section.getAttribute('data-section');
      }
      const root: Node = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  });
}

/** Runs axe on the page, or on the sections of the gallery that `sections` names. */
async function check(
  page: Page,
  describe: Omit<Found, 'rule' | 'impact' | 'help' | 'where'>,
  sections: readonly string[] = [],
): Promise<Found[]> {
  const builder = new AxeBuilder({ page });
  for (const section of sections) {
    builder.include(['karmania-gallery', `[data-section="${section}"]`]);
  }
  const results = await builder.analyze();
  return results.violations.map((violation) => ({
    ...describe,
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    where: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

test('the gallery page as a whole has nothing wrong, in either theme', async ({ page }) => {
  test.setTimeout(120_000);
  const found: Found[] = [];
  for (const theme of THEMES) {
    await page.goto(`${GALLERY_PATH}?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    found.push(...(await check(page, { state: 'the whole page', theme, window: 'default' })));
  }
  expect(found).toEqual([]);
});

/** The states of the gallery, each checked in its own section, at the usual window. */
for (const shot of GALLERY) {
  test(`gallery: the state "${shot.name}" has nothing wrong, in either theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORTS[1]);
    const found: Found[] = [];
    for (const theme of THEMES) {
      await page.goto(`${GALLERY_PATH}?theme=${theme}`);
      await page.evaluate(() => document.fonts.ready);
      const targets = await shot.show(page);
      const names = new Set<string>();
      for (const target of targets) {
        const name = await sectionOf(target);
        if (name !== null) {
          names.add(name);
        }
      }
      found.push(
        ...(await check(page, { state: shot.name, theme, window: '1440x900' }, [...names])),
      );
    }
    expect(found).toEqual([]);
  });
}

/** The states of the app, each checked as a whole, at the usual window and at the smallest. */
const APP: readonly (readonly [string, string, readonly Shot[]])[] = [
  ['shell', SHELL_PATH, SHELL],
  ['wizard', WIZARD_PATH, WIZARD],
  ['data tab', DATA_TAB_PATH, DATA_TAB],
];

for (const [group, path, shots] of APP) {
  for (const shot of shots) {
    test(`${group}: the state "${shot.name}" has nothing wrong, in either theme and window`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const found: Found[] = [];
      for (const viewport of [VIEWPORTS[1], VIEWPORTS[0]]) {
        for (const theme of THEMES) {
          await page.setViewportSize(viewport);
          await page.goto(`${path}?theme=${theme}`);
          await page.evaluate(() => document.fonts.ready);
          await shot.show(page);
          found.push(
            ...(await check(page, {
              state: shot.name,
              theme,
              window: `${String(viewport.width)}x${String(viewport.height)}`,
            })),
          );
        }
      }
      expect(found).toEqual([]);
    });
  }
}
