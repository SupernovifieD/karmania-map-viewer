/**
 * A photograph of the panel with the Legend tab open and layers in it, in each of the states that look different: layers and groups, a folded group,
 * and names too long for their rows, at three window sizes in both themes. Run with `pnpm test:visual` (it needs Docker); `scripts/visual-tests --update`
 * takes them again, and the new pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import { PATH, SHOTS } from './states/legend-tab.js';

test.use({ reducedMotion: 'reduce' });

/** The states that load 50 layers, each time the page is made again (six times): they take most of the minute that a test has, and more when the machine is busy. */
const SLOW = ['legend-tab-many', 'legend-tab-many-end'];

for (const each of SHOTS) {
  test(`the state "${each.name}", at every window size in both themes`, async ({ page }) => {
    test.slow(SLOW.includes(each.name), 'it loads 50 layers for each of the six pictures');
    await photograph(page, PATH, each);
  });
}
