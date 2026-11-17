import type { Page } from '@playwright/test';

/** What a page has made and let go of, of the things that must not be left behind when a viewer is disposed. */
export interface Leaks {
  /** Workers started, and workers terminated. */
  readonly workers: { readonly started: number; readonly terminated: number };
}

declare global {
  interface Window {
    /** What `trackLeaks` counts, kept by the script it adds to the page. */
    __leaks: { started: number; terminated: number };
  }
}

/**
 * Counts the workers that a page starts and terminates, from before any of its scripts run (call it before `goto`). `read` gives the counts
 * at the time it is called.
 */
export async function trackLeaks(page: Page): Promise<() => Promise<Leaks>> {
  await page.addInitScript(() => {
    const counts = { started: 0, terminated: 0 };
    window.__leaks = counts;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        counts.started += 1;
      }
      override terminate(): void {
        counts.terminated += 1;
        super.terminate();
      }
    };
  });
  return async () => {
    const counts = await page.evaluate(() => ({ ...window.__leaks }));
    return { workers: counts };
  };
}
