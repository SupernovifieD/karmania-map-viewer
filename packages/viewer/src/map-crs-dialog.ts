import type { CrsInfo, Engine, Summary } from '@karmania/engine';
import type { Frame } from '@karmania/engine/display';
import type { CrsRef, Units } from '@karmania/engine/types';
import { sharedStyles } from '@karmania/ui';
import type { InputChange } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import './crs-matches.js';
import type { CrsPick } from './crs-matches.js';
import { CrsSearch } from './crs-search.js';
import { localUnitsOf, sameCrs } from './crs-choice.js';
import { describeKind } from './import-crs.js';

/** The name of the event the dialog sends when a person applies a coordinate system: what was chosen. */
export const MAP_CRS_APPLY = 'karmania-map-crs-apply';

/** What `karmania-map-crs-apply` carries. */
export interface MapCrsApply {
  readonly crs: CrsRef;
}

/** What the dialog needs of the engine. */
export type MapCrsEngine = Pick<Engine, 'searchCrs'>;

/** What each unit of a local grid is called in words. */
const UNIT_WORDS: Readonly<Record<Units, string>> = {
  m: 'metres',
  ft: 'feet',
  us_ft: 'US survey feet',
};

/**
 * The map coordinate system dialog (section 10.5 of the brief), opened from the status chip: the system the map is in now (its code, name
 * and units, and whether it came from the datasets or was chosen by a person), a search of the EPSG definitions by code or name with the
 * matches to pick from, as the wizard's step has, and, when local grids are loaded, a choice of a local grid in their units. The footer has
 * Cancel on the left, and Apply on the right, which can be pressed once a system other than the current one is chosen; applying sends
 * `karmania-map-crs-apply` with the system, and closes the dialog. Cancel, Esc and the close button close it and change nothing. Each visit
 * starts with nothing chosen.
 */
export class KarmaniaMapCrsDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    engine: { attribute: false },
    frame: { attribute: false },
    info: { attribute: false },
    datasets: { attribute: false },
    query: { state: true },
    choice: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: contents;
      }

      /* A narrower dialog than the wizard's: 560 or the window less 24 each side (the dialog takes its width and its height limit from this). */
      k-dialog {
        --k-dialog-max-size: calc(var(--k-space-48) * 11 + var(--k-space-32));
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-16);
        min-width: 0;
      }

      p {
        margin: 0;
      }

      h3 {
        font-size: var(--k-font-size-body);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-body);
        margin: 0 0 var(--k-space-4);
      }

      .muted {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
      }

      /* What the names and the notes hold can have no place to break: they break anywhere. */
      .current p {
        overflow-wrap: anywhere;
      }

      .current .name {
        font-weight: var(--k-weight-medium);
      }

      /* The local grids that are loaded, a radio for each. */
      .local label {
        align-items: center;
        cursor: pointer;
        display: flex;
        gap: var(--k-space-8);
        min-height: var(--k-control-height);
      }

      .local input {
        accent-color: var(--k-accent);
        height: var(--k-icon-size-sm);
        margin: 0;
        width: var(--k-icon-size-sm);
      }

      .local input:focus-visible {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: var(--k-focus-offset);
      }

      span[slot='footer-note'] {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];

  /** Whether the dialog is open. */
  declare open: boolean;
  /** What the dialog searches the definitions with; without it nothing can be searched. */
  declare engine: MapCrsEngine | undefined;
  /** The frame the map is in now: its system, and whether a person chose it. */
  declare frame: Frame | null;
  /** What the definitions say of the code of the map's system: the system, `null` if they do not have it, `undefined` if nobody has asked. */
  declare info: CrsInfo | null | undefined;
  /** The datasets that are loaded: their local grids are offered. */
  declare datasets: readonly Summary[];
  /** What the search box holds. */
  declare query: string;
  /** The system that is chosen to change to, if one is. */
  declare choice: CrsRef | undefined;

  /** The search of the definitions, which a change of what it found draws the dialog again for. */
  private readonly finder = new CrsSearch(() => {
    this.requestUpdate();
  });

  constructor() {
    super();
    this.open = false;
    this.engine = undefined;
    this.frame = null;
    this.info = undefined;
    this.datasets = [];
    this.query = '';
    this.choice = undefined;
  }

  /** Opens the dialog, with nothing chosen and nothing searched for. */
  show(): void {
    this.query = '';
    this.choice = undefined;
    this.finder.reset();
    this.open = true;
  }

  protected override willUpdate(): void {
    if (this.open) {
      this.finder.search(this.engine, this.query);
    }
  }

  private readonly close = (): void => {
    this.open = false;
  };

  /** The dialog has closed itself (Esc, or its close button): this follows. */
  private readonly onDialogClose = (): void => {
    this.open = false;
  };

  private readonly onApply = (): void => {
    const choice = this.choice;
    if (choice === undefined || sameCrs(choice, this.frame?.mapCrs)) {
      return;
    }
    this.open = false;
    this.dispatchEvent(
      new CustomEvent<MapCrsApply>(MAP_CRS_APPLY, {
        detail: { crs: choice },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /** The system the map is in, in words, for the top of the dialog. */
  private current() {
    const frame = this.frame;
    if (frame === null) {
      return html`<p class="name">The map has no coordinate system yet.</p>`;
    }
    const { mapCrs } = frame;
    const info = this.info;
    const name =
      mapCrs.kind === 'local'
        ? `A local grid, in ${UNIT_WORDS[mapCrs.units]}`
        : info === undefined
          ? `EPSG ${String(mapCrs.code)}`
          : info === null
            ? `EPSG ${String(mapCrs.code)}, which is not one of the coordinate systems Karmania knows`
            : `EPSG ${String(mapCrs.code)}, ${info.name}`;
    const detail = [
      mapCrs.kind === 'epsg' && info !== undefined && info !== null
        ? describeKind(info)
        : undefined,
      frame.source === 'user' ? 'Chosen by you' : 'Taken from the datasets',
    ].filter((part) => part !== undefined);
    const sentence = detail.join(' · ');
    return html`<p class="name">${name}</p>
      <p class="muted">${sentence.charAt(0).toUpperCase() + sentence.slice(1)}</p>`;
  }

  /** The local grids that are loaded, to choose among, when there are any. */
  private local() {
    const units = localUnitsOf(this.datasets);
    if (units.length === 0) {
      return nothing;
    }
    const choice = this.choice;
    return html`<section class="local">
      <h3 id="local-title">Local grid</h3>
      <div role="radiogroup" aria-labelledby="local-title">
        ${units.map(
          (unit) =>
            html`<label>
              <input
                type="radio"
                name="local-grid"
                .checked=${choice?.kind === 'local' && choice.units === unit}
                @change=${() => {
                  this.choice = { kind: 'local', units: unit };
                }}
              />
              <span>A local grid, in ${UNIT_WORDS[unit]}</span>
            </label>`,
        )}
      </div>
    </section>`;
  }

  /** Why Apply cannot be pressed yet. */
  private get blocker(): string | undefined {
    if (this.choice === undefined) {
      return 'Choose a coordinate system to change to.';
    }
    return sameCrs(this.choice, this.frame?.mapCrs)
      ? 'That is the coordinate system the map is in.'
      : undefined;
  }

  override render() {
    const blocker = this.blocker;
    const chosen = this.choice?.kind === 'epsg' ? this.choice.code : undefined;
    return html`
      <k-dialog
        heading="Map coordinate system"
        .open=${this.open}
        @k-dialog-close=${this.onDialogClose}
      >
        <div class="content">
          <section class="current">
            <h3>Now</h3>
            ${this.current()}
          </section>
          <section>
            <k-input
              label="Search by EPSG code or name"
              placeholder="for example: 32640 or UTM zone 40"
              reserve
              .value=${this.query}
              help=${this.finder.help(this.query)}
              @k-input-change=${(event: CustomEvent<InputChange>) => {
                this.query = event.detail.value;
              }}
            ></k-input>
            <karmania-crs-matches
              .query=${this.query}
              .results=${this.finder.results}
              .failed=${this.finder.failed}
              .chosen=${chosen}
              @karmania-crs-pick=${(event: CustomEvent<CrsPick>) => {
                this.choice = { kind: 'epsg', code: event.detail.code };
              }}
            ></karmania-crs-matches>
          </section>
          ${this.local()}
        </div>
        <k-button slot="footer-start" variant="ghost" @click=${this.close}>Cancel</k-button>
        ${
          blocker === undefined
            ? nothing
            : html`<span slot="footer-note" title=${blocker}>${blocker}</span>`
        }
        <k-button
          slot="footer-end"
          variant="primary"
          ?disabled=${blocker !== undefined}
          @click=${this.onApply}
          >Apply</k-button
        >
      </k-dialog>
    `;
  }
}

customElements.define('karmania-map-crs-dialog', KarmaniaMapCrsDialog);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-map-crs-dialog': KarmaniaMapCrsDialog;
  }

  interface HTMLElementEventMap {
    [MAP_CRS_APPLY]: CustomEvent<MapCrsApply>;
  }
}
