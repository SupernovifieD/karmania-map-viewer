import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { formatCount } from './import-files.js';
import type { IdentifyModel } from './identify.js';
import { placePopover } from './popover-place.js';
import type { Point, Size } from './popover-place.js';

/** The name of the event the popover sends when it is to be closed (its button, or Escape). */
export const IDENTIFY_CLOSE = 'karmania-identify-close';

/** The name of the event the popover sends when a person asks for the element in the table. */
export const IDENTIFY_SHOW = 'karmania-identify-show';

/** How the popover was asked to close: with the keyboard (Escape: the selection is cleared too) or with its button (the element stays selected). */
export interface IdentifyClose {
  readonly escape: boolean;
}

/** Which element "Show in table" is for. */
export interface IdentifyShow {
  readonly datasetId: number;
  readonly element: number;
}

/**
 * The identify popover (brief 10.5): what is known of the element that was clicked, next to the click. It is not modal (a dialog by role, with a label, and
 * nothing is trapped: the map stays as it is and the keys of the map are the map's), 240 to 320 wide, at most half as high as the map with its body
 * scrolling, padding 12, radius 8, a raised surface. The header has the name of the dataset (weight 500, cut with an ellipsis) and a close button;
 * under it the caption ("Point 1,204", counted from 1); the body has up to 8 attributes (the name muted, the value in tabular figures, cut with an
 * ellipsis with the whole of it in its title); the footer has "Show in table". Escape closes it. It says what a person did (`karmania-identify-close`,
 * `karmania-identify-show`) and decides nothing; where it goes is `placePopover`'s, from the click, the map's size and its own.
 */
export class KarmaniaIdentify extends LitElement {
  static override properties = {
    model: { attribute: false },
    anchor: { attribute: false },
    area: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        position: absolute;
        /* Where it is put is set by the code (left, top, and the largest it may be), from the click and the size of the map. */
        inset: 0 auto auto 0;
        z-index: 2;
      }

      section {
        background: var(--k-surface-raised);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-lg);
        box-sizing: border-box;
        color: var(--k-text);
        display: flex;
        flex-direction: column;
        gap: var(--k-space-8);
        /* The least width, which the most it may have takes over from on a map that is narrower than the least: a minimum is stronger than a maximum in CSS. */
        max-width: var(--popover-max-width, none);
        min-width: min(
          var(--k-popover-min-width),
          var(--popover-max-width, var(--k-popover-min-width))
        );
        padding: var(--k-space-12);
        /* Not seen until it has been put: it is measured at its natural size first. */
        visibility: hidden;
        width: max-content;
      }

      :host([placed]) section {
        visibility: visible;
      }

      header {
        align-items: center;
        display: flex;
        gap: var(--k-space-8);
      }

      h2 {
        flex: 1 1 auto;
        font-size: var(--k-font-size-body);
        font-weight: var(--k-weight-medium);
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .caption {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-caption);
        margin: 0;
      }

      .body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
      }

      dl {
        column-gap: var(--k-space-12);
        display: grid;
        /* A name is as wide as it is, to half the row at most: a name too long for that is cut and leaves the other half to its value. */
        grid-template-columns: fit-content(50%) minmax(0, 1fr);
        margin: 0;
        row-gap: var(--k-space-4);
      }

      dt {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      dd {
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      dd[data-numeric] {
        text-align: end;
      }

      dd[data-null] {
        color: var(--k-text-muted);
      }

      .note {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        margin: 0;
      }

      .more {
        margin-block-start: var(--k-space-8);
      }

      /* The ghost button has padding of its own: it is pulled back by it, so that its words start where the rest of the popover's do. */
      footer {
        display: flex;
        justify-content: flex-start;
        margin-inline-start: calc(var(--k-space-12) * -1);
      }
    `,
  ];

  declare model: IdentifyModel | undefined;
  /** Where the map was clicked, in CSS pixels from its top left. */
  declare anchor: Point;
  /** How big the map is. */
  declare area: Size;

  private resize: ResizeObserver | undefined;

  constructor() {
    super();
    this.anchor = { x: 0, y: 0 };
    this.area = { width: 0, height: 0 };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.resize = new ResizeObserver(() => {
      this.place();
    });
  }

  override disconnectedCallback(): void {
    this.resize?.disconnect();
    this.resize = undefined;
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    const section = this.renderRoot.querySelector('section');
    if (section !== null) {
      this.resize?.observe(section);
    }
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('anchor') || changed.has('area') || changed.has('model')) {
      this.place();
    }
  }

  /** Puts the popover by the click, from its size as it is (its largest first, so that what is measured is what it wants to be). */
  private place(): void {
    const section = this.renderRoot.querySelector('section');
    if (section === null || this.area.width <= 0) {
      return;
    }
    // Measured without the limits of the last time, which may have made it smaller than its content wants.
    section.style.removeProperty('--popover-max-width');
    section.style.maxHeight = '';
    const size = { width: section.offsetWidth, height: section.offsetHeight };
    const at = placePopover(this.anchor, size, this.area);
    section.style.setProperty('--popover-max-width', `${String(at.maxWidth)}px`);
    section.style.maxHeight = `${String(at.maxHeight)}px`;
    this.style.left = `${String(at.left)}px`;
    this.style.top = `${String(at.top)}px`;
    this.toggleAttribute('placed', true);
  }

  /**
   * Gives the popover the keyboard, so that a person who cannot see it is told of it: a screen reader says its name ("Point 3 of points") and what it says (the
   * attributes), as it does for any dialog that is opened. The keys of the map are not the popover's (the map's own keys are used only when the map itself has the
   * focus), and Escape or its button gives the focus back to the map. The viewer asks for this once, when what a click found has been read: it is not done on its own
   * at every change of what the popover says, which a pan of the map is.
   */
  takeFocus(): void {
    // It is put first: it is not visible, and so not to be focused, until it has been.
    this.place();
    this.renderRoot.querySelector('section')?.focus({ preventScroll: true });
  }

  private close(escape: boolean): void {
    this.dispatchEvent(
      new CustomEvent<IdentifyClose>(IDENTIFY_CLOSE, {
        detail: { escape },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private readonly onClose = (): void => {
    this.close(false);
  };

  private readonly onShow = (): void => {
    const model = this.model;
    if (model === undefined) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<IdentifyShow>(IDENTIFY_SHOW, {
        detail: { datasetId: model.datasetId, element: model.element },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
    }
  };

  private body(model: IdentifyModel) {
    if (model.state === 'loading') {
      return html`<p class="note">Loading…</p>`;
    }
    if (model.state === 'missing') {
      return html`<p class="note">This element is not in the dataset any more.</p>`;
    }
    if (model.rows.length === 0) {
      return html`<p class="note">No attributes.</p>`;
    }
    return html`
      <dl>
        ${model.rows.map(
          (row) => html`
            <dt title=${row.name} data-truncate>${row.name}</dt>
            <dd
              title=${row.value}
              data-truncate
              ?data-numeric=${row.numeric}
              ?data-null=${row.isNull}
            >
              ${row.value}
            </dd>
          `,
        )}
      </dl>
      ${
        model.more > 0
          ? html`<p class="note more">
              and ${formatCount(model.more)} more ${model.more === 1 ? 'attribute' : 'attributes'},
              in the table
            </p>`
          : nothing
      }
    `;
  }

  override render() {
    const model = this.model;
    if (model === undefined) {
      return nothing;
    }
    return html`
      <section
        role="dialog"
        aria-label=${`${model.caption} of ${model.name}`}
        aria-describedby="detail"
        tabindex="-1"
        @keydown=${this.onKeyDown}
      >
        <header>
          <h2 title=${model.name} data-truncate>${model.name}</h2>
          ${kButton({ icon: 'x', label: 'Close', variant: 'ghost', size: 28, onClick: this.onClose })}
        </header>
        <p class="caption">${model.caption}</p>
        <div class="body" id="detail" data-scroll-region>${this.body(model)}</div>
        <footer>
          ${kButton({ variant: 'ghost', children: 'Show in table', onClick: this.onShow })}
        </footer>
      </section>
    `;
  }
}

customElements.define('karmania-identify', KarmaniaIdentify);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-identify': KarmaniaIdentify;
  }

  interface HTMLElementEventMap {
    [IDENTIFY_CLOSE]: CustomEvent<IdentifyClose>;
    [IDENTIFY_SHOW]: CustomEvent<IdentifyShow>;
  }
}
