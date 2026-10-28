import { css, html, LitElement } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import { placeTooltip } from './tooltip-position.js';
import type { Placement } from './tooltip-position.js';

/**
 * A tooltip for the control inside it:
 *
 * ```html
 * <k-tooltip text="Collapse panel"><k-button icon="chevrons-right" label="Collapse panel"></k-button></k-tooltip>
 * ```
 *
 * It shows when the pointer is over the control, and when the control has keyboard focus (not
 * after a click, which leaves focus behind). Escape puts it away until the pointer or focus
 * comes back, and the pointer may move onto it without it going. It is above the control if
 * there is room and below if not, and always inside the window: it is drawn in the browser's
 * top layer, so no container can clip it.
 *
 * It is for sighted people. A screen reader gets the control's own name, so when the tooltip
 * says something other than the control's name, the control is given it as a description.
 */
export class KTooltip extends LitElement {
  static override properties = {
    text: { type: String },
    placement: { type: String },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        max-width: 100%;
      }

      .tip {
        background: var(--k-text);
        border: 0;
        border-radius: var(--k-radius-sm);
        color: var(--k-surface);
        font-size: var(--k-font-size-caption);
        font-weight: var(--k-weight-medium);
        inset: auto;
        line-height: var(--k-line-height-caption);
        margin: 0;
        max-width: min(calc(var(--k-space-48) * 5), calc(100vw - var(--k-space-16)));
        overflow: visible;
        overflow-wrap: anywhere;
        padding: var(--k-space-4) var(--k-space-8);
        pointer-events: auto;
        position: fixed;
        transition: opacity var(--k-motion-duration) var(--k-motion-easing);
        width: max-content;
      }

      .tip:not(:popover-open) {
        display: none;
      }

      @starting-style {
        .tip:popover-open {
          opacity: 0;
        }
      }
    `,
  ];

  /** What the tooltip says. Without text, there is no tooltip. */
  declare text: string | undefined;
  /** The side it prefers: `top` (the default) or `bottom`. */
  declare placement: Placement;

  private hovered = false;
  private focused = false;
  private dismissed = false;

  constructor() {
    super();
    this.text = undefined;
    this.placement = 'top';
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('pointerenter', this.onPointerEnter);
    this.addEventListener('pointerleave', this.onPointerLeave);
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('focusout', this.onFocusOut);
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('scroll', this.onViewportChange, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('pointerenter', this.onPointerEnter);
    this.removeEventListener('pointerleave', this.onPointerLeave);
    this.removeEventListener('focusin', this.onFocusIn);
    this.removeEventListener('focusout', this.onFocusOut);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('scroll', this.onViewportChange, true);
    this.hovered = false;
    this.focused = false;
  }

  private readonly onPointerEnter = (): void => {
    this.hovered = true;
    this.dismissed = false;
    this.sync();
  };

  private readonly onPointerLeave = (): void => {
    this.hovered = false;
    this.sync();
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    // Focus from the keyboard shows the tooltip; focus left behind by a click does not.
    const target = event.composedPath()[0];
    if (target instanceof Element && target.matches(':focus-visible')) {
      this.focused = true;
      this.dismissed = false;
      this.sync();
    }
  };

  private readonly onFocusOut = (): void => {
    this.focused = false;
    this.sync();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.isOpen) {
      this.dismissed = true;
      this.sync();
    }
  };

  private readonly onViewportChange = (): void => {
    if (this.isOpen) {
      this.position();
    }
  };

  private get tip(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.tip');
  }

  private get isOpen(): boolean {
    return this.tip?.matches(':popover-open') ?? false;
  }

  /** The control the tooltip is for: the first element in it. */
  private get trigger(): Element | undefined {
    return this.querySelector(':scope > *') ?? undefined;
  }

  /** The size in pixels of a spacing token. */
  private spacing(name: string): number {
    return parseFloat(getComputedStyle(this).getPropertyValue(name));
  }

  private sync(): void {
    const tip = this.tip;
    if (tip === null) {
      return;
    }
    const wanted = (this.hovered || this.focused) && !this.dismissed && (this.text ?? '') !== '';
    if (wanted && !this.isOpen) {
      tip.showPopover();
    } else if (!wanted && this.isOpen) {
      tip.hidePopover();
    }
    if (wanted) {
      this.position();
    }
  }

  private position(): void {
    const tip = this.tip;
    const trigger = this.trigger;
    if (tip === null || trigger === undefined) {
      return;
    }
    const anchor = trigger.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const spot = placeTooltip(
      anchor,
      size,
      {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      this.spacing('--k-space-4'),
      this.spacing('--k-space-8'),
      this.placement === 'bottom' ? 'bottom' : 'top',
    );
    tip.style.left = `${String(spot.left)}px`;
    tip.style.top = `${String(spot.top)}px`;
    tip.dataset['placement'] = spot.placement;
  }

  /** Tells the control what the tooltip says, if that is something its own name does not. */
  private describeTrigger(): void {
    const trigger = this.trigger;
    if (trigger === undefined) {
      return;
    }
    const name = (
      trigger.getAttribute('label') ??
      trigger.getAttribute('aria-label') ??
      trigger.textContent
    ).trim();
    const text = this.text ?? '';
    if (text !== '' && text !== name) {
      trigger.setAttribute('aria-description', text);
    } else {
      trigger.removeAttribute('aria-description');
    }
  }

  protected override updated(): void {
    this.describeTrigger();
    this.sync();
  }

  override render() {
    // The text is for eyes: what a screen reader gets is the control's own name and description.
    return html`
      <slot
        @slotchange=${() => {
          this.describeTrigger();
        }}
      ></slot>
      <div class="tip" popover="manual" aria-hidden="true">${this.text}</div>
    `;
  }
}

defineOnce('k-tooltip', KTooltip);

declare global {
  interface HTMLElementTagNameMap {
    'k-tooltip': KTooltip;
  }
}
