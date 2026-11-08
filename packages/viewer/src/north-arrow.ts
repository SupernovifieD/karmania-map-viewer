import { northArrow } from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/** The name of the event the north arrow sends when a person asks for north to be up. */
export const NORTH_RESET = 'karmania-north-reset';

/**
 * The north arrow of the map (section 10.2 of the brief): a button, 40 by 40, over the map, with a needle that turns with the map's
 * heading and shows where grid north is (up is +y of the map's coordinate system, which is not true north). Pressing it, or Enter
 * or Space with the keyboard on it, asks for north to be up: it sends `karmania-north-reset`, and what the camera does is the
 * viewer's. The button does not move, only the needle does. Its name says the angle, so that a screen reader says how the map is turned.
 */
export class KarmaniaNorthArrow extends LitElement {
  static override properties = {
    heading: { type: Number },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        height: calc(var(--k-space-8) * 5);
        width: calc(var(--k-space-8) * 5);
      }

      k-tooltip {
        display: block;
      }

      button {
        background: var(--k-surface-raised);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-lg);
        box-sizing: border-box;
        color: var(--k-text);
        cursor: pointer;
        display: block;
        height: calc(var(--k-space-8) * 5);
        padding: 0;
        width: calc(var(--k-space-8) * 5);
      }

      button:hover {
        background: var(--k-surface);
      }

      button:active {
        background: var(--k-border);
      }

      /* The ring is drawn outside the button, where nothing cuts it off. */
      button:focus-visible {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: var(--k-focus-offset);
      }

      svg {
        display: block;
        height: 100%;
        width: 100%;
      }

      .head {
        fill: var(--k-accent);
      }

      .tail {
        stroke: var(--k-text-muted);
      }

      .letter {
        stroke: var(--k-text);
      }
    `,
  ];

  /** Degrees clockwise from grid north that the top of the map faces: the camera's heading. */
  declare heading: number;

  constructor() {
    super();
    this.heading = 0;
  }

  private readonly onClick = (): void => {
    this.dispatchEvent(new CustomEvent(NORTH_RESET, { bubbles: true, composed: true }));
  };

  override render() {
    const arrow = northArrow(this.heading);
    // The name is the action and then how the map is turned; the tooltip, for those who see it, is the action alone.
    return html`
      <k-tooltip text="Reset to north" placement="left">
        <button type="button" aria-label=${`Reset to north. ${arrow.label}`} @click=${this.onClick}>
          <!-- The needle and the N above it turn about the middle of the button: nothing is clipped, the farthest point is 15 of the 20. -->
          <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
            <g
              data-angle=${String(arrow.angle)}
              transform=${`rotate(${String(arrow.angle)} 20 20)`}
            >
              <path
                class="letter"
                d="M17 11V5L23 11V5"
                fill="none"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path class="head" d="M20 14L25.5 29L20 25.5L14.5 29Z" />
              <path
                class="tail"
                d="M20 25.5V34"
                fill="none"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </g>
          </svg>
        </button>
      </k-tooltip>
    `;
  }
}

customElements.define('karmania-north-arrow', KarmaniaNorthArrow);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-north-arrow': KarmaniaNorthArrow;
  }

  interface HTMLElementEventMap {
    [NORTH_RESET]: CustomEvent;
  }
}
