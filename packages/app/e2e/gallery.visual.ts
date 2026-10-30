/**
 * A photograph of every state of every component in the gallery, at three window sizes in
 * both themes. Run with `pnpm test:visual` (it needs Docker); `pnpm test:visual:update` takes
 * them again, and the new pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import { PATH, SHOTS } from './states/gallery.js';

test.use({ reducedMotion: 'reduce' });

for (const shot of SHOTS) {
  test(`the state "${shot.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, PATH, shot);
  });
}
