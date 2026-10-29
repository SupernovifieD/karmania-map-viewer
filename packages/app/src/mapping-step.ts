import { sharedStyles } from '@karmania/ui';
import type { InputChange, SelectChange, SelectOption } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { DRAFT_CHANGE } from './file-step.js';
import type { DraftChange } from './file-step.js';
import type { ImportDraft } from './import-draft.js';
import { formatCount, NO_COLUMNS_NOTE } from './import-files.js';
import type { FileEntry } from './import-files.js';
import {
  mappingProblems,
  parseSize,
  REQUIREMENTS_NOTE,
  ROLE_NAMES,
  rolesFor,
  TYPE_NAMES,
  TYPES_BY_ROLE,
  withRename,
  withRole,
  withType,
} from './import-mapping.js';
import type { BlockSizeDraft } from './import-mapping.js';
import './findings.js';
import { COLUMN_TYPES, ROLES } from '@karmania/engine';
import type { ColumnType, Role } from '@karmania/engine';

/** How many rows of the file the table shows. */
export const PREVIEW_ROWS = 100;

/** Whether some text, from a select say, is the name of a role. */
function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value);
}

/** Whether some text, from a select say, is the name of a column type. */
function isColumnType(value: string): value is ColumnType {
  return COLUMN_TYPES.some((type) => type === value);
}

/**
 * The wizard's Mapping step: the first rows of the file as a table, and over each column a selector
 * for what the column is for. The roles the kernel suggested are filled in and marked as
 * suggested, until a person changes them. The table scrolls inside itself, in both directions, with
 * its header, selectors and all, kept in view; the rest of the step stays where it is.
 *
 * A file with no columns (GeoJSON, an ASCII grid, an OBJ mesh) has nothing to map, and says so.
 */
export class KarmaniaMappingStep extends LitElement {
  static override properties = {
    entry: { attribute: false },
    draft: { attribute: false },
    selected: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--k-space-8);
        min-height: 0;
        min-width: 0;
      }

      p {
        margin: 0;
      }

      .note {
        align-items: flex-start;
        display: flex;
        gap: var(--k-space-8);
      }

      .note k-icon {
        color: var(--k-info);
        flex: none;
        margin-top: var(--k-space-2);
      }

      fieldset {
        border: none;
        margin: 0;
        min-width: 0;
        padding: 0;
      }

      legend {
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        margin-bottom: var(--k-space-4);
        padding: 0;
      }

      .sizes {
        display: grid;
        gap: var(--k-space-16);
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .count {
        color: var(--k-text-muted);
        flex: none;
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
      }

      /* The table has its own room, and scrolls in it: what the step has left, and not less than
         enough to see a few rows in, since what is above and below it can take a good deal. */
      .viewport {
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-md);
        flex: 1 1 0;
        min-height: calc(var(--k-space-48) * 4);
        overflow: auto;
      }

      /* What is wrong is under the table, so that it appearing or going moves neither the header
         nor the rows. */
      .problems {
        flex: none;
      }

      table {
        border-collapse: separate;
        border-spacing: 0;
        table-layout: fixed;
        width: calc(var(--columns) * var(--k-mapping-column-width));
      }

      th,
      td {
        border-bottom: var(--k-border-width) solid var(--k-border);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
        text-align: left;
      }

      /* The header stays at the top while the rows go by. */
      th {
        background: var(--k-surface-raised);
        font-weight: var(--k-weight-regular);
        padding: var(--k-space-8);
        position: sticky;
        top: 0;
        vertical-align: top;
        z-index: var(--k-z-sticky);
      }

      th[data-role='x'],
      th[data-role='y'],
      th[data-role='z'],
      th[data-role='line_id'] {
        background: color-mix(in srgb, var(--k-accent) 10%, var(--k-surface-raised));
      }

      .head {
        align-items: baseline;
        display: flex;
        gap: var(--k-space-8);
        justify-content: space-between;
        margin-bottom: var(--k-space-4);
        min-width: 0;
      }

      /* The name of a column is a button: it chooses the column, to set its type and its name. */
      .column-name {
        background: none;
        border: none;
        border-radius: var(--k-radius-sm);
        cursor: pointer;
        font-weight: var(--k-weight-medium);
        min-width: 0;
        overflow: hidden;
        padding: 0;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .column-name:hover {
        text-decoration: underline;
      }

      /* The chosen column has a line under its header, as well as being said in the panel below. */
      th[data-selected] {
        box-shadow: inset 0 calc(var(--k-border-width) * -2) 0 var(--k-accent);
      }

      /* What is set for the chosen column: one row, as high whether or not there is a column. */
      .details {
        align-items: center;
        display: flex;
        flex: none;
        gap: var(--k-space-8);
        min-height: var(--k-control-height-compact);
        min-width: 0;
      }

      .details .title {
        font-weight: var(--k-weight-medium);
        max-width: calc(var(--k-space-48) * 4);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .details .caption {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
      }

      .details k-select {
        width: calc(var(--k-space-48) * 4);
      }

      .details k-input {
        flex: 1 1 auto;
        max-width: calc(var(--k-space-48) * 6);
      }

      .suggested {
        border: var(--k-border-width) solid var(--k-accent);
        border-radius: var(--k-radius-sm);
        color: var(--k-accent);
        flex: none;
        font-size: var(--k-font-size-caption);
        line-height: var(--k-line-height-caption);
        padding: 0 var(--k-space-4);
      }

      td {
        height: var(--k-control-height-compact);
        overflow: hidden;
        padding: 0 var(--k-space-8);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      td[data-numeric] {
        font-variant-numeric: tabular-nums;
        text-align: right;
      }

      td[data-role='ignore'] {
        color: var(--k-text-muted);
      }

      tbody tr:last-child td {
        border-bottom: none;
      }
    `,
  ];

  /** The file being imported. */
  declare entry: FileEntry | undefined;
  /** What is to be done with it. */
  declare draft: ImportDraft | undefined;
  /** The column a person has chosen, to set its type and its name. */
  declare private selected: number | undefined;

  constructor() {
    super();
    this.entry = undefined;
    this.draft = undefined;
    this.selected = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // A column of one file is not a column of the next.
    if (changed.has('entry')) {
      this.selected = undefined;
    }
  }

  private tell(change: DraftChange): void {
    this.dispatchEvent(
      new CustomEvent<DraftChange>(DRAFT_CHANGE, { detail: change, bubbles: true, composed: true }),
    );
  }

  private onRole(index: number, event: CustomEvent<SelectChange>): void {
    const { value } = event.detail;
    if (this.draft !== undefined && isRole(value)) {
      this.tell({ columns: withRole(this.draft.columns, index, value) });
    }
  }

  private onSize(axis: keyof BlockSizeDraft, event: CustomEvent<InputChange>): void {
    if (this.draft !== undefined) {
      this.tell({ blockSize: { ...this.draft.blockSize, [axis]: event.detail.value } });
    }
  }

  /** The size of a block along each axis, for a block model. */
  private blockSize(size: BlockSizeDraft) {
    return html`
      <fieldset class="block-size">
        <legend>Size of a block, in the units of the coordinates</legend>
        <div class="sizes">
          ${(['x', 'y', 'z'] as const).map((axis) => {
            const text = size[axis];
            return html`<k-input
              label=${`Along ${axis.toUpperCase()}`}
              inputmode="decimal"
              reserve
              .value=${text}
              error=${
                text.trim() !== '' && parseSize(text) === undefined ? 'Enter a number above 0.' : ''
              }
              @k-input-change=${(event: CustomEvent<InputChange>) => {
                this.onSize(axis, event);
              }}
            ></k-input>`;
          })}
        </div>
      </fieldset>
    `;
  }

  private head(
    source: string,
    role: Role,
    suggested: boolean,
    index: number,
    options: readonly SelectOption[],
  ) {
    return html`
      <th scope="col" data-role=${role} ?data-selected=${this.selected === index}>
        <div class="head">
          <button
            type="button"
            class="column-name"
            data-truncate
            title=${source}
            aria-pressed=${this.selected === index ? 'true' : 'false'}
            @click=${() => {
              this.selected = index;
            }}
          >
            ${source}
          </button>
          ${suggested ? html`<span class="suggested">suggested</span>` : nothing}
        </div>
        <k-select
          size="28"
          hide-label
          label=${`What the column "${source}" is for`}
          .options=${options}
          .value=${role}
          @k-select-change=${(event: CustomEvent<SelectChange>) => {
            this.onRole(index, event);
          }}
        ></k-select>
      </th>
    `;
  }

  private onType(index: number, event: CustomEvent<SelectChange>): void {
    const { value } = event.detail;
    if (this.draft !== undefined && (value === '' || isColumnType(value))) {
      this.tell({ columns: withType(this.draft.columns, index, value === '' ? undefined : value) });
    }
  }

  private onRename(index: number, event: CustomEvent<InputChange>): void {
    if (this.draft !== undefined) {
      this.tell({ columns: withRename(this.draft.columns, index, event.detail.value) });
    }
  }

  /** The type and the name of the column that was chosen, or what to do to choose one. */
  private details(draft: ImportDraft, detected: readonly ColumnType[]) {
    const index = this.selected;
    const column = index === undefined ? undefined : draft.columns[index];
    if (index === undefined || column === undefined) {
      return html`<div class="details">
        <span class="caption"
          >Choose the name of a column to set its type, or the name it gets in the dataset.</span
        >
      </div>`;
    }
    if (column.role === 'ignore') {
      return html`<div class="details">
        <span class="title" title=${column.source}>${column.source}</span>
        <span class="caption">is ignored, so there is nothing to set.</span>
      </div>`;
    }
    const sniffed = detected[index];
    // The types a role can be read as, and the one that was chosen if it has stopped being one.
    const types = TYPES_BY_ROLE[column.role];
    const offered =
      column.type === undefined || types.includes(column.type) ? types : [...types, column.type];
    const options: SelectOption[] = [
      { value: '', label: sniffed === undefined ? 'Auto' : `Auto (${TYPE_NAMES[sniffed]})` },
      ...offered.map((type) => ({ value: type, label: TYPE_NAMES[type] })),
    ];
    return html`<div class="details">
      <span class="title" title=${column.source}>${column.source}</span>
      <span class="caption" aria-hidden="true">Type</span>
      <k-select
        size="28"
        hide-label
        label=${`Type of the column "${column.source}"`}
        .options=${options}
        .value=${column.type ?? ''}
        @k-select-change=${(event: CustomEvent<SelectChange>) => {
          this.onType(index, event);
        }}
      ></k-select>
      ${
        column.role === 'attribute'
          ? html`<span class="caption" aria-hidden="true">Name</span>
              <k-input
                size="28"
                hide-label
                label=${`Name of the column "${column.source}" in the dataset`}
                placeholder=${column.source}
                .value=${column.rename}
                @k-input-change=${(event: CustomEvent<InputChange>) => {
                  this.onRename(index, event);
                }}
              ></k-input>`
          : nothing
      }
    </div>`;
  }

  override render() {
    const preview = this.entry?.preview;
    const table = preview?.table;
    const draft = this.draft;
    if (preview === undefined || draft === undefined) {
      return nothing;
    }
    if (table === undefined) {
      const note = preview.format === undefined ? '' : NO_COLUMNS_NOTE[preview.format];
      return html`<p class="note"><k-icon name="info" size="16"></k-icon><span>${note}</span></p>`;
    }
    const options = rolesFor(draft.kind).map((role) => ({ value: role, label: ROLE_NAMES[role] }));
    const rows = table.rows.slice(0, PREVIEW_ROWS);
    const total = table.estimatedRows;
    const kind = draft.kind;
    const problems = mappingProblems(kind, draft.columns, draft.blockSize);
    return html`
      <p>
        ${kind === undefined ? '' : REQUIREMENTS_NOTE[kind]} The roles the kernel suggests are
        filled in, and marked <span class="suggested">suggested</span> until you change them.
      </p>
      ${kind === 'blocks' ? this.blockSize(draft.blockSize) : nothing}
      <div class="viewport" data-scroll-region>
        <table style=${`--columns: ${String(draft.columns.length)}`}>
          <thead>
            <tr>
              ${draft.columns.map((column, index) =>
                this.head(column.source, column.role, column.suggested, index, options),
              )}
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (row) =>
                html`<tr>
                  ${draft.columns.map((column, index) => {
                    const cell = row[index] ?? '';
                    const type = table.columnTypes[index];
                    return html`<td
                      title=${cell}
                      data-role=${column.role}
                      ?data-numeric=${type === 'float' || type === 'int'}
                    >
                      ${cell}
                    </td>`;
                  })}
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${this.details(draft, table.columnTypes)}
      ${
        problems.length === 0
          ? nothing
          : html`<karmania-findings class="problems" .findings=${problems}></karmania-findings>`
      }
      <p class="count">
        ${
          rows.length >= total
            ? `All ${formatCount(rows.length)} ${rows.length === 1 ? 'row' : 'rows'}.`
            : `The first ${formatCount(rows.length)} of about ${formatCount(total)} rows.`
        }
      </p>
    `;
  }
}

customElements.define('karmania-mapping-step', KarmaniaMappingStep);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-mapping-step': KarmaniaMappingStep;
  }
}
