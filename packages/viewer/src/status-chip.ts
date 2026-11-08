import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { MapCrsText } from './map-crs-text.js';
import type { Readout } from './pointer-readout.js';

/** The name of the event the chip sends when a person asks to change the map's coordinate system. */
export const MAP_CRS_REQUEST = 'karmania-map-crs-request';

/**
 * The status chip of the map (section 10.2 of the brief), 24 high: where the pointer is in the map's coordinate system (`X 512,345.12  Y
 * 4,012,345.67`, in the caption size with tabular numbers, and a dash when the pointer is off the map or the view is 3D), a separator, and the
 * map's coordinate system as a button (`EPSG:32640`, `Local grid, m`) that asks to change it (`karmania-map-crs-request`), with the whole
 * name in its tooltip. Each coordinate has the room of its longest text (`chars` of them), right-aligned, so that nothing in the chip moves as
 * the pointer does. Nothing in it is for the pointer but the button.
 */
export class KarmaniaStatusChip extends LitElement {
  static override properties = {
    readout: { attribute: false },
    chars: { type: Number },
    crs: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .status {
        align-items: center;
        background: var(--k-surface-raised);
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-lg);
        box-sizing: border-box;
        color: var(--k-text);
        display: flex;
        font-size: var(--k-font-size-caption);
        font-variant-numeric: tabular-nums;
        gap: var(--k-space-8);
        height: var(--k-space-24);
        line-height: var(--k-line-height-caption);
        padding: 0 var(--k-space-8);
        white-space: nowrap;
      }

      /* The two coordinates, each with the room of its longest text: a label, and the number to its right, aligned on the right. */
      .coordinates {
        column-gap: var(--k-space-4);
        display: grid;
        grid-template-columns: auto var(--_room) auto var(--_room);
        position: relative;
      }

      .axis {
        color: var(--k-text-muted);
      }

      .axis:nth-of-type(2) {
        margin-inline-start: var(--k-space-8);
      }

      .value {
        text-align: right;
      }

      /* With the pointer off the map the same cells are there, hidden, so that the chip is as wide as it is with numbers in them, and the dash is on
         top of them at the start. */
      .coordinates[data-off] > :not(.off) {
        visibility: hidden;
      }

      .separator {
        background: var(--k-border-strong);
        block-size: var(--k-space-12);
        flex: none;
        inline-size: var(--k-border-width);
      }

      /* The button is the only part that is for the pointer (the chip itself is over the map and takes none). Its ring is drawn inside it, since
         the chip is as high as the button and a ring outside would be on the chip's border. */
      k-tooltip {
        pointer-events: auto;
      }

      .crs {
        background: transparent;
        border: 0;
        border-radius: var(--k-radius-sm);
        color: var(--k-text);
        cursor: pointer;
        font: inherit;
        font-variant-numeric: inherit;
        height: calc(var(--k-space-16) + var(--k-space-4));
        padding: 0 var(--k-space-4);
      }

      .crs:hover {
        background: var(--k-surface);
      }

      .crs:active {
        background: var(--k-border);
      }

      .crs:focus-visible {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      .off {
        inset-block-start: 0;
        inset-inline-start: 0;
        position: absolute;
      }
    `,
  ];

  /** Where the pointer is, written; `undefined` for off the map or the 3D view. */
  declare readout: Readout | undefined;
  /** How many characters wide the longest coordinate can be at this camera: the room each is given. */
  declare chars: number;
  /** What the button says of the map's coordinate system, and what its tooltip does. */
  declare crs: MapCrsText | undefined;

  constructor() {
    super();
    this.readout = undefined;
    this.chars = 0;
    this.crs = undefined;
  }

  private readonly onRequest = (): void => {
    this.dispatchEvent(new CustomEvent(MAP_CRS_REQUEST, { bubbles: true, composed: true }));
  };

  override render() {
    const readout = this.readout;
    return html`
      <div class="status" role="group" aria-label="Pointer position">
        <div
          class="coordinates"
          ?data-off=${readout === undefined}
          style=${`--_room: ${String(Math.max(this.chars, 1))}ch`}
        >
          <span class="axis">X</span><span class="value">${readout?.x ?? ''}</span
          ><span class="axis">Y</span><span class="value">${readout?.y ?? ''}</span>
          ${readout === undefined ? html`<span class="off">—</span>` : nothing}
        </div>
        ${
          this.crs === undefined
            ? nothing
            : html`<span class="separator" aria-hidden="true"></span>
                <k-tooltip text=${this.crs.title}>
                  <button
                    type="button"
                    class="crs"
                    aria-haspopup="dialog"
                    aria-label=${`Map coordinate system: ${this.crs.label}`}
                    @click=${this.onRequest}
                  >
                    ${this.crs.label}
                  </button>
                </k-tooltip>`
        }
      </div>
    `;
  }
}

customElements.define('karmania-status-chip', KarmaniaStatusChip);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-status-chip': KarmaniaStatusChip;
  }

  interface HTMLElementEventMap {
    [MAP_CRS_REQUEST]: CustomEvent;
  }
}
