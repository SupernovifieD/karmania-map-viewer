/** DOM listeners for the 3D orbit camera; the arithmetic lives in `controls-3d.ts`. */
import type { Camera3d } from '@karmania/scene';
import { wheelFactor } from './controls-2d.js';
import { keyAction3d, orbit3dBy, pan3dBy, zoom3dAt } from './controls-3d.js';
import type { Camera3dChange, DistanceLimits } from './controls-3d.js';

export interface Controller3dOptions {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly focusTarget: HTMLElement;
  getCamera(): Camera3d;
  getLimits(): DistanceLimits;
  onCamera(change: Camera3dChange): void;
  onFit?(): void;
}

export interface Controller3d {
  dispose(): void;
}

interface Drag {
  readonly pointerId: number;
  readonly mode: 'orbit' | 'pan';
  x: number;
  y: number;
}

/** Left drag orbits; right or Shift-left drag pans; the wheel zooms to the pointer. */
export function attachController3d(options: Controller3dOptions): Controller3d {
  const { element, canvas, focusTarget } = options;
  let drag: Drag | undefined;

  const place = (event: { clientX: number; clientY: number }) => {
    const box = canvas.getBoundingClientRect();
    return {
      size: { width: box.width, height: box.height },
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    };
  };
  const onMap = (event: Event): boolean => event.composedPath()[0] === canvas;

  const endDrag = (): void => {
    drag = undefined;
    delete canvas.dataset['dragging'];
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (drag !== undefined || !onMap(event) || (event.button !== 0 && event.button !== 2)) {
      return;
    }
    const { x, y } = place(event);
    drag = {
      pointerId: event.pointerId,
      mode: event.button === 2 || event.shiftKey ? 'pan' : 'orbit',
      x,
      y,
    };
    canvas.dataset['dragging'] = drag.mode;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    focusTarget.focus({ preventScroll: true });
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    const { size, x, y } = place(event);
    const move = drag.mode === 'orbit' ? orbit3dBy : pan3dBy;
    const change = move(options.getCamera(), size, x - drag.x, y - drag.y);
    if (change !== undefined) {
      options.onCamera(change);
    }
    drag.x = x;
    drag.y = y;
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) {
      endDrag();
    }
  };
  const onContextMenu = (event: Event): void => {
    if (onMap(event)) {
      event.preventDefault();
    }
  };
  const onWheel = (event: WheelEvent): void => {
    if (!onMap(event)) {
      return;
    }
    event.preventDefault();
    const { size, x, y } = place(event);
    const change = zoom3dAt(
      options.getCamera(),
      size,
      wheelFactor(event, size.height),
      x,
      y,
      options.getLimits(),
    );
    if (change !== undefined) {
      options.onCamera(change);
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.composedPath()[0] !== focusTarget) {
      return;
    }
    const action = keyAction3d(event);
    if (action === undefined) {
      return;
    }
    const camera = options.getCamera();
    const box = canvas.getBoundingClientRect();
    const size = { width: box.width, height: box.height };
    let change: Camera3dChange | undefined;
    switch (action.type) {
      case 'orbit':
        change = {
          heading: (((camera.heading + action.heading) % 360) + 360) % 360,
          elevation: Math.min(89, Math.max(-89, camera.elevation + action.elevation)),
        };
        break;
      case 'pan':
        change = pan3dBy(camera, size, action.dx, action.dy);
        break;
      case 'zoom':
        change = zoom3dAt(
          camera,
          size,
          action.factor,
          size.width / 2,
          size.height / 2,
          options.getLimits(),
        );
        break;
      case 'fit':
        if (options.onFit === undefined) {
          return;
        }
        options.onFit();
        break;
    }
    if (change !== undefined) {
      options.onCamera(change);
    }
    event.preventDefault();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerEnd);
  element.addEventListener('pointercancel', onPointerEnd);
  element.addEventListener('lostpointercapture', onPointerEnd);
  element.addEventListener('contextmenu', onContextMenu);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('keydown', onKeyDown);

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      endDrag();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
      element.removeEventListener('lostpointercapture', onPointerEnd);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('keydown', onKeyDown);
    },
  };
}
