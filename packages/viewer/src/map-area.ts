import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import { carriesFiles } from './drag.js';
import { formatCount } from './import-files.js';

/** The name of the event the map area sends when a person asks to import files with its button. */
export const IMPORT_REQUEST = 'karmania-import-request';

/** The name of the event the map area sends when files have been dropped on it. */
export const FILES_DROPPED = 'karmania-files-dropped';

/** The files that were dropped. */
export interface DroppedFiles {
  readonly files: readonly File[];
}

/**
 * The map area. Nothing is drawn in phase 1: it says so, with an empty state in the middle. With
 * no data it invites people to drop files or import them; once datasets are loaded (`datasets`)
 * it says that the map itself comes in phase 2, and how many datasets there are.
 *
 * Files can be dropped on it. While some are being dragged over it, an outline and a label
 * (`Drop to import`) are shown inside its edges. They are laid over the area without being part of
 * its layout, so showing them moves and resizes nothing. A drop sends `karmania-files-dropped` with
 * the files, and its Import button sends `karmania-import-request`: what to do about either is up
 * to the app.
 */
export class KarmaniaMapArea extends LitElement {
  static override properties = {
    datasets: { type: Number },
    dragging: { state: true },
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

      /* Over the area, 8 inside its edges, and not in the way of the pointer. It is there all
         the time and only becomes visible, so nothing is added to or taken from the layout. */
      .drop-zone {
        align-items: center;
        background: color-mix(in srgb, var(--k-accent) 10%, var(--k-surface-map));
        border: calc(var(--k-border-width) * 2) dashed var(--k-accent);
        border-radius: var(--k-radius-lg);
        display: flex;
        inset: var(--k-space-8);
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        position: absolute;
        transition:
          opacity var(--k-motion-duration) var(--k-motion-easing),
          visibility var(--k-motion-duration) var(--k-motion-easing);
        visibility: hidden;
      }

      .drop-zone[data-active] {
        opacity: 1;
        visibility: visible;
      }

      .drop-label {
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
      }
    `,
  ];

  /** How many datasets are loaded. */
  declare datasets: number;
  /** Whether files are being dragged over the area. */
  declare private dragging: boolean;

  /**
   * How many of the area's elements the drag is over. Moving onto a child fires `dragenter` for
   * it before `dragleave` for the one just left, so the drag is over the area while this is not 0.
   */
  private depth = 0;

  constructor() {
    super();
    this.datasets = 0;
    this.dragging = false;
  }

  override render() {
    return html`
      <main
        aria-label="Map"
        @dragenter=${this.onDragEnter}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        ${this.datasets > 0 ? this.loaded() : this.empty()}
        <div class="drop-zone" ?data-active=${this.dragging} aria-hidden="true">
          <span class="drop-label">Drop to import</span>
        </div>
      </main>
    `;
  }

  private readonly onDragEnter = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      event.preventDefault();
      this.depth += 1;
      this.dragging = true;
    }
  };

  /** Agrees to take the files, which is what makes dropping them possible. */
  private readonly onDragOver = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  };

  private readonly onDragLeave = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      this.depth = Math.max(0, this.depth - 1);
      this.dragging = this.depth > 0;
    }
  };

  /** Takes the files away from the browser, which would otherwise open one and leave the app. */
  private readonly onDrop = (event: DragEvent): void => {
    if (carriesFiles(event)) {
      event.preventDefault();
      this.depth = 0;
      this.dragging = false;
      // The files are only there while the event is being handled.
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) {
        this.dispatchEvent(
          new CustomEvent<DroppedFiles>(FILES_DROPPED, {
            detail: { files },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
  };

  private readonly onImport = (): void => {
    this.dispatchEvent(new CustomEvent(IMPORT_REQUEST, { bubbles: true, composed: true }));
  };

  private empty() {
    return html`
      <k-empty-state icon="map" heading="No data yet">
        Drop files here or use Import
        <span slot="action"
          >${kButton({ icon: 'upload', children: 'Import', onClick: this.onImport })}</span
        >
      </k-empty-state>
    `;
  }

  private loaded() {
    const count = this.datasets === 1 ? '1 dataset' : `${formatCount(this.datasets)} datasets`;
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

  interface HTMLElementEventMap {
    [IMPORT_REQUEST]: CustomEvent;
    [FILES_DROPPED]: CustomEvent<DroppedFiles>;
  }
}
