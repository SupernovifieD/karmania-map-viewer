/**
 * The renderer of the map: a WebGL2 context on a canvas that the page lays out, a drawing buffer that follows the size of
 * the canvas and the device pixel ratio, and a frame that is drawn only when something asks for one. three.js stays in
 * this package; what the viewer sees is the small interface below.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import type { Camera2d } from '@karmania/scene';
import { Color, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { bufferSize } from './buffer-size.js';
import { orthographicFrame } from './camera-2d.js';
import type { OrthographicFrame } from './camera-2d.js';
import { CompiledLayers } from './compiled-layers.js';
import { parseCssColour } from './css-colour.js';
import { makeLayer } from './layer-kinds.js';
import { LayerSet } from './layer-set.js';
import type { LayerOutcome } from './layer-set.js';
import type { ClassColouring, LayerLook } from './look.js';

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
  /** How many layers are on the card, how many of them the last frame drew (a layer is not drawn until its programs are compiled), and the largest texture the card takes, in cells on a side (what `prepare` cuts a grid to). */
  readonly layers: number;
  readonly layersDrawn: number;
  readonly maxTextureSize: number;
  /** What the map is cleared to: `#rrggbb`, or `transparent` where the canvas has no opaque background. */
  readonly background: string;
  /** The box the orthographic camera of three shows now, where it is and how it is turned. */
  readonly frame: OrthographicFrame;
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
  /**
   * Looks at the map through `camera`, with `origin` the point (in map units) that the positions on the card are relative to.
   * A frame is asked for if either changed.
   */
  setCamera2d(camera: Camera2d, origin: readonly [number, number, number]): void;
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
   * The order the layers are drawn in, from the first drawn (the bottom of the legend) to the last, which is on top: each is drawn over
   * the ones before it with the depth cleared between them, so the order decides what is on top whatever the heights. A layer that is
   * not named is drawn after those that are.
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
  await untilSettled(made, view);
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
    return undefined;
  }
  gl.setPixelRatio(1);
  gl.setClearColor(0x000000, 0);
  const context = gl.getContext();
  const limit: unknown = context.getParameter(context.MAX_RENDERBUFFER_SIZE);
  const maxBuffer =
    typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_MAX_BUFFER;

  // A scene for each layer, so that a layer is drawn by itself over the ones under it, with the depth cleared between them (section 9.4).
  const scenes = new Map<string, Scene>();
  /** The ids of the layers from the one that is drawn first (the bottom of the legend) to the one drawn last. */
  let order: readonly string[] = [];
  /**
   * The layers whose shader programs are compiled. A layer that is not is not drawn yet: its programs are compiled meanwhile, by the driver
   * and off this thread (`KHR_parallel_shader_compile`), and a frame is asked for when they are. Linking a program in the frame that first
   * draws it holds the page for about 50 ms, which is the longest task that a million points or a model of blocks put on it.
   */
  const programs = new CompiledLayers();
  gl.autoClear = false;
  // Objects are drawn in the order they were put (a fill under its outline), and not sorted by how far they are: three would otherwise work
  // out the bounding sphere of every geometry at its first frame, a pass over every vertex of a million points, only to sort by it.
  gl.sortObjects = false;
  // Any box: `placeCamera` gives it its real one before the first frame, as the canvas gets its size.
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.25, 100);

  /** What the map is looking at, and the heights that are drawn (relative to the origin). */
  let look: Camera2d = { centre: [0, 0], unitsPerPixel: 1, heading: 0 };
  let origin: readonly [number, number, number] = [0, 0, 0];
  const depth = { min: 0, max: 0 };

  const layers = new LayerSet(
    {
      add(object, id) {
        const own = new Scene();
        own.add(object);
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

  /** Puts the orthographic camera where `look` says, for the box that the canvas has now. */
  function placeCamera(): void {
    const box = orthographicFrame(look, origin, { width: cssWidth, height: cssHeight }, depth);
    camera.left = box.left;
    camera.right = box.right;
    camera.top = box.top;
    camera.bottom = box.bottom;
    camera.near = box.near;
    camera.far = box.far;
    camera.position.set(...box.position);
    camera.rotation.z = box.rotation;
    camera.updateProjectionMatrix();
  }

  /** The colour of outlines: the colour of the text where the canvas is, which contrasts with the map in the theme that it is in. */
  let outline: readonly [number, number, number] = [0, 0, 0];

  /** What the map is cleared to is the background of the canvas, which the page gives (the token `--k-surface-map`). */
  let background = '';
  function readBackground(): void {
    const style = view.getComputedStyle(canvas);
    const ink = parseCssColour(style.color);
    outline = ink === undefined ? [0, 0, 0] : [ink.r / 255, ink.g / 255, ink.b / 255];
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
    gl.compileAsync(own, camera).then(done, done);
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
    layers.prepareFrame({
      pixelRatio: size.pixelRatio,
      viewport: [size.width, size.height],
      // This renderer draws the 2D view (the 3D view of M18 is not flat).
      flat: true,
      outline,
    });
    // The map's colour first, then each layer over what is there with its own depth: what is higher in the legend is on top, whatever the heights.
    gl.clear();
    let drawn = 0;
    for (const id of drawOrder()) {
      const own = scenes.get(id);
      if (own === undefined) {
        continue;
      }
      if (!everything && !programs.has(id)) {
        warm(id, own);
        continue;
      }
      programs.add(id);
      gl.clearDepth();
      gl.render(own, camera);
      drawn += 1;
    }
    layersDrawn = drawn;
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

  /** Gives the buffer the size of the box at the pixel ratio of the page now, and asks for a frame if it changed. */
  function resize(): void {
    const next = bufferSize(cssWidth, cssHeight, view.devicePixelRatio, maxBuffer);
    if (next.width !== size.width || next.height !== size.height || frames === 0) {
      gl.setSize(next.width, next.height, false);
    }
    size = next;
    placeCamera();
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
    invalidate();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    invalidate,
    setCamera2d(camera, nextOrigin) {
      if (disposed) {
        return;
      }
      look = camera;
      origin = nextOrigin;
      placeCamera();
      invalidate();
    },
    setLayer(id, buffers, look) {
      if (disposed) {
        return 'unsupported';
      }
      const outcome = layers.set(id, buffers, look);
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
      programs.remove(id);
      invalidate();
      return removed;
    },
    setDepthRange(min, max) {
      if (disposed || (depth.min === min && depth.max === max)) {
        return;
      }
      depth.min = min;
      depth.max = max;
      placeCamera();
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
          left: camera.left,
          right: camera.right,
          top: camera.top,
          bottom: camera.bottom,
          near: camera.near,
          far: camera.far,
          position: [camera.position.x, camera.position.y, camera.position.z],
          rotation: camera.rotation.z,
        },
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
      gl.dispose();
      // A context that is away already has nothing to give up.
      if (!lost) {
        gl.forceContextLoss();
      }
    },
  };
}
