import { sharedStyles } from '@karmania/ui';
import type { InputChange, SelectChange, SelectOption } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import './findings.js';
import {
  describeFile,
  isImportable,
  isKind,
  KIND_HELP,
  KIND_NAMES,
  KINDS_BY_FORMAT,
} from './import-files.js';
import type { FileEntry } from './import-files.js';
import type { ImportDraft } from './import-draft.js';

/** The name of the event the step sends when a person changes what is to be imported. */
export const DRAFT_CHANGE = 'karmania-draft-change';

/** What a person changed: the parts of the draft that are different. */
export type DraftChange = Partial<ImportDraft>;

/** The value of the kind select for a format with no kind to choose. */
const DECIDED_BY_THE_FILE = 'decided-by-the-file';

/**
 * The wizard's first step: the files, and what to make of the one that is being imported. It lists
 * every file with what the kernel found in it (its format, encoding, delimiter and about how many
 * rows), and a file that cannot be imported says why. Under the list, the file being imported has
 * its settings: what to import it as (only what its format can be) and the dataset's name, and what
 * the kernel found out about it that a person ought to know.
 *
 * The step shows `draft` and says what a person changed (`karmania-draft-change`); the wizard keeps it.
 */
export class KarmaniaFileStep extends LitElement {
  static override properties = {
    entries: { attribute: false },
    current: { attribute: false },
    draft: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-24);
        min-width: 0;
      }

      section {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-8);
        min-width: 0;
      }

      h3 {
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      ul {
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-md);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .file {
        display: flex;
        gap: var(--k-space-8);
        min-width: 0;
        padding: var(--k-space-8) var(--k-space-12);
      }

      .file + .file {
        border-top: var(--k-border-width) solid var(--k-border);
      }

      .file k-icon {
        color: var(--k-text-muted);
        flex: none;
        margin-top: var(--k-space-2);
      }

      .main {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--k-space-4);
        min-width: 0;
      }

      .line {
        align-items: baseline;
        display: flex;
        gap: var(--k-space-8);
        justify-content: space-between;
        min-width: 0;
      }

      .name {
        font-weight: var(--k-weight-medium);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .status {
        color: var(--k-text-muted);
        flex: none;
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
      }

      .file[data-state='current'] .status {
        color: var(--k-text);
        font-weight: var(--k-weight-medium);
      }

      .file[data-state='blocked'] .status {
        color: var(--k-danger);
        font-weight: var(--k-weight-medium);
      }

      .detail {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
        overflow-wrap: anywhere;
      }

      /* The findings about the file are set apart from the settings above them. */
      .about karmania-findings {
        margin-top: var(--k-space-8);
      }

      .settings {
        display: grid;
        gap: var(--k-space-16);
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    `,
  ];

  /** Every file, as the kernel saw it. */
  declare entries: readonly FileEntry[];
  /** The file being imported: the first one that can be. */
  declare current: FileEntry | undefined;
  /** What is to be done with it. */
  declare draft: ImportDraft | undefined;

  constructor() {
    super();
    this.entries = [];
    this.current = undefined;
    this.draft = undefined;
  }

  private tell(change: DraftChange): void {
    this.dispatchEvent(
      new CustomEvent<DraftChange>(DRAFT_CHANGE, { detail: change, bubbles: true, composed: true }),
    );
  }

  private readonly onKind = (event: CustomEvent<SelectChange>): void => {
    const { value } = event.detail;
    if (isKind(value)) {
      this.tell({ kind: value });
    }
  };

  private readonly onName = (event: CustomEvent<InputChange>): void => {
    this.tell({ datasetName: event.detail.value });
  };

  private row(entry: FileEntry, several: boolean) {
    const { preview, group } = entry;
    const state = !isImportable(preview)
      ? 'blocked'
      : entry === this.current
        ? 'current'
        : 'waiting';
    const status =
      state === 'blocked'
        ? 'Cannot be imported'
        : several
          ? state === 'current'
            ? 'Importing now'
            : 'Waiting'
          : '';
    const described = describeFile(preview);
    const sidecars = group.sidecars.map((file) => file.name);
    const detail = [described, sidecars.length > 0 ? `with ${sidecars.join(', ')}` : undefined]
      .filter((part) => part !== undefined)
      .join(' · ');
    return html`
      <li class="file" data-state=${state} data-file=${preview.fileName}>
        <k-icon name="file" size="16"></k-icon>
        <div class="main">
          <div class="line">
            <span class="name" data-truncate title=${preview.fileName}>${preview.fileName}</span>
            ${status === '' ? nothing : html`<span class="status">${status}</span>`}
          </div>
          ${detail === '' ? nothing : html`<div class="detail">${detail}</div>`}
          ${
            state === 'blocked'
              ? html`<karmania-findings .findings=${preview.findings}></karmania-findings>`
              : nothing
          }
        </div>
      </li>
    `;
  }

  /** The kinds a person can choose from for the file, as the options of a select. */
  private kindOptions(entry: FileEntry): readonly SelectOption[] {
    const { format } = entry.preview;
    const kinds = format === undefined ? [] : KINDS_BY_FORMAT[format];
    return kinds.length === 0
      ? [{ value: DECIDED_BY_THE_FILE, label: 'Decided by the shapes in the file' }]
      : kinds.map((kind) => ({ value: kind, label: KIND_NAMES[kind] }));
  }

  private settings(entry: FileEntry, draft: ImportDraft) {
    const options = this.kindOptions(entry);
    const { format, fileName, findings } = entry.preview;
    const name = draft.datasetName;
    return html`
      <section class="about">
        <h3 data-truncate title=${`Settings for ${fileName}`}>Settings for ${fileName}</h3>
        <div class="settings">
          <k-select
            label="Import as"
            reserve
            ?disabled=${options.length < 2}
            .options=${options}
            .value=${draft.kind ?? DECIDED_BY_THE_FILE}
            help=${format === undefined ? '' : KIND_HELP[format]}
            @k-select-change=${this.onKind}
          ></k-select>
          <k-input
            label="Dataset name"
            reserve
            .value=${name}
            error=${name.trim() === '' ? 'Give the dataset a name.' : ''}
            @k-input-change=${this.onName}
          ></k-input>
        </div>
        ${
          findings.length === 0
            ? nothing
            : html`<karmania-findings .findings=${findings}></karmania-findings>`
        }
      </section>
    `;
  }

  override render() {
    const several = this.entries.filter((entry) => isImportable(entry.preview)).length > 1;
    return html`
      <section class="files">
        <h3>${this.entries.length === 1 ? 'File' : 'Files'}</h3>
        <ul>
          ${this.entries.map((entry) => this.row(entry, several))}
        </ul>
      </section>
      ${
        this.current === undefined || this.draft === undefined
          ? nothing
          : this.settings(this.current, this.draft)
      }
    `;
  }
}

customElements.define('karmania-file-step', KarmaniaFileStep);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-file-step': KarmaniaFileStep;
  }

  interface HTMLElementEventMap {
    [DRAFT_CHANGE]: CustomEvent<DraftChange>;
  }
}
