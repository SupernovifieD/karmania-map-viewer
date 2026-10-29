import { groupFiles } from '@karmania/engine';
import type { Engine } from '@karmania/engine';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import './file-step.js';
import type { DraftChange } from './file-step.js';
import { applyDraftChange, draftFor } from './import-draft.js';
import type { ImportDraft } from './import-draft.js';
import { entriesOf, isImportable } from './import-files.js';
import { mappingProblems } from './import-mapping.js';
import type { FileEntry } from './import-files.js';
import './findings.js';
import './mapping-step.js';
import './nodata-step.js';
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
    draft: { state: true },
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

      /* The Mapping step has a table that scrolls in the room the step has, so the step has all of it,
         and more if what is round the table needs more than the dialog has. */
      .step[data-step='mapping'] {
        min-height: 100%;
      }

      .reading {
        color: var(--k-text-muted);
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
  /** What a person has decided about the file being imported. */
  declare draft: ImportDraft | undefined;

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
    this.draft = undefined;
  }

  /** The file being imported: the first one that can be. */
  private get current(): FileEntry | undefined {
    return this.entries?.find((entry) => isImportable(entry.preview));
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
    this.draft = undefined;
    const engine = this.engine;
    if (engine === undefined) {
      this.failure = 'The import engine is not available.';
      return;
    }
    try {
      const previews = await engine.preview(files);
      if (reading === this.readings) {
        this.entries = entriesOf(groupFiles(files), previews);
        const current = this.current;
        this.draft = current === undefined ? undefined : draftFor(current);
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
    this.draft = undefined;
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

  private readonly onDraftChange = (event: CustomEvent<DraftChange>): void => {
    if (this.draft !== undefined) {
      this.draft = applyDraftChange(this.draft, event.detail);
    }
  };

  /** Why a person cannot go on from this step yet, in words, or `undefined` if they can. */
  private get blocker(): string | undefined {
    if (this.step === 'mapping' && this.draft !== undefined) {
      // The first thing that is wrong with the mapping, in the kernel's words.
      return mappingProblems(this.draft.kind, this.draft.columns, this.draft.blockSize)[0]?.message;
    }
    if (this.step !== 'file') {
      return undefined;
    }
    if (this.failure !== undefined) {
      return 'The files could not be read.';
    }
    if (this.entries === undefined) {
      return 'Reading the files…';
    }
    if (this.current === undefined) {
      return 'None of these files can be imported.';
    }
    if ((this.draft?.datasetName ?? '').trim() === '') {
      return 'Give the dataset a name.';
    }
    return undefined;
  }

  private fileStep() {
    if (this.failure !== undefined) {
      return html`<karmania-findings
        .findings=${[
          {
            code: 'engine.failed',
            severity: 'error',
            message: `The import engine could not read the files: ${this.failure}`,
            hint: 'Close this window and try again. If it keeps happening, reload the page.',
            count: 1,
            examples: [],
          },
        ]}
      ></karmania-findings>`;
    }
    if (this.entries === undefined) {
      return html`<p class="reading" role="status">Reading the files…</p>`;
    }
    return html`<karmania-file-step
      .entries=${this.entries}
      .current=${this.current}
      .draft=${this.draft}
      @karmania-draft-change=${this.onDraftChange}
    ></karmania-file-step>`;
  }

  private body() {
    if (this.step === 'file') {
      return html`<div class="step" data-step="file">${this.fileStep()}</div>`;
    }
    if (this.step === 'mapping') {
      return html`<div class="step" data-step="mapping">
        <karmania-mapping-step
          .entry=${this.current}
          .draft=${this.draft}
          @karmania-draft-change=${this.onDraftChange}
        ></karmania-mapping-step>
      </div>`;
    }
    if (this.step === 'nodata') {
      return html`<div class="step" data-step="nodata">
        <karmania-nodata-step
          .entry=${this.current}
          .draft=${this.draft}
          @karmania-draft-change=${this.onDraftChange}
        ></karmania-nodata-step>
      </div>`;
    }
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
    const blocker = this.blocker;
    return html`
      <k-dialog heading="Import data" fill .open=${this.open} @k-dialog-close=${this.onDialogClose}>
        <k-steps
          slot="steps"
          label="Import steps"
          current=${this.step}
          .steps=${IMPORT_STEPS}
        ></k-steps>
        <!-- First, not last: it is placed absolutely, where it would have been, and where the content
             ends is out of sight when the body is scrolled. -->
        <span class="visually-hidden" role="status">${describeStep(this.step)}</span>
        ${this.body()}
        <k-button slot="footer-start" variant="ghost" @click=${this.onCancel}>Cancel</k-button>
        ${
          blocker === undefined
            ? nothing
            : html`<span slot="footer-note" title=${blocker}>${blocker}</span>`
        }
        <k-button
          slot="footer-end"
          ?disabled=${stepBefore(this.step) === undefined}
          @click=${this.onBack}
          >Back</k-button
        >
        <!-- Nothing has been made to load yet, so the last step's button is there but cannot be used. -->
        <k-button
          slot="footer-end"
          variant="primary"
          ?disabled=${last || blocker !== undefined}
          @click=${this.onNext}
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
