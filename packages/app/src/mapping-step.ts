import { sharedStyles } from '@karmania/ui';
import type { InputChange, SelectChange, SelectOption } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
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
  withRole,
} from './import-mapping.js';
import type { BlockSizeDraft } from './import-mapping.js';
import './findings.js';
import { ROLES } from '@karmania/engine';
import type { Role } from '@karmania/engine';

/** How many rows of the file the table shows. */
export const PREVIEW_ROWS = 100;

/** Whether some text, from a select say, is the name of a role. */
function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value);
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

      .column-name {
        font-weight: var(--k-weight-medium);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

  constructor() {
    super();
    this.entry = undefined;
    this.draft = undefined;
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
      <th scope="col" data-role=${role}>
        <div class="head">
          <span class="column-name" data-truncate title=${source}>${source}</span>
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
