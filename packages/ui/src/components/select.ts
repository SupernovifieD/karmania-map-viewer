import { css, html, LitElement, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { defineOnce } from '../define.js';
import { fieldStyles } from './field-styles.js';
import { sharedStyles } from '../shared-styles.js';
import './icon.js';

/** One choice of a select. */
export interface SelectOption {
  /** What the select's value is while this is chosen. */
  readonly value: string;
  /** What a person reads. */
  readonly label: string;
  readonly disabled?: boolean;
}

/** The name of the event a select sends when a person chooses something. */
export const SELECT_CHANGE = 'k-select-change';

/** What a select sends when a person chooses something. */
export interface SelectChange {
  readonly value: string;
}

/**
 * A choice from a list, with its label above it:
 *
 * ```html
 * <k-select label="Kind" value="points" .options=${[{ value: 'points', label: 'Points' }, ...]}></k-select>
 * ```
 *
 * It is a native `<select>` inside, so the keyboard, the list that opens and what screen readers say
 * are the browser's own. It takes the width it is given and cuts a choice that is too long with an
 * ellipsis. `size="28"` makes it compact, for inside a table, where `hide-label` keeps the label for
 * those who cannot see it and takes it off the screen. `help` is a line under it; `reserve` keeps
 * that line's room free when there is none. A person's choice is sent as `k-select-change`; the
 * value is the page's to keep, as for any native control.
 */
export class KSelect extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override properties = {
    label: { type: String },
    value: { type: String },
    options: { attribute: false },
    disabled: { type: Boolean, reflect: true },
    size: { type: Number, reflect: true },
    hideLabel: { type: Boolean, attribute: 'hide-label' },
    help: { type: String },
    reserve: { type: Boolean, reflect: true },
    // What a tooltip says of the select, which it sets as the select's `aria-description`: the control that a screen reader reaches is the native one inside.
    description: { type: String, attribute: 'aria-description' },
  };

  static override styles = [
    sharedStyles,
    fieldStyles,
    css`
      select {
        appearance: none;
        cursor: pointer;
        padding-right: var(--k-space-32);
      }

      select:disabled {
        cursor: not-allowed;
      }

      /* The arrow is drawn over the right of the control, out of the pointer's way, 8 inside the
         border as the text is on the left. */
      .chevron {
        color: var(--k-text-muted);
        pointer-events: none;
        position: absolute;
        right: calc(var(--k-space-8) + var(--k-border-width));
        top: 50%;
        translate: 0 -50%;
      }
    `,
  ];

  declare label: string;
  declare value: string;
  declare options: readonly SelectOption[];
  declare disabled: boolean;
  declare size: 28 | 32;
  declare hideLabel: boolean;
  declare help: string;
  declare reserve: boolean;
  /** A description for people who cannot see the page, given as the attribute `aria-description` (which a tooltip does): the native select has it. */
  declare description: string | null;

  constructor() {
    super();
    this.label = '';
    this.value = '';
    this.options = [];
    this.disabled = false;
    this.size = 32;
    this.hideLabel = false;
    this.help = '';
    this.reserve = false;
    this.description = null;
  }

  private readonly onChange = (event: Event): void => {
    const select = event.target as HTMLSelectElement;
    this.value = select.value;
    this.dispatchEvent(
      new CustomEvent<SelectChange>(SELECT_CHANGE, {
        detail: { value: select.value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Shows the value the page gave. A native select that a person has changed no longer follows the
   * `selected` of its options, so a select that is given another value afterwards (the same select,
   * used for another column) would go on showing the old one.
   */
  protected override updated(): void {
    const select = this.renderRoot.querySelector('select');
    if (select !== null && select.value !== this.value) {
      select.value = this.value;
    }
  }

  override render() {
    return html`
      <div class="field">
        <label for="control" class=${this.hideLabel ? 'visually-hidden' : ''}>${this.label}</label>
        <div class="control">
          <select
            id="control"
            ?disabled=${this.disabled}
            aria-describedby=${this.help === '' ? nothing : 'help'}
            aria-description=${ifDefined(this.description === null || this.description === '' ? undefined : this.description)}
            @change=${this.onChange}
          >
            ${this.options.map(
              (option) =>
                html`<option
                  value=${option.value}
                  ?disabled=${option.disabled ?? false}
                  ?selected=${option.value === this.value}
                >
                  ${option.label}
                </option>`,
            )}
          </select>
          <k-icon class="chevron" name="chevron-down" size="16"></k-icon>
        </div>
        ${
          this.help === '' && !this.reserve
            ? nothing
            : html`<div class="message">
                ${this.help === '' ? nothing : html`<span class="help" id="help">${this.help}</span>`}
              </div>`
        }
      </div>
    `;
  }
}

defineOnce('k-select', KSelect);

declare global {
  interface HTMLElementTagNameMap {
    'k-select': KSelect;
  }

  interface HTMLElementEventMap {
    [SELECT_CHANGE]: CustomEvent<SelectChange>;
  }
}
