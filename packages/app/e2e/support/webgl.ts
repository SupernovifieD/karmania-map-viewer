import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** What `drawTriangle` found out in the page: the browser's WebGL, and what it drew. */
export interface TriangleResult {
  readonly webgl2: boolean;
  /** The graphics driver the browser reports (`SwiftShader` for the software one). */
  readonly renderer: string;
  readonly maxTextureSize: number;
  readonly maxRenderbufferSize: number;
  /** Whether the context can be lost on purpose (`WEBGL_lose_context`), which the tests of a lost context need. */
  readonly canLoseContext: boolean;
  /** The pixel (r, g, b, a) in the middle of the triangle. */
  readonly inside: readonly number[];
  /** The pixel (r, g, b, a) in a corner, outside the triangle. */
  readonly outside: readonly number[];
  /** FNV-1a (32 bits, hex) of every byte of the 64 x 64 picture, so that two pictures can be compared. */
  readonly hash: string;
}

/** The colour the triangle is drawn in, as bytes: 1.0, 0.2 and 0.0 leave no rounding to argue about. */
export const TRIANGLE_PIXEL: readonly number[] = [255, 51, 0, 255];
/** The colour the picture is cleared to, as bytes. */
export const CLEAR_PIXEL: readonly number[] = [0, 0, 255, 255];

/**
 * Draws one triangle on a new 64 x 64 canvas in WebGL2, without anti-aliasing, and reads the pixels
 * back. It runs in the page (it is sent to the browser as text), so it uses nothing from this file.
 * The numbers in it are those of `TRIANGLE_PIXEL` and `CLEAR_PIXEL`.
 */
export function drawTriangle(): TriangleResult {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (gl === null) {
    return {
      webgl2: false,
      renderer: '',
      maxTextureSize: 0,
      maxRenderbufferSize: 0,
      canLoseContext: false,
      inside: [],
      outside: [],
      hash: '',
    };
  }

  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error('The browser gave no shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'A shader did not compile.');
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(
    program,
    compile(
      gl.VERTEX_SHADER,
      '#version 300 es\nin vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }',
    ),
  );
  gl.attachShader(
    program,
    compile(
      gl.FRAGMENT_SHADER,
      '#version 300 es\nprecision highp float;\nout vec4 c;\nvoid main() { c = vec4(1.0, 0.2, 0.0, 1.0); }',
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'The program did not link.');
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.8, -0.8, 0.8, -0.8, 0, 0.8]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const bytes = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const pixel = (x: number, y: number): number[] => {
    const at = (y * size + x) * 4;
    return [bytes[at] ?? -1, bytes[at + 1] ?? -1, bytes[at + 2] ?? -1, bytes[at + 3] ?? -1];
  };
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const loseContext = gl.getExtension('WEBGL_lose_context');
  const result: TriangleResult = {
    webgl2: true,
    renderer: String(
      gl.getParameter(debugInfo === null ? gl.RENDERER : debugInfo.UNMASKED_RENDERER_WEBGL),
    ),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    canLoseContext: loseContext !== null,
    inside: pixel(32, 24),
    outside: pixel(1, 1),
    hash: hash.toString(16).padStart(8, '0'),
  };
  // Free the context: a page may only hold a handful of them.
  loseContext?.loseContext();
  return result;
}

/**
 * Draws the triangle twice, on two new canvases, and checks WebGL2 works: the pixel inside is the
 * triangle's colour, the one outside is the clear colour, the context can be lost on purpose, and
 * both pictures are the same byte for byte. Returns what the first one found.
 */
export async function expectTriangle(page: Page): Promise<TriangleResult> {
  await page.goto('about:blank');
  const first = await page.evaluate(drawTriangle);
  expect(first.webgl2, 'the browser gives a WebGL2 context').toBe(true);
  expect(first.inside, 'the middle of the triangle').toEqual(TRIANGLE_PIXEL);
  expect(first.outside, 'a corner outside the triangle').toEqual(CLEAR_PIXEL);
  expect(first.canLoseContext, 'WEBGL_lose_context is there').toBe(true);
  const second = await page.evaluate(drawTriangle);
  expect(second.hash, 'a second picture is the same as the first').toBe(first.hash);
  return first;
}
