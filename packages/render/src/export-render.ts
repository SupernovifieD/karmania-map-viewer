/**
 * Drawing the map for an export (step 22.1c): the layers that are on the card already are drawn again, into a target of the size of the map in the picture, with cameras
 * of the export's and the sizes of the screen scaled by `dpi / 96`, in the light theme, with no outline of a selection, and the picture is read off the card in bands
 * (`export-bands.ts`). It does not touch what is on the screen: the live frame and the picking are as they were. What it is built on (the findings of the design review of
 * the export, each tested):
 *
 * - **the live context and layers are used**, not a second renderer: a second one would put every layer on the card again and link every program again;
 * - **what is shared is told again at the start of every slice of drawing** (`prepare`: the sizes in pixels, the viewport and the light are uniforms of the layers, which a
 *   frame or a pick of the screen that comes between two awaits would change), and the target is bound only within a slice that has no await in it;
 * - **its own cameras**: the screen's are never changed, so a resize or a gesture meanwhile does not move the export;
 * - **the programs are made with the target bound**: three keys its programs by the colour space of what is drawn on, so a target needs its own, and making them in a frame
 *   is a task of about 50 ms for each; they are made together and waited for;
 * - **the map's colour is written as it is**: a target is cleared in the working (linear) colour space, so the colour is made in that space from the bytes, and not from sRGB;
 * - **a change of the layers while it works makes it stop** (`interrupted`), and not a picture that is half of one thing and half of another.
 *
 * The renderer gives this a host, which is what it needs of the renderer and nothing else, so that the order of things here is tested without a card.
 */
import {
  Color,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three';
import type { Camera, Scene } from 'three';
import type { BBox } from '@karmania/engine/types';
import type { Camera2d, Camera3d, ViewMode } from '@karmania/scene';
import { orthographicFrame } from './camera-2d.js';
import type { DepthRange } from './camera-2d.js';
import { perspectiveFrame } from './camera-3d.js';
import { applyOrthographic, applyPerspective } from './camera-apply.js';
import { readBands } from './export-bands.js';
import type { TakeBand } from './export-bands.js';
import { frameLight } from './light.js';
import type { FrameInfo } from './look.js';

/** Why an export did not come to an end: what a person is told is from the code (an abort is the signal's own reason, not one of these). */
export type ExportErrorCode =
  /** Another export is being made. */
  | 'busy'
  /** The layers or the view changed while it was being made, so what is drawn is not what was asked for. */
  | 'interrupted'
  /** The graphics card took the map away while it was being made. */
  | 'context_lost'
  /** The map was taken out of the page. */
  | 'disposed'
  /** The map was still being put on the card, or the card did not give the picture. */
  | 'not_ready'
  /** The picture is larger than the card draws. */
  | 'too_large'
  /** A point of the map, at the size of the picture, is larger than the card draws a point. */
  | 'point_size'
  /** The card has not the memory for a picture of this size. */
  | 'out_of_memory';

/** What goes wrong with an export that is not a mistake of the caller. */
export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

/** Three numbers from 0 to 255: a colour as bytes. */
export type Bytes = readonly [number, number, number];

/** What an export is asked for. */
export interface ExportRenderOptions {
  /** The size of the map in the picture, in pixels: whole numbers. */
  readonly width: number;
  readonly height: number;
  /** `dpi / 96`: what the sizes of the screen (a point, a line, an outline) are multiplied by. */
  readonly scale: number;
  /** The view that is drawn: the one that the map is in, which is asked so that a view that changed since the cameras were made is found out. */
  readonly viewMode: ViewMode;
  /** The cameras of the export (the scene's `exportCamera2d` and `exportCamera3d`): the one of `viewMode` is used. */
  readonly camera2d: Camera2d;
  readonly camera3d: Camera3d;
  /** What the map is cleared to, and the colour of outlines: the light theme's, whatever the page's theme is. */
  readonly background: Bytes;
  readonly ink: Bytes;
  /** Takes the picture a band at a time, from its top row (see `readBands`). */
  readonly onBand: TakeBand;
  /** How many rows are read off the card at a time: about four megabytes if it is not given. A knob for tests, which read a small picture in many bands; the picture is the same whatever it is. */
  readonly bandRows?: number;
  /** Stops the export between two steps; it then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Called as the export goes, with the part that is done, from 0 to 1 (counted in steps, never in time). */
  readonly onProgress?: (done: number) => void;
}

/** What an export says when it is done. */
export interface ExportRendered {
  /** The view that was drawn. */
  readonly viewMode: ViewMode;
}

/** What the card allows, in pixels: the most that a side of a renderbuffer, a texture and a viewport is, and that a point is. */
export interface ExportLimits {
  readonly renderbuffer: number;
  readonly texture: number;
  readonly viewport: number;
  readonly pointSize: number;
}

/** What the export draws with: the part of three that it uses (the renderer is one). */
export interface ExportGl {
  setRenderTarget(target: WebGLRenderTarget | null): void;
  compileAsync(scene: Scene, camera: Camera): Promise<unknown>;
  render(scene: Scene, camera: Camera): void;
  clear(): void;
  clearDepth(): void;
  setClearColor(color: Color, alpha?: number): void;
}

/** What the map is looking at, as the renderer has it now. */
export interface ExportView {
  readonly viewMode: ViewMode;
  readonly origin: readonly [number, number, number];
  readonly extent: BBox | null;
  readonly depth: DepthRange;
  readonly verticalExaggeration: number;
}

/** What the export needs of the renderer. */
export interface ExportHost {
  readonly gl: ExportGl;
  view(): ExportView;
  /** The scenes of the layers, from the one drawn first. */
  layers(): readonly { readonly id: string; readonly scene: Scene }[];
  /** Puts a layer where the view says it is for the draw (the place in the legend, in 3D). */
  place(id: string, scene: Scene, rank: number): void;
  /** Tells every layer what is true of the frame that is about to be drawn. */
  prepare(info: FrameInfo): void;
  /** Waits until every layer is built, and on the card with its programs made for the screen; rejects with an `ExportError` if it does not come to that. */
  settle(signal?: AbortSignal): Promise<void>;
  /** A number that is one more each time the layers or the view are changed. */
  revision(): number;
  status(): 'ok' | 'lost' | 'disposed';
  limits(): ExportLimits;
  /** The largest point of a layer of points that is drawn, in CSS pixels; 0 if there is none. */
  largestPoint(): number;
  /** The next error of the card (as `getError` says it), 0 if there is none. */
  error(): number;
  /** Reads `rows` rows of the target, `y` up from its bottom, into `into` (see `ReadRows`). */
  read(target: WebGLRenderTarget, y: number, rows: number, into: Uint8Array): Promise<void>;
  /** Gives the page a turn. */
  yieldTask(): Promise<void>;
  /**
   * Called with no target bound, after each slice of drawing and at the end: the export has used the card's clear colour for its own (three writes it again for the bound target on
   * every render), so the screen is to set its own again from the page's colour when it next draws (no frame is asked for). It is *not* put back from a colour saved at the
   * start: a theme that changed meanwhile would be put back to the old one, and the screen would be cleared to it for good.
   */
  restoreScreen(): void;
}

/** What `getError` says when the card has not the memory. */
export const GL_OUT_OF_MEMORY = 0x0505;
/** How much of the whole export is made by the time the programs are made, and by the time the layers are drawn: the rest is the reading. */
const DONE_COMPILING = 0.05;
const DONE_DRAWING = 0.5;
/** How many errors of the card are looked at after the drawing: the card keeps one of each kind. */
const ERRORS_LOOKED_AT = 8;

/** The size and the scale are numbers that make a picture, or the caller has made a mistake. */
function checkOptions(options: ExportRenderOptions): void {
  const { width, height, scale } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('The picture has to be whole pixels, at least one each way.');
  }
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new RangeError('The scale is not a positive number.');
  }
}

/** How many turns of the page an export gives the screen's drawing to finish what it has begun (the layers built, the programs made) before it says it is not ready. */
export const MAX_SETTLE_TURNS = 3000;

/** What waiting for the layers needs of the renderer. */
export interface SettleHost {
  /** Whether there is nothing to draw on (the renderer is disposed of, or the card has the context away): the wait ends, and the export says why when it asks. */
  unusable(): boolean;
  /** Whether every layer is built and has its programs made. */
  ready(): boolean;
  /** Does what the screen's frame would do to go on building (a part of each layer put on the card, the programs of each made off the page's thread). */
  step(): void;
  /** Gives the page a turn. */
  nextTask(): Promise<void>;
}

/**
 * Lets the screen's drawing finish what it has begun, a frame at a time as it would (a million points are not put on the card in one task by an export), until the layers are built.
 * Nothing is waited for by the clock: it is a number of turns, after which it says it is not ready. It stops at once when aborted (with the signal's reason), and returns when the
 * renderer is unusable (the export finds out why).
 */
export async function settleUntilReady(
  host: SettleHost,
  signal?: AbortSignal,
  maxTurns = MAX_SETTLE_TURNS,
): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    signal?.throwIfAborted();
    if (host.unusable() || host.ready()) {
      return;
    }
    host.step();
    await host.nextTask();
  }
  signal?.throwIfAborted();
  throw new ExportError('not_ready', 'The map is still being put on the graphics card.');
}

/**
 * Waits until the programs are made, and stops (by what `stop` throws) as soon as the export cannot go on. Three's own wait asks the card, every 10 ms, whether each program is
 * ready, and a card that has lost its context says no for ever: waiting for it alone would leave the export, and its guard against a second one, hanging after the map was taken away.
 * The check costs a turn of the page and nothing else, and it is not a time limit: a program that the card is still making is waited for as long as it takes.
 */
export async function untilMade(
  compiling: readonly Promise<unknown>[],
  host: { yieldTask(): Promise<void> },
  stop: () => void,
): Promise<void> {
  let made = false;
  // (Read through a function: the promise sets it during an await, which the checker's narrowing cannot see.)
  const isMade = (): boolean => made;
  const all = Promise.allSettled(compiling).then(() => {
    made = true;
  });
  while (!isMade()) {
    stop();
    await Promise.race([all, host.yieldTask()]);
  }
}

/** What the card says of its limits, as `getParameter` gives them: the numbers of each, which may be missing or not numbers. */
export interface CardParameters {
  readonly renderbuffer: unknown;
  readonly texture: unknown;
  /** `MAX_VIEWPORT_DIMS`: two numbers, the widest and the highest viewport. */
  readonly viewport: unknown;
  /** `ALIASED_POINT_SIZE_RANGE`: two numbers, the least and the largest point. */
  readonly pointRange: unknown;
}

/**
 * The limits that an export is held to, from what the card says. The viewport's is the **least of its two numbers** (a card may allow a different width and height, and the picture's
 * longest side may be either); a number that is missing or is not above 0 is `fallback` (and 1 for the point range, which is then no point larger than the card's smallest).
 */
export function limitsOf(card: CardParameters, fallback: number): ExportLimits {
  const number = (value: unknown, otherwise: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : otherwise;
  const pair = (value: unknown, at: number, otherwise: number): number =>
    value instanceof Int32Array || value instanceof Float32Array
      ? number(value[at], otherwise)
      : otherwise;
  return {
    renderbuffer: number(card.renderbuffer, fallback),
    texture: number(card.texture, fallback),
    viewport: Math.min(pair(card.viewport, 0, fallback), pair(card.viewport, 1, fallback)),
    pointSize: pair(card.pointRange, 1, 1),
  };
}

/** The export of a host: one function that draws the map into a picture and gives it, band by band, to the caller. Two at a time are refused. */
export function createExporter(
  host: ExportHost,
): (options: ExportRenderOptions) => Promise<ExportRendered> {
  let running = false;

  return async (options) => {
    checkOptions(options);
    if (running) {
      throw new ExportError('busy', 'A picture of the map is being made already.');
    }
    running = true;
    try {
      return await run(host, options);
    } finally {
      running = false;
    }
  };
}

async function run(host: ExportHost, options: ExportRenderOptions): Promise<ExportRendered> {
  const { width, height, scale, signal, onProgress } = options;
  const { gl } = host;
  let revision = 0;

  /** Stops the export if it cannot go on: the map is gone or away, it was told to stop, or (before the picture is drawn) what it draws has changed. */
  function guard(layersToo: boolean): void {
    const status = host.status();
    if (status === 'disposed') {
      throw new ExportError('disposed', 'The map was taken out of the page.');
    }
    if (status === 'lost') {
      throw new ExportError('context_lost', 'The graphics card took the map away.');
    }
    signal?.throwIfAborted();
    if (layersToo && host.revision() !== revision) {
      throw new ExportError('interrupted', 'The map changed while the picture was made.');
    }
  }

  // What cannot be done is said before anything is touched.
  guard(false);
  const limits = host.limits();
  if (
    width > Math.min(limits.renderbuffer, limits.texture, limits.viewport) ||
    height > Math.min(limits.renderbuffer, limits.texture, limits.viewport)
  ) {
    throw new ExportError('too_large', 'The picture is larger than the graphics card can draw.');
  }
  if (host.largestPoint() * scale + 1 > limits.pointSize) {
    throw new ExportError(
      'point_size',
      'A point of the map would be larger than the graphics card can draw at this size.',
    );
  }
  // What is drawn has to be what the caller saw when it asked (the cameras and the legend it made the plan from): the revision is taken before the wait for the layers, so a change
  // during it is a change of what is drawn.
  revision = host.revision();
  await host.settle(signal);
  guard(true);
  const view = host.view();
  if (view.viewMode !== options.viewMode) {
    throw new ExportError('interrupted', 'The view of the map changed while the picture was made.');
  }

  // The cameras are the export's own, made here and never given to the screen.
  const flat = view.viewMode === '2d';
  let camera: Camera;
  let light: readonly [number, number, number];
  if (flat) {
    const own = new OrthographicCamera(-1, 1, 1, -1, 0.25, 100);
    applyOrthographic(
      own,
      orthographicFrame(
        options.camera2d,
        view.origin,
        { width: width / scale, height: height / scale },
        view.depth,
      ),
    );
    camera = own;
    light = frameLight(true, own.matrixWorldInverse.elements);
  } else {
    const own = new PerspectiveCamera(45, 1, 0.25, 100);
    applyPerspective(
      own,
      perspectiveFrame(
        options.camera3d,
        view.origin,
        { width, height },
        view.extent,
        view.verticalExaggeration,
      ),
    );
    camera = own;
    light = frameLight(false, own.matrixWorldInverse.elements);
  }
  const [ink0, ink1, ink2] = options.ink;
  const info: FrameInfo = {
    pixelRatio: scale,
    viewport: [width, height],
    flat,
    light,
    outline: [ink0 / 255, ink1 / 255, ink2 / 255],
  };
  // In the working colour space of three, from the bytes: a target is cleared in that space, and the layers' own colours are written as they are.
  const [back0, back1, back2] = options.background;
  const clear = new Color().setRGB(back0 / 255, back1 / 255, back2 / 255);
  const layers = host.layers();

  const target = new WebGLRenderTarget(width, height, {
    type: UnsignedByteType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
  });
  /** One piece of drawing, with no await in it: what the layers are told is true for all of it, and the target is bound only for it. */
  const slice = (draw: () => void): void => {
    host.prepare(info);
    gl.setRenderTarget(target);
    try {
      draw();
    } finally {
      gl.setRenderTarget(null);
      host.restoreScreen();
    }
  };

  try {
    // The programs, made with the target bound and together, and waited for.
    host.prepare(info);
    const compiling: Promise<unknown>[] = [];
    for (const { scene } of layers) {
      gl.setRenderTarget(target);
      try {
        compiling.push(gl.compileAsync(scene, camera));
      } finally {
        gl.setRenderTarget(null);
      }
    }
    host.restoreScreen();
    // (A program that cannot be made is the card's to say, in the drawing; it does not stop the picture here.)
    await untilMade(compiling, host, () => {
      guard(false);
    });
    guard(true);
    onProgress?.(DONE_COMPILING);

    // The map's colour is set while the target is bound: three writes a clear colour for the target that is bound when it is set (the working colour space for a
    // target, sRGB for the screen), so this is the colour as it is. (The screen's own is put back at the very end, below.)
    slice(() => {
      gl.setClearColor(clear, 1);
      gl.clear();
    });
    for (const [rank, { id, scene }] of layers.entries()) {
      guard(true);
      slice(() => {
        host.place(id, scene, rank);
        if (flat) {
          gl.clearDepth();
        }
        gl.render(scene, camera);
      });
      onProgress?.(DONE_COMPILING + ((DONE_DRAWING - DONE_COMPILING) * (rank + 1)) / layers.length);
      await host.yieldTask();
    }
    guard(true);
    for (let looked = 0; looked < ERRORS_LOOKED_AT; looked += 1) {
      const code = host.error();
      if (code === 0) {
        break;
      }
      if (code === GL_OUT_OF_MEMORY) {
        throw new ExportError(
          'out_of_memory',
          'The graphics card has not the memory for a picture this large.',
        );
      }
    }

    // What is drawn is in the target and final: from here a change of the layers does not matter, only the card and the signal.
    await readBands({
      width,
      height,
      onBand: options.onBand,
      ...(options.bandRows === undefined ? {} : { rows: options.bandRows }),
      ...(signal === undefined ? {} : { signal }),
      onProgress: (done) => onProgress?.(DONE_DRAWING + (1 - DONE_DRAWING) * done),
      read: async (y, rows, into) => {
        guard(false);
        await host.read(target, y, rows, into);
        guard(false);
      },
    });
    return { viewMode: view.viewMode };
  } finally {
    host.restoreScreen();
    target.dispose();
  }
}
