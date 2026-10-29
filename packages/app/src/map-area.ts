import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/**
 * The map area. Nothing is drawn in phase 1: it says so, with an empty state in the middle. With
 * no data it invites people to drop files or import them; once datasets are loaded (`datasets`)
 * it says that the map itself comes in phase 2, and how many datasets there are.
 */
export class KarmaniaMapArea extends LitElement {
  static override properties = {
    datasets: { type: Number },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        background: var(--k-surface-map);
        display: block;
        min-height: 0;
        min-width: 0;
      }

      main {
        height: 100%;
        position: relative;
      }
    `,
  ];

  /** How many datasets are loaded. */
  declare datasets: number;

  constructor() {
    super();
    this.datasets = 0;
  }

  override render() {
    return html`<main aria-label="Map">${this.datasets > 0 ? this.loaded() : this.empty()}</main>`;
  }

  private empty() {
    return html`
      <k-empty-state icon="map" heading="No data yet">
        Drop files here or use Import
        <span slot="action">${kButton({ icon: 'upload', children: 'Import' })}</span>
      </k-empty-state>
    `;
  }

  private loaded() {
    const count = this.datasets === 1 ? '1 dataset' : `${String(this.datasets)} datasets`;
    return html`
      <k-empty-state icon="map" heading="Map rendering arrives in phase 2">
        ${count} loaded
      </k-empty-state>
    `;
  }
}

customElements.define('karmania-map-area', KarmaniaMapArea);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-map-area': KarmaniaMapArea;
  }
}
