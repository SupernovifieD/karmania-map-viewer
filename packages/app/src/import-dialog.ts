import { groupFiles } from '@karmania/engine';
import type { Engine, Summary } from '@karmania/engine';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import './file-step.js';
import type { DraftChange } from './file-step.js';
import { applyDraftChange, draftFor } from './import-draft.js';
import type { ImportDraft } from './import-draft.js';
import { crsBlocker } from './import-crs.js';
import { entriesOf, isImportable } from './import-files.js';
import { mappingProblems } from './import-mapping.js';
import type { FileEntry } from './import-files.js';
import './crs-step.js';
import './findings.js';
import type { GoToStep } from './findings.js';
import './mapping-step.js';
import './nodata-step.js';
import { buildMapping, groupFindings, IDLE, loadBlocker, loadLabel } from './import-run.js';
import type { RunState } from './import-run.js';
import './review-step.js';
import { describeStep, FIRST_STEP, IMPORT_STEPS, stepAfter, stepBefore } from './import-steps.js';
import type { ImportStep } from './import-steps.js';

/** The name of the event the dialog sends when it has been closed, by Cancel, Esc or the close button. */
export const IMPORT_CLOSE = 'karmania-import-close';

/** The name of the event the dialog sends when a person has loaded what was imported. */
export const IMPORT_LOADED = 'karmania-import-loaded';

/** What was loaded. */
export interface ImportLoaded {
  readonly summaries: readonly Summary[];
}

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
    run: { state: true },
    returning: { state: true },
    position: { state: true },
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
  /** What the import, which runs while the last step is shown, has come to. */
  declare run: RunState;
  /** Whether a person went from the last step to an earlier one to fix something, and is to be taken back. */
  declare returning: boolean;
  /** How many of the files that can be imported have been loaded: the one to import now comes next. */
  declare position: number;

  /** Counts the times files have been looked at, so that an answer that comes late is ignored. */
  private readings = 0;
  /** Counts the times the import has been started, for the same reason. */
  private runs = 0;
  /** Stops the import that is going on. */
  private controller: AbortController | undefined;
  /** The datasets the import has loaded into the engine, which are taken out again if it is not kept. */
  private loadedIds: readonly number[] = [];

  constructor() {
    super();
    this.open = false;
    this.step = FIRST_STEP;
    this.files = [];
    this.engine = undefined;
    this.entries = undefined;
    this.failure = undefined;
    this.draft = undefined;
    this.run = IDLE;
    this.returning = false;
    this.position = 0;
  }

  /** The files that can be imported, in the order they were given: one is imported at a time. */
  private get queue(): readonly FileEntry[] {
    return this.entries?.filter((entry) => isImportable(entry.preview)) ?? [];
  }

  /** The file being imported: the first of those that can be that has not been loaded. */
  private get current(): FileEntry | undefined {
    return this.queue[this.position];
  }

  /** The files that have been loaded, which the File step says. */
  private get done(): readonly FileEntry[] {
    return this.queue.slice(0, this.position);
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
    this.position = 0;
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
      this.returning = false;
    }
    // Once the last step is shown, the way back to it has been taken.
    if (changed.has('step') && this.step === 'review') {
      this.returning = false;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('step')) {
      // The body of a step starts at its top.
      const body = this.renderRoot.querySelector('k-dialog')?.shadowRoot?.querySelector('.body');
      if (body) {
        body.scrollTop = 0;
      }
      // The import runs when the last step is shown, and what it did is undone when it is left.
      if (this.step === 'review') {
        void this.startRun();
      } else if (changed.get('step') === 'review') {
        this.discardRun();
      }
    }
  }

  /** Runs the import with what a person decided, and keeps what comes of it while the step is shown. */
  private async startRun(): Promise<void> {
    this.discardRun();
    const { engine, draft } = this;
    const entry = this.current;
    if (engine === undefined || entry === undefined || draft === undefined) {
      this.run = { status: 'failed', message: 'There is nothing to import.' };
      return;
    }
    const run = ++this.runs;
    const controller = new AbortController();
    this.controller = controller;
    this.run = { status: 'running', phase: undefined, fraction: undefined };
    try {
      const result = await engine.importFiles(
        [entry.group.file, ...entry.group.sidecars],
        buildMapping(draft, entry),
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (run === this.runs) {
              this.run = { status: 'running', phase: progress.phase, fraction: progress.fraction };
            }
          },
        },
      );
      if (run !== this.runs) {
        // Another import was started, or the step was left, while this one was going on.
        if (result.status === 'loaded') {
          this.unload(result.summaries.map((summary) => summary.id));
        }
        return;
      }
      if (result.status === 'loaded') {
        this.loadedIds = result.summaries.map((summary) => summary.id);
        this.run = {
          status: 'loaded',
          summaries: result.summaries,
          findings: result.summaries.flatMap((summary) => summary.findings),
        };
      } else {
        this.run = { status: 'blocked', findings: result.findings };
      }
    } catch (error) {
      if (run === this.runs) {
        this.run = controller.signal.aborted
          ? { status: 'cancelled' }
          : { status: 'failed', message: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  /** Stops the import, if one is going on, and takes out of the engine what it loaded. */
  private discardRun(): void {
    this.runs += 1;
    this.controller?.abort();
    this.controller = undefined;
    const ids = this.loadedIds;
    this.loadedIds = [];
    this.unload(ids);
    this.run = IDLE;
  }

  /** Takes datasets out of the engine. */
  private unload(ids: readonly number[]): void {
    const engine = this.engine;
    if (engine !== undefined) {
      for (const id of ids) {
        engine.remove(id).catch(() => undefined);
      }
    }
  }

  private readonly onRunCancel = (): void => {
    this.controller?.abort();
  };

  private readonly onRunAgain = (): void => {
    void this.startRun();
  };

  private readonly onGoToStep = (event: CustomEvent<GoToStep>): void => {
    const target = IMPORT_STEPS.find((known) => known.id === event.detail.step);
    if (target !== undefined) {
      this.step = target.id;
      this.returning = true;
    }
  };

  /** Keeps what the import loaded: it stays in the engine, and the dialog closes. */
  private load(): void {
    if (this.run.status !== 'loaded') {
      return;
    }
    const { summaries } = this.run;
    this.loadedIds = [];
    this.dispatchEvent(
      new CustomEvent<ImportLoaded>(IMPORT_LOADED, {
        detail: { summaries },
        bubbles: true,
        composed: true,
      }),
    );
    if (this.position + 1 < this.queue.length) {
      // Another file is waiting: it is imported next, from the start.
      this.position += 1;
      const next = this.current;
      this.draft = next === undefined ? undefined : draftFor(next);
      this.run = IDLE;
      this.returning = false;
      this.step = FIRST_STEP;
    } else {
      this.close();
    }
  }

  /** Closes the dialog, and says so. */
  private close(): void {
    this.discardRun();
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

  /** The first step after `step`, before the last, that has something wrong with it now, if any. */
  private firstBlockedAfter(step: ImportStep): ImportStep | undefined {
    let at = stepAfter(step);
    while (at !== undefined && at !== 'review') {
      if (this.blockerOf(at) !== undefined) {
        return at;
      }
      at = stepAfter(at);
    }
    return undefined;
  }

  private readonly onNext = (): void => {
    const next = stepAfter(this.step);
    if (next === undefined) {
      this.load();
    } else if (this.returning) {
      this.step = this.firstBlockedAfter(this.step) ?? 'review';
    } else {
      this.step = next;
    }
  };

  private readonly onDraftChange = (event: CustomEvent<DraftChange>): void => {
    if (this.draft !== undefined) {
      this.draft = applyDraftChange(this.draft, event.detail);
    }
  };

  /** Why a person cannot go on from this step yet, in words, or `undefined` if they can. */
  private get blocker(): string | undefined {
    return this.blockerOf(this.step);
  }

  /** Why a person cannot go on from `step`, in words, or `undefined` if they can. */
  private blockerOf(step: ImportStep): string | undefined {
    if (step === 'mapping' && this.draft !== undefined) {
      // The first thing that is wrong with the mapping, in the kernel's words.
      return mappingProblems(this.draft.kind, this.draft.columns, this.draft.blockSize)[0]?.message;
    }
    if (step === 'crs' && this.draft !== undefined) {
      return crsBlocker(this.draft.crs, this.current?.preview.crs);
    }
    if (step === 'review') {
      return loadBlocker(this.run);
    }
    if (step !== 'file') {
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
      .done=${this.done}
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
    if (this.step === 'crs') {
      return html`<div class="step" data-step="crs">
        <karmania-crs-step
          .entry=${this.current}
          .draft=${this.draft}
          @karmania-draft-change=${this.onDraftChange}
        ></karmania-crs-step>
      </div>`;
    }
    return html`<div class="step" data-step="review">
      <karmania-review-step
        .run=${this.run}
        @karmania-run-cancel=${this.onRunCancel}
        @karmania-run-again=${this.onRunAgain}
        @karmania-go-step=${this.onGoToStep}
      ></karmania-review-step>
    </div>`;
  }

  /** What the primary button says: Next, or on the last step Load, with the warnings there are. */
  private nextLabel(last: boolean): string {
    if (!last) {
      // After going back to fix something, the way on is to the last step, to check again.
      return this.returning ? 'Check again' : 'Next';
    }
    return this.run.status === 'loaded'
      ? loadLabel(groupFindings(this.run.findings).warnings.length)
      : 'Load';
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
        <k-button
          slot="footer-end"
          variant="primary"
          ?disabled=${blocker !== undefined}
          @click=${this.onNext}
          >${this.nextLabel(last)}</k-button
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
    [IMPORT_LOADED]: CustomEvent<ImportLoaded>;
  }
}
