import { css, html, LitElement, nothing } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import { isIconName } from './icons.js';
import type { IconName } from './icons.js';
import './icon.js';

/**
 * What to show where there is nothing yet, centred in the space it is given:
 *
 * ```html
 * <k-empty-state icon="map" heading="No data yet">
 *   Drop files here or use Import
 *   <k-button slot="action" variant="secondary" icon="upload">Import</k-button>
 * </k-empty-state>
 * ```
 *
 * An icon (muted, 32 pixels), a heading, a line of text and an optional action, in that order,
 * 8 pixels apart and 16 before the action. Every part is optional. Long text wraps in a column
 * of limited width, so it does not stretch across a wide window.
 */
export class KEmptyState extends LitElement {
  static override properties = {
    icon: { type: String },
    heading: { type: String },
  };

  static override styles = [
    sharedStyles,
    css`
      /* Centred in the space it is given. If its content is taller than that, which long text in
         a small space can make it, it scrolls: an auto margin centres what fits and, unlike
         centring with justify-content, still lets a person scroll to the top of what does not. */
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-width: 0;
        overflow: auto;
        padding: var(--k-space-24);
        text-align: center;
        width: 100%;
      }

      .group {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: var(--k-space-8);
        margin: auto;
        max-width: calc(var(--k-space-48) * 6);
        min-width: 0;
      }

      .icon {
        color: var(--k-text-muted);
      }

      .heading {
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
        margin: 0;
        overflow-wrap: anywhere;
      }

      .message {
        color: var(--k-text-muted);
        margin: 0;
        overflow-wrap: anywhere;
      }

      /* The action is 16 pixels from what is above it: the gap of 8 and 8 more. */
      .action {
        margin-top: var(--k-space-8);
      }

      .action[hidden],
      .message[hidden] {
        display: none;
      }
    `,
  ];

  /** The icon at the top, drawn at 32 pixels. */
  declare icon: IconName | undefined;
  /** The heading: what is missing. */
  declare heading: string | undefined;

  constructor() {
    super();
    this.icon = undefined;
    this.heading = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Marks it, for the layout checks, as a place that may scroll.
    this.toggleAttribute('data-scroll-region', true);
  }

  /** Whether something was put in the slot called `name` (or, with none, in the default slot). */
  private has(name: string | undefined): boolean {
    return [...this.childNodes].some((node) =>
      name === undefined
        ? (node instanceof Text && node.textContent.trim() !== '') ||
          (node instanceof Element && !node.hasAttribute('slot'))
        : node instanceof Element && node.getAttribute('slot') === name,
    );
  }

  override render() {
    const icon: string | undefined = this.icon;
    const heading = this.heading ?? '';
    const refresh = (): void => {
      this.requestUpdate();
    };
    return html`
      <div class="group">
        ${
          icon !== undefined && isIconName(icon)
            ? html`<k-icon class="icon" name=${icon} size="32"></k-icon>`
            : nothing
        }
        ${heading === '' ? nothing : html`<p class="heading">${heading}</p>`}
        <p class="message" ?hidden=${!this.has(undefined)}>
          <slot @slotchange=${refresh}></slot>
        </p>
        <div class="action" ?hidden=${!this.has('action')}>
          <slot name="action" @slotchange=${refresh}></slot>
        </div>
      </div>
    `;
  }
}

defineOnce('k-empty-state', KEmptyState);

declare global {
  interface HTMLElementTagNameMap {
    'k-empty-state': KEmptyState;
  }
}
