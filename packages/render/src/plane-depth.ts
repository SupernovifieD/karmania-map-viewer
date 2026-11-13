import { TIE_DEPTH, TIE_SLOPE } from './tie-break.js';

/**
 * The depth of a marker or a line in 3D (section 9.4 of the brief). A marker and a line are drawn in screen space: a square or a box of pixels
 * that has one depth, or one that changes along it, at the point or the segment, and not across it. Another layer in the plane that they lie in (the
 * polygons or the grid under a point, a 2D map seen in 3D) has a depth that changes across the pixels they cover, as much as the plane is
 * tilted to the view, so at an angle the marker is half behind it: nothing that is added to their one depth makes them the layer on top
 * wherever they are, and the layer in the plane is on top where it is nearer.
 *
 * So in 3D they write, for each pixel they cover, the depth that the plane they lie in has at that pixel: for a point the plane through it that
 * is level (z is up, and so is it for every layer), and for a line the plane through the segment that is as level as the segment lets it be (a
 * ribbon along it). What they draw is the same, and where they are in depth is where a polygon in that plane is, to the rounding of the card, which the
 * layers' place in the legend (`tie-break.ts`) is made larger than. A segment that points straight up or down has no such plane, and keeps the
 * depth it has.
 *
 * Writing the depth turns off the card's early depth test, so only the materials for the view in 3D do it; those of the view from above (where the
 * depth is cleared between layers, and the heights do not matter) are as they were.
 */

/**
 * The uniforms and the function that the fragment shaders of 3D use, in the space of the camera. Declared here because three declares the
 * projection matrix only for the vertex shader.
 */
export const PLANE_DEPTH_GLSL = /* glsl */ `
uniform highp mat4 projectionMatrix;
uniform vec2 uViewport;
// The layer's place in the legend: how many layers are under it.
uniform float uTieBreak;

// The depth, from 0 to 1 as the depth buffer has it, that the plane through q with the normal n has at the pixel that is drawn, and in y how much it
// changes from one pixel to the next at most (what a polygon's slope is to the card's own polygon offset). Where the plane is seen edge on or is
// behind the camera it is the depth the fragment has. Called before anything is discarded, as the change from pixel to pixel is only worked out
// where every pixel of a block of four runs it.
vec2 planeDepth(vec3 q, vec3 n) {
  vec2 ndc = gl_FragCoord.xy / uViewport * 2.0 - 1.0;
  vec3 ray = vec3(ndc.x / projectionMatrix[0][0], ndc.y / projectionMatrix[1][1], -1.0);
  float facing = dot(n, ray);
  float along = dot(n, q) / facing;
  float depth = gl_FragCoord.z;
  if (abs(facing) >= 1e-4 && along > 0.0) {
    // The point of the plane on the ray is at a depth of "along" in front of the camera, which the projection takes to this.
    float clip = projectionMatrix[2][2] * -along + projectionMatrix[3][2];
    depth = clamp(clip / along * 0.5 + 0.5, 0.0, 1.0);
  }
  return vec2(depth, max(abs(dFdx(depth)), abs(dFdy(depth))));
}

// The depth to write: the layer is moved towards the camera by its place in the legend, as polygon offset moves the triangles of the layers under
// it (the same step, and the same part of their slope), so that of two in one plane the one that is higher in the legend is nearer.
float tiedDepth(vec2 plane) {
  return clamp(plane.x - uTieBreak * (${String(TIE_DEPTH)} + ${String(TIE_SLOPE)}.0 * plane.y), 0.0, 1.0);
}

// The level direction up, in the space of the camera.
vec3 levelUp() {
  return normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
}
`;

/**
 * The plane of a line's segment from `a` to `b` (in the space of the camera): through it, as level as it can be across its width, which is the
 * plane that holds it and the level direction across it. For a segment that is level that is the level plane. The normal is of length 0 for a segment
 * that has no length or is straight up or down, where `planeDepth` keeps the depth the fragment has.
 */
export const RIBBON_GLSL = /* glsl */ `
vec3 ribbonNormal(vec3 a, vec3 b) {
  vec3 along = b - a;
  if (length(along) < 1e-9) {
    return vec3(0.0);
  }
  along = normalize(along);
  vec3 across = cross(levelUp(), along);
  if (length(across) < 1e-3) {
    return vec3(0.0);
  }
  return normalize(cross(along, normalize(across)));
}
`;
