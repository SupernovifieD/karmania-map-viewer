import { css, html, LitElement, nothing } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import './icon.js';

/** The name of the event a checkbox sends when a person ticks or unticks it. */
export const CHECKBOX_CHANGE = 'k-checkbox-change';

/** What a checkbox sends when a person ticks or unticks it. */
export interface CheckboxChange {
  readonly checked: boolean;
}

/**
 * A box that is ticked or not, with its label beside it:
 *
 * ```html
 * <k-checkbox checked detail="12 times">NA</k-checkbox>
 * ```
 *
 * The label is what is between the tags, and wraps, however long. `detail` is a muted word or two
 * at the end of the row, such as how often something was found. It is a native checkbox inside, so
 * the keyboard (Space) and what screen readers say are the browser's own, and the whole row, label
 * and all, is what can be pressed, at least as high as a hit target. The state is the page's to
 * keep: a person's change is sent as `k-checkbox-change`, and the page sets `checked`.
 */
export class KCheckbox extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override properties = {
    checked: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    detail: { type: String },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      /* The detail goes under the label, to the right, when the row has too little room for both. */
      label {
        align-items: flex-start;
        cursor: pointer;
        display: flex;
        flex-wrap: wrap;
        gap: 0 var(--k-space-8);
        min-height: var(--k-hit-target);
        /* A single line of text sits in the middle of a hit target's height. */
        padding: calc((var(--k-hit-target) - var(--k-line-height-body)) / 2) 0;
        position: relative;
      }

      :host([disabled]) label {
        color: var(--k-text-muted);
        cursor: not-allowed;
      }

      /* The box is 16, and the first line of text is 20: this puts the box in the middle of it. */
      .box {
        flex: none;
        height: var(--k-icon-size-sm);
        margin-top: var(--k-space-2);
        position: relative;
        width: var(--k-icon-size-sm);
      }

      input {
        appearance: none;
        background: var(--k-surface);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-sm);
        cursor: inherit;
        display: block;
        height: 100%;
        margin: 0;
        transition:
          background-color var(--k-motion-duration) var(--k-motion-easing),
          border-color var(--k-motion-duration) var(--k-motion-easing);
        width: 100%;
      }

      label:hover input:not(:disabled) {
        border-color: var(--k-text-muted);
      }

      input:checked {
        background: var(--k-accent);
        border-color: var(--k-accent);
      }

      input:disabled {
        background: var(--k-surface-raised);
        border-color: var(--k-border);
      }

      input:checked:disabled {
        background: var(--k-text-muted);
        border-color: var(--k-text-muted);
      }

      /* The tick is drawn over the box, when it is ticked, and does not take the pointer. */
      k-icon {
        color: var(--k-on-accent);
        inset: 0;
        opacity: 0;
        pointer-events: none;
        position: absolute;
      }

      :host([checked]) k-icon {
        opacity: 1;
      }

      .text {
        flex: 1 1 calc(var(--k-space-48) * 2);
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .detail {
        color: var(--k-text-muted);
        flex: none;
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        line-height: var(--k-line-height-body);
        margin-left: auto;
        padding-left: var(--k-space-8);
      }
    `,
  ];

  declare checked: boolean;
  declare disabled: boolean;
  /** Muted words at the end of the row. */
  declare detail: string;

  constructor() {
    super();
    this.checked = false;
    this.disabled = false;
    this.detail = '';
  }

  private readonly onChange = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    this.checked = input.checked;
    this.dispatchEvent(
      new CustomEvent<CheckboxChange>(CHECKBOX_CHANGE, {
        detail: { checked: input.checked },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /** Shows the state the page gave, which a person's own click may have changed under it. */
  protected override updated(): void {
    const input = this.renderRoot.querySelector('input');
    if (input !== null && input.checked !== this.checked) {
      input.checked = this.checked;
    }
  }

  override render() {
    return html`
      <label>
        <span class="box">
          <input
            type="checkbox"
            .checked=${this.checked}
            ?disabled=${this.disabled}
            @change=${this.onChange}
          />
          <k-icon name="check" size="16"></k-icon>
        </span>
        <span class="text"><slot></slot></span>
        ${this.detail === '' ? nothing : html`<span class="detail">${this.detail}</span>`}
      </label>
    `;
  }
}

defineOnce('k-checkbox', KCheckbox);

declare global {
  interface HTMLElementTagNameMap {
    'k-checkbox': KCheckbox;
  }

  interface HTMLElementEventMap {
    [CHECKBOX_CHANGE]: CustomEvent<CheckboxChange>;
  }
}
