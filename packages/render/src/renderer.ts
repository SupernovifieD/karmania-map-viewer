/**
 * The renderer of the map: a WebGL2 context on a canvas that the page lays out, a drawing buffer that follows the size of
 * the canvas and the device pixel ratio, and a frame that is drawn only when something asks for one. three.js stays in
 * this package; what the viewer sees is the small interface below.
 */
import type { Camera2d } from '@karmania/scene';
import { Color, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { bufferSize } from './buffer-size.js';
import { orthographicFrame } from './camera-2d.js';
import type { OrthographicFrame } from './camera-2d.js';
import { parseCssColour } from './css-colour.js';

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
 * Makes a renderer that draws on `canvas`, which the page sizes (the drawing buffer follows its box). `undefined` if
 * WebGL2 cannot be had, which is a fact of the browser and not a mistake: the viewer says so to the person.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  options: RendererOptions = {},
): Renderer | undefined {
  const owner = canvas.ownerDocument.defaultView;
  if (owner === null) {
    return undefined;
  }
  // The same window, with the type it has once it is known not to be null, which a function declaration would lose.
  const view: Window = owner;
  let gl: WebGLRenderer;
  try {
    gl = new WebGLRenderer({
      canvas,
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

  const scene = new Scene();
  // Any box: `placeCamera` gives it its real one before the first frame, as the canvas gets its size.
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.25, 100);

  /** What the map is looking at, and the heights that are drawn (relative to the origin). */
  let look: Camera2d = { centre: [0, 0], unitsPerPixel: 1, heading: 0 };
  let origin: readonly [number, number, number] = [0, 0, 0];
  const depth = { min: 0, max: 0 };

  let disposed = false;
  let lost = false;
  let frames = 0;
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

  /** What the map is cleared to is the background of the canvas, which the page gives (the token `--k-surface-map`). */
  let background = '';
  function readBackground(): void {
    const colour = parseCssColour(view.getComputedStyle(canvas).backgroundColor);
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

  function draw(): void {
    frame = undefined;
    if (lost) {
      return;
    }
    readBackground();
    gl.render(scene, camera);
    frames += 1;
  }

  function invalidate(): void {
    if (!disposed && frame === undefined) {
      frame = view.requestAnimationFrame(draw);
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
      if (lost) {
        throw new Error(
          'The graphics card has taken the context away, so there is nothing to read.',
        );
      }
      draw();
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
      gl.dispose();
      // A context that is away already has nothing to give up.
      if (!lost) {
        gl.forceContextLoss();
      }
    },
  };
}
