/**
 * A photograph of the whole app with a map in it and its furniture over the map, and of the map coordinate system dialog, in each of
 * their states, at three window sizes in both themes. Run with `pnpm test:visual` (it needs Docker); `pnpm test:visual:update` takes
 * them again, and the new pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import { PATH, SHOTS } from './states/map-furniture.js';

test.use({ reducedMotion: 'reduce' });
// Each state loads its data at six window sizes and themes, which takes a while on a slow machine.
test.setTimeout(150_000);

for (const each of SHOTS) {
  test(`the state "${each.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, PATH, each);
  });
}
