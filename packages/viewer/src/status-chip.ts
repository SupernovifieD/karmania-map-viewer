import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { Readout } from './pointer-readout.js';

/**
 * The status chip of the map (section 10.2 of the brief), 24 high: where the pointer is in the map's coordinate system (`X 512,345.12  Y
 * 4,012,345.67`, in the caption size with tabular numbers, and a dash when the pointer is off the map or the view is 3D). Each coordinate has
 * the room of its longest text (`chars` of them), right-aligned, so that nothing in the chip moves as the pointer does. It is not for the
 * pointer itself.
 */
export class KarmaniaStatusChip extends LitElement {
  static override properties = {
    readout: { attribute: false },
    chars: { type: Number },
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

  constructor() {
    super();
    this.readout = undefined;
    this.chars = 0;
  }

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
      </div>
    `;
  }
}

customElements.define('karmania-status-chip', KarmaniaStatusChip);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-status-chip': KarmaniaStatusChip;
  }
}
