/**
 * WebGL2 works in the browser in the Docker image, the one that will take the pictures of maps, and it
 * draws the same bytes every time. This is the premise of the render golden images (section 10.8 of the
 * phase 2 brief): if the picture below ever changes, find out why before changing the number.
 * Run with `pnpm test:visual`, like the screenshot tests.
 */
import { expect, test } from '@playwright/test';
import { expectTriangle } from './support/webgl.js';

/**
 * FNV-1a of the 64 x 64 picture of `drawTriangle`. The same value came out of 10 browsers on macOS and
 * 10 in the Docker image (Chromium 156, SwiftShader), so it does not depend on the machine.
 */
const TRIANGLE_PICTURE = '185ca885';

test.describe('WebGL2 in the browser of the screenshot tests', () => {
  test('draws a triangle with the software driver, the same bytes every time', async ({ page }) => {
    const result = await expectTriangle(page);
    expect(
      result.renderer,
      'the driver is the software one, with no graphics card in the way',
    ).toMatch(/SwiftShader/);
    expect(result.hash, 'the picture, byte for byte').toBe(TRIANGLE_PICTURE);
  });
});
