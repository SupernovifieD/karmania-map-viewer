import { css, html, LitElement } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import { iconShapes, isIconName } from './icons.js';
import type { IconName } from './icons.js';

/** The sizes an icon is drawn at, in the tokens' pixels: beside text, and in buttons. */
export type IconSize = 16 | 20;

/** How Lucide draws its icons, in its 24-unit square. */
const DRAWING = { viewBox: '0 0 24 24', strokeWidth: '2' } as const;

/**
 * An icon: `<k-icon name="upload"></k-icon>`, 16 or 20 pixels square (`size`), in the color
 * of the text around it. An icon is decoration and hidden from screen readers unless it has a
 * `label`, which makes it an image with that name.
 */
export class KIcon extends LitElement {
  static override properties = {
    name: { type: String, reflect: true },
    size: { type: Number, reflect: true },
    label: { type: String },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        flex: none;
        height: var(--k-icon-size-sm);
        width: var(--k-icon-size-sm);
      }

      :host([size='20']) {
        height: var(--k-icon-size-md);
        width: var(--k-icon-size-md);
      }

      svg {
        display: block;
        height: 100%;
        width: 100%;
      }
    `,
  ];

  /** The icon to draw. An unknown name draws nothing. */
  declare name: IconName;
  /** 16 (the default) or 20. */
  declare size: IconSize;
  /** What the icon means, if it carries meaning of its own; otherwise it is hidden from assistive technology. */
  declare label: string | undefined;

  constructor() {
    super();
    this.size = 16;
    this.label = undefined;
  }

  override render() {
    // The name may come from an attribute, so it is checked, whatever its type says.
    const name: string = this.name;
    if (!isIconName(name)) {
      return html``;
    }
    const labelled = this.label !== undefined && this.label !== '';
    return html`<svg
      viewBox=${DRAWING.viewBox}
      fill="none"
      stroke="currentColor"
      stroke-width=${DRAWING.strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      role=${ifDefined(labelled ? 'img' : undefined)}
      aria-label=${ifDefined(labelled ? this.label : undefined)}
      aria-hidden=${ifDefined(labelled ? undefined : 'true')}
      focusable="false"
    >
      ${unsafeSVG(iconShapes(name))}
    </svg>`;
  }
}

defineOnce('k-icon', KIcon);

declare global {
  interface HTMLElementTagNameMap {
    'k-icon': KIcon;
  }
}
