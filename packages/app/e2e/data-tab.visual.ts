/**
 * A photograph of the whole app with the Data tab open, in each of the states that look different:
 * nothing loaded, one dataset, so many that the list scrolls, names too long for their rows, and a
 * dataset with warnings, at three window sizes in both themes. Run with `pnpm test:visual` (it needs
 * Docker); `pnpm test:visual:update` takes them again, and the new pictures have to be looked at before
 * they are committed.
 */
import { test } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import { PATH, SHOTS } from './states/data-tab.js';

test.use({ reducedMotion: 'reduce' });

for (const each of SHOTS) {
  test(`the state "${each.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, PATH, each);
  });
}
