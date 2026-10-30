/**
 * A photograph of the app with the long and the unexpected in it (a name of 120 characters, a column of
 * 60, 10 million as a count, a negative coordinate with 12 decimals), at three window sizes in both
 * themes. Run with `pnpm test:visual` (it needs Docker); `pnpm test:visual:update` takes them again,
 * and the new pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import { PATH, SHOTS } from './states/long-content.js';

test.use({ reducedMotion: 'reduce' });

for (const each of SHOTS) {
  test(`the state "${each.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, PATH, each);
  });
}
