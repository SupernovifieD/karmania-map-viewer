import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import { isIconName } from './icons.js';
import type { IconName } from './icons.js';
import './icon.js';

/** How a button looks: the main action, an ordinary one, or one that stays quiet. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/** A button's height in pixels: compact (inside tables) or the default. */
export type ButtonSize = 28 | 32;

/**
 * A button: `<k-button variant="primary" icon="upload">Import</k-button>`. It is a native
 * `<button>` inside, so it is focused, pressed and announced as one, and it fires the
 * ordinary `click` event.
 *
 * A button that opens or closes something (a panel, a menu) says whether it is open with
 * `expanded`, which a screen reader announces. It is a property, not an attribute: `true` and
 * `false` both mean something, and so does leaving it unset, for a button that opens nothing.
 *
 * A button needs a name for people who cannot see it: its text, or, with an icon alone, its
 * `label`. A button with neither is a mistake in the page that uses it, and throws. In
 * TypeScript, make buttons with {@link kButton}, which does not compile without one.
 */
export class KButton extends LitElement {
  // Focusing the element focuses the button inside it.
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override properties = {
    variant: { type: String, reflect: true },
    size: { type: Number, reflect: true },
    icon: { type: String },
    label: { type: String },
    disabled: { type: Boolean, reflect: true },
    expanded: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        max-width: 100%;
        vertical-align: middle;
      }

      button {
        align-items: center;
        background: var(--_background);
        border: var(--k-border-width) solid var(--_border);
        border-radius: var(--k-radius-md);
        color: var(--_color);
        cursor: pointer;
        display: inline-flex;
        font-weight: var(--k-weight-medium);
        gap: var(--k-space-8);
        height: var(--_height);
        justify-content: center;
        line-height: var(--k-line-height-body);
        max-width: 100%;
        min-width: 0;
        padding: 0 var(--k-space-12);
        position: relative;
        transition:
          background-color var(--k-motion-duration) var(--k-motion-easing),
          border-color var(--k-motion-duration) var(--k-motion-easing);
      }

      /* An icon alone makes a square, at least as big as a hit target: a compact icon button is
         as high as a default one rather than smaller than a finger can be expected to hit. */
      button.icon-only {
        height: max(var(--_height), var(--k-hit-target));
        padding: 0;
        width: max(var(--_height), var(--k-hit-target));
      }

      .text {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      :host([size='28']) button {
        --_height: var(--k-control-height-compact);
      }

      :host(:not([size='28'])) button {
        --_height: var(--k-control-height);
      }

      /* Variants. Each sets the colors of the button at rest, under the pointer, and pressed;
         secondary is the default. */
      button,
      :host([variant='secondary']) button {
        --_background: var(--k-surface);
        --_border: var(--k-border-strong);
        --_color: var(--k-text);
        --_hover: var(--k-surface-raised);
        --_hover-border: var(--k-border-strong);
        --_pressed: var(--k-border);
        --_pressed-border: var(--k-border-strong);
      }

      :host([variant='primary']) button {
        --_background: var(--k-accent);
        --_border: var(--k-accent);
        --_color: var(--k-on-accent);
        --_hover: color-mix(in srgb, var(--k-accent), var(--k-text) 14%);
        --_hover-border: var(--_hover);
        --_pressed: color-mix(in srgb, var(--k-accent), var(--k-text) 24%);
        --_pressed-border: var(--_pressed);
      }

      :host([variant='ghost']) button {
        --_background: transparent;
        --_border: transparent;
        --_color: var(--k-text);
        --_hover: var(--k-surface-raised);
        --_hover-border: transparent;
        --_pressed: var(--k-border);
        --_pressed-border: transparent;
      }

      button:hover:not(:disabled) {
        background: var(--_hover);
        border-color: var(--_hover-border);
      }

      button:active:not(:disabled) {
        background: var(--_pressed);
        border-color: var(--_pressed-border);
      }

      button:disabled {
        background: var(--k-surface-raised);
        border-color: var(--k-border);
        color: var(--k-text-muted);
        cursor: not-allowed;
      }

      :host([variant='ghost']) button:disabled {
        background: transparent;
        border-color: transparent;
      }
    `,
  ];

  declare variant: ButtonVariant;
  declare size: ButtonSize;
  /** The icon drawn before the text, or alone. */
  declare icon: IconName | undefined;
  /** The button's name, for when its content is an icon alone. */
  declare label: string | undefined;
  declare disabled: boolean;
  /** Whether what the button opens is open; `undefined` for a button that opens nothing. */
  declare expanded: boolean | undefined;

  constructor() {
    super();
    this.variant = 'secondary';
    this.size = 32;
    this.icon = undefined;
    this.label = undefined;
    this.disabled = false;
    this.expanded = undefined;
  }

  /** Whether the button has anything to read: text between its tags. */
  private get hasText(): boolean {
    return this.textContent.trim() !== '';
  }

  override render() {
    const iconOnly = !this.hasText;
    // A compact button has room for the small icon only.
    const iconSize = this.size === 28 || !iconOnly ? 16 : 20;
    const icon: string | undefined = this.icon;
    return html`
      <button
        type="button"
        class=${iconOnly ? 'icon-only' : ''}
        ?disabled=${this.disabled}
        aria-label=${ifDefined(this.label === '' ? undefined : this.label)}
        aria-expanded=${ifDefined(this.expanded === undefined ? undefined : String(this.expanded))}
      >
        ${
          icon !== undefined && isIconName(icon)
            ? html`<k-icon name=${icon} size=${iconSize}></k-icon>`
            : nothing
        }
        <span class="text" data-truncate ?hidden=${iconOnly}>
          <slot
            @slotchange=${() => {
              this.requestUpdate();
            }}
          ></slot>
        </span>
      </button>
    `;
  }

  protected override updated(): void {
    const named = this.hasText || (this.label !== undefined && this.label.trim() !== '');
    if (!named) {
      throw new Error(
        'A k-button needs text or, for an icon alone, a label: it would have no name for people who cannot see it.',
      );
    }
  }
}

defineOnce('k-button', KButton);

declare global {
  interface HTMLElementTagNameMap {
    'k-button': KButton;
  }
}

/** What every button can be told. */
interface ButtonLook {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  /** Whether what the button opens is open. Leave it out for a button that opens nothing. */
  readonly expanded?: boolean;
}

/** A button that says what it does in words, and may have an icon beside them. */
interface TextButton extends ButtonLook {
  readonly icon?: IconName;
  /** What the button says. */
  readonly children: string;
  readonly label?: string;
}

/** A button that is an icon alone, which must be given a name. */
interface IconOnlyButton extends ButtonLook {
  readonly icon: IconName;
  /** What the button does, for people who cannot see the icon: "Close", "Remove dataset". */
  readonly label: string;
  readonly children?: never;
}

/** The properties of a button: with words, or an icon with a `label`. Nothing else compiles. */
export type ButtonProps = TextButton | IconOnlyButton;

/**
 * A `<k-button>` for a Lit template. Unlike the bare element, this does not compile for an
 * icon alone without a `label`.
 */
export function kButton(props: ButtonProps): TemplateResult {
  return html`<k-button
    variant=${ifDefined(props.variant)}
    size=${ifDefined(props.size)}
    icon=${ifDefined(props.icon)}
    label=${ifDefined(props.label)}
    ?disabled=${props.disabled ?? false}
    .expanded=${props.expanded}
    >${props.children}</k-button
  >`;
}
