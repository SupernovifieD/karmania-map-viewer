import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { carriesFiles } from './drag.js';
import { formatCount } from './import-files.js';
import './nav-group.js';
import './north-arrow.js';
import './scale-bar.js';
import './status-chip.js';
import type { MapCrsText } from './map-crs-text.js';
import type { Readout } from './pointer-readout.js';
import type { ScaleBarModel } from '@karmania/scene';

/** The name of the event the map area sends when a person asks to import files with its button. */
export const IMPORT_REQUEST = 'karmania-import-request';

/** The name of the event the map area sends when files have been dropped on it. */
export const FILES_DROPPED = 'karmania-files-dropped';

/** The files that were dropped. */
export interface DroppedFiles {
  readonly files: readonly File[];
}

/** The name of the event the map area sends when a person asks to see the Legend, which says why a layer is not drawn. */
export const SHOW_LEGEND = 'karmania-show-legend';

/** The name of the event the map area sends when the pointer moves over it, or leaves it. */
export const POINTER_ON_MAP = 'karmania-pointer-on-map';

/** Where the pointer is on the map, in CSS pixels from its top left, and how big the map is; `null` when it is off the map. */
export type PointerOnMap = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} | null;

/**
 * The map area: the canvas the map is drawn on, and what is laid over it. With no data it invites people to drop files or import them. With
 * data it shows the map and says nothing, but while layers are being prepared it has a chip at the top (how many, and how far along they are),
 * and if none of the layers can be drawn it says that nothing can be, with the reason and a button to the Legend.
 *
 * Files can be dropped on it. While some are being dragged over it, an outline and a label
 * (`Drop to import`) are shown inside its edges. They are laid over the area without being part of
 * its layout, so showing them moves and resizes nothing. A drop sends `karmania-files-dropped` with
 * the files, and its Import button sends `karmania-import-request`: what to do about either is up
 * to the app.
 */
export class KarmaniaMapArea extends LitElement {
  static override properties = {
    datasets: { type: Number },
    redrawing: { type: Boolean },
    unavailable: { type: Boolean },
    heading: { type: Number },
    scale: { attribute: false },
    crs: { attribute: false },
    readout: { attribute: false },
    readoutChars: { type: Number },
    preparing: { type: Number },
    progress: { type: Number },
    reasons: { attribute: false },
    interactive: { type: Boolean },
    dragging: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        background: var(--k-surface-map);
        display: block;
        min-height: 0;
        min-width: 0;
      }

      /* A stacking context of its own, so that the canvas can go behind what is laid over it (the empty state, the
         drop zone) without going behind the background of the area. */
      main {
        height: 100%;
        isolation: isolate;
        position: relative;
      }

      /* The area has the keyboard when it is focused, and the ring is drawn inside it, where it is not cut off. */
      main:focus-visible {
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      /* The empty state fills the area, and the map under it is what a pointer is on: only its action is for the pointer. */
      k-empty-state {
        pointer-events: none;
      }

      span[slot='action'] {
        pointer-events: auto;
      }

      /* The map: it fills the area exactly, whatever the area is, and is under everything else. Its background is
         the colour that the renderer clears it to, which it reads from here: the map has the colour of the area. */
      canvas {
        background-color: var(--k-surface-map);
        cursor: grab;
        display: block;
        height: 100%;
        inset: 0;
        position: absolute;
        touch-action: none;
        width: 100%;
        z-index: -1;
      }

      canvas[data-dragging] {
        cursor: grabbing;
      }

      /* Over the area, 8 inside its edges, and not in the way of the pointer. It is there all
         the time and only becomes visible, so nothing is added to or taken from the layout. */
      .drop-zone {
        align-items: center;
        background: color-mix(in srgb, var(--k-accent) 10%, var(--k-surface-map));
        border: calc(var(--k-border-width) * 2) dashed var(--k-accent);
        border-radius: var(--k-radius-lg);
        display: flex;
        inset: var(--k-space-8);
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        position: absolute;
        transition:
          opacity var(--k-motion-duration) var(--k-motion-easing),
          visibility var(--k-motion-duration) var(--k-motion-easing);
        visibility: hidden;
      }

      .drop-zone[data-active] {
        opacity: 1;
        visibility: visible;
      }

      /* The furniture of the map is laid over it, 16 inside its edges, and moves nothing: the north arrow at the top on the right. */
      .furniture {
        position: absolute;
      }

      .north {
        inset-block-start: var(--k-space-16);
        inset-inline-end: var(--k-space-16);
      }

      /* The navigation group at the bottom on the right. */
      .nav {
        inset-block-end: var(--k-space-16);
        inset-inline-end: var(--k-space-16);
      }

      /* At the bottom on the left, 16 in, what is there stacked with 8 between, and the left edges level: the scale bar, and under it
         the status chip. The stack takes the pointer for nothing itself: what is in it that is for the pointer says so. */
      .stack {
        align-items: flex-start;
        display: flex;
        flex-direction: column;
        gap: var(--k-space-8);
        inset-block-end: var(--k-space-16);
        inset-inline-start: var(--k-space-16);
        pointer-events: none;
      }

      /* A notice over the map, at the top in the middle, 16 from the edge: it is laid over the area and moves nothing. */
      .notice {
        align-items: center;
        background: var(--k-surface-raised);
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-lg);
        box-sizing: border-box;
        color: var(--k-text);
        display: flex;
        font-size: var(--k-font-size-caption);
        height: var(--k-space-24);
        inset-block-start: var(--k-space-16);
        inset-inline-start: 50%;
        line-height: var(--k-line-height-caption);
        padding: 0 var(--k-space-12);
        pointer-events: none;
        position: absolute;
        transform: translateX(-50%);
        white-space: nowrap;
      }

      /* The chip while layers are being prepared: the notice with a thin bar along its foot that fills as they get ready. */
      .chip {
        overflow: hidden;
      }

      .chip .bar {
        background: var(--k-border);
        block-size: calc(var(--k-border-width) * 2);
        inset-block-end: 0;
        inset-inline: 0;
        position: absolute;
      }

      .chip .bar::after {
        background: var(--k-accent);
        block-size: 100%;
        content: '';
        display: block;
        inline-size: var(--k-progress);
      }

      .drop-label {
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
      }
    `,
  ];

  /** How many datasets are loaded. */
  declare datasets: number;
  /** Whether the map is being drawn again after the graphics card took it away: it says so, in a notice over the map. */
  declare redrawing: boolean;
  /** Whether the browser cannot draw the map at all (it has no WebGL 2): with data, it says so, and says nothing of layers. */
  declare unavailable: boolean;
  /** The camera's heading, in degrees clockwise from grid north: the north arrow's needle turns with it. */
  declare heading: number;
  /** The scale bar, or why there is none; `undefined` while there is no map. */
  declare scale: ScaleBarModel | undefined;
  /** What the status chip's button says of the map's coordinate system. */
  declare crs: MapCrsText | undefined;
  /** Where the pointer is on the map, written, for the status chip; `undefined` when it is off the map or the view is 3D. */
  declare readout: Readout | undefined;
  /** How many characters wide the longest coordinate of the readout can be at this camera: what the chip keeps room for. */
  declare readoutChars: number;
  /** How many layers are being prepared (0 for none): the chip at the top says so. */
  declare preparing: number;
  /** How far along the layers are, from 0 to 1, for the bar of the chip. */
  declare progress: number;
  /** Why each layer that cannot be drawn is not, when there is data and none of it can be drawn: then the map area says that nothing can be. */
  declare reasons: readonly string[];
  /**
   * Whether the map can be moved (a drag, the wheel, the keys): the area is then a stop of the keyboard. Before that it is not,
   * since a stop that does nothing is in a person's way, and the empty state's own button is the first thing after the toolbar.
   */
  declare interactive: boolean;
  /** Whether files are being dragged over the area. */
  declare private dragging: boolean;

  /**
   * How many of the area's elements the drag is over. Moving onto a child fires `dragenter` for
   * it before `dragleave` for the one just left, so the drag is over the area while this is not 0.
   */
  private depth = 0;

  constructor() {
    super();
    this.datasets = 0;
    this.redrawing = false;
    this.unavailable = false;
    this.heading = 0;
    this.scale = undefined;
    this.crs = undefined;
    this.readout = undefined;
    this.readoutChars = 0;
    this.preparing = 0;
    this.progress = 0;
    this.reasons = [];
    this.interactive = false;
    this.dragging = false;
  }

  /** What has the focus when the keys are the map's: there from the first render, and `undefined` until then. */
  get focusTarget(): HTMLElement | undefined {
    return this.renderRoot.querySelector('main') ?? undefined;
  }

  /** The canvas the map is drawn on: there from the first render, and `undefined` until then. */
  get canvas(): HTMLCanvasElement | undefined {
    return this.renderRoot.querySelector('canvas') ?? undefined;
  }

  /**
   * Whether the furniture is shown: there is data, the browser can draw it, and it is not the case that nothing can be (then the map is
   * not there to be moved or measured, and the empty state says why).
   */
  private get furnished(): boolean {
    return this.datasets > 0 && !this.unavailable && this.reasons.length === 0;
  }

  /** Whether the status chip is shown: there is data and the browser can draw it, whether or not anything can be (the chip is where the map's coordinate system is changed). */
  private get chipped(): boolean {
    return this.datasets > 0 && !this.unavailable;
  }

  override render() {
    return html`
      <main
        aria-label="Map"
        tabindex=${this.interactive ? '0' : nothing}
        @pointermove=${this.onPointerMove}
        @pointerleave=${this.onPointerLeave}
        @dragenter=${this.onDragEnter}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <canvas aria-hidden="true"></canvas>
        ${
          this.datasets === 0
            ? this.empty()
            : this.unavailable
              ? this.cannotDraw()
              : this.reasons.length > 0
                ? this.blocked()
                : nothing
        }
        ${
          this.furnished
            ? html`<karmania-north-arrow
                class="furniture north"
                .heading=${this.heading}
              ></karmania-north-arrow>`
            : nothing
        }
        ${
          this.furnished
            ? html`<karmania-nav-group class="furniture nav"></karmania-nav-group>`
            : nothing
        }
        ${
          this.chipped
            ? html`<div class="furniture stack">
                ${
                  this.furnished && this.scale?.kind === 'bar'
                    ? html`<karmania-scale-bar .model=${this.scale}></karmania-scale-bar>`
                    : nothing
                }
                <karmania-status-chip
                  .readout=${this.readout}
                  .chars=${this.readoutChars}
                  .crs=${this.crs}
                ></karmania-status-chip>
              </div>`
            : nothing
        }
        ${
          this.redrawing
            ? html`<div class="notice" role="status">Redrawing the map…</div>`
            : this.preparing > 0 && !this.unavailable
              ? this.chip()
              : nothing
        }
        <div class="drop-zone" ?data-active=${this.dragging} aria-hidden="true">
          <span class="drop-label">Drop to import</span>
        </div>
      </main>
    `;
  }

  /** Says where the pointer is on the map (anywhere in the area is on the map: what is laid over it is not in its way), or that it is not. */
  private readonly onPointerMove = (event: PointerEvent): void => {
    const box = this.canvas?.getBoundingClientRect();
    if (box === undefined) {
      return;
    }
    const [x, y] = [event.clientX - box.left, event.clientY - box.top];
    const on = x >= 0 && y >= 0 && x <= box.width && y <= box.height;
    this.tell(on ? { x, y, width: box.width, height: box.height } : null);
  };

  private readonly onPointerLeave = (): void => {
    this.tell(null);
  };

  private tell(where: PointerOnMap): void {
    this.dispatchEvent(
      new CustomEvent<PointerOnMap>(POINTER_ON_MAP, {
        detail: where,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private readonly onDragEnter = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      event.preventDefault();
      this.depth += 1;
      this.dragging = true;
    }
  };

  /** Agrees to take the files, which is what makes dropping them possible. */
  private readonly onDragOver = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  };

  private readonly onDragLeave = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      this.depth = Math.max(0, this.depth - 1);
      this.dragging = this.depth > 0;
    }
  };

  /** Takes the files away from the browser, which would otherwise open one and leave the app. */
  private readonly onDrop = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      event.preventDefault();
      this.depth = 0;
      this.dragging = false;
      // The files are only there while the event is being handled.
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) {
        this.dispatchEvent(
          new CustomEvent<DroppedFiles>(FILES_DROPPED, {
            detail: { files },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
  };

  private readonly onImport = (): void => {
    this.dispatchEvent(new CustomEvent(IMPORT_REQUEST, { bubbles: true, composed: true }));
  };

  private empty() {
    return html`
      <k-empty-state icon="map" heading="No data yet">
        Drop files here or use Import
        <span slot="action"
          >${kButton({ icon: 'upload', children: 'Import', onClick: this.onImport })}</span
        >
      </k-empty-state>
    `;
  }

  private readonly onShowLegend = (): void => {
    this.dispatchEvent(new CustomEvent(SHOW_LEGEND, { bubbles: true, composed: true }));
  };

  /** Data, and none of it can be drawn: why, and where the Legend says it. */
  private blocked() {
    const [first = ''] = this.reasons;
    const count = this.reasons.length;
    const text = count === 1 ? first : `${formatCount(count)} layers cannot be drawn. ${first}`;
    return html`
      <k-empty-state icon="map" heading="Nothing can be drawn yet">
        ${text}
        <span slot="action"
          >${kButton({ icon: 'layers', children: 'Show the Legend', onClick: this.onShowLegend })}</span
        >
      </k-empty-state>
    `;
  }

  /** Data, and the browser cannot draw it: the layers are fine, and the Legend has nothing to add. */
  private cannotDraw() {
    return html`
      <k-empty-state icon="map" heading="The map cannot be drawn">
        This browser or its graphics card does not give the page WebGL 2, which the map needs. Try a
        current version of Chrome, Edge, Firefox or Safari, with hardware acceleration on.
      </k-empty-state>
    `;
  }

  /** The chip at the top while layers are being prepared. */
  private chip() {
    const percent = Math.round(Math.min(1, Math.max(0, this.progress)) * 100);
    const layers = this.preparing === 1 ? '1 layer' : `${formatCount(this.preparing)} layers`;
    return html`<div class="notice chip" role="status" style=${`--k-progress: ${String(percent)}%`}>
      Preparing ${layers}…
      <span class="bar" aria-hidden="true"></span>
    </div>`;
  }
}

customElements.define('karmania-map-area', KarmaniaMapArea);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-map-area': KarmaniaMapArea;
  }

  interface HTMLElementEventMap {
    [IMPORT_REQUEST]: CustomEvent;
    [SHOW_LEGEND]: CustomEvent;
    [POINTER_ON_MAP]: CustomEvent<PointerOnMap>;
    [FILES_DROPPED]: CustomEvent<DroppedFiles>;
  }
}
