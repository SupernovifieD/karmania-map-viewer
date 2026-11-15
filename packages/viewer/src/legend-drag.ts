import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { dropCandidates, pickDrop } from './legend-drop.js';
import type { DropCandidate, DropRow } from './legend-drop.js';
import type { Move } from './legend-order.js';

/** How far the pointer goes, in pixels, from where it was pressed before the press is a drag and not a click. */
const DRAG_START = 4;

/** What the Legend tab gives the drag: its own element, which has the pointer, and the rows as they are on the page now. */
export interface DragHost extends ReactiveControllerHost, HTMLElement {
  /** The rows that are shown, measured now (the panel may have scrolled since the drag began). */
  measureRows(): readonly DropRow[];
  /** How far in the layers of a group are, in pixels. */
  indent(): number;
}

/** A row that is being dragged, or pressed and not dragged yet. */
interface Pressed {
  readonly id: string;
  readonly kind: 'group' | 'layer';
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Dragging a row of the Legend tab with the pointer: a press on a row's handle (or on a group's row), a move of more than a few pixels, and a release, with
 * the gap the row would land in found at each move (`pickDrop`) for the tab to draw its line at. The tab's element has the pointer from the start of the drag
 * to its end, wherever it goes (and not before, so that a click is a click), and the drag ends at the release (the row is moved), at Escape or when the
 * pointer is taken away (nothing is moved).
 *
 * The release is heard in the window, wherever it is; a press whose release is lost all the same (the window lost the pointer) is not a drag later: a move with no
 * button down, or a new press of the same pointer anywhere in the page, ends it. What is heard of other pointers (a finger, while the mouse drags) is not this one's.
 *
 * It says what was dropped (`onDrop`) and what is dragged and where it would land (`dragging`, `drop`) for the tab to draw.
 */
export class LegendDrag implements ReactiveController {
  /** The row that is being dragged, once the press has become a drag. */
  dragging: { readonly id: string; readonly kind: 'group' | 'layer' } | undefined;
  /** The gap it would land in now, if there is one. */
  drop: DropCandidate | undefined;

  private pressed: Pressed | undefined;

  constructor(
    private readonly host: DragHost,
    private readonly onDrop: (move: Move) => void,
  ) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this.end();
  }

  /** A press on a row, which is a drag when the pointer goes on. */
  press(event: PointerEvent, id: string, kind: 'group' | 'layer'): void {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    this.end();
    this.pressed = { id, kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    // The pointer is not taken yet: a press that is a click (or half a double click) has to reach what was pressed, and a capture would give the click to the tab.
    this.host.addEventListener('pointermove', this.onMove);
    // The release and the cancel are listened for in the window: a release outside the tab, before the pointer has gone far enough to be a drag (when the tab does not
    // have the pointer yet), is a release all the same, and a press that never heard of it would be armed for the next time the pointer comes over the tab.
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    // In the capture phase, so that it comes before the press that a row is about to make (and not for the one that is making this).
    window.addEventListener('pointerdown', this.onAnyDown, true);
  }

  /** Whether a row is being dragged (and not only pressed). */
  get active(): boolean {
    return this.dragging !== undefined;
  }

  /** Ends the drag, or the press, and moves nothing. */
  cancel(): void {
    this.end();
  }

  /**
   * A press of the pointer that is pressed, anywhere in the page, before the one that a row is about to make: it is pressed again, so its release never came
   * (it was let go where nothing heard it, or the window lost it), and the press that was armed is over. Left armed, it would make a drag of a row that nobody
   * pressed, with the next press that is dragged over the tab. A press of another pointer (a finger, while the mouse drags) is not this one's.
   */
  private readonly onAnyDown = (event: PointerEvent): void => {
    const pressed = this.pressed;
    if (pressed !== undefined && event.isPrimary && event.pointerId === pressed.pointerId) {
      this.end();
    }
  };

  private readonly onMove = (event: PointerEvent): void => {
    const pressed = this.pressed;
    if (pressed === undefined || event.pointerId !== pressed.pointerId) {
      return;
    }
    // Nothing is pressed any more, so this press is a stale one (its release was lost): the pointer going over the tab is not a drag.
    if (event.buttons === 0) {
      this.end();
      return;
    }
    if (this.dragging === undefined) {
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_START) {
        return;
      }
      this.dragging = { id: pressed.id, kind: pressed.kind };
      // From here the tab has the pointer, wherever it goes.
      this.host.setPointerCapture(pressed.pointerId);
      this.host.addEventListener('lostpointercapture', this.onCancel);
      this.host.toggleAttribute('data-dragging', true);
    }
    const rows = this.host.measureRows();
    const indent = this.host.indent();
    const base = Math.min(
      ...rows.filter((row) => row.parent === null).map((row) => row.left),
      Infinity,
    );
    this.drop = pickDrop(
      dropCandidates(rows, this.dragging, indent),
      { x: event.clientX, y: event.clientY },
      base + indent,
    );
    this.host.requestUpdate();
  };

  private readonly onUp = (event: PointerEvent): void => {
    const pressed = this.pressed;
    if (pressed === undefined || event.pointerId !== pressed.pointerId) {
      return;
    }
    const dropped = this.dragging !== undefined ? this.drop : undefined;
    const id = pressed.id;
    this.end();
    if (dropped !== undefined) {
      this.onDrop({ id, to: dropped.place });
    }
  };

  /** The pointer that was pressed was cancelled, or the tab lost it. Another pointer's cancel (a second finger, anywhere in the window) is not this press's. */
  private readonly onCancel = (event: PointerEvent): void => {
    const pressed = this.pressed;
    if (pressed !== undefined && event.pointerId !== pressed.pointerId) {
      return;
    }
    this.end();
  };

  private end(): void {
    const pressed = this.pressed;
    this.pressed = undefined;
    this.host.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('pointerdown', this.onAnyDown, true);
    this.host.removeEventListener('lostpointercapture', this.onCancel);
    if (pressed !== undefined && this.host.hasPointerCapture(pressed.pointerId)) {
      this.host.releasePointerCapture(pressed.pointerId);
    }
    if (this.dragging !== undefined || this.drop !== undefined) {
      this.dragging = undefined;
      this.drop = undefined;
      this.host.toggleAttribute('data-dragging', false);
      this.host.requestUpdate();
    }
  }
}
