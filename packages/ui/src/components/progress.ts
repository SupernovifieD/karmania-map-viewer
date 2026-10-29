import { css, html, LitElement, nothing } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';

/**
 * How far something has got, as a bar:
 *
 * ```html
 * <k-progress label="Reading the file" value="0.42"></k-progress>
 * ```
 *
 * `value` is a fraction from 0 to 1. Without one (`value` unset, or not a number) the bar says that
 * something is going on but not how far: a short bar that travels along the track, or, for people
 * who ask for less motion, a short bar that stays. The label is above the bar, and the percentage,
 * when there is a value, at the end of its line. It is a progress bar to screen readers, with its
 * value when it has one. The bar grows by scaling, not by changing its width, so that it moves
 * nothing round it.
 */
export class KProgress extends LitElement {
  static override properties = {
    label: { type: String },
    value: { type: Number },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .head {
        align-items: baseline;
        display: flex;
        gap: var(--k-space-8);
        justify-content: space-between;
        margin-bottom: var(--k-space-4);
      }

      .label {
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .percent {
        color: var(--k-text-muted);
        flex: none;
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        line-height: var(--k-line-height-secondary);
      }

      .track {
        background: var(--k-border);
        border-radius: var(--k-radius-sm);
        height: var(--k-space-8);
        overflow: hidden;
      }

      .bar {
        background: var(--k-accent);
        border-radius: var(--k-radius-sm);
        height: 100%;
        transform: scaleX(var(--_fraction));
        transform-origin: left;
        transition: transform var(--k-motion-duration) var(--k-motion-easing);
        width: 100%;
      }

      .bar.unknown {
        animation: travel calc(var(--k-motion-duration) * 8) ease-in-out infinite alternate;
        transform: none;
        width: 30%;
      }

      @keyframes travel {
        from {
          translate: 0 0;
        }
        to {
          translate: 233% 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .bar.unknown {
          animation: none;
        }
      }
    `,
  ];

  /** What is going on, in a few words. */
  declare label: string;
  /** How far it has got, from 0 to 1; not a number when that is not known. */
  declare value: number;

  constructor() {
    super();
    this.label = '';
    this.value = Number.NaN;
  }

  override render() {
    const known = Number.isFinite(this.value);
    const fraction = known ? Math.min(1, Math.max(0, this.value)) : 0;
    const percent = Math.round(fraction * 100);
    return html`
      <div class="head">
        <span class="label" id="label">${this.label}</span>
        ${known ? html`<span class="percent">${String(percent)}%</span>` : nothing}
      </div>
      <div
        class="track"
        role="progressbar"
        aria-labelledby="label"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${known ? String(percent) : nothing}
      >
        <div
          class="bar ${known ? '' : 'unknown'}"
          style=${`--_fraction: ${String(fraction)}`}
        ></div>
      </div>
    `;
  }
}

defineOnce('k-progress', KProgress);

declare global {
  interface HTMLElementTagNameMap {
    'k-progress': KProgress;
  }
}
