import type { ScaleBarModel } from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';

/**
 * The scale bar of the map (section 10.2 of the brief), 24 high: a bar with a tick at each end, as wide as the model says that length is
 * (at most 160), and the length written after it, in the caption size with tabular numbers. The model is the scene's, which the export
 * draws too. With no bar (a map in degrees, the 3D view, units that are not known) it shows nothing. It is not for the pointer: a drag that
 * begins on it is the map's.
 */
export class KarmaniaScaleBar extends LitElement {
  static override properties = {
    model: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        pointer-events: none;
      }

      .scale {
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

      /* A line with a tick up from each end: the bottom and the two sides of a box that is as high as a tick. */
      .bar {
        border: var(--k-border-width) solid var(--k-text);
        border-top: 0;
        box-sizing: border-box;
        flex: none;
        height: var(--k-space-8);
      }
    `,
  ];

  /** The bar to draw, or why there is none; `undefined` before there is a map. */
  declare model: ScaleBarModel | undefined;

  constructor() {
    super();
    this.model = undefined;
  }

  override render() {
    const model = this.model;
    if (model?.kind !== 'bar') {
      return nothing;
    }
    // A whole number of pixels, so that the ticks are on pixels: it is never more than half a pixel off.
    const width = String(Math.round(model.widthPx));
    return html`
      <div class="scale" role="img" aria-label=${`Scale bar, ${model.label}`}>
        <span class="bar" style=${`width: ${width}px`} aria-hidden="true"></span>
        <span aria-hidden="true">${model.label}</span>
      </div>
    `;
  }
}

customElements.define('karmania-scale-bar', KarmaniaScaleBar);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-scale-bar': KarmaniaScaleBar;
  }
}
