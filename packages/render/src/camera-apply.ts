/**
 * Putting a camera of three where the plain arithmetic of the frames says (`camera-2d.ts`, `camera-3d.ts`): the same for the camera that draws the screen and for
 * the one that draws an export, so that the two are made one way.
 */
import type { OrthographicCamera, PerspectiveCamera } from 'three';
import type { OrthographicFrame } from './camera-2d.js';
import type { PerspectiveFrame } from './camera-3d.js';

/** Gives an orthographic camera the box, pose and turn of a frame. */
export function applyOrthographic(camera: OrthographicCamera, box: OrthographicFrame): void {
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

/**
 * Gives a perspective camera the lens, pose and target of a frame. The view matrix is made too (`updateMatrixWorld`): the light of the frame (`frameLight`) is worked
 * out from it before three would update it in its own draw.
 */
export function applyPerspective(camera: PerspectiveCamera, frame: PerspectiveFrame): void {
  camera.fov = frame.fov;
  camera.aspect = frame.aspect;
  camera.near = frame.near;
  camera.far = frame.far;
  camera.position.set(...frame.position);
  camera.up.set(...frame.up);
  camera.lookAt(...frame.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
