/**
 * What is a click on the map (step 21.3a): a press and a release of the primary button, by the same pointer, in one place (within `CLICK_SLOP` pixels), on the
 * map itself and not on a control laid over it. A second pointer coming down (a pinch) or the press being taken away is not one. The map area gives it the
 * pointer events; this says whether they were a click, and where.
 */

/** How far, in CSS pixels, the pointer may move between pressing and letting go and still be a click: more is a drag, which moves the map. */
export const CLICK_SLOP = 4;

/** What of a pointer event is asked: which pointer, whether it is the primary one, which button, and where. */
export interface PointerPress {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
}

export interface ClickDetector {
  /** A pointer came down; `onMap` is whether it did so on the map itself (not on what is laid over it). */
  down(press: PointerPress, onMap: boolean): void;
  /** The pointer was let go: where the click was (in client pixels), or `undefined` if it was not one. */
  up(press: PointerPress): { readonly x: number; readonly y: number } | undefined;
  /** The press was taken away (the browser took the pointer for itself). */
  cancel(): void;
}

export function createClickDetector(): ClickDetector {
  let pressed: { readonly id: number; readonly x: number; readonly y: number } | undefined;
  return {
    down(press, onMap) {
      // Only the primary button of the first pointer, and only the map itself: the controls laid over it have their own clicks, and a second finger is a pinch.
      pressed =
        press.isPrimary && press.button === 0 && onMap
          ? { id: press.pointerId, x: press.clientX, y: press.clientY }
          : undefined;
    },
    up(press) {
      const was = pressed;
      pressed = undefined;
      if (
        was === undefined ||
        was.id !== press.pointerId ||
        Math.hypot(press.clientX - was.x, press.clientY - was.y) > CLICK_SLOP
      ) {
        return undefined;
      }
      return { x: press.clientX, y: press.clientY };
    },
    cancel() {
      pressed = undefined;
    },
  };
}
