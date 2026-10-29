import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/** What the handle asks for: the width the panel should have. It is for the page to limit it. */
export interface ResizeRequest {
  readonly width: number;
}

/** The name of the event the handle sends when a person moves the panel's edge. */
export const RESIZE = 'karmania-resize';

/** How far an arrow key moves the edge, in pixels. */
const KEY_STEP = 16;

/**
 * The strip along the left edge of the side panel that a person grabs to make the panel wider or
 * narrower: with the pointer (drag it), or with the keyboard (it can be focused; Left and Right
 * move the edge by 16, Home and End take it to the narrowest and the widest), or by a double click,
 * which puts the panel back to its usual width.
 *
 * It is a separator, as a screen reader hears it, with the width as its value. It does not change
 * anything itself: it says the width that is wanted (`karmania-resize`), and the page, which knows
 * what the window allows, sets `value`. Where it is, and how big, is the page's business too; it
 * fills the box it is given and draws a line along the middle of it, but only while it is pointed
 * at, has the keyboard, or is being dragged.
 */
export class KarmaniaResizeHandle extends LitElement {
  static override properties = {
    value: { type: Number },
    min: { type: Number },
    max: { type: Number },
    reset: { type: Number },
    dragging: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      /* Not selectable, so that the page's text is not selected as the pointer is dragged over it. */
      .handle {
        cursor: col-resize;
        height: 100%;
        position: relative;
        touch-action: none;
        user-select: none;
        width: 100%;
      }

      /* The line is what shows that the edge is there, so it is the focus indicator too. */
      .handle:focus {
        outline: none;
      }

      .line {
        background: var(--k-accent);
        height: 100%;
        left: calc(50% - var(--k-border-width));
        opacity: 0;
        pointer-events: none;
        position: absolute;
        top: 0;
        transition: opacity var(--k-motion-duration) var(--k-motion-easing);
        width: calc(var(--k-border-width) * 2);
      }

      .handle:hover .line,
      .handle:focus-visible .line,
      .handle[data-dragging] .line {
        opacity: 1;
      }
    `,
  ];

  /** The width of the panel now. */
  declare value: number;
  /** The narrowest the panel can be, where Home goes. */
  declare min: number;
  /** The widest it can be, where End goes. */
  declare max: number;
  /** The width a double click goes back to. */
  declare reset: number;
  /** Whether the edge is being dragged. */
  declare private dragging: boolean;

  /** The drag that is going on: which pointer, and where it started, and how wide the panel was. */
  private drag:
    { readonly pointer: number; readonly startX: number; readonly startWidth: number } | undefined;

  constructor() {
    super();
    this.value = 0;
    this.min = 0;
    this.max = 0;
    this.reset = 0;
    this.dragging = false;
    this.drag = undefined;
  }

  private request(width: number): void {
    this.dispatchEvent(
      new CustomEvent<ResizeRequest>(RESIZE, { detail: { width }, bubbles: true, composed: true }),
    );
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    // Keeps the pointer's moves coming here, wherever it goes, until it is let go. (The browser
    // focuses the handle as it does for any click, which is not keyboard focus, so no line stays.)
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { pointer: event.pointerId, startX: event.clientX, startWidth: this.value };
    this.dragging = true;
  };

  /** The panel is on the right, so moving the pointer left makes it wider, by as far as it moved. */
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.drag?.pointer === event.pointerId) {
      this.request(this.drag.startWidth - (event.clientX - this.drag.startX));
    }
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (this.drag?.pointer === event.pointerId) {
      this.drag = undefined;
      this.dragging = false;
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const width = {
      ArrowLeft: this.value + KEY_STEP,
      ArrowRight: this.value - KEY_STEP,
      Home: this.min,
      End: this.max,
    }[event.key];
    if (width !== undefined) {
      event.preventDefault();
      this.request(width);
    }
  };

  private readonly onDoubleClick = (): void => {
    this.request(this.reset);
  };

  override render() {
    return html`
      <div
        class="handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow=${this.value}
        aria-valuemin=${this.min}
        aria-valuemax=${this.max}
        aria-valuetext=${`${String(this.value)} pixels wide`}
        tabindex="0"
        ?data-dragging=${this.dragging}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerEnd}
        @pointercancel=${this.onPointerEnd}
        @lostpointercapture=${this.onPointerEnd}
        @keydown=${this.onKeyDown}
        @dblclick=${this.onDoubleClick}
      >
        <div class="line"></div>
      </div>
    `;
  }
}

customElements.define('karmania-resize-handle', KarmaniaResizeHandle);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-resize-handle': KarmaniaResizeHandle;
  }

  interface HTMLElementEventMap {
    [RESIZE]: CustomEvent<ResizeRequest>;
  }
}
