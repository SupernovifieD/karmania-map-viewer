import { kButton, sharedStyles } from '@karmania/ui';
import type { SegmentedChange, SegmentedOption } from '@karmania/ui';
import { createViewer } from '@karmania/viewer';
import type { Viewer } from '@karmania/viewer';
import { css, html, LitElement } from 'lit';

/** The views the map can be shown in, as the toolbar's control offers them. */
const VIEWS: readonly SegmentedOption[] = [
  { value: '2d', label: '2D' },
  { value: '3d', label: '3D' },
];

/**
 * The root of the app, `<karmania-app>`: the toolbar across the top (the name, and the Import button), and under it the
 * viewer, which has the map area, the side panel and the import wizard. It fills the window and never scrolls.
 *
 * The viewer is put in the page by `createViewer`, as an embedder would, and taken out again (`dispose`) when the app leaves the page.
 * The Import button asks it to open its file picker; everything that follows is the viewer's. At the other end of the toolbar is the
 * control for the view (2D or 3D), which asks the viewer to switch and follows the scene when the view changes by other means.
 */
export class KarmaniaApp extends LitElement {
  static override properties = {
    view: { state: true },
  };

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

      /* What is at the right of the toolbar: the controls of the view, 8 apart (the toolbar's own 16 is between the groups). */
      .tools {
        align-items: center;
        display: flex;
        gap: var(--k-space-8);
        margin-inline-start: auto;
      }

      /* What the viewer fills: the rest of the window under the toolbar. */
      .viewer {
        min-height: 0;
        min-width: 0;
      }
    `,
  ];

  /** The viewer, from the page being rendered until the app leaves it. */
  private viewer: Viewer | undefined;

  /** The view the scene is in, which the control shows. */
  declare private view: string;

  /** Stops following the scene. */
  private unfollow: (() => void) | undefined;

  constructor() {
    super();
    this.view = '2d';
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The first time, the container is not rendered yet: `firstUpdated` puts the viewer in it.
    if (this.hasUpdated) {
      this.mount();
    }
  }

  override firstUpdated(): void {
    this.mount();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unfollow?.();
    this.unfollow = undefined;
    this.viewer?.dispose();
    this.viewer = undefined;
  }

  /**
   * Puts the viewer in its container, once: the first render happens even if the app was taken out of the page
   * before it, and then the app is put back with its viewer already in it.
   */
  private mount(): void {
    const container = this.renderRoot.querySelector<HTMLElement>('.viewer');
    if (container !== null && this.viewer === undefined) {
      const viewer = createViewer(container);
      this.viewer = viewer;
      this.view = viewer.scene().viewMode;
      this.unfollow = viewer.on('scene', (scene) => {
        this.view = scene.viewMode;
      });
    }
  }

  /** A person chose a view: the viewer switches, and the scene tells the control (which is what it shows) when it has. */
  private readonly onView = (event: CustomEvent<SegmentedChange>): void => {
    this.viewer?.setViewMode(event.detail.value === '3d' ? '3d' : '2d');
  };

  /** Opens the viewer's file picker. */
  private readonly openImport = (): void => {
    this.viewer?.openImport();
  };

  override render() {
    return html`
      <header class="toolbar">
        <h1 class="wordmark">Karmania</h1>
        ${kButton({ icon: 'upload', children: 'Import', onClick: this.openImport })}
        <div class="tools">
          <k-segmented
            label="View"
            .value=${this.view}
            .options=${VIEWS}
            @k-segmented-change=${this.onView}
          ></k-segmented>
        </div>
      </header>
      <div class="viewer"></div>
    `;
  }
}

customElements.define('karmania-app', KarmaniaApp);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-app': KarmaniaApp;
  }
}
