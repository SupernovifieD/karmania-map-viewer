import { groupFiles } from '@karmania/engine';
import type { Engine } from '@karmania/engine';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import type { PropertyValues } from 'lit';
import { entriesOf } from './import-files.js';
import type { FileEntry } from './import-files.js';
import { describeStep, FIRST_STEP, IMPORT_STEPS, stepAfter, stepBefore } from './import-steps.js';
import type { ImportStep } from './import-steps.js';

/** The name of the event the dialog sends when it has been closed, by Cancel, Esc or the close button. */
export const IMPORT_CLOSE = 'karmania-import-close';

/**
 * The import wizard's dialog: the frame the steps are shown in. It has the title, the indicator of
 * the five steps, the body of the step a person is on, and a footer with Cancel on the left and
 * Back and Next on the right (Next reads Load on the last step, the primary action always being the
 * rightmost).
 *
 * It is open while `open` is set, and then starts on the first step. Cancel, Esc and the close button
 * close it and send `karmania-import-close`; the keyboard goes back to the control that opened it.
 * Moving between steps leaves the keyboard on the button that was pressed, so that Enter can be
 * pressed again; a screen reader is told where the person is by a line of text that is not drawn.
 */
export class KarmaniaImportDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    step: { type: String, reflect: true },
    files: { attribute: false },
    engine: { attribute: false },
    entries: { state: true },
    failure: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: contents;
      }

      .step {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-16);
      }

      .step h3 {
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
        margin: 0;
      }

      .step p {
        margin: 0;
      }
    `,
  ];

  /** Whether the dialog is open. */
  declare open: boolean;
  /** The step a person is on. */
  declare step: ImportStep;
  /** The files being imported: the ones chosen or dropped, which the steps are about. */
  declare files: readonly File[];
  /** The engine that reads them. */
  declare engine: Engine | undefined;
  /** What the kernel made of each file, once it has looked: `undefined` until then. */
  declare entries: readonly FileEntry[] | undefined;
  /** Why the files could not be looked at (the engine could not start, say), if that is so. */
  declare failure: string | undefined;

  /** Counts the times files have been looked at, so that an answer that comes late is ignored. */
  private readings = 0;

  constructor() {
    super();
    this.open = false;
    this.step = FIRST_STEP;
    this.files = [];
    this.engine = undefined;
    this.entries = undefined;
    this.failure = undefined;
  }

  /** Opens the dialog, on its first step, to import `files`, and has the engine look at them. */
  show(files: readonly File[]): void {
    this.files = files;
    this.open = true;
    void this.look(files);
  }

  /** Has the engine preview the files, and keeps what it says if the dialog is still about them. */
  private async look(files: readonly File[]): Promise<void> {
    const reading = ++this.readings;
    this.entries = undefined;
    this.failure = undefined;
    const engine = this.engine;
    if (engine === undefined) {
      this.failure = 'The import engine is not available.';
      return;
    }
    try {
      const previews = await engine.preview(files);
      if (reading === this.readings) {
        this.entries = entriesOf(groupFiles(files), previews);
      }
    } catch (error) {
      if (reading === this.readings) {
        this.failure = error instanceof Error ? error.message : String(error);
      }
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Every visit starts at the beginning.
    if (changed.has('open') && this.open) {
      this.step = FIRST_STEP;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    // The body of a step starts at its top.
    if (changed.has('step')) {
      const body = this.renderRoot.querySelector('k-dialog')?.shadowRoot?.querySelector('.body');
      if (body) {
        body.scrollTop = 0;
      }
    }
  }

  /** Closes the dialog, and says so. */
  private close(): void {
    this.open = false;
    this.files = [];
    this.readings += 1;
    this.entries = undefined;
    this.failure = undefined;
    this.dispatchEvent(new CustomEvent(IMPORT_CLOSE, { bubbles: true, composed: true }));
  }

  private readonly onCancel = (): void => {
    this.close();
  };

  /** A person closed the dialog itself (Esc or its close button), which has already shut. */
  private readonly onDialogClose = (): void => {
    this.close();
  };

  private readonly onBack = (): void => {
    this.step = stepBefore(this.step) ?? this.step;
  };

  private readonly onNext = (): void => {
    this.step = stepAfter(this.step) ?? this.step;
  };

  private body() {
    const found = IMPORT_STEPS.find((known) => known.id === this.step);
    return html`
      <div class="step" data-step=${this.step}>
        <h3>${found?.label ?? ''}</h3>
        <p>This step is not built yet.</p>
      </div>
    `;
  }

  override render() {
    const last = stepAfter(this.step) === undefined;
    return html`
      <k-dialog heading="Import data" .open=${this.open} @k-dialog-close=${this.onDialogClose}>
        <k-steps
          slot="steps"
          label="Import steps"
          current=${this.step}
          .steps=${IMPORT_STEPS}
        ></k-steps>
        ${this.body()}
        <span class="visually-hidden" role="status">${describeStep(this.step)}</span>
        <k-button slot="footer-start" variant="ghost" @click=${this.onCancel}>Cancel</k-button>
        <k-button
          slot="footer-end"
          ?disabled=${stepBefore(this.step) === undefined}
          @click=${this.onBack}
          >Back</k-button
        >
        <!-- Nothing has been made to load yet, so the last step's button is there but cannot be used. -->
        <k-button slot="footer-end" variant="primary" ?disabled=${last} @click=${this.onNext}
          >${last ? 'Load' : 'Next'}</k-button
        >
      </k-dialog>
    `;
  }
}

customElements.define('karmania-import-dialog', KarmaniaImportDialog);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-import-dialog': KarmaniaImportDialog;
  }

  interface HTMLElementEventMap {
    [IMPORT_CLOSE]: CustomEvent;
  }
}
