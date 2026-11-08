import type { CrsInfo, Engine, Summary } from '@karmania/engine';
import type { Frame } from '@karmania/engine/display';
import type { CrsRef, Units } from '@karmania/engine/types';
import { sharedStyles } from '@karmania/ui';
import type { InputChange } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import './crs-matches.js';
import type { CrsPick } from './crs-matches.js';
import { CrsSearch } from './crs-search.js';
import { localUnitsOf, sameCrs } from './crs-choice.js';
import { describeKind } from './import-crs.js';
import { ChangesPreview } from './what-changes.js';

/** The name of the event the dialog sends when a person applies a coordinate system: what was chosen. */
export const MAP_CRS_APPLY = 'karmania-map-crs-apply';

/** What `karmania-map-crs-apply` carries. */
export interface MapCrsApply {
  readonly crs: CrsRef;
}

/** What the dialog needs of the engine. */
export type MapCrsEngine = Pick<Engine, 'searchCrs' | 'previewFrame'>;

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

      /* A narrower dialog than the wizard's: 560 wide, or the window less 24 each side. It is as tall as the wizard's. */
      k-dialog {
        --k-dialog-width: calc(var(--k-space-48) * 11 + var(--k-space-32));
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-12);
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

      .current .name .muted {
        font-weight: var(--k-weight-regular);
      }

      /* The local grids that are loaded, a radio for each. */
      .local label {
        align-items: center;
        cursor: pointer;
        display: flex;
        gap: var(--k-space-8);
        min-height: var(--k-control-height-compact);
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

      /* What would change: a line for each dataset that would start or stop being drawn, with an icon and the reason under its name. */
      .changes ul {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-8);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .changes li {
        align-items: flex-start;
        display: grid;
        gap: var(--k-space-8);
        grid-template-columns: var(--k-icon-size-sm) minmax(0, 1fr);
        overflow-wrap: anywhere;
      }

      .changes li k-icon {
        margin-top: var(--k-space-2);
      }

      .changes li[data-kind='starts'] k-icon {
        color: var(--k-info);
      }

      .changes li[data-kind='stops'] k-icon {
        color: var(--k-warning);
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

  /** What would change if the system that is chosen were applied, worked out by the engine as the choice changes. */
  private readonly preview = new ChangesPreview(() => {
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
    this.preview.reset();
    this.open = true;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (this.open) {
      this.finder.search(this.engine, this.query);
    }
    // What would change is asked again when what is chosen, what the map is in, what is loaded, the engine or the dialog's being open is
    // different, and only while it is open: a closed dialog keeps the choice it was closed with, and the engine has nobody to answer to.
    // A system that is the one the map is in changes nothing, and is not asked about.
    if (
      this.open &&
      (changed.has('choice') ||
        changed.has('frame') ||
        changed.has('datasets') ||
        changed.has('engine') ||
        changed.has('open'))
    ) {
      const current = this.frame?.mapCrs;
      this.preview.ask(
        this.engine,
        current,
        sameCrs(this.choice, current) ? undefined : this.choice,
        this.datasets,
      );
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
      return html`<p class="name">
        <span class="muted">Now: </span>The map has no coordinate system yet.
      </p>`;
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
    return html`<p class="name"><span class="muted">Now: </span>${name}</p>
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
      <div role="radiogroup" aria-label="Local grid">
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

  /** What would change, or what is being done to find out. */
  private changes() {
    const { status, changes } = this.preview;
    let body;
    if (status === 'idle') {
      body = html`<p class="muted">
        Choose a coordinate system to see which datasets would start or stop being drawn.
      </p>`;
    } else if (status === 'working') {
      body = html`<p class="muted">Working out what would change…</p>`;
    } else if (status === 'failed') {
      body = html`<p class="muted">What would change could not be worked out.</p>`;
    } else if (changes.length === 0) {
      body = html`<p class="muted">No dataset would start or stop being drawn.</p>`;
    } else {
      body = html`<ul>
        ${changes.map(
          (change) =>
            html`<li data-kind=${change.kind}>
              <k-icon
                name=${change.kind === 'starts' ? 'check' : 'triangle-alert'}
                size="16"
              ></k-icon>
              <span
                ><strong>${change.name}</strong>
                ${change.kind === 'starts' ? 'would start' : 'would stop'} being drawn.
                <span class="muted">${change.reason}</span></span
              >
            </li>`,
        )}
      </ul>`;
    }
    return html`<section class="changes">
      <h3>What changes</h3>
      <div role="status">${body}</div>
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
        fill
        .open=${this.open}
        @k-dialog-close=${this.onDialogClose}
      >
        <div class="content">
          <section class="current" aria-label="The map's coordinate system now">
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
          ${this.local()} ${this.changes()}
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
