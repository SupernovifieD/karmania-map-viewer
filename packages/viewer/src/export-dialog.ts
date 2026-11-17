import type { ExportLimits } from '@karmania/render';
import type { ExportWarning, GpuSizes, Size } from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import type { CheckboxChange, InputChange, SelectChange, SelectOption } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type {
  ExportPlan,
  ExportPngOptions,
  ExportPngRun,
  PictureOptions,
} from './export-compose.js';
import {
  DEFAULT_FILE_NAME,
  DPI_LABELS,
  EXPORT_DPIS,
  MIN_EXPORT_SIDE,
  SIZE_LABELS,
  SIZE_PRESETS,
  defaultOptions,
  errorText,
  fileNameOf,
  pictureSize,
  problemText,
  problemsOf,
  progressText,
  sizeCaption,
  warningText,
} from './export-options.js';
import type { ExportOptionsState } from './export-options.js';
import { saveBlob } from './save-blob.js';

/** The name of the event the dialog sends when a file has been given to the person. */
export const EXPORT_DONE = 'karmania-export-done';

/** What `karmania-export-done` carries. */
export interface ExportDone {
  readonly fileName: string;
  readonly bytes: number;
}

/** What the dialog is given by the viewer to make pictures with: the plan of one, a small copy of one, and the file. */
export interface ExportDialogWork {
  plan(options: PictureOptions): Promise<ExportPlan>;
  preview(options: PictureOptions): Promise<HTMLCanvasElement>;
  run(options: ExportPngOptions, run: ExportPngRun): Promise<Blob>;
}

/** How long after the last change of an option the preview is made again, in milliseconds (a wait, which decides nothing about the picture). */
const PREVIEW_DELAY = 250;
/** The longest side of the preview's canvas, in pixels: twice what it is shown at, so that it is sharp on a screen of twice the pixels. */
const PREVIEW_SIDE = 560;

/** How the preview is: waiting to be made, being made, made, or none (the size is not one, or the legend leaves no room). */
type PreviewState = 'working' | 'ready' | 'none' | 'failed';

/**
 * The export dialog (section 10.5 of the brief), opened by the toolbar's Export PNG button: the options on the left (the size, the width and height in pixels, which are the
 * size's own numbers and can be typed only for Custom, the resolution, whether the legend is to the right of the map, the file name with ".png" after it), a live preview on the right
 * (made a moment after the last change, at the shape of the picture, at most 360 high, with its size and dpi under it), and under the options what is wrong or worth knowing. The footer has Cancel
 * on the left and, on the right, a status that has its room kept ("Rendering… 40 %") and Export. Cancel, Esc and the close button stop a picture that is being made and close the dialog.
 * What it does is the viewer's: it is given `work`, which makes the plan of a picture, a small copy of it and the file.
 */
export class KarmaniaExportDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    screen: { attribute: false },
    limits: { attribute: false },
    canLegend: { type: Boolean, attribute: false },
    work: { attribute: false },
    options: { state: true },
    customText: { state: true },
    warnings: { state: true },
    previewState: { state: true },
    exporting: { state: true },
    progress: { state: true },
    failure: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: contents;
      }

      /* The dialog is as wide as a dialog is at most, or the window less 24 each side. */
      k-dialog {
        --k-dialog-width: var(--k-dialog-max-size);
      }

      /* The options and the preview side by side; when there is not room for both they are one above the other. */
      .content {
        display: flex;
        flex-wrap: wrap;
        gap: var(--k-space-24);
        min-width: 0;
      }

      .options {
        display: flex;
        flex: 1 1 calc(var(--k-space-8) * 42);
        flex-direction: column;
        gap: var(--k-space-12);
        min-width: 0;
      }

      .pair {
        display: grid;
        gap: var(--k-space-12);
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .name {
        align-items: flex-end;
        display: flex;
        gap: var(--k-space-8);
      }

      .name k-input {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* On the middle line of the field it follows: the field is as high as a control, and so is the line. */
      .suffix {
        color: var(--k-text-muted);
        flex: none;
        line-height: var(--k-control-height);
      }

      .label {
        color: var(--k-text);
        font-size: var(--k-font-size-caption);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-caption);
        margin-bottom: var(--k-space-4);
      }

      .preview {
        display: flex;
        flex: 0 0 calc(var(--k-space-8) * 35);
        flex-direction: column;
        gap: var(--k-space-8);
        max-width: 100%;
        min-width: 0;
      }

      .frame {
        align-items: center;
        background: var(--k-surface-raised);
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-md);
        box-sizing: border-box;
        display: flex;
        justify-content: center;
        min-height: calc(var(--k-space-8) * 20);
        overflow: hidden;
      }

      .frame canvas {
        display: block;
        height: auto;
        max-height: calc(var(--k-space-8) * 45);
        max-width: 100%;
        width: auto;
      }

      .caption,
      .hint {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-caption);
        line-height: var(--k-line-height-caption);
        margin: 0;
        min-height: var(--k-line-height-caption);
      }

      .frame .hint {
        padding: var(--k-space-16);
        text-align: center;
      }

      /* What is wrong or worth knowing. */
      .notes {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-8);
        margin: 0;
        padding: 0;
      }

      .notes p {
        align-items: flex-start;
        display: grid;
        font-size: var(--k-font-size-secondary);
        gap: var(--k-space-8);
        grid-template-columns: var(--k-icon-size-sm) minmax(0, 1fr);
        line-height: var(--k-line-height-secondary);
        margin: 0;
        overflow-wrap: anywhere;
      }

      .notes .problem {
        color: var(--k-danger);
      }

      .notes .warning {
        color: var(--k-warning);
      }

      /* The room of the status is kept, so that nothing moves as it changes. */
      .status {
        color: var(--k-text-muted);
        display: inline-block;
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        min-width: calc(var(--k-space-8) * 21);
        text-align: right;
        white-space: nowrap;
      }
    `,
  ];

  declare open: boolean;
  /** The map on screen, in CSS pixels: what "the same as the map on screen" is. */
  declare screen: Size;
  /** What the graphics card allows, or `undefined` if it is not known. */
  declare limits: ExportLimits | undefined;
  /** Whether any layer is shown and drawn on the map (kept up to date while the dialog is open): without one there is nothing to export, and no legend to put beside it. */
  declare canLegend: boolean;
  declare work: ExportDialogWork | undefined;
  declare private options: ExportOptionsState;
  /** The width and height as typed, for the size `custom` (text, so that a number half typed is not lost). */
  declare private customText: { width: string; height: string };
  declare private warnings: readonly ExportWarning[];
  declare private previewState: PreviewState;
  declare private exporting: boolean;
  declare private progress: number;
  declare private failure: string | undefined;

  /** The preview that was made: a canvas of the picture, small. */
  private previewCanvas: HTMLCanvasElement | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** What stops the preview that is being made, and what says it has stopped. */
  private refresher: AbortController | undefined;
  private refreshing: Promise<void> = Promise.resolve();
  /** What stops the export that is being made. */
  private exporter: AbortController | undefined;

  constructor() {
    super();
    this.open = false;
    this.screen = { width: 800, height: 600 };
    this.limits = undefined;
    this.canLegend = true;
    this.work = undefined;
    this.options = defaultOptions(this.screen);
    this.customText = { width: '', height: '' };
    this.warnings = [];
    this.previewState = 'none';
    this.exporting = false;
    this.progress = 0;
    this.failure = undefined;
  }

  /** Opens the dialog with the options at their start, and makes the preview. */
  show(): void {
    this.stopRefresh();
    this.options = defaultOptions(this.screen);
    this.customText = {
      width: String(this.options.custom.width),
      height: String(this.options.custom.height),
    };
    this.warnings = [];
    this.previewCanvas = undefined;
    this.previewState = 'working';
    this.failure = undefined;
    this.exporting = false;
    this.open = true;
    this.schedule(0);
  }

  override disconnectedCallback(): void {
    this.stopRefresh();
    this.exporter?.abort(new DOMException('The dialog was taken out of the page.', 'AbortError'));
    super.disconnectedCallback();
  }

  /** What the card allows, in the shape the size checks take. */
  private gpu(): GpuSizes | undefined {
    const limits = this.limits;
    return limits === undefined
      ? undefined
      : { renderbuffer: limits.renderbuffer, texture: limits.texture, viewport: limits.viewport };
  }

  /** The size of the picture the options come to: for Custom what is typed (which may not be a number), else the preset's. */
  private size(): Size {
    const { preset } = this.options;
    return preset === 'custom'
      ? { width: Number(this.customText.width), height: Number(this.customText.height) }
      : pictureSize(this.options, this.screen);
  }

  /** Whether the legend is in the picture: it is asked for and there is a layer to list. */
  private withLegend(): boolean {
    return this.options.legend && this.canLegend;
  }

  /** What is wrong with the size, as sentences. */
  private problems(): readonly string[] {
    return problemsOf(this.size(), this.gpu()).map(problemText);
  }

  /** Why Export cannot be pressed, or `undefined`. */
  private get blocker(): string | undefined {
    if (this.exporting) {
      return 'A picture is being made.';
    }
    if (this.work === undefined || !this.canLegend) {
      return 'There is nothing drawn on the map to export.';
    }
    if (this.problems().length > 0) {
      return 'The size is not one that can be made.';
    }
    return this.warnings.includes('no_room_for_map')
      ? 'The legend leaves no room for the map.'
      : undefined;
  }

  /** Stops the preview that is being made and the wait for the next. */
  private stopRefresh(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.refresher?.abort(new DOMException('The options changed.', 'AbortError'));
    this.refresher = undefined;
  }

  /** The preview is made again after a moment, or at once with 0: what changed last is what it is made for. */
  private schedule(delay = PREVIEW_DELAY): void {
    this.stopRefresh();
    if (!this.open || this.exporting) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refreshing = this.refresh();
    }, delay);
  }

  /** Makes the plan and the small copy of the picture for the options as they are. */
  private async refresh(): Promise<void> {
    const work = this.work;
    const controller = new AbortController();
    this.refresher = controller;
    const { signal } = controller;
    // (Read through a function: the signal is aborted by what happens during an await, which the checker's narrowing cannot see.)
    const stopped = (): boolean => signal.aborted;
    const size = this.size();
    if (work === undefined || this.problems().length > 0) {
      this.warnings = [];
      this.previewCanvas = undefined;
      this.previewState = 'none';
      return;
    }
    this.previewState = 'working';
    const { dpi } = this.options;
    const legend = this.withLegend();
    try {
      const plan = await work.plan({ size, dpi, legend, signal });
      if (stopped()) {
        return;
      }
      this.warnings = plan.layout.warnings;
      const factor = Math.min(1, PREVIEW_SIDE / Math.max(size.width, size.height));
      const canvas = await work.preview({
        size: {
          width: Math.max(1, Math.round(size.width * factor)),
          height: Math.max(1, Math.round(size.height * factor)),
        },
        dpi: dpi * factor,
        legend,
        signal,
      });
      if (stopped()) {
        return;
      }
      this.previewCanvas = canvas;
      this.previewState = 'ready';
    } catch (error) {
      if (stopped()) {
        return;
      }
      const named = error as { code?: unknown };
      this.previewCanvas = undefined;
      if (named.code === 'no_room_for_map') {
        this.warnings = ['no_room_for_map'];
        this.previewState = 'none';
      } else {
        this.previewState = 'failed';
      }
    }
  }

  private setOptions(change: Partial<ExportOptionsState>): void {
    this.options = { ...this.options, ...change };
    this.failure = undefined;
    this.schedule();
  }

  private readonly onSize = (event: CustomEvent<SelectChange>): void => {
    const preset = SIZE_PRESETS.find((known) => known === event.detail.value);
    if (preset !== undefined) {
      this.setOptions({ preset });
    }
  };

  private readonly onDpi = (event: CustomEvent<SelectChange>): void => {
    const dpi = EXPORT_DPIS.find((known) => String(known) === event.detail.value);
    if (dpi !== undefined) {
      this.setOptions({ dpi });
    }
  };

  private readonly onSide =
    (side: 'width' | 'height') =>
    (event: CustomEvent<InputChange>): void => {
      this.customText = { ...this.customText, [side]: event.detail.value.trim() };
      this.failure = undefined;
      this.schedule();
    };

  private readonly onLegend = (event: CustomEvent<CheckboxChange>): void => {
    this.setOptions({ legend: event.detail.checked });
  };

  private readonly onName = (event: CustomEvent<InputChange>): void => {
    this.options = { ...this.options, name: event.detail.value };
    this.failure = undefined;
  };

  /** Cancel, Esc and the close button: a picture that is being made is stopped, and the dialog closes. */
  private readonly onClose = (): void => {
    this.exporter?.abort(new DOMException('The export was cancelled.', 'AbortError'));
    this.stopRefresh();
    this.open = false;
  };

  private readonly onExport = async (): Promise<void> => {
    const work = this.work;
    if (this.blocker !== undefined || work === undefined) {
      return;
    }
    const size = this.size();
    const { dpi } = this.options;
    const fileName = `${fileNameOf(this.options.name)}.png`;
    const exporter = new AbortController();
    this.exporter = exporter;
    this.exporting = true;
    this.failure = undefined;
    this.progress = 0;
    // The preview shares the renderer with the export, which makes one picture at a time: it is stopped, and waited for, first.
    this.stopRefresh();
    await this.refreshing.catch(() => undefined);
    try {
      if (exporter.signal.aborted) {
        return;
      }
      const blob = await work.run(
        { widthPx: size.width, heightPx: size.height, dpi, legend: this.withLegend() },
        {
          signal: exporter.signal,
          onProgress: (done) => {
            this.progress = done;
          },
        },
      );
      saveBlob(this.ownerDocument, blob, fileName);
      this.open = false;
      this.dispatchEvent(
        new CustomEvent<ExportDone>(EXPORT_DONE, {
          detail: { fileName, bytes: blob.size },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (!exporter.signal.aborted) {
        this.failure = errorText(error);
      }
    } finally {
      this.exporting = false;
      this.exporter = undefined;
      if (this.open) {
        this.schedule(0);
      }
    }
  };

  private sizeOptions(): SelectOption[] {
    return SIZE_PRESETS.map((preset) => ({ value: preset, label: SIZE_LABELS[preset] }));
  }

  private dpiOptions(): SelectOption[] {
    return EXPORT_DPIS.map((dpi) => ({ value: String(dpi), label: DPI_LABELS[dpi] }));
  }

  /** The text of what the preview is not, in the frame. */
  private previewHint(): string {
    switch (this.previewState) {
      case 'working':
        return 'Making the preview…';
      case 'failed':
        return 'The preview could not be made.';
      case 'none':
        return this.problems().length > 0
          ? 'There is no preview for this size.'
          : 'There is no preview: the legend leaves no room for the map.';
      case 'ready':
        return '';
    }
  }

  /** The preview's frame: the picture, or why there is none. */
  private frame() {
    const canvas = this.previewState === 'ready' ? this.previewCanvas : undefined;
    return html`<div class="frame" aria-label="Preview of the picture" role="group">
      ${canvas === undefined ? html`<p class="hint">${this.previewHint()}</p>` : canvas}
    </div>`;
  }

  private notes() {
    const problems = this.problems();
    const warnings = this.warnings.filter(
      (warning) => !(warning === 'no_room_for_map' && problems.length > 0),
    );
    return html`<div class="notes" role="status">
      ${problems.map(
        (text) =>
          html`<p class="problem">
            <k-icon name="circle-alert" size="16"></k-icon><span>${text}</span>
          </p>`,
      )}
      ${warnings.map(
        (warning) =>
          html`<p class="warning">
            <k-icon name="triangle-alert" size="16"></k-icon><span>${warningText(warning)}</span>
          </p>`,
      )}
      ${
        this.failure === undefined
          ? nothing
          : html`<p class="problem" role="alert">
              <k-icon name="circle-alert" size="16"></k-icon><span>${this.failure}</span>
            </p>`
      }
    </div>`;
  }

  override render() {
    const size = this.size();
    const custom = this.options.preset === 'custom';
    const shown = custom
      ? this.customText
      : { width: String(size.width), height: String(size.height) };
    const caption = this.problems().length === 0 ? sizeCaption(size, this.options.dpi) : '';
    const blocker = this.blocker;
    const legendReason = this.canLegend ? undefined : 'No layer is on the map.';
    const typed = this.options.name;
    return html`
      <k-dialog heading="Export PNG" fill .open=${this.open} @k-dialog-close=${this.onClose}>
        <div class="content">
          <div class="options">
            <k-select
              label="Size"
              .options=${this.sizeOptions()}
              .value=${this.options.preset}
              @k-select-change=${this.onSize}
            ></k-select>
            <div class="pair">
              <k-input
                label="Width (px)"
                inputmode="numeric"
                .value=${shown.width}
                ?disabled=${!custom}
                reserve
                help=${custom ? `At least ${String(MIN_EXPORT_SIDE)}` : ''}
                @k-input-change=${this.onSide('width')}
              ></k-input>
              <k-input
                label="Height (px)"
                inputmode="numeric"
                .value=${shown.height}
                ?disabled=${!custom}
                reserve
                help=${custom ? `At least ${String(MIN_EXPORT_SIDE)}` : ''}
                @k-input-change=${this.onSide('height')}
              ></k-input>
            </div>
            <k-select
              label="Resolution"
              .options=${this.dpiOptions()}
              .value=${String(this.options.dpi)}
              @k-select-change=${this.onDpi}
            ></k-select>
            <k-checkbox
              ?checked=${this.withLegend()}
              ?disabled=${!this.canLegend}
              detail=${legendReason ?? ''}
              @k-checkbox-change=${this.onLegend}
              >Put the legend to the right of the map</k-checkbox
            >
            <div>
              <div class="label" id="file-name-label">File name</div>
              <div class="name">
                <k-input
                  label="File name"
                  hide-label
                  placeholder=${DEFAULT_FILE_NAME}
                  .value=${typed}
                  @k-input-change=${this.onName}
                ></k-input>
                <span class="suffix" aria-hidden="true">.png</span>
              </div>
            </div>
            ${this.notes()}
          </div>
          <div class="preview">
            ${this.frame()}
            <p class="caption">${caption}</p>
          </div>
        </div>
        <k-button slot="footer-start" variant="ghost" @click=${this.onClose}>Cancel</k-button>
        <span slot="footer-note" class="status" role="status" title=${blocker ?? ''}
          >${this.exporting ? progressText(this.progress) : ''}</span
        >
        <k-button
          slot="footer-end"
          variant="primary"
          ?disabled=${blocker !== undefined}
          @click=${this.onExport}
          >Export</k-button
        >
      </k-dialog>
    `;
  }
}

customElements.define('karmania-export-dialog', KarmaniaExportDialog);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-export-dialog': KarmaniaExportDialog;
  }

  interface HTMLElementEventMap {
    [EXPORT_DONE]: CustomEvent<ExportDone>;
  }
}
