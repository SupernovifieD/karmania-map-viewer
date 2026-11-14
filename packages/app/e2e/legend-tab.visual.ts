/**
 * A photograph of the panel with the Legend tab open and layers in it, in each of the states that look different: layers and groups, a folded group,
 * and names too long for their rows, at three window sizes in both themes. Run with `pnpm test:visual` (it needs Docker); `scripts/visual-tests --update`
 * takes them again, and the new pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import { PATH, SHOTS } from './states/legend-tab.js';

test.use({ reducedMotion: 'reduce' });

for (const each of SHOTS) {
  test(`the state "${each.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, PATH, each);
  });
}
