/**
 * A photograph of the import wizard in each of its steps, and in the states that look different (an
 * error, a warning, nothing found, a failure), at three window sizes in both themes. Run with
 * `pnpm test:visual` (it needs Docker); `pnpm test:visual:update` takes them again, and the new
 * pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import { PATH, SHOTS } from './states/wizard.js';

test.use({ reducedMotion: 'reduce' });

for (const each of SHOTS) {
  test(`the state "${each.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, PATH, each);
  });
}
