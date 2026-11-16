/**
 * The highlight of the selected element (brief 9.3, step 21.2): an outline round it, in the accent colour with a ring of the colour of the text outside
 * that, so that it is read on every map colour and in both themes.
 *
 * It is made from what picking is made from. The layer of the selected element is drawn with its picking materials into a target of its own (each pixel
 * says the layer and the element it is of), and a pass over the whole picture then looks, for each pixel that is not the element, at the pixels round it: the
 * ones near enough to the element are the outline. So an element of any kind has one, of the shape the layer draws it in (the same pixels, the same
 * larger target of the point and the line), and nothing is made for each kind of layer.
 */
import {
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import type { WebGLRenderer } from 'three';

const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** How far from the element the outline reaches, in CSS pixels: the accent ring, and the ring of the colour of the text outside it. */
export const HIGHLIGHT_RING = 3;
export const HIGHLIGHT_EDGE = 1.5;

const FRAGMENT = /* glsl */ `
uniform sampler2D tMask;
// The four bytes the selected element is written as, from 0 to 1.
uniform vec4 uExpected;
uniform vec2 uTexel;
uniform float uRing;
uniform float uEdge;
uniform vec3 uAccent;
uniform vec3 uContrast;
varying vec2 vUv;

bool selected(vec2 uv) {
  vec4 found = texture2D(tMask, uv);
  return all(lessThan(abs(found - uExpected), vec4(0.5 / 255.0)));
}

void main() {
  // The element itself is as it is drawn.
  if (selected(vUv)) {
    discard;
  }
  float ring = 0.0;
  float edge = 0.0;
  for (int i = 0; i < 16; i += 1) {
    float angle = float(i) * 0.39269908;
    vec2 step = vec2(cos(angle), sin(angle)) * uTexel;
    // The accent ring: the pixels within uRing of the element (looked for at half and all of it); the edge outside it, within uRing + uEdge.
    if (selected(vUv + step * uRing * 0.5) || selected(vUv + step * uRing)) {
      ring = 1.0;
    }
    if (selected(vUv + step * (uRing + uEdge * 0.5)) || selected(vUv + step * (uRing + uEdge))) {
      edge = 1.0;
    }
  }
  if (ring > 0.5) {
    gl_FragColor = vec4(uAccent, 1.0);
  } else if (edge > 0.5) {
    gl_FragColor = vec4(uContrast, 1.0);
  } else {
    discard;
  }
}
`;

export interface Highlight {
  /** The target the layer of the selection is drawn into (made at the size of the buffer, and again when that changes). */
  targetFor(width: number, height: number): WebGLRenderTarget;
  /** Draws the outline of what `target` says is the element written as `expected` (four bytes), over what is on the screen. */
  draw(
    gl: WebGLRenderer,
    target: WebGLRenderTarget,
    expected: readonly [number, number, number, number],
    ratio: number,
    colours: {
      readonly accent: readonly [number, number, number];
      readonly contrast: readonly [number, number, number];
    },
  ): void;
  dispose(): void;
}

export function createHighlight(): Highlight {
  const uniforms = {
    tMask: { value: null as WebGLRenderTarget['texture'] | null },
    uExpected: { value: new Vector4() },
    uTexel: { value: new Vector2(1, 1) },
    uRing: { value: HIGHLIGHT_RING },
    uEdge: { value: HIGHLIGHT_EDGE },
    uAccent: { value: new Vector3() },
    uContrast: { value: new Vector3() },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: false,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let target: WebGLRenderTarget | undefined;

  return {
    targetFor(width, height) {
      if (target === undefined || target.width !== width || target.height !== height) {
        target?.dispose();
        target = new WebGLRenderTarget(width, height, {
          type: UnsignedByteType,
          format: RGBAFormat,
          minFilter: NearestFilter,
          magFilter: NearestFilter,
          generateMipmaps: false,
          depthBuffer: true,
          stencilBuffer: false,
        });
      }
      return target;
    },
    draw(gl, mask, expected, ratio, colours) {
      uniforms.tMask.value = mask.texture;
      uniforms.uExpected.value.set(
        expected[0] / 255,
        expected[1] / 255,
        expected[2] / 255,
        expected[3] / 255,
      );
      uniforms.uTexel.value.set(1 / mask.width, 1 / mask.height);
      uniforms.uRing.value = HIGHLIGHT_RING * ratio;
      uniforms.uEdge.value = HIGHLIGHT_EDGE * ratio;
      uniforms.uAccent.value.set(...colours.accent);
      uniforms.uContrast.value.set(...colours.contrast);
      gl.render(scene, camera);
    },
    dispose() {
      target?.dispose();
      target = undefined;
      geometry.dispose();
      material.dispose();
    },
  };
}
