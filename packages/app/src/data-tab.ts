import type { Summary } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { IMPORT_REQUEST } from './map-area.js';

/**
 * What the side panel's Data tab holds. With nothing loaded it says so, and offers Import. (With
 * datasets loaded it shows them, which the steps that follow build.)
 */
export class KarmaniaDataTab extends LitElement {
  static override properties = {
    datasets: { attribute: false },
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

  constructor() {
    super();
    this.datasets = [];
  }

  private readonly onImport = (): void => {
    this.dispatchEvent(new CustomEvent(IMPORT_REQUEST, { bubbles: true, composed: true }));
  };

  override render() {
    if (this.datasets.length > 0) {
      return nothing;
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
