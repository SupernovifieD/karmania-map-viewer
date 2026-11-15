import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { dropCandidates, edgeStep, pickDrop } from './legend-drop.js';
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
  /** The part of the page that scrolls the tab, which a drag scrolls at its edges, if there is one. */
  scrollRegion(): HTMLElement | null;
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
 * While the pointer is near the top or the bottom of the part of the page that scrolls the tab, that part scrolls, a frame at a time (`edgeStep`), so that a row can be
 * dragged to where it is not in sight. A finger on a group's row scrolls the panel and does not drag the group.
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
  /** Where the pointer is, in the window, while a row is dragged; and the frame that is asked for to scroll the panel. */
  private pointer: { readonly x: number; readonly y: number } | undefined;
  private frame: number | undefined;

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
    // A finger on a group's row is a finger that scrolls the panel: a group is dragged with a mouse or a pen (a layer, by its handle, which is not scrolled by a finger).
    if (event.pointerType === 'touch' && kind === 'group') {
      return;
    }
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
    this.pointer = { x: event.clientX, y: event.clientY };
    this.pick();
    this.scroll();
  };

  /** The gap that the dragged row would land in at the pointer, as the rows are now. */
  private pick(): void {
    const dragging = this.dragging;
    const at = this.pointer;
    if (dragging === undefined || at === undefined) {
      return;
    }
    const rows = this.host.measureRows();
    const indent = this.host.indent();
    const base = Math.min(
      ...rows.filter((row) => row.parent === null).map((row) => row.left),
      Infinity,
    );
    this.drop = pickDrop(dropCandidates(rows, dragging, indent), at, base + indent);
    this.host.requestUpdate();
  }

  /** While the pointer is near the top or the bottom of the part that scrolls, a frame at a time, that part scrolls, and the gap is found again (the rows moved under the pointer). */
  private scroll(): void {
    if (this.frame !== undefined) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const region = this.host.scrollRegion();
      const at = this.pointer;
      if (this.dragging === undefined || region === null || at === undefined) {
        return;
      }
      const box = region.getBoundingClientRect();
      const step = edgeStep(at.y, box.top, box.bottom);
      if (step === 0) {
        // Away from the edges: nothing more until the pointer moves again.
        return;
      }
      const before = region.scrollTop;
      region.scrollTop += step;
      if (region.scrollTop !== before) {
        this.pick();
      }
      this.scroll();
    });
  }

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
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.pointer = undefined;
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
