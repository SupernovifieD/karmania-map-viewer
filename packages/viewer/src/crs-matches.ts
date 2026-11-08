import type { CrsInfo } from '@karmania/engine';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import { describeKind } from './import-crs.js';

/** The name of the event the matches send when a person picks one: the code of the system. */
export const CRS_PICK = 'karmania-crs-pick';

/** What `karmania-crs-pick` carries. */
export interface CrsPick {
  readonly code: number;
}

/**
 * The box of the coordinate systems that match a search (the wizard's coordinate system step and the map CRS dialog have one): the systems
 * that match what is in the search box, to pick one, or why there are none. It is a radio group in a box of a fixed height that scrolls, so
 * that matches coming and going moves nothing; picking one sends `karmania-crs-pick` with its code. `results` is `undefined` until the first
 * search has been answered.
 */
export class KarmaniaCrsMatches extends LitElement {
  static override properties = {
    query: { type: String },
    results: { attribute: false },
    failed: { type: Boolean },
    chosen: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      p {
        margin: 0;
      }

      /* What matches the search box: a box of a fixed height, so that matches coming and going moves nothing,
         and one that scrolls when there are more rows than fit. It shows three rows: with the room that the
         line above it keeps for two lines, and a line of the "found" text above that when a file name or a
         GeoJSON default makes it wrap, more would make the dialog of the smallest window (1024 x 640)
         scroll. The room round the rows keeps the focus ring of a row from being cut, and the scroll
         padding keeps one that the keyboard has reached from being cut at the edge of the box. */
      .matches {
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-md);
        box-sizing: border-box;
        height: calc(var(--k-list-row-height) * 3 + var(--k-space-8) + var(--k-border-width) * 2);
        overflow: hidden auto;
        padding: var(--k-space-4) 0;
        scroll-padding: var(--k-space-8) 0;
      }

      .matches-note {
        color: var(--k-text-muted);
        overflow-wrap: anywhere;
        padding: var(--k-space-8) var(--k-space-12);
      }

      .match {
        align-items: center;
        cursor: pointer;
        display: grid;
        gap: var(--k-space-8);
        grid-template-columns: var(--k-icon-size-sm) minmax(0, 1fr) auto;
        height: var(--k-list-row-height);
        padding: 0 var(--k-space-12);
        position: relative;
      }

      .match:hover,
      .match[data-selected] {
        background: var(--k-surface-raised);
      }

      /* The chosen row has a bar at its left edge, drawn inside the row, as in the list of datasets. */
      .match[data-selected]::before {
        background: var(--k-accent);
        bottom: 0;
        content: '';
        left: 0;
        position: absolute;
        top: 0;
        width: calc(var(--k-border-width) * 3);
      }

      .match input {
        accent-color: var(--k-accent);
        height: var(--k-icon-size-sm);
        margin: 0;
        width: var(--k-icon-size-sm);
      }

      .match input:focus-visible {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: var(--k-focus-offset);
      }

      .match-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .match[data-selected] .match-name {
        font-weight: var(--k-weight-medium);
      }

      .match-detail {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        white-space: nowrap;
      }
    `,
  ];

  /** What the search box holds. */
  declare query: string;
  /** What the latest search found; `undefined` until there has been one. */
  declare results: readonly CrsInfo[] | undefined;
  /** Whether the latest search could not be done. */
  declare failed: boolean;
  /** The code that is chosen, if one is. */
  declare chosen: number | undefined;

  constructor() {
    super();
    this.query = '';
    this.results = undefined;
    this.failed = false;
    this.chosen = undefined;
  }

  private pick(code: number): void {
    this.dispatchEvent(
      new CustomEvent<CrsPick>(CRS_PICK, { detail: { code }, bubbles: true, composed: true }),
    );
  }

  override render() {
    const query = this.query.trim();
    const matches = this.results ?? [];
    const chosen = this.chosen;
    if (query === '') {
      return html`<div class="matches" data-scroll-region>
        <p class="matches-note" role="status">
          Type a code, or part of a name such as UTM zone 40, to see the coordinate systems that
          match.
        </p>
      </div>`;
    }
    if (this.failed || (matches.length === 0 && this.results !== undefined)) {
      return html`<div class="matches" data-scroll-region>
        <p class="matches-note" role="status">
          ${
            this.failed
              ? 'The coordinate systems could not be searched.'
              : `No coordinate system matches ${query}.`
          }
        </p>
      </div>`;
    }
    return html`<div class="matches" data-scroll-region>
      <div role="radiogroup" aria-label="Coordinate systems that match">
        ${matches.map(
          (info) =>
            html`<label class="match" ?data-selected=${info.code === chosen} title=${info.name}>
              <input
                type="radio"
                name="crs-match"
                value=${String(info.code)}
                .checked=${info.code === chosen}
                @change=${() => {
                  this.pick(info.code);
                }}
              />
              <span class="match-name" data-truncate>${info.name}</span>
              <span class="match-detail">EPSG ${info.code} · ${describeKind(info)}</span>
            </label>`,
        )}
      </div>
    </div>`;
  }
}

customElements.define('karmania-crs-matches', KarmaniaCrsMatches);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-crs-matches': KarmaniaCrsMatches;
  }

  interface HTMLElementEventMap {
    [CRS_PICK]: CustomEvent<CrsPick>;
  }
}
