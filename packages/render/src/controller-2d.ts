/**
 * The 2D controller: it listens to the pointer, the wheel and the keyboard on the map area and turns what a person does into
 * changes of the scene's camera (`controls-2d.ts` has the arithmetic). It owns no camera: every event asks for the camera as
 * the scene has it now and gives back a change, so that the scene stays the one place the camera is, and a change that came
 * from elsewhere meanwhile (a button, an embedder) is not undone.
 *
 * The left button drags the map; the right button turns it about the middle; the wheel zooms to the pointer; and, when the map
 * area itself has the focus, the keys of section 10.2 of the brief work.
 */
import type { Camera2d } from '@karmania/scene';
import {
  angleAbout,
  keyAction,
  panBy,
  rotateAbout,
  turnBetween,
  wheelFactor,
  zoomAt,
} from './controls-2d.js';
import type { CameraChange, ScaleLimits } from './controls-2d.js';

/** What the controller needs from the page. */
export interface Controller2dOptions {
  /** The element that hears the events (those from inside its shadow roots arrive at it). */
  readonly element: HTMLElement;
  /** The map's canvas: a drag or a wheel that starts anywhere else (on a button laid over the map) is not the map's. */
  readonly canvas: HTMLCanvasElement;
  /** What has the focus when the keys are the map's, and is given it when the map is pressed. */
  readonly focusTarget: HTMLElement;
  /** The camera as the scene has it now. */
  getCamera(): Camera2d;
  /** How near and how far the map may be taken. */
  getLimits(): ScaleLimits;
  /** A change of the camera: the controller does not make it, it asks for it. */
  onCamera(change: CameraChange): void;
  /** Home: fit to the data, if there is something that does. */
  onFit?(): void;
}

/** A controller that is listening. */
export interface Controller2d {
  /** Stops listening and lets go of a drag that is under way. Calling it again does nothing. */
  dispose(): void;
}

/** A drag that is under way: which pointer, what it does, and where it was last. */
interface Drag {
  readonly pointerId: number;
  readonly mode: 'pan' | 'rotate';
  x: number;
  y: number;
  angle: number;
}

/** Starts listening. */
export function attachController2d(options: Controller2dOptions): Controller2d {
  const { element, canvas, focusTarget } = options;
  let drag: Drag | undefined;

  /** The size of the map and a point of the pointer in it, in CSS pixels from its top left. */
  const place = (event: { clientX: number; clientY: number }) => {
    const box = canvas.getBoundingClientRect();
    return {
      size: { width: box.width, height: box.height },
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    };
  };
  /** Whether an event began on the map itself and not on something that is over it. */
  const onMap = (event: Event): boolean => event.composedPath()[0] === canvas;

  function endDrag(): void {
    drag = undefined;
    delete canvas.dataset['dragging'];
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (drag !== undefined || !onMap(event) || (event.button !== 0 && event.button !== 2)) {
      return;
    }
    const { size, x, y } = place(event);
    drag = {
      pointerId: event.pointerId,
      mode: event.button === 0 ? 'pan' : 'rotate',
      x,
      y,
      angle: angleAbout(size, x, y),
    };
    canvas.dataset['dragging'] = drag.mode;
    canvas.setPointerCapture(event.pointerId);
    // The press is the map's: it takes the focus (which `preventDefault` would otherwise stop) and no text is selected.
    event.preventDefault();
    focusTarget.focus({ preventScroll: true });
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    const { size, x, y } = place(event);
    const camera = options.getCamera();
    if (drag.mode === 'pan') {
      options.onCamera(panBy(camera, size, x - drag.x, y - drag.y));
    } else {
      const angle = angleAbout(size, x, y);
      // The map follows the pointer, so the top of the screen turns the other way: the heading goes down as the pointer goes clockwise.
      const change = rotateAbout(
        camera,
        size,
        -turnBetween(drag.angle, angle),
        size.width / 2,
        size.height / 2,
      );
      if (change !== undefined) {
        options.onCamera(change);
      }
      drag.angle = angle;
    }
    drag.x = x;
    drag.y = y;
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) {
      endDrag();
    }
  };

  // The menu of the right button would open when it is let go, in the middle of a turn.
  const onContextMenu = (event: Event): void => {
    if (onMap(event)) {
      event.preventDefault();
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (!onMap(event)) {
      return;
    }
    // The page does not scroll under a map that is being zoomed.
    event.preventDefault();
    const { size, x, y } = place(event);
    const change = zoomAt(
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
    // The keys are the map's when the map area itself has the focus, not a button or a field in it.
    if (event.composedPath()[0] !== focusTarget) {
      return;
    }
    const action = keyAction(event);
    if (action === undefined) {
      return;
    }
    const camera = options.getCamera();
    const box = canvas.getBoundingClientRect();
    const size = { width: box.width, height: box.height };
    const middle = { x: size.width / 2, y: size.height / 2 };
    switch (action.type) {
      case 'pan':
        options.onCamera(panBy(camera, size, action.dx, action.dy));
        break;
      case 'zoom': {
        const change = zoomAt(camera, size, action.factor, middle.x, middle.y, options.getLimits());
        if (change !== undefined) {
          options.onCamera(change);
        }
        break;
      }
      case 'rotate': {
        const change = rotateAbout(camera, size, action.degrees, middle.x, middle.y);
        if (change !== undefined) {
          options.onCamera(change);
        }
        break;
      }
      case 'north':
        options.onCamera({ heading: 0 });
        break;
      case 'fit':
        if (options.onFit === undefined) {
          return;
        }
        options.onFit();
        break;
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
      if (disposed) {
        return;
      }
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
