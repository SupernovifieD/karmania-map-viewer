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

/** What a test asks of a composed picture (the whole page: the map, its line, the furniture and the legend). */
export interface PictureRequest {
  readonly width: number;
  readonly height: number;
  readonly dpi?: number;
  readonly legend?: boolean;
}

/** What came of it: the layout rectangles and the scale bar, as the page has them. */
export type PictureOutcome =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      readonly layout: {
        readonly map: Box;
        readonly northArrow: Box;
        readonly scaleBar: Box | null;
        readonly legend: Box | null;
        readonly columns: readonly Box[];
        /** Every line of the legend, in the order it is drawn, with its rectangle. */
        readonly lines: readonly {
          readonly kind: string;
          readonly text: string;
          readonly rect: Box;
        }[];
        readonly warnings: readonly string[];
      };
      readonly inner: Box;
      readonly scaleBarLabel: string | null;
    }
  | {
      readonly ok: false;
      readonly name: string;
      readonly code: string | null;
      readonly message: string;
    };

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Puts a picture together through the viewer, and keeps its canvas in the page (see `pictureRegion`, `pictureNotWhite`, `pictureAgainstScreen`). */
export function composePicture(page: Page, request: PictureRequest): Promise<PictureOutcome> {
  return page.evaluate(async (req) => {
    interface Viewer {
      composePicture(options: {
        size: { width: number; height: number };
        dpi: number;
        legend: boolean;
      }): Promise<{
        canvas: HTMLCanvasElement;
        layout: PictureOutcomeLayout;
        map: Box;
        scaleBar: { kind: string; label?: string };
      }>;
    }
    type Box = { x: number; y: number; width: number; height: number };
    type Line =
      | { kind: 'group'; name: string }
      | { kind: 'layer'; name: string }
      | { kind: 'class'; entry: { label: string } };
    type PictureOutcomeLayout = {
      map: Box;
      northArrow: Box;
      scaleBar: Box | null;
      legend: Box | null;
      columns: { rect: Box; lines: { line: Line; rect: Box }[] }[];
      warnings: string[];
    };
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as Viewer | null;
    if (viewer === null) {
      return { ok: false, name: 'Error', code: null, message: 'There is no viewer.' } as const;
    }
    try {
      const composed = await viewer.composePicture({
        size: { width: req.width, height: req.height },
        dpi: req.dpi ?? 96,
        legend: req.legend ?? true,
      });
      (window as unknown as { __composed: HTMLCanvasElement }).__composed = composed.canvas;
      const layout = composed.layout;
      return {
        ok: true,
        width: composed.canvas.width,
        height: composed.canvas.height,
        layout: {
          map: layout.map,
          northArrow: layout.northArrow,
          scaleBar: layout.scaleBar,
          legend: layout.legend,
          columns: layout.columns.map((c) => c.rect),
          lines: layout.columns.flatMap((c) =>
            c.lines.map((l) => ({
              kind: l.line.kind,
              text: l.line.kind === 'class' ? l.line.entry.label : l.line.name,
              rect: l.rect,
            })),
          ),
          warnings: layout.warnings,
        },
        inner: composed.map,
        scaleBarLabel: composed.scaleBar.kind === 'bar' ? (composed.scaleBar.label ?? null) : null,
      } as const;
    } catch (error) {
      const e = error as { name?: string; code?: string; message?: string };
      return {
        ok: false,
        name: e.name ?? 'Error',
        code: e.code ?? null,
        message: e.message ?? '',
      } as const;
    }
  }, request);
}

/** The bytes of a small region of the composed picture, rows from the top, four bytes a pixel. */
export function pictureRegion(page: Page, box: Box): Promise<number[]> {
  return page.evaluate((b) => {
    const canvas = (window as unknown as { __composed?: HTMLCanvasElement }).__composed;
    const ctx = canvas?.getContext('2d');
    if (canvas === undefined || ctx === null || ctx === undefined) {
      throw new Error('There is no composed picture.');
    }
    return [...ctx.getImageData(b.x, b.y, b.width, b.height).data];
  }, box);
}

/**
 * The box of the pixels of a region of the composed picture that are not white (to within `tolerance` in a channel), or null if there are none: where something is drawn.
 */
export function pictureNotWhite(
  page: Page,
  region: Box,
  tolerance = 8,
): Promise<{ minX: number; maxX: number; minY: number; maxY: number; count: number } | null> {
  return page.evaluate(
    ([r, within]) => {
      const canvas = (window as unknown as { __composed?: HTMLCanvasElement }).__composed;
      const ctx = canvas?.getContext('2d');
      if (canvas === undefined || ctx === null || ctx === undefined) {
        throw new Error('There is no composed picture.');
      }
      const data = ctx.getImageData(r.x, r.y, r.width, r.height).data;
      let [count, minX, maxX, minY, maxY] = [0, Infinity, -Infinity, Infinity, -Infinity];
      for (let y = 0; y < r.height; y += 1) {
        for (let x = 0; x < r.width; x += 1) {
          const at = (y * r.width + x) * 4;
          const away = Math.max(
            255 - (data[at] ?? 0),
            255 - (data[at + 1] ?? 0),
            255 - (data[at + 2] ?? 0),
          );
          if (away > within) {
            count += 1;
            minX = Math.min(minX, r.x + x);
            maxX = Math.max(maxX, r.x + x);
            minY = Math.min(minY, r.y + y);
            maxY = Math.max(maxY, r.y + y);
          }
        }
      }
      return count === 0 ? null : { minX, maxX, minY, maxY, count };
    },
    [region, tolerance] as const,
  );
}

/**
 * How many pixels of the composed picture, in a rectangle that starts at `(x, y)` and is the size of the screen's buffer, are not what the screen shows. The picture has its
 * rows from the top and the screen from the bottom.
 */
export function pictureAgainstScreen(
  page: Page,
  at: { x: number; y: number },
  except: readonly Box[] = [],
): Promise<{ differences: number; first: number[] | null }> {
  return page.evaluate(
    ([origin, skip]) => {
      const canvas = (window as unknown as { __composed?: HTMLCanvasElement }).__composed;
      const ctx = canvas?.getContext('2d');
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        renderStats(): { width: number; height: number } | undefined;
        renderPixels(x: number, y: number, w: number, h: number): Uint8Array | undefined;
      } | null;
      const stats = viewer?.renderStats();
      if (canvas === undefined || ctx === null || ctx === undefined || stats === undefined) {
        throw new Error('There is nothing to compare.');
      }
      const screen = viewer?.renderPixels(0, 0, stats.width, stats.height);
      if (screen === undefined) {
        throw new Error('There is no screen to read.');
      }
      const mine = ctx.getImageData(origin.x, origin.y, stats.width, stats.height).data;
      let differences = 0;
      let first: number[] | null = null;
      for (let y = 0; y < stats.height; y += 1) {
        for (let x = 0; x < stats.width; x += 1) {
          // What the picture draws over its map and is not in the screen's canvas (its furniture is DOM there) is not compared.
          const px = origin.x + x;
          const py = origin.y + y;
          if (
            skip.some((b) => px >= b.x && px < b.x + b.width && py >= b.y && py < b.y + b.height)
          ) {
            continue;
          }
          const a = (y * stats.width + x) * 4;
          const b = ((stats.height - 1 - y) * stats.width + x) * 4;
          let same = true;
          for (let k = 0; k < 4; k += 1) {
            same = same && mine[a + k] === screen[b + k];
          }
          if (!same) {
            differences += 1;
            first ??= [x, y, ...mine.subarray(a, a + 4), ...screen.subarray(b, b + 4)];
          }
        }
      }
      return { differences, first };
    },
    [at, except] as const,
  );
}
