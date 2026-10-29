import type { Summary } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import type { PropertyValues } from 'lit';
import './dataset-list.js';
import { IMPORT_REQUEST } from './map-area.js';

/**
 * What the side panel's Data tab holds. With nothing loaded it says so, and offers Import. With
 * datasets loaded it shows them in a list, and the one that is selected below it.
 */
export class KarmaniaDataTab extends LitElement {
  static override properties = {
    datasets: { attribute: false },
    selected: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        min-width: 0;
      }

      k-empty-state {
        flex: 1 1 auto;
        min-height: 0;
      }
    `,
  ];

  /** The datasets that are loaded, in the order they were loaded. */
  declare datasets: readonly Summary[];
  /** The `id` of the dataset that is selected. */
  declare selected: number | undefined;

  constructor() {
    super();
    this.datasets = [];
    this.selected = undefined;
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
      return html`<karmania-dataset-list
        .datasets=${this.datasets}
        .selected=${this.selected}
      ></karmania-dataset-list>`;
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
