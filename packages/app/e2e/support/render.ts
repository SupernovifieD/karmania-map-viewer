/** What the tests of the map's renderer share: how to reach it through the viewer, and to read what it says and has drawn. */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { importAndLoad } from './wizard.js';

/** What the renderer says of itself (`RenderStats`). */
export interface Stats {
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelRatio: number;
  readonly contextLost: boolean;
  readonly geometries: number;
  readonly textures: number;
  readonly background: string;
  readonly frame: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly near: number;
    readonly far: number;
    readonly position: readonly [number, number, number];
    readonly rotation: number;
  };
}

/** The 2D camera of the scene. */
export interface Camera {
  readonly centre: readonly [number, number];
  readonly unitsPerPixel: number;
  readonly heading: number;
}

/** The viewer of the page, in what the tests use of it. */
interface ViewerElement {
  scene(): { camera2d: Camera };
  renderStats(): Stats | undefined;
  renderPixels(x: number, y: number, width: number, height: number): Uint8Array | undefined;
  dispatch(command: unknown): unknown;
}

/** The renderer's account of itself, reached through the viewer; `undefined` while there is no renderer. */
export function stats(page: Page): Promise<Stats | undefined> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    return viewer.renderStats();
  });
}

/** Waits until a frame has been drawn, and says how the renderer is. */
export async function drawn(page: Page): Promise<Stats> {
  await expect.poll(async () => (await stats(page))?.frames ?? 0).toBeGreaterThan(0);
  const now = await stats(page);
  if (now === undefined) {
    throw new Error('There is no renderer.');
  }
  return now;
}

/** Loads a file, which gives the scene its first layer, and so the viewer its renderer; waits for the first frame. */
export async function withData(page: Page): Promise<Stats> {
  await importAndLoad(page, 'points.csv', 'points.prj');
  return drawn(page);
}

/** Draws a frame now and reads back a rectangle of the buffer (from the bottom left, as the card has it): bytes of r, g, b, a. */
export function pixels(
  page: Page,
  rectangle: readonly [x: number, y: number, width: number, height: number],
): Promise<number[]> {
  return page.evaluate(([x, y, width, height]) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    const read = viewer.renderPixels(x, y, width, height);
    if (read === undefined) {
      throw new Error('There is no renderer.');
    }
    return [...read];
  }, rectangle);
}

/** Gives the scene a command, as the controls of the viewer do. */
export function dispatch(page: Page, ...commands: readonly unknown[]): Promise<void> {
  return page.evaluate((list) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    for (const command of list) {
      viewer.dispatch(command);
    }
  }, commands);
}

/** Lets a number of milliseconds pass in the page. */
export const pause = (page: Page, ms: number): Promise<void> =>
  page.evaluate((time) => new Promise<void>((resolve) => setTimeout(resolve, time)), ms);

/** The 2D camera of the scene as it is now. */
export function camera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    const { centre, unitsPerPixel, heading } = viewer.scene().camera2d;
    return { centre: [centre[0], centre[1]] as const, unitsPerPixel, heading };
  });
}
