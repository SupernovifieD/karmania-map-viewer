import { css, html, LitElement } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';

/** One choice of a segmented control. */
export interface SegmentedOption {
  /** What the control's value is while this is chosen. */
  readonly value: string;
  /** What a person reads: short, as the choices sit side by side. */
  readonly label: string;
}

/** The name of the event a segmented control sends when a person chooses something. */
export const SEGMENTED_CHANGE = 'k-segmented-change';

/** What a segmented control sends when a person chooses something. */
export interface SegmentedChange {
  readonly value: string;
}

/**
 * A choice of one from a few short ones, side by side in one box, following the WAI-ARIA radio group pattern:
 *
 * ```html
 * <k-segmented label="View" value="2d" .options=${[{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }]}></k-segmented>
 * ```
 *
 * `label` names the group for people who cannot see it; the choices name themselves. Each choice is at least 48 wide and the box is
 * 32 high. The chosen one is filled, so it is not marked by color alone: it is the one that is darker and has the text in the
 * color that stands out on it. Only the chosen choice is in the Tab order (the first if none is chosen), so Tab goes in once and out
 * once; the arrow keys move between the choices and choose each as they go, wrapping round at the ends, and Home and End go to the
 * first and the last. A person choosing something changes `value` and sends `k-segmented-change`; the page's own `value` is the
 * page's to keep, as for any native control.
 */
export class KSegmented extends LitElement {
  static override properties = {
    label: { type: String },
    value: { type: String },
    options: { attribute: false },
    disabled: { type: Boolean, reflect: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
      }

      /* The box clips the chosen choice's fill to its rounded corners; the focus ring is drawn inside the choice, which has those corners itself, so it is not cut. */
      .group {
        background: var(--k-surface);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-md);
        display: inline-flex;
        height: var(--k-control-height);
        overflow: hidden;
      }

      .option {
        background: transparent;
        border: 0;
        border-radius: 0;
        color: var(--k-text);
        cursor: pointer;
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-body);
        min-width: var(--k-space-48);
        padding: 0 var(--k-space-8);
        transition: background-color var(--k-motion-duration) var(--k-motion-easing);
      }

      .option:hover:not(:disabled, [aria-checked='true']) {
        background: var(--k-surface-raised);
      }

      .option[aria-checked='true'] {
        background: var(--k-accent);
        color: var(--k-on-accent);
      }

      .option:focus-visible {
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      /* The outer corners of the first and last choice are rounded as the inside of the box is (its radius less its border), so that the box's clip
         does not cut the corners of the ring, which follows the choice's own corners. */
      .option:first-child {
        border-top-left-radius: calc(var(--k-radius-md) - var(--k-border-width));
        border-bottom-left-radius: calc(var(--k-radius-md) - var(--k-border-width));
      }

      .option:last-child {
        border-top-right-radius: calc(var(--k-radius-md) - var(--k-border-width));
        border-bottom-right-radius: calc(var(--k-radius-md) - var(--k-border-width));
      }

      /* The ring of the chosen choice is in the color of its words: the accent, which is the ring's own, is the fill there and would not show. */
      .option[aria-checked='true']:focus-visible {
        outline-color: var(--k-on-accent);
      }

      :host([disabled]) .group {
        background: var(--k-surface-raised);
        border-color: var(--k-border);
      }

      .option:disabled {
        color: var(--k-text-muted);
        cursor: not-allowed;
      }

      .option[aria-checked='true']:disabled {
        background: var(--k-border);
      }
    `,
  ];

  /** What the group is called, for people who cannot see it: "View". */
  declare label: string;
  /** The `value` of the chosen option. Anything that is not an option's value means none is chosen. */
  declare value: string;
  declare options: readonly SegmentedOption[];
  declare disabled: boolean;

  constructor() {
    super();
    this.label = '';
    this.value = '';
    this.options = [];
    this.disabled = false;
  }

  protected override willUpdate(): void {
    const values = this.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      throw new Error(
        `The options of a k-segmented must each have a different value, but they are: ${values.join(', ')}.`,
      );
    }
    if (this.label.trim() === '') {
      throw new Error('A k-segmented needs a label, so that its group has a name.');
    }
  }

  /** The option that is in the Tab order: the chosen one, or the first if none is chosen. */
  private get tabbable(): string | undefined {
    return (this.options.find((option) => option.value === this.value) ?? this.options[0])?.value;
  }

  /** Focuses the option the keyboard enters at. The group has to have been drawn (`await updateComplete`). */
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>("[role='radio'][tabindex='0']")?.focus(options);
  }

  private choose(value: string, focus: boolean): void {
    if (focus) {
      this.renderRoot
        .querySelector<HTMLElement>(`[role='radio'][data-value='${CSS.escape(value)}']`)
        ?.focus();
    }
    if (value === this.value) {
      return;
    }
    this.value = value;
    this.dispatchEvent(
      new CustomEvent<SegmentedChange>(SEGMENTED_CHANGE, {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onKeyDown(event: KeyboardEvent, index: number): void {
    // A key with Alt, Control or Command is the browser's (Alt and an arrow is Back, say), not a way to choose.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const last = this.options.length - 1;
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const option = target === undefined ? undefined : this.options[target];
    if (option !== undefined) {
      event.preventDefault();
      this.choose(option.value, true);
    }
  }

  override render() {
    const tabbable = this.tabbable;
    return html`
      <div class="group" role="radiogroup" aria-label=${this.label}>
        ${this.options.map(
          (option, index) => html`
            <button
              type="button"
              class="option"
              role="radio"
              data-value=${option.value}
              aria-checked=${option.value === this.value ? 'true' : 'false'}
              tabindex=${option.value === tabbable ? '0' : '-1'}
              ?disabled=${this.disabled}
              @click=${() => {
                this.choose(option.value, false);
              }}
              @keydown=${(event: KeyboardEvent) => {
                this.onKeyDown(event, index);
              }}
            >
              ${option.label}
            </button>
          `,
        )}
      </div>
    `;
  }
}

defineOnce('k-segmented', KSegmented);

declare global {
  interface HTMLElementTagNameMap {
    'k-segmented': KSegmented;
  }

  interface HTMLElementEventMap {
    [SEGMENTED_CHANGE]: CustomEvent<SegmentedChange>;
  }
}
