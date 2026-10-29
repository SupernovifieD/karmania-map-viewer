import type { Summary } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import type { TableFetch } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import './dataset-list.js';
import './dataset-summary.js';
import type { RowSource } from './datasets.js';
import { IMPORT_REQUEST } from './map-area.js';

/**
 * What the side panel's Data tab holds. With nothing loaded it says so, and offers Import. With
 * datasets loaded it shows them in a list, and the one that is selected below it: a summary, and
 * its rows in a table that takes the room that is left, and never less than five rows' worth.
 */
export class KarmaniaDataTab extends LitElement {
  static override properties = {
    datasets: { attribute: false },
    selected: { attribute: false },
    rows: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      /* As tall as the panel's body, or as its content if that is taller, which then scrolls: it
         is not shrunk to fit, so that its box is as big as what is in it. */
      :host {
        display: flex;
        flex: none;
        flex-direction: column;
        min-height: 100%;
        min-width: 0;
      }

      k-empty-state {
        flex: 1 1 auto;
        min-height: 0;
      }

      /* The table goes the whole width, and takes what is left of the height, down to a few rows. */
      k-table {
        border-top: var(--k-border-width) solid var(--k-border);
        flex: 1 1 0;
        height: auto;
        min-height: calc(var(--k-space-48) * 5);
      }
    `,
  ];

  /** The datasets that are loaded, in the order they were loaded. */
  declare datasets: readonly Summary[];
  /** The `id` of the dataset that is selected. */
  declare selected: number | undefined;
  /** Gets the rows of a dataset. */
  declare rows: RowSource | undefined;

  /**
   * What each dataset's table asks for rows with. The table starts again when it is given another,
   * so a dataset keeps the one it was first given, while it is loaded.
   */
  private readonly fetchers = new Map<number, TableFetch>();

  constructor() {
    super();
    this.datasets = [];
    this.selected = undefined;
    this.rows = undefined;
  }

  /** The function the table of dataset `id` gets its rows with. */
  private fetcherFor(id: number): TableFetch {
    let fetcher = this.fetchers.get(id);
    if (fetcher === undefined) {
      fetcher = (start, count) =>
        this.rows === undefined
          ? Promise.reject(new Error('There is no way to get rows.'))
          : this.rows(id, start, count);
      this.fetchers.set(id, fetcher);
    }
    return fetcher;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('datasets')) {
      const loaded = new Set(this.datasets.map((dataset) => dataset.id));
      for (const id of this.fetchers.keys()) {
        if (!loaded.has(id)) {
          this.fetchers.delete(id);
        }
      }
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    // The last dataset was removed, which took with it what had the keyboard: it goes to Import.
    const before = changed.get('datasets');
    if (before !== undefined && before.length > 0 && this.datasets.length === 0) {
      void this.focusImport();
    }
  }

  /** Puts the keyboard on Import, once the button has been drawn. */
  private async focusImport(): Promise<void> {
    const button =
      this.renderRoot.querySelector<HTMLElementTagNameMap['k-button']>('k-empty-state k-button');
    await button?.updateComplete;
    button?.focus();
  }

  private readonly onImport = (): void => {
    this.dispatchEvent(new CustomEvent(IMPORT_REQUEST, { bubbles: true, composed: true }));
  };

  override render() {
    if (this.datasets.length > 0) {
      const selected = this.datasets.find((dataset) => dataset.id === this.selected);
      return html`
        <karmania-dataset-list
          .datasets=${this.datasets}
          .selected=${this.selected}
        ></karmania-dataset-list>
        <karmania-dataset-summary .summary=${selected}></karmania-dataset-summary>
        ${
          selected === undefined
            ? nothing
            : html`<k-table
                label="${selected.name}, rows"
                .rowCount=${selected.elementCount}
                .fetch=${this.fetcherFor(selected.id)}
              ></k-table>`
        }
      `;
    }
    return html`
      <k-empty-state icon="table" heading="No data loaded">
        <span slot="action"
          >${kButton({ icon: 'upload', children: 'Import', onClick: this.onImport })}</span
        >
      </k-empty-state>
    `;
  }
}

customElements.define('karmania-data-tab', KarmaniaDataTab);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-data-tab': KarmaniaDataTab;
  }
}
