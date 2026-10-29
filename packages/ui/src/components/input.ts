import { html, LitElement, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { defineOnce } from '../define.js';
import { fieldStyles } from './field-styles.js';
import { sharedStyles } from '../shared-styles.js';
import './icon.js';

/** The name of the event an input sends when a person changes its text. */
export const INPUT_CHANGE = 'k-input-change';

/** What an input sends when a person changes its text. */
export interface InputChange {
  readonly value: string;
}

/** What kind of text the keyboard of a phone or tablet should offer. */
export type InputMode = 'text' | 'numeric' | 'decimal';

/**
 * A line of text, with its label above it:
 *
 * ```html
 * <k-input label="Dataset name" value="Collars" help="Shown in the Data tab"></k-input>
 * ```
 *
 * It is a native `<input>` inside. It takes the width it is given and scrolls a value that is too
 * long, as an input does. `size="28"` makes it compact, with `hide-label` to keep the label for
 * those who cannot see it and take it off the screen. `help` is a line under it, and `error` takes
 * its place when something is wrong: it is said in words with an icon, and the input is marked
 * invalid for screen readers; `reserve` keeps that line's room free, so that a message appearing
 * moves nothing. Every change is sent, as it is made, as `k-input-change`.
 */
export class KInput extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override properties = {
    label: { type: String },
    value: { type: String },
    placeholder: { type: String },
    disabled: { type: Boolean, reflect: true },
    size: { type: Number, reflect: true },
    hideLabel: { type: Boolean, attribute: 'hide-label' },
    help: { type: String },
    error: { type: String },
    invalid: { type: Boolean, reflect: true },
    reserve: { type: Boolean, reflect: true },
    inputMode: { type: String, attribute: 'inputmode' },
  };

  static override styles = [sharedStyles, fieldStyles];

  declare label: string;
  declare value: string;
  declare placeholder: string;
  declare disabled: boolean;
  declare size: 28 | 32;
  declare hideLabel: boolean;
  declare help: string;
  /** What is wrong with the value, in words; empty when nothing is. */
  declare error: string;
  /** Set along with `error`, for the styles. */
  declare invalid: boolean;
  declare reserve: boolean;
  declare inputMode: InputMode;

  constructor() {
    super();
    this.label = '';
    this.value = '';
    this.placeholder = '';
    this.disabled = false;
    this.size = 32;
    this.hideLabel = false;
    this.help = '';
    this.error = '';
    this.invalid = false;
    this.reserve = false;
    this.inputMode = 'text';
  }

  protected override willUpdate(): void {
    this.invalid = this.error !== '';
  }

  private readonly onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.dispatchEvent(
      new CustomEvent<InputChange>(INPUT_CHANGE, {
        detail: { value: input.value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  override render() {
    const describedBy = this.error !== '' ? 'error' : this.help === '' ? undefined : 'help';
    return html`
      <div class="field">
        <label for="control" class=${this.hideLabel ? 'visually-hidden' : ''}>${this.label}</label>
        <div class="control">
          <input
            id="control"
            type="text"
            autocomplete="off"
            spellcheck="false"
            .value=${this.value}
            placeholder=${ifDefined(this.placeholder === '' ? undefined : this.placeholder)}
            inputmode=${this.inputMode}
            ?disabled=${this.disabled}
            aria-invalid=${this.invalid ? 'true' : nothing}
            aria-describedby=${ifDefined(describedBy)}
            @input=${this.onInput}
          />
        </div>
        ${
          this.error === '' && this.help === '' && !this.reserve
            ? nothing
            : html`<div class="message">
                ${
                  this.error !== ''
                    ? html`<span class="error" id="error"
                        ><k-icon name="circle-alert" size="16"></k-icon>${this.error}</span
                      >`
                    : this.help === ''
                      ? nothing
                      : html`<span class="help" id="help">${this.help}</span>`
                }
              </div>`
        }
      </div>
    `;
  }
}

defineOnce('k-input', KInput);

declare global {
  interface HTMLElementTagNameMap {
    'k-input': KInput;
  }

  interface HTMLElementEventMap {
    [INPUT_CHANGE]: CustomEvent<InputChange>;
  }
}
