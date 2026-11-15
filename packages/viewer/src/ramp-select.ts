import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { rampPreview } from './legend-style.js';
import type { RampOption } from './legend-style.js';

/** The name of the event the picker sends when a person chooses a ramp. */
export const RAMP_CHANGE = 'karmania-ramp-change';

/** What the picker sends: the id of the ramp that was chosen. */
export interface RampChange {
  readonly id: string;
}

/**
 * A select whose face and whose choices show the ramps (section 10.3 of the brief): the ramp that is chosen, as a strip of its colours beside its name, and,
 * opened, a list with a strip and a name for each, in the direction the layer has (`reverse`). It is a select-only combobox: the face is the combobox and has the
 * keyboard throughout, and the list, which is in the page where it is opened (it pushes what is under it away, and does not cover it), is its listbox, with
 * the choice that the arrows are at as `aria-activedescendant`. Enter, Space and Down open it; Up and Down, Home and End move; Enter and Space choose; Escape and
 * leaving it close it. The choice that is made has a tick as well as being the one that is marked.
 */
export class KarmaniaRampSelect extends LitElement {
  static override properties = {
    label: { type: String },
    value: { type: String },
    reverse: { type: Boolean },
    options: { attribute: false },
    open: { state: true },
    active: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .label {
        color: var(--k-text);
        display: block;
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        margin-bottom: var(--k-space-4);
      }

      .face {
        align-items: center;
        background: var(--k-surface);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-md);
        box-sizing: border-box;
        color: var(--k-text);
        cursor: pointer;
        display: flex;
        font: inherit;
        gap: var(--k-space-8);
        height: var(--k-control-height);
        padding: 0 var(--k-space-8);
        text-align: left;
        width: 100%;
      }

      .face:hover {
        border-color: var(--k-text-muted);
      }

      .face:focus-visible {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: var(--k-focus-offset);
      }

      .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* The strip of a ramp: its colours, in the room of 48 by 12. */
      .strip {
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-sm);
        box-sizing: border-box;
        flex: none;
        height: var(--k-space-12);
        width: var(--k-space-48);
      }

      ul {
        background: var(--k-surface);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-md);
        list-style: none;
        margin: var(--k-space-4) 0 0;
        max-height: calc(var(--k-control-height) * 6);
        overflow: hidden auto;
        padding: 0;
      }

      li {
        align-items: center;
        cursor: pointer;
        display: flex;
        gap: var(--k-space-8);
        height: var(--k-control-height);
        padding: 0 var(--k-space-8);
      }

      li:hover,
      li[data-active] {
        background: var(--k-surface-raised);
      }

      /* The option the arrows are at has a ring inside it, as a row of the Legend tab has. */
      li[data-active] {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      .tick {
        color: var(--k-accent);
        flex: none;
        height: var(--k-icon-size-sm);
        width: var(--k-icon-size-sm);
      }
    `,
  ];

  declare label: string;
  /** The id of the ramp that is chosen. */
  declare value: string;
  /** Whether the layer uses its ramp from the last colour: the strips are drawn that way. */
  declare reverse: boolean;
  declare options: readonly RampOption[];
  declare private open: boolean;
  /** The index of the option that the arrows are at while the list is open. */
  declare private active: number;

  constructor() {
    super();
    this.label = '';
    this.value = '';
    this.reverse = false;
    this.options = [];
    this.open = false;
    this.active = 0;
  }

  private get chosen(): number {
    return Math.max(
      this.options.findIndex((option) => option.id === this.value),
      0,
    );
  }

  private show(): void {
    this.active = this.chosen;
    this.open = true;
  }

  private choose(index: number): void {
    const option = this.options[index];
    this.open = false;
    if (option !== undefined && option.id !== this.value) {
      this.dispatchEvent(
        new CustomEvent<RampChange>(RAMP_CHANGE, {
          detail: { id: option.id },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const last = this.options.length - 1;
    if (!this.open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        this.show();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.active = Math.min(this.active + 1, last);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.active = Math.max(this.active - 1, 0);
        break;
      case 'Home':
        event.preventDefault();
        this.active = 0;
        break;
      case 'End':
        event.preventDefault();
        this.active = last;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.choose(this.active);
        break;
      case 'Escape':
        event.preventDefault();
        this.open = false;
        break;
      case 'Tab':
        this.open = false;
        break;
      default:
        break;
    }
  };

  /** Keeps the option that the arrows are at in sight in a list that scrolls. */
  protected override updated(): void {
    if (this.open) {
      this.renderRoot.querySelector('li[data-active]')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private strip(option: RampOption) {
    return html`<span
      class="strip"
      aria-hidden="true"
      style=${`background: ${rampPreview(option.colours, option.kind, this.reverse)}`}
    ></span>`;
  }

  override render() {
    const chosen = this.options[this.chosen];
    return html`
      <span class="label" id="label">${this.label}</span>
      <button
        type="button"
        class="face"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-controls=${this.open ? 'list' : nothing}
        aria-activedescendant=${this.open ? `option-${String(this.active)}` : nothing}
        aria-labelledby="label current"
        @click=${() => {
          if (this.open) {
            this.open = false;
          } else {
            this.show();
          }
        }}
        @keydown=${this.onKeyDown}
        @focusout=${(event: FocusEvent) => {
          if (!this.renderRoot.contains(event.relatedTarget as Node | null)) {
            this.open = false;
          }
        }}
      >
        ${chosen === undefined ? nothing : this.strip(chosen)}
        <span class="name" id="current">${chosen?.name ?? ''}</span>
        <k-icon name="chevron-down" size="16" aria-hidden="true"></k-icon>
      </button>
      ${
        this.open
          ? html`<ul id="list" role="listbox" aria-labelledby="label">
              ${this.options.map(
                (option, index) => html`
                  <li
                    id=${`option-${String(index)}`}
                    role="option"
                    aria-selected=${option.id === this.value ? 'true' : 'false'}
                    ?data-active=${index === this.active}
                    @pointerdown=${(event: PointerEvent) => {
                      // The face keeps the keyboard: pressing an option must not take it, and then close the list as focus leaves.
                      event.preventDefault();
                    }}
                    @click=${() => {
                      this.choose(index);
                    }}
                  >
                    ${this.strip(option)}
                    <span class="name">${option.name}</span>
                    ${
                      option.id === this.value
                        ? html`<k-icon
                            class="tick"
                            name="check"
                            size="16"
                            aria-hidden="true"
                          ></k-icon>`
                        : html`<span class="tick"></span>`
                    }
                  </li>
                `,
              )}
            </ul>`
          : nothing
      }
    `;
  }
}

customElements.define('karmania-ramp-select', KarmaniaRampSelect);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-ramp-select': KarmaniaRampSelect;
  }

  interface HTMLElementEventMap {
    [RAMP_CHANGE]: CustomEvent<RampChange>;
  }
}
