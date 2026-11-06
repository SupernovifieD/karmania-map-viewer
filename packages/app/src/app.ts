import { kButton, sharedStyles } from '@karmania/ui';
import { KarmaniaViewer } from '@karmania/viewer';
import { css, html, LitElement } from 'lit';

/**
 * The root of the app, `<karmania-app>`: the toolbar across the top (the name, and the Import button), and under it the
 * viewer, which has the map area, the side panel and the import wizard. It fills the window and never scrolls.
 *
 * The Import button asks the viewer to open its file picker; everything that follows is the viewer's.
 */
export class KarmaniaApp extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      :host {
        background: var(--k-surface);
        display: grid;
        grid-template-rows: var(--k-toolbar-height) minmax(0, 1fr);
        height: 100dvh;
        overflow: hidden;
        width: 100%;
      }

      /* The border takes a pixel at the bottom; the same above keeps the contents on the middle
         of the 48, on whole pixels. */
      .toolbar {
        align-items: center;
        border-bottom: var(--k-border-width) solid var(--k-border);
        display: flex;
        gap: var(--k-space-16);
        min-width: 0;
        padding: var(--k-border-width) var(--k-space-16) 0;
      }

      .wordmark {
        flex: none;
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
        margin: 0;
      }
    `,
  ];

  /** Opens the viewer's file picker. */
  private readonly openImport = (): void => {
    this.renderRoot.querySelector<KarmaniaViewer>('karmania-viewer')?.openImport();
  };

  override render() {
    return html`
      <header class="toolbar">
        <h1 class="wordmark">Karmania</h1>
        ${kButton({ icon: 'upload', children: 'Import', onClick: this.openImport })}
      </header>
      <karmania-viewer></karmania-viewer>
    `;
  }
}

customElements.define('karmania-app', KarmaniaApp);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-app': KarmaniaApp;
  }
}
