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
  readonly layers: number;
  readonly layersDrawn: number;
  readonly maxTextureSize: number;
  readonly background: string;
  readonly viewMode: '2d' | '3d';
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
  readonly perspective: {
    readonly fov: number;
    readonly aspect: number;
    readonly near: number;
    readonly far: number;
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly up: readonly [0, 0, 1];
  } | null;
}

/** The 2D camera of the scene. */
export interface Camera {
  readonly centre: readonly [number, number];
  readonly unitsPerPixel: number;
  readonly heading: number;
}

/** The 3D camera of the scene. */
export interface Camera3d {
  readonly target: readonly [number, number, number];
  readonly distance: number;
  readonly heading: number;
  readonly elevation: number;
  readonly fov: number;
}

/** The frame of the scene: the map's coordinate system, the origin the card's positions are relative to, and who chose it. */
export interface SceneFrame {
  readonly mapCrs: { readonly kind: string; readonly code?: number; readonly units?: string };
  readonly origin: readonly [number, number, number];
  readonly source: string;
}

/** The part of the scene that the tests of the switch between views listen for. */
interface ViewerElementScene {
  readonly viewMode: '2d' | '3d';
  readonly camera2d: Camera;
  readonly camera3d: Camera3d;
}

/** The viewer of the page, in what the tests use of it. */
interface ViewerElement {
  setViewMode(mode: '2d' | '3d'): void;
  subscribeToScene(listener: (scene: ViewerElementScene) => void): () => void;
  scene(): {
    viewMode: '2d' | '3d';
    camera2d: Camera;
    camera3d: Camera3d;
    frame: SceneFrame | null;
    layers: Record<string, { style: { colour: { mode: string; value?: string } } }>;
  };
  layerStates(): [string, { status: string; fraction?: number; message?: string }][];
  renderStats(): Stats | undefined;
  renderPixels(x: number, y: number, width: number, height: number): Uint8Array | undefined;
  dispatch(command: unknown): unknown;
  load(input: unknown): Promise<{ status: string }>;
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

/**
 * Loads a file, which gives the scene its first layer, and so the viewer its renderer and its pipeline; waits for the first frame, for
 * the layer to be prepared, and for the camera to be fitted to it (the pipeline's first view), so that nothing changes after.
 */
export async function withData(page: Page): Promise<Stats> {
  await importAndLoad(page, 'points.csv', 'points.prj');
  await drawn(page);
  await expect
    .poll(async () => {
      const states = await layerStatuses(page);
      return states.length > 0 && states.every(([, status]) => status !== 'preparing');
    })
    .toBe(true);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
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

/** Shows the map in 2D or in 3D, as the toolbar's control does (the viewer's `setViewMode`). */
export function setViewMode(page: Page, mode: '2d' | '3d'): Promise<void> {
  return page.evaluate((view) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    viewer.setViewMode(view);
  }, mode);
}

/** What the scene's view was after one change of it. */
export interface ViewRecord {
  readonly viewMode: string;
  readonly centre2d: readonly number[];
  readonly heading2d: number;
  readonly target3d: readonly number[];
  readonly heading3d: number;
}

/**
 * Asks the viewer for each of `modes` in turn while recording what the scene was after each change it made (the view mode and where the 3D
 * camera looks), so that the order of the changes is seen.
 */
export function recordingViewChanges(
  page: Page,
  modes: readonly ('2d' | '3d')[],
): Promise<ViewRecord[]> {
  return page.evaluate((asked) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    const records: ViewRecord[] = [];
    const stop = viewer.subscribeToScene((scene) => {
      records.push({
        viewMode: scene.viewMode,
        centre2d: [...scene.camera2d.centre],
        heading2d: scene.camera2d.heading,
        target3d: [...scene.camera3d.target],
        heading3d: scene.camera3d.heading,
      });
    });
    for (const mode of asked) {
      viewer.setViewMode(mode);
    }
    stop();
    return records;
  }, modes);
}

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

/** The 3D camera of the scene as it is now. */
export function camera3d(page: Page): Promise<Camera3d> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    const { target, distance, heading, elevation, fov } = viewer.scene().camera3d;
    return { target: [target[0], target[1], target[2]], distance, heading, elevation, fov };
  });
}

/** The frame of the scene as it is now: `null` until the engine has chosen one. */
export function sceneFrame(page: Page): Promise<SceneFrame | null> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    const frame = viewer.scene().frame;
    return frame === null
      ? null
      : {
          mapCrs: { ...frame.mapCrs },
          origin: [...frame.origin] as [number, number, number],
          source: frame.source,
        };
  });
}

/** Where each layer is, as the pipeline says: `[layer id, status]` in the order of the layers. */
export function layerStatuses(page: Page): Promise<[string, string][]> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    return viewer.layerStates().map(([id, state]): [string, string] => [id, state.status]);
  });
}

/** Waits until the map has `count` layers and every one is drawn, as the pipeline says (the map is told, not only the placeholder gone). */
export async function expectLayersDrawn(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await layerStatuses(page)).map(([, status]) => status))
    .toEqual(Array.from({ length: count }, () => 'drawn'));
}

/** The colour of the first layer of the scene, `#rrggbb`: the one its points are drawn in. */
export function layerColour(page: Page, id = 'layer-1'): Promise<string> {
  return page.evaluate((layerId) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    const colour = viewer.scene().layers[layerId]?.style.colour;
    return colour?.value ?? '';
  }, id);
}

/** `#rrggbb` as `[r, g, b]` bytes. */
export function bytes(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** A square of the buffer, read back: `at(dx, dy)` is the pixel `dx` right and `dy` up of its middle. */
export interface Block {
  readonly half: number;
  at(dx: number, dy: number): [number, number, number, number];
  /** Every pixel of the block, as `[dx, dy, [r, g, b, a]]`. */
  all(): [number, number, [number, number, number, number]][];
}

/** Reads the `2 * half + 1` pixels square whose middle is the pixel `(x, y)` of the buffer (from the bottom left). */
export async function around(page: Page, x: number, y: number, half: number): Promise<Block> {
  const side = 2 * half + 1;
  const flat = await pixels(page, [x - half, y - half, side, side]);
  const at = (dx: number, dy: number): [number, number, number, number] => {
    const at4 = ((dy + half) * side + (dx + half)) * 4;
    return [flat[at4] ?? -1, flat[at4 + 1] ?? -1, flat[at4 + 2] ?? -1, flat[at4 + 3] ?? -1];
  };
  return {
    half,
    at,
    all: () =>
      Array.from(
        { length: side * side },
        (_, i): [number, number, [number, number, number, number]] => {
          const [dx, dy] = [(i % side) - half, Math.floor(i / side) - half];
          return [dx, dy, at(dx, dy)];
        },
      ),
  };
}

/** How far the pixel is from a colour, as the largest difference of a channel. */
export function distance(pixel: readonly number[], colour: readonly number[]): number {
  if (colour.length === 0) {
    // The largest of no differences is minus infinity, which is within any tolerance: a test that compared with nothing could not fail.
    throw new Error('There is no colour to compare the pixel with.');
  }
  return Math.max(...colour.map((channel, i) => Math.abs((pixel[i] ?? 0) - channel)));
}

/** The colour the map shows where nothing is drawn: the background of the canvas, as the 4 bytes of a pixel. */
export async function mapColour(page: Page): Promise<number[]> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const text = getComputedStyle(element).backgroundColor;
    return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
  });
}

/** The box (in pixels from the middle of the block) of the pixels that are not the background, and how many there are. */
export function marked(block: Block, background: readonly number[], tolerance = 8) {
  const inside = block.all().filter(([, , pixel]) => distance(pixel, background) > tolerance);
  const xs = inside.map(([dx]) => dx);
  const ys = inside.map(([, dy]) => dy);
  return {
    count: inside.length,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** A lattice (a grid or a block model) to load: where it is, how big its cells are, how many, how it is turned, and the values of its cells. */
export interface LatticeSpec {
  readonly name: string;
  readonly crs:
    | { readonly kind: 'epsg'; readonly code: number }
    | { readonly kind: 'local'; readonly units: 'm' | 'ft' | 'us_ft' };
  readonly origin: readonly [number, number, number];
  readonly spacing: readonly [number, number, number];
  readonly dims: readonly [number, number, number];
  /** For a grid: the height of its plane in map units (a lattice's own origin has no height that a flat grid takes); 0 if not given. */
  readonly elevation?: number;
  /**
   * For a grid: the height of each cell, in the same order as `values` (a NaN is a cell with no height). The grid is then a surface, through the
   * heights at the middles of the cells, instead of a flat image.
   */
  readonly heights?: readonly number[];
  /** Degrees anticlockwise about the origin. No file or step of the wizard gives one: the viewer's `load` is the way. */
  readonly rotation?: number;
  /** One value for each cell, X fastest, then Y, then Z. */
  readonly values: readonly number[];
}

/**
 * Loads a grid or a block model that is made in the page, with the viewer's `load` (the first part of its API), as a script that embeds the
 * viewer would. The arrays are made in the page, since a typed array does not cross from the test as one. Resolves with what the engine says.
 */
export function loadLattice(
  page: Page,
  kind: 'grid' | 'blocks',
  spec: LatticeSpec,
): Promise<{ status: string }> {
  return page.evaluate(
    ([which, lattice]) => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
      return viewer.load({
        kind: which,
        name: lattice.name,
        crs: lattice.crs,
        origin: lattice.origin,
        spacing: lattice.spacing,
        dims: lattice.dims,
        ...(lattice.rotation === undefined ? {} : { rotation: lattice.rotation }),
        ...(lattice.elevation === undefined ? {} : { elevation: lattice.elevation }),
        ...(lattice.heights === undefined ? {} : { elevationColumn: 'height' }),
        columns: [
          { name: 'value', type: 'float', values: new Float64Array(lattice.values) },
          ...(lattice.heights === undefined
            ? []
            : [{ name: 'height', type: 'float', values: new Float64Array(lattice.heights) }]),
        ],
      });
    },
    [kind, spec] as const,
  );
}
