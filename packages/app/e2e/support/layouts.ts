/**
 * The window sizes and themes every UI state is checked and photographed at (section 7.4):
 * three window sizes, from the smallest the app supports to a large one, in both themes.
 */
import type { Page } from '@playwright/test';

/** The window sizes, in pixels. */
export const VIEWPORTS = [
  { width: 1024, height: 640 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

/** The themes. */
export const THEMES = ['light', 'dark'] as const;

/** One window size in one theme. */
export interface Layout {
  readonly viewport: (typeof VIEWPORTS)[number];
  readonly theme: (typeof THEMES)[number];
  /** For naming a screenshot: `1440x900-dark`. */
  readonly name: string;
}

/** Every size in every theme: six layouts. */
export const LAYOUTS: readonly Layout[] = VIEWPORTS.flatMap((viewport) =>
  THEMES.map((theme) => ({
    viewport,
    theme,
    name: `${String(viewport.width)}x${String(viewport.height)}-${theme}`,
  })),
);

/**
 * Opens `path` at every window size in both themes, once each, waits for the fonts, and calls
 * `check` with the page ready. The theme is forced with `?theme=`, which the gallery (and, from
 * step 7.1, the app) reads.
 */
export async function inEveryLayout(
  page: Page,
  path: string,
  check: (layout: Layout) => Promise<void>,
): Promise<void> {
  for (const layout of LAYOUTS) {
    await page.setViewportSize(layout.viewport);
    const separator = path.includes('?') ? '&' : '?';
    await page.goto(`${path}${separator}theme=${layout.theme}`);
    await page.evaluate(() => document.fonts.ready);
    await check(layout);
  }
}
