/**
 * The renderer of the map: a WebGL2 context on a canvas that the page lays out, a drawing buffer that follows the size of
 * the canvas and the device pixel ratio, and a frame that is drawn only when something asks for one. three.js stays in
 * this package; what the viewer sees is the small interface below.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import type { BBox } from '@karmania/engine/types';
import type { Camera2d, Camera3d, VerticalExaggeration, ViewMode } from '@karmania/scene';
import {
  Color,
  OrthographicCamera,
  NearestFilter,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { bufferSize } from './buffer-size.js';
import { orthographicFrame } from './camera-2d.js';
import type { OrthographicFrame } from './camera-2d.js';
import { perspectiveFrame } from './camera-3d.js';
import type { PerspectiveFrame } from './camera-3d.js';
import { CompiledLayers } from './compiled-layers.js';
import { parseCssColour } from './css-colour.js';
import { makeLayer } from './layer-kinds.js';
import { LayerSet } from './layer-set.js';
import { frameLight } from './light.js';
import { createHighlight } from './highlight.js';
import type { Highlight } from './highlight.js';
import { MAX_PICK_LAYERS, decodePick, encodePick } from './pick.js';
import type { PickHit } from './pick.js';
import { tieBreak } from './tie-break.js';
import type { LayerOutcome } from './layer-set.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';

/** What the renderer says of itself, for tests and diagnostics. */
export interface RenderStats {
  /** Frames drawn since the renderer was made. */
  readonly frames: number;
  /** The drawing buffer, in device pixels. */
  readonly width: number;
  readonly height: number;
  /** The box of the canvas, in CSS pixels. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Device pixels to a CSS pixel in the buffer: the page's, or less where the card's limit was in the way. */
  readonly pixelRatio: number;
  /** Whether the graphics card has taken the context away (and not yet given it back). */
  readonly contextLost: boolean;
  /** How many geometries and textures are on the card, as three counts them. */
  readonly geometries: number;
  readonly textures: number;
  /** How many layers are on the card, how many of them the last frame drew (a layer is not drawn until its programs are compiled), and the largest texture the card takes, in cells on a side (a grid is cut to that, or to 4,096 if that is less). */
  readonly layers: number;
  readonly layersDrawn: number;
  readonly maxTextureSize: number;
  /** What the map is cleared to: `#rrggbb`, or `transparent` where the canvas has no opaque background. */
  readonly background: string;
  /** The box the orthographic camera of three shows now, where it is and how it is turned. */
  readonly frame: OrthographicFrame;
  /** Which camera draws, and the perspective frame when it is the 3D one. */
  readonly viewMode: ViewMode;
  readonly perspective: PerspectiveFrame | null;
}

/** The parts of the scene that determine the renderer's camera. */
export interface RendererView {
  readonly viewMode: ViewMode;
  readonly camera2d: Camera2d;
  readonly camera3d: Camera3d;
  readonly origin: readonly [number, number, number];
  readonly verticalExaggeration: VerticalExaggeration;
}

/** What a renderer is told of how it is to behave. */
export interface RendererOptions {
  /**
   * Called when the graphics card takes the context away (`true`) and when it gives it back (`false`). While it is away nothing is drawn;
   * when it is back the map is drawn again, from what the renderer holds.
   */
  readonly onContextLoss?: (lost: boolean) => void;
}

/** A renderer on a canvas. */
export interface Renderer {
  /** Asks for a frame: one is drawn soon, however many times this is called before it. After `dispose` it does nothing. */
  invalidate(): void;
  /** Gives both scene cameras to the renderer and says which one draws. */
  setView(view: RendererView): void;
  /** The absolute extent of the prepared data, for the clipping planes of the perspective camera. */
  setExtent(extent: BBox | null): void;
  /**
   * The heights that are drawn, relative to the origin: the camera is put above the highest and sees down to the lowest, so what is
   * outside them is not drawn. A frame is asked for if they changed.
   */
  setDepthRange(min: number, max: number): void;
  /**
   * Puts the layer of some buffers on the card, looking as `look` says, in place of the one of the same id; a big layer is built a part at a time over the
   * next frames. `unsupported` if buffers of that kind are not drawn: there is no layer then, and the old one is gone.
   */
  setLayer(id: string, buffers: RenderBuffers, look: LayerLook): LayerOutcome;
  /** Changes how a layer looks (colour, size, opacity, whether it is shown) without building it again. `false` if there is no such layer. */
  setLayerLook(id: string, look: LayerLook): boolean;
  /**
   * Colours the elements of a layer by class (`undefined` takes the colouring away), without building the layer again. `false` if there is
   * no such layer, or it is of a kind that is not coloured by classes.
   */
  setLayerClasses(id: string, classes: ClassColouring | undefined): boolean;
  /**
   * The order the layers are drawn in, from the bottom of the legend to the top. In 2D, depth is cleared between them and the last is on
   * top whatever the heights; in 3D, all share the frame's depth test. A layer that is not named is drawn after those that are.
   */
  setLayerOrder(ids: readonly string[]): void;
  /** Takes a layer off the card and frees what it held. `false` if there was none. */
  removeLayer(id: string): boolean;
  /**
   * Draws a frame now and reads back a rectangle of the drawing buffer: `x` and `y` from the bottom left, in device pixels,
   * four bytes (red, green, blue, alpha) for each, rows from the bottom as the card has them. For tests and pictures.
   *
   * @throws RangeError if the rectangle is not whole pixels inside the buffer.
   * @throws Error while the card has the context away: there is nothing to read.
   */
  readPixels(x: number, y: number, width: number, height: number): Uint8Array;
  /**
   * The element that is selected, or `null` for none: an outline is drawn round it, over the layers, in the accent colour of the canvas (its CSS `accent-color`)
   * and a ring of the colour of the text outside that. The outline is of the pixels that picking would pick for the element, so it follows the shape the layer
   * draws it in, in 2D and in 3D. A selection of a layer that is not there, is not visible or is beyond the first `MAX_PICK_LAYERS` draws nothing.
   */
  setSelection(selection: PickHit | null): void;
  /**
   * Which element of which layer is at a point of the map: `x` and `y` in CSS pixels from the top left of the canvas. The layers that are drawn
   * (the visible ones, and the pixels of them that are drawn: what a class has no colour for is not there) are drawn again into a target that holds
   * numbers, and the one pixel is read back without waiting for the card (`pick.ts`). `null` where nothing is, or outside the map, or while the card
   * has the context away. A layer beyond the first `MAX_PICK_LAYERS` in the drawing order is not picked.
   */
  pick(x: number, y: number): Promise<PickHit | null>;
  stats(): RenderStats;
  /** Stops watching the canvas, frees what is on the card and gives the context up. Calling it again does nothing. */
  dispose(): void;
}

/** What the limit of the buffer is if the card does not say. */
const DEFAULT_MAX_BUFFER = 4096;

/**
 * Waits, a turn of the page at a time, until the card has made the context. The browser gives the page its context at once and the graphics
 * process finishes making it meanwhile, and the first thing that asks the context a question (three asks dozens) waits for that, which was
 * 15 to 60 ms of the page's thread. A fence that the card signals when it has run the commands up to it says when that is, and asking whether it
 * has been signalled does not wait. At most a second is waited, after which three is let to wait as it would.
 */
async function untilSettled(gl: WebGL2RenderingContext, view: Window): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) {
    return;
  }
  gl.flush();
  const until = view.performance.now() + 1000;
  while (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED && view.performance.now() < until) {
    await new Promise<void>((resolve) => {
      view.setTimeout(resolve, 2);
    });
  }
  gl.deleteSync(fence);
}

/**
 * Waits for the card to give the context back, if it took it away while the context was being settled (a reset of the card), for at most
 * two seconds: three is not there yet to say that it may be given back, which it does (by refusing the event) once it is made.
 */
async function untilBack(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  view: Window,
): Promise<void> {
  if (!gl.isContextLost()) {
    return;
  }
  await new Promise<void>((resolve) => {
    const done = (): void => {
      canvas.removeEventListener('webglcontextrestored', done);
      view.clearTimeout(timer);
      resolve();
    };
    const timer = view.setTimeout(done, 2000);
    canvas.addEventListener('webglcontextrestored', done);
  });
}

/** What the context of the card is asked for: what three would ask for with the options it is given below. */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  depth: true,
  stencil: false,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
};

/**
 * Makes a renderer that draws on `canvas`, which the page sizes (the drawing buffer follows its box). `undefined` if
 * WebGL2 cannot be had, which is a fact of the browser and not a mistake: the viewer says so to the person.
 *
 * It is made in pieces with the page given a turn between them: the browser makes the context (14 to 34 ms), the page waits for the card to
 * finish it (`untilSettled`: a turn at a time, and not by being held), and three then makes its own state from it (10 to 20 ms). All of it in
 * one task held the page for over 45 ms, which with the work that came with it was over the 50 ms that a task may take (section 9.6).
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: RendererOptions = {},
): Promise<Renderer | undefined> {
  const owner = canvas.ownerDocument.defaultView;
  if (owner === null) {
    return undefined;
  }
  // The same window, with the type it has once it is known not to be null, which a function declaration would lose.
  const view: Window = owner;
  const made = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  if (made === null) {
    return undefined;
  }
  // A loss while the context is settled has no listener to refuse it (three's own come with it): refused here, so that the card may give the
  // context back, and waited for. If it does not, there is no context to draw on.
  const refuse = (event: Event): void => {
    event.preventDefault();
  };
  canvas.addEventListener('webglcontextlost', refuse);
  try {
    await untilSettled(made, view);
    await untilBack(canvas, made, view);
  } finally {
    canvas.removeEventListener('webglcontextlost', refuse);
  }
  if (made.isContextLost()) {
    return undefined;
  }
  let gl: WebGLRenderer;
  try {
    gl = new WebGLRenderer({
      canvas,
      context: made,
      alpha: true,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
  } catch {
    // three could not make its state from the context: the context is let go.
    made.getExtension('WEBGL_lose_context')?.loseContext();
    return undefined;
  }
  gl.setPixelRatio(1);
  gl.setClearColor(0x000000, 0);
  const context = gl.getContext();
  const limit: unknown = context.getParameter(context.MAX_RENDERBUFFER_SIZE);
  const maxBuffer =
    typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_MAX_BUFFER;

  // A scene for each layer. In 2D each is drawn by itself over the ones under it, with depth cleared between them (section 9.4); in 3D the
  // scenes are still drawn in this order but share the depth buffer, so geometry decides what can be seen.
  const scenes = new Map<string, Scene>();
  /** The ids of the layers from the one that is drawn first (the bottom of the legend) to the one drawn last. */
  let order: readonly string[] = [];
  /**
   * The layers whose shader programs are compiled. A layer that is not is not drawn yet: its programs are compiled meanwhile, by the driver
   * and off this thread (`KHR_parallel_shader_compile`), and a frame is asked for when they are. Linking a program in the frame that first
   * draws it holds the page for about 50 ms, which is the longest task that a million points or a model of blocks put on it.
   */
  const programs = new CompiledLayers();
  /** The layers that were moved by their place in the legend, in 3D, and are put back when the view is 2D. */
  const broken = new Set<string>();
  gl.autoClear = false;
  // Objects are drawn in the order they were put (a fill under its outline), and not sorted by how far they are: three would otherwise work
  // out the bounding sphere of every geometry at its first frame, a pass over every vertex of a million points, only to sort by it.
  gl.sortObjects = false;
  // Any boxes: `placeCameras` gives them their real ones before the first frame, as the canvas gets its size.
  const camera2d = new OrthographicCamera(-1, 1, 1, -1, 0.25, 100);
  const camera3d = new PerspectiveCamera(45, 1, 0.25, 100);

  /** What the map is looking at, and the heights that are drawn (relative to the origin). */
  let look: Camera2d = { centre: [0, 0], unitsPerPixel: 1, heading: 0 };
  let orbit: Camera3d = {
    target: [0, 0, 0],
    distance: 1000,
    heading: 0,
    elevation: 45,
    fov: 45,
  };
  let viewMode: ViewMode = '2d';
  let verticalExaggeration = 1;
  /**
   * What heights are multiplied by when the layers are drawn: in 3D the scene's vertical exaggeration, about the origin (the positions the layers
   * have are relative to it, so it is a scale of z of each layer's scene), and in the view from above 1, which has the heights it has (the depth that
   * the 2D camera sees is made from them, and nothing in the picture changes with them).
   */
  const heightScale = (): number => (viewMode === '3d' ? verticalExaggeration : 1);
  let origin: readonly [number, number, number] = [0, 0, 0];
  let extent: BBox | null = null;
  const depth = { min: 0, max: 0 };
  let perspective: PerspectiveFrame | null = null;

  const layers = new LayerSet(
    {
      add(object, id) {
        const own = new Scene();
        own.add(object);
        own.scale.z = heightScale();
        scenes.set(id, own);
      },
      remove(object, id) {
        scenes.get(id)?.remove(object);
        scenes.delete(id);
      },
    },
    makeLayer,
  );

  /** The layers in the order they are drawn: as the order says, and any that it does not name after them, as they were put. */
  function drawOrder(): string[] {
    const named = order.filter((id) => scenes.has(id));
    return [...named, ...[...scenes.keys()].filter((id) => !named.includes(id))];
  }
  let disposed = false;
  let lost = false;
  let frames = 0;
  /** How many layers the last frame drew: fewer than there are while the programs of a new one are being compiled. */
  let layersDrawn = 0;
  let frame: number | undefined;
  let cssWidth = 0;
  let cssHeight = 0;
  let size = bufferSize(cssWidth, cssHeight, view.devicePixelRatio, maxBuffer);

  /** Puts both cameras where the scene says, for the box that the canvas has now. */
  function placeCameras(): void {
    const box = orthographicFrame(look, origin, { width: cssWidth, height: cssHeight }, depth);
    camera2d.left = box.left;
    camera2d.right = box.right;
    camera2d.top = box.top;
    camera2d.bottom = box.bottom;
    camera2d.near = box.near;
    camera2d.far = box.far;
    camera2d.position.set(...box.position);
    camera2d.rotation.z = box.rotation;
    camera2d.updateProjectionMatrix();

    perspective = perspectiveFrame(
      orbit,
      origin,
      { width: cssWidth, height: cssHeight },
      extent,
      verticalExaggeration,
    );
    camera3d.fov = perspective.fov;
    camera3d.aspect = perspective.aspect;
    camera3d.near = perspective.near;
    camera3d.far = perspective.far;
    camera3d.position.set(...perspective.position);
    camera3d.up.set(...perspective.up);
    camera3d.lookAt(...perspective.target);
    camera3d.updateProjectionMatrix();
    // The view matrix is kept for the light of the frame (`frameLight`), which is worked out before three would update it in its own draw.
    camera3d.updateMatrixWorld();
  }

  const activeCamera = () => (viewMode === '3d' ? camera3d : camera2d);

  /** The colour of outlines: the colour of the text where the canvas is, which contrasts with the map in the theme that it is in. */
  let outline: readonly [number, number, number] = [0, 0, 0];
  /** The accent colour, from the canvas's `accent-color`: the outline of the selected element. */
  let accent: readonly [number, number, number] = [0.102, 0.337, 0.769];

  /** What the map is cleared to is the background of the canvas, which the page gives (the token `--k-surface-map`). */
  let background = '';
  function readBackground(): void {
    const style = view.getComputedStyle(canvas);
    const ink = parseCssColour(style.color);
    outline = ink === undefined ? [0, 0, 0] : [ink.r / 255, ink.g / 255, ink.b / 255];
    const accented = parseCssColour(style.accentColor);
    accent =
      accented === undefined ? accent : [accented.r / 255, accented.g / 255, accented.b / 255];
    const colour = parseCssColour(style.backgroundColor);
    const opaque = colour !== undefined && colour.a > 0 ? colour : undefined;
    const text =
      opaque === undefined
        ? 'transparent'
        : `#${[opaque.r, opaque.g, opaque.b]
            .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
            .join('')}`;
    if (text !== background) {
      background = text;
      gl.setClearColor(
        opaque === undefined
          ? new Color(0, 0, 0)
          : new Color().setRGB(opaque.r / 255, opaque.g / 255, opaque.b / 255, SRGBColorSpace),
        opaque === undefined ? 0 : opaque.a,
      );
    }
  }
  readBackground();

  /** Starts compiling the programs of a layer that has not been drawn, without holding this thread; a frame is asked for when they are ready. */
  function warm(id: string, own: Scene): void {
    const token = programs.start(id, own);
    if (token === undefined) {
      return;
    }
    const done = (): void => {
      if (programs.finish(id, token, scenes.get(id) === own)) {
        invalidate();
      }
    };
    gl.compileAsync(own, activeCamera()).then(done, done);
  }

  /** The element that is selected, the programs of the picking materials that its outline is made with (by layer and view), and the pass that makes it. */
  let selection: PickHit | null = null;
  const warmed = new Set<string>();
  const warming = new Set<string>();
  let highlight: Highlight | undefined;

  /** The picking materials of a layer are made again when the layer is: what was said of their programs is not so any more. */
  function forgetHighlightPrograms(id: string): void {
    for (const key of [...warmed, ...warming]) {
      if (key.startsWith(`${id}:`)) {
        warmed.delete(key);
        warming.delete(key);
      }
    }
  }

  /** Makes the programs of the picking materials of the layer that the outline is of, off this thread (as a pick does), and asks for a frame when they are made. */
  function warmHighlight(id: string, own: Scene, rank: number, key: string): void {
    if (warming.has(key)) {
      return;
    }
    warming.add(key);
    const back = layers.pick(id, rank, true);
    if (back === undefined) {
      warmed.add(key);
      warming.delete(key);
      return;
    }
    let ready: Promise<unknown>;
    try {
      ready = gl.compileAsync(own, activeCamera());
    } finally {
      back();
    }
    const done = (): void => {
      if (warming.delete(key)) {
        warmed.add(key);
        invalidate();
      }
    };
    ready.then(done, done);
  }

  /**
   * The outline of the selected element, over the layers: the layer is drawn into a target of its own with its picking materials, and a pass over the
   * picture draws a ring round the pixels that say the element (`highlight.ts`). Nothing is drawn for a selection that is not of a layer that is there
   * and drawn.
   */
  function drawHighlight(everything: boolean): void {
    if (selection === null) {
      return;
    }
    const id = selection.layerId;
    const own = scenes.get(id);
    const rank = drawOrder().indexOf(id);
    if (own === undefined || rank < 0 || rank >= MAX_PICK_LAYERS) {
      return;
    }
    const key = `${id}:${viewMode}`;
    if (!warmed.has(key)) {
      if (!everything) {
        warmHighlight(id, own, rank, key);
        return;
      }
      // A picture that is read back is of everything, and has its programs made now.
      warmed.add(key);
    }
    // An element that the target cannot say (beyond what three bytes hold) has no outline; asked before anything is swapped, so that nothing is left swapped.
    const expected = encodePick(rank, selection.element);
    if (expected === undefined) {
      return;
    }
    // (Of what is drawn: the outline hugs the point, the line, the polygon, and not the larger target that a pointer is given.)
    const back = layers.pick(id, rank, true);
    if (back === undefined) {
      return;
    }
    highlight ??= createHighlight();
    const mask = highlight.targetFor(size.width, size.height);
    const colour = new Color();
    gl.getClearColor(colour);
    const alpha = gl.getClearAlpha();
    try {
      gl.setRenderTarget(mask);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(own, activeCamera());
    } finally {
      gl.setRenderTarget(null);
      gl.setClearColor(colour, alpha);
      back();
    }
    highlight.draw(gl, mask, expected, size.pixelRatio, { accent, contrast: outline });
  }

  /** What is true of the screen and the theme for the frame that is drawn now. */
  function frameInfo(): FrameInfo {
    return {
      pixelRatio: size.pixelRatio,
      viewport: [size.width, size.height],
      flat: viewMode === '2d',
      light: frameLight(viewMode === '2d', camera3d.matrixWorldInverse.elements),
      outline,
    };
  }

  /**
   * Puts a layer where the view says it is for the draw: in 3D the layer that is higher in the legend is moved a little towards the camera, so that of
   * two in one plane it is the one seen; in 2D they are where they are, as the depth is cleared between layers.
   */
  function placeLayer(id: string, own: Scene, rank: number): void {
    if (viewMode === '3d') {
      tieBreak(own, rank);
      broken.add(id);
    } else if (broken.delete(id)) {
      tieBreak(own, 0);
    }
  }

  /** Draws a frame. `everything` draws every layer now, compiling what has to be compiled (a picture that is read back, which is of all of them). */
  function draw(everything: boolean): void {
    // The frame that was asked for and has not come is this one: it is not drawn twice, nor after the renderer is gone.
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
    if (disposed || lost) {
      return;
    }
    readBackground();
    // The next part of what is still being built goes on the card before the frame, and another frame is asked for if there is more.
    const more = layers.step();
    layers.prepareFrame(frameInfo());
    // The map's colour first. In 2D each layer then has its own depth; in 3D the clear above is the only one, so all layers share it.
    gl.clear();
    let drawn = 0;
    for (const [rank, id] of drawOrder().entries()) {
      const own = scenes.get(id);
      if (own === undefined) {
        continue;
      }
      placeLayer(id, own, rank);
      if (!everything && !programs.has(id)) {
        warm(id, own);
        continue;
      }
      programs.add(id);
      if (viewMode === '2d') {
        gl.clearDepth();
      }
      gl.render(own, activeCamera());
      drawn += 1;
    }
    layersDrawn = drawn;
    drawHighlight(everything);
    frames += 1;
    if (more) {
      invalidate();
    }
  }

  function invalidate(): void {
    if (!disposed && frame === undefined) {
      frame = view.requestAnimationFrame(() => {
        draw(false);
      });
    }
  }

  /** The target of picking: the size of the drawing buffer, made when the first pick wants it and made again when the buffer changes size. */
  let pickTarget: WebGLRenderTarget | undefined;
  function targetOfPicking(): WebGLRenderTarget {
    if (
      pickTarget === undefined ||
      pickTarget.width !== size.width ||
      pickTarget.height !== size.height
    ) {
      pickTarget?.dispose();
      pickTarget = new WebGLRenderTarget(size.width, size.height, {
        type: UnsignedByteType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        generateMipmaps: false,
        depthBuffer: true,
        stencilBuffer: false,
      });
    }
    return pickTarget;
  }

  /** Puts the picking materials of every layer that has them in place, in the order the layers are drawn, and says how to put them back. */
  function swapToPicking(): { restore: () => void; scenes: Scene[] } {
    const restores: (() => void)[] = [];
    const swapped: Scene[] = [];
    for (const [rank, id] of drawOrder().entries()) {
      const own = scenes.get(id);
      const back = own === undefined || rank >= MAX_PICK_LAYERS ? undefined : layers.pick(id, rank);
      if (own !== undefined && back !== undefined) {
        restores.push(back);
        swapped.push(own);
      }
    }
    return {
      restore: () => {
        for (const back of restores) {
          back();
        }
      },
      scenes: swapped,
    };
  }

  /** Whether there is nothing to draw on (the renderer is disposed of, or the card has the context away): asked again after a wait, as it may have changed. */
  const unusable = (): boolean => disposed || lost;

  async function pick(x: number, y: number): Promise<PickHit | null> {
    if (unusable() || cssWidth <= 0 || cssHeight <= 0 || !Number.isFinite(x + y)) {
      return null;
    }
    // The pixel of the buffer (rows from the bottom, as the card has them).
    const px = Math.floor((x * size.width) / cssWidth);
    const py = size.height - 1 - Math.floor((y * size.height) / cssHeight);
    if (px < 0 || px >= size.width || py < 0 || py >= size.height) {
      return null;
    }
    layers.prepareFrame(frameInfo());
    // The programs of the picking materials are made first, off this thread, and a pick that comes after the first does not wait: they are there.
    const compiling = swapToPicking();
    let ready: Promise<unknown>[];
    try {
      ready = compiling.scenes.map((own) => gl.compileAsync(own, activeCamera()));
    } finally {
      compiling.restore();
    }
    // (A program that could not be made is the card's to say, in the frame; it does not make a click fail.)
    await Promise.allSettled(ready);
    if (unusable()) {
      return null;
    }
    // (What may have changed while the programs were made: the uniforms, and the layers that were put or taken.)
    layers.prepareFrame(frameInfo());
    const order = drawOrder();
    const target = targetOfPicking();
    target.scissor.set(px, py, 1, 1);
    target.scissorTest = true;
    const picking = swapToPicking();
    const colour = new Color();
    gl.getClearColor(colour);
    const alpha = gl.getClearAlpha();
    let read: Promise<unknown>;
    const bytes = new Uint8Array(4);
    try {
      gl.setRenderTarget(target);
      // Nothing is 0: what the map is cleared to for the page is not what is cleared here.
      gl.setClearColor(0x000000, 0);
      gl.clear();
      for (const [rank, id] of order.entries()) {
        const own = scenes.get(id);
        if (own === undefined || rank >= MAX_PICK_LAYERS || !picking.scenes.includes(own)) {
          continue;
        }
        placeLayer(id, own, rank);
        if (viewMode === '2d') {
          gl.clearDepth();
        }
        gl.render(own, activeCamera());
      }
      // The read is begun here, with the card's commands for the pixel behind it, and waited for after the state is put back.
      read = gl.readRenderTargetPixelsAsync(target, px, py, 1, 1, bytes);
    } finally {
      gl.setRenderTarget(null);
      gl.setClearColor(colour, alpha);
      picking.restore();
    }
    try {
      await read;
    } catch (error) {
      // The card took the context away while the pixel was being read: there is nothing to say. Any other failure is a fault, and is let through.
      if (unusable()) {
        return null;
      }
      throw error;
    }
    if (unusable()) {
      return null;
    }
    const found = decodePick(bytes);
    const layerId = found === undefined ? undefined : order[found.rank];
    return found === undefined || layerId === undefined
      ? null
      : { layerId, element: found.element };
  }

  /** Gives the buffer the size of the box at the pixel ratio of the page now, and asks for a frame if it changed. */
  function resize(): void {
    const next = bufferSize(cssWidth, cssHeight, view.devicePixelRatio, maxBuffer);
    if (next.width !== size.width || next.height !== size.height || frames === 0) {
      gl.setSize(next.width, next.height, false);
    }
    size = next;
    placeCameras();
    invalidate();
  }

  const observer = new ResizeObserver((entries) => {
    const entry = entries.at(-1);
    if (entry !== undefined) {
      cssWidth = entry.contentRect.width;
      cssHeight = entry.contentRect.height;
      resize();
    }
  });
  observer.observe(canvas);

  /** The page's pixel ratio changes with its zoom and with the screen it is on, which a media query says. */
  let ratioQuery: MediaQueryList | undefined;
  const onRatio = (): void => {
    resize();
    watchRatio();
  };
  function watchRatio(): void {
    ratioQuery = view.matchMedia(`(resolution: ${String(view.devicePixelRatio)}dppx)`);
    ratioQuery.addEventListener('change', onRatio, { once: true });
  }
  watchRatio();

  /**
   * The colour of the map follows the theme: a page says which with an attribute or a class on its root, or leaves it to the
   * system's preference, so a change of either is looked for (the colour itself is read when a frame is drawn).
   */
  const themeObserver = new MutationObserver(invalidate);
  themeObserver.observe(canvas.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  });
  const scheme = view.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', invalidate);

  /**
   * The card can take the context away at any time (a driver reset, too many contexts on the page, a tab that was in the
   * background) and gives it back later. three keeps what it needs to make its objects again, and does so when a frame is drawn
   * after the context is back; this says so to the page, draws nothing in between, and asks for a frame when it is back.
   */
  const onLost = (): void => {
    // (three has refused the event already, which is what makes the browser give the context back.)
    lost = true;
    options.onContextLoss?.(true);
  };
  const onRestored = (): void => {
    lost = false;
    options.onContextLoss?.(false);
    // three made its state again with the context (its clear colour among it), so what was set is set again; and the buffer
    // is as the card made it, which may not be the size it had.
    background = '';
    readBackground();
    gl.setSize(size.width, size.height, false);
    // And its programs are gone: they are compiled again, a layer at a time and off this thread, before the layers are drawn.
    programs.reset();
    warmed.clear();
    warming.clear();
    invalidate();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    invalidate,
    setView(next) {
      if (disposed) {
        return;
      }
      const changedMode = viewMode !== next.viewMode;
      viewMode = next.viewMode;
      look = next.camera2d;
      orbit = next.camera3d;
      origin = next.origin;
      verticalExaggeration = next.verticalExaggeration;
      for (const own of scenes.values()) {
        own.scale.z = heightScale();
      }
      placeCameras();
      if (changedMode) {
        programs.reset();
      }
      invalidate();
    },
    setExtent(next) {
      const same =
        extent === next ||
        (extent !== null &&
          next !== null &&
          extent.min.every((value, axis) => value === next.min[axis]) &&
          extent.max.every((value, axis) => value === next.max[axis]));
      if (disposed || same) {
        return;
      }
      extent = next;
      placeCameras();
      invalidate();
    },
    setLayer(id, buffers, look) {
      if (disposed) {
        return 'unsupported';
      }
      const outcome = layers.set(id, buffers, look);
      forgetHighlightPrograms(id);
      if (outcome === 'drawn') {
        programs.put(id, buffers.kind);
      } else {
        programs.remove(id);
      }
      invalidate();
      return outcome;
    },
    setLayerLook(id, look) {
      if (disposed) {
        return false;
      }
      const known = layers.setLook(id, look);
      invalidate();
      return known;
    },
    setLayerClasses(id, classes) {
      if (disposed) {
        return false;
      }
      const known = layers.setClasses(id, classes);
      invalidate();
      return known;
    },
    setLayerOrder(ids) {
      if (disposed || (ids.length === order.length && ids.every((id, i) => id === order[i]))) {
        return;
      }
      order = [...ids];
      invalidate();
    },
    removeLayer(id) {
      if (disposed) {
        return false;
      }
      const removed = layers.remove(id);
      forgetHighlightPrograms(id);
      programs.remove(id);
      invalidate();
      return removed;
    },
    setSelection(next) {
      if (disposed) {
        return;
      }
      const same =
        selection === next ||
        (selection !== null &&
          next !== null &&
          selection.layerId === next.layerId &&
          selection.element === next.element);
      selection = next === null ? null : { layerId: next.layerId, element: next.element };
      if (!same) {
        invalidate();
      }
    },
    setDepthRange(min, max) {
      if (disposed || (depth.min === min && depth.max === max)) {
        return;
      }
      depth.min = min;
      depth.max = max;
      placeCameras();
      invalidate();
    },
    readPixels(x, y, width, height) {
      const whole = [x, y, width, height].every(Number.isInteger);
      if (
        !whole ||
        x < 0 ||
        y < 0 ||
        width < 1 ||
        height < 1 ||
        x + width > size.width ||
        y + height > size.height
      ) {
        throw new RangeError(
          `The rectangle ${String(width)} x ${String(height)} at ${String(x)}, ${String(y)} is not in the buffer of ${String(size.width)} x ${String(size.height)}.`,
        );
      }
      if (disposed) {
        throw new Error('The renderer has been disposed of, so there is nothing to read.');
      }
      if (lost) {
        throw new Error(
          'The graphics card has taken the context away, so there is nothing to read.',
        );
      }
      draw(true);
      const pixels = new Uint8Array(width * height * 4);
      context.readPixels(x, y, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      return pixels;
    },
    pick,
    stats() {
      return {
        frames,
        width: size.width,
        height: size.height,
        cssWidth,
        cssHeight,
        pixelRatio: size.pixelRatio,
        contextLost: lost,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        layers: layers.size,
        layersDrawn,
        maxTextureSize: gl.capabilities.maxTextureSize,
        background,
        // What the camera of three has, which is what draws, and not what was worked out for it.
        frame: {
          left: camera2d.left,
          right: camera2d.right,
          top: camera2d.top,
          bottom: camera2d.bottom,
          near: camera2d.near,
          far: camera2d.far,
          position: [camera2d.position.x, camera2d.position.y, camera2d.position.z],
          rotation: camera2d.rotation.z,
        },
        viewMode,
        perspective: viewMode === '3d' ? perspective : null,
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      observer.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener('change', invalidate);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      ratioQuery?.removeEventListener('change', onRatio);
      if (frame !== undefined) {
        view.cancelAnimationFrame(frame);
        frame = undefined;
      }
      layers.clear();
      programs.reset();
      pickTarget?.dispose();
      highlight?.dispose();
      gl.dispose();
      // A context that is away already has nothing to give up.
      if (!lost) {
        gl.forceContextLoss();
      }
    },
  };
}
