/**
 * What the end-to-end tests of the export (step 22.1c) use: one call that draws the map again for a picture through the viewer (`renderExport`) and keeps the picture in
 * the page, and what can be asked of the picture there, so that a picture of millions of numbers does not travel between the page and the test.
 */
import type { Page } from '@playwright/test';

/** The light theme's colour of the map and of the text, as bytes: what an export is drawn with whatever the page's theme is. */
export const LIGHT_MAP = [233, 236, 240] as const;
export const LIGHT_INK = [26, 29, 33] as const;

/** What a test asks of an export. Everything not given is the screen's: its size in pixels, its pixel ratio, its cameras. */
export interface ExportRequest {
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
  /** Compares the picture with what the screen shows, which has to be of the same size, and counts the pixels that are not the same. */
  readonly compareWithScreen?: boolean;
  /**
   * Something that is done when the export has got as far as `done` (from 0 to 1): `abort` it, `restyle` a layer (which changes what is drawn), make the card
   * `lose` the context, or `interfere` as the screen does (a draw of the screen and a pick), which is done every time it says how far it is, from `done` on.
   */
  readonly at?: { readonly done: number; readonly do: 'abort' | 'restyle' | 'lose' | 'interfere' };
}

/** What came of it. */
export type ExportOutcome =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      readonly bands: number;
      /** How many pixels are not those of the screen, if it was compared; and where the first is. */
      readonly differences: number | null;
      readonly first: { x: number; y: number; picture: number[]; screen: number[] } | null;
    }
  | {
      readonly ok: false;
      readonly name: string;
      readonly code: string | null;
      readonly message: string;
    };

/** What the page keeps of the last picture. */
interface Held {
  width: number;
  height: number;
  /** Rows from the top, four bytes a pixel. */
  data: Uint8Array;
}

/** Draws the map again as a picture through the viewer, and keeps it in the page (for `pictureBox` and `pixelOfPicture`). */
export function exportPicture(page: Page, request: ExportRequest = {}): Promise<ExportOutcome> {
  return page.evaluate(
    async ([req, map, ink]) => {
      interface Camera {
        centre: [number, number];
        unitsPerPixel: number;
        heading: number;
      }
      interface Viewer {
        scene(): { viewMode: '2d' | '3d'; camera2d: Camera; camera3d: unknown };
        renderStats(): { width: number; height: number; pixelRatio: number } | undefined;
        renderExport(options: unknown): Promise<unknown>;
        renderPixels(x: number, y: number, w: number, h: number): Uint8Array | undefined;
        renderPick(x: number, y: number): Promise<unknown>;
        dispatch(command: unknown): unknown;
      }
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as Viewer | null;
      const stats = viewer?.renderStats();
      if (viewer === null || stats === undefined) {
        return { ok: false, name: 'Error', code: null, message: 'There is no renderer.' } as const;
      }
      const scene = viewer.scene();
      const width = req.width ?? stats.width;
      const height = req.height ?? stats.height;
      const controller = new AbortController();
      const picture = new Uint8Array(width * height * 4);
      let bands = 0;
      let did = false;
      const loseContext = (): void => {
        const canvas = document
          .querySelector('karmania-app')
          ?.shadowRoot?.querySelector('karmania-viewer')
          ?.shadowRoot?.querySelector('karmania-map-area')
          ?.shadowRoot?.querySelector('canvas');
        // A context that is lost does not hand out its extensions: the page keeps the one it got while the context was there, to give it back with.
        const extension = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
        (window as unknown as { __loseContext?: WEBGL_lose_context | null }).__loseContext =
          extension ?? null;
        extension?.loseContext();
      };
      try {
        await viewer.renderExport({
          width,
          height,
          scale: req.scale ?? stats.pixelRatio,
          viewMode: scene.viewMode,
          camera2d: scene.camera2d,
          camera3d: scene.camera3d,
          background: map,
          ink,
          signal: controller.signal,
          onBand: (rows: Uint8Array, first: number, count: number) => {
            bands += 1;
            picture.set(rows.subarray(0, count * width * 4), first * width * 4);
          },
          onProgress: (done: number) => {
            const at = req.at;
            if (at === undefined || done < at.done) {
              return;
            }
            if (at.do === 'interfere') {
              viewer.renderPixels(0, 0, 1, 1);
              void viewer.renderPick(10, 10);
            } else if (!did) {
              did = true;
              if (at.do === 'abort') {
                controller.abort(new DOMException('Stopped by the test', 'AbortError'));
              } else if (at.do === 'lose') {
                loseContext();
              } else {
                viewer.dispatch({
                  type: 'setStyle',
                  layerId: 'layer-1',
                  patch: { opacity: 0.5 },
                });
              }
            }
          },
        });
      } catch (error) {
        const e = error as { name?: string; code?: string; message?: string };
        return {
          ok: false,
          name: e.name ?? 'Error',
          code: e.code ?? null,
          message: e.message ?? '',
        } as const;
      }
      (window as unknown as { __picture: Held }).__picture = { width, height, data: picture };
      let differences: number | null = null;
      let first: { x: number; y: number; picture: number[]; screen: number[] } | null = null;
      if (req.compareWithScreen === true) {
        // The screen has its rows from the bottom; the picture from the top.
        const screen = viewer.renderPixels(0, 0, width, height);
        if (screen === undefined) {
          throw new Error('There is no renderer to compare with.');
        }
        differences = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const mine = (y * width + x) * 4;
            const theirs = ((height - 1 - y) * width + x) * 4;
            let same = true;
            for (let k = 0; k < 4; k += 1) {
              same = same && picture[mine + k] === screen[theirs + k];
            }
            if (!same) {
              differences += 1;
              first ??= {
                x,
                y,
                picture: [...picture.subarray(mine, mine + 4)],
                screen: [...screen.subarray(theirs, theirs + 4)],
              };
            }
          }
        }
      }
      return { ok: true, width, height, bands, differences, first } as const;
    },
    [request, [...LIGHT_MAP], [...LIGHT_INK]] as const,
  );
}

/** The box and the number of the pixels of the last picture that are not the colour `background` (to within `tolerance` in a channel). */
export function pictureBox(
  page: Page,
  background: readonly number[] = LIGHT_MAP,
  tolerance = 8,
): Promise<{ count: number; minX: number; maxX: number; minY: number; maxY: number }> {
  return page.evaluate(
    ([back, within]) => {
      const held = (window as unknown as { __picture?: Held }).__picture;
      if (held === undefined) {
        throw new Error('There is no picture.');
      }
      let [count, minX, maxX, minY, maxY] = [0, Infinity, -Infinity, Infinity, -Infinity];
      for (let y = 0; y < held.height; y += 1) {
        for (let x = 0; x < held.width; x += 1) {
          const at = (y * held.width + x) * 4;
          const away = Math.max(
            Math.abs((held.data[at] ?? 0) - (back[0] ?? 0)),
            Math.abs((held.data[at + 1] ?? 0) - (back[1] ?? 0)),
            Math.abs((held.data[at + 2] ?? 0) - (back[2] ?? 0)),
          );
          if (away > within) {
            count += 1;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      return { count, minX, maxX, minY, maxY };
    },
    [background, tolerance] as const,
  );
}

/** Gives the context back to the map, which `at: { do: 'lose' }` took away. */
export function restoreContext(page: Page): Promise<void> {
  return page.evaluate(() => {
    const held = (window as unknown as { __loseContext?: WEBGL_lose_context | null }).__loseContext;
    if (held === null || held === undefined) {
      throw new Error('No context was taken away.');
    }
    held.restoreContext();
  });
}

/** A number that says what the screen shows now (its whole buffer), so that two states of it are compared without the pixels travelling to the test. */
export function screenHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      renderStats(): { width: number; height: number } | undefined;
      renderPixels(x: number, y: number, w: number, h: number): Uint8Array | undefined;
    } | null;
    const stats = viewer?.renderStats();
    const read =
      stats === undefined ? undefined : viewer?.renderPixels(0, 0, stats.width, stats.height);
    if (read === undefined) {
      throw new Error('There is no renderer.');
    }
    // FNV-1a over the bytes.
    let hash = 0x811c9dc5;
    for (const byte of read) {
      hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    }
    return `${String(read.length)}:${hash.toString(16)}`;
  });
}
