/**
 * The renderer of the map: a WebGL2 context on a canvas that the page lays out, a drawing buffer that follows the size of
 * the canvas and the device pixel ratio, and a frame that is drawn only when something asks for one. three.js stays in
 * this package; what the viewer sees is the small interface below.
 */
import { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { bufferSize } from './buffer-size.js';

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
  /** How many geometries and textures are on the card, as three counts them. */
  readonly geometries: number;
  readonly textures: number;
}

/** A renderer on a canvas. */
export interface Renderer {
  /** Asks for a frame: one is drawn soon, however many times this is called before it. After `dispose` it does nothing. */
  invalidate(): void;
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
export function createRenderer(canvas: HTMLCanvasElement): Renderer | undefined {
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
  const camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);

  let disposed = false;
  let frames = 0;
  let frame: number | undefined;
  let cssWidth = 0;
  let cssHeight = 0;
  let size = bufferSize(cssWidth, cssHeight, view.devicePixelRatio, maxBuffer);

  function draw(): void {
    frame = undefined;
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

  return {
    invalidate,
    stats() {
      return {
        frames,
        width: size.width,
        height: size.height,
        cssWidth,
        cssHeight,
        pixelRatio: size.pixelRatio,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      observer.disconnect();
      ratioQuery?.removeEventListener('change', onRatio);
      if (frame !== undefined) {
        view.cancelAnimationFrame(frame);
        frame = undefined;
      }
      gl.dispose();
      gl.forceContextLoss();
    },
  };
}
