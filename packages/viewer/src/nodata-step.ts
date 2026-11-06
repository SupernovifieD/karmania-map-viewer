import { sharedStyles } from '@karmania/ui';
import type { CheckboxChange, InputChange, SelectChange, SelectOption } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { DRAFT_CHANGE } from './file-step.js';
import type { DraftChange } from './file-step.js';
import type { ImportDraft } from './import-draft.js';
import { formatCount, NO_NODATA_NOTE } from './import-files.js';
import type { FileEntry } from './import-files.js';
import {
  DECIMAL_NAMES,
  describeOther,
  EMPTY_COORDINATE_NAMES,
  numberLabel,
  tokenLabel,
  withNumber,
  withToken,
} from './import-nodata.js';
import type { EmptyCoordinates } from './import-nodata.js';
import type { DecimalSeparator } from '@karmania/engine';

const EMPTY_COORDINATE_OPTIONS: readonly SelectOption[] = (
  Object.entries(EMPTY_COORDINATE_NAMES) as [EmptyCoordinates, string][]
).map(([value, label]) => ({ value, label }));

const DECIMAL_OPTIONS: readonly SelectOption[] = (
  Object.entries(DECIMAL_NAMES) as [DecimalSeparator, string][]
).map(([value, label]) => ({ value, label }));

/** How often the preview had a value, for the end of its row. */
function seen(count: number): string {
  return `${formatCount(count)} in the preview`;
}

/**
 * The wizard's Nodata step: which words and numbers in the file mean that a value is missing. The
 * kernel's suggestions, with how often the preview had each, are ticked boxes that a person can
 * untick; other values can be typed. Under them, what to do with a row that has no coordinate, and how
 * the numbers in the file are written. A file with no columns has nothing of this to set, and says so.
 */
export class KarmaniaNodataStep extends LitElement {
  static override properties = {
    entry: { attribute: false },
    draft: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-16);
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

      .lists {
        display: grid;
        gap: var(--k-space-24);
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      section {
        min-width: 0;
      }

      h3 {
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        margin: 0 0 var(--k-space-4);
      }

      .none {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
      }

      .options {
        display: grid;
        gap: var(--k-space-16);
        grid-template-columns: repeat(2, minmax(0, 1fr));
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

  override render() {
    const preview = this.entry?.preview;
    const draft = this.draft;
    if (preview === undefined || draft === undefined) {
      return nothing;
    }
    if (preview.table === undefined) {
      const note = preview.format === undefined ? '' : NO_NODATA_NOTE[preview.format];
      return html`<p class="note"><k-icon name="info" size="16"></k-icon><span>${note}</span></p>`;
    }
    const { nodata } = draft;
    const read = describeOther(nodata.other);
    return html`
      <p>
        Some files write a word or a number where a value is missing. Tick the ones this file uses:
        they become empty values, and the ones found are counted in a warning.
      </p>
      <div class="lists">
        <section class="words">
          <h3>Words</h3>
          ${
            nodata.tokens.length === 0
              ? html`<p class="none">None found in the preview.</p>`
              : nodata.tokens.map(
                  (each, index) =>
                    html`<k-checkbox
                      .checked=${each.use}
                      detail=${seen(each.count)}
                      @k-checkbox-change=${(event: CustomEvent<CheckboxChange>) => {
                        this.tell({ nodata: withToken(nodata, index, event.detail.checked) });
                      }}
                      >${tokenLabel(each.token)}</k-checkbox
                    >`,
                )
          }
        </section>
        <section class="numbers">
          <h3>Numbers</h3>
          ${
            nodata.numbers.length === 0
              ? html`<p class="none">None found in the preview.</p>`
              : nodata.numbers.map(
                  (each, index) =>
                    html`<k-checkbox
                      .checked=${each.use}
                      detail=${seen(each.count)}
                      @k-checkbox-change=${(event: CustomEvent<CheckboxChange>) => {
                        this.tell({ nodata: withNumber(nodata, index, event.detail.checked) });
                      }}
                      >${numberLabel(each.value)}</k-checkbox
                    >`,
                )
          }
        </section>
      </div>
      <k-input
        label="Other values that mean no data"
        placeholder="for example: -1, none"
        reserve
        .value=${nodata.other}
        help=${
          read === ''
            ? 'Separate them with commas. Write numbers with a point. Words match whatever their case.'
            : read
        }
        @k-input-change=${(event: CustomEvent<InputChange>) => {
          this.tell({ nodata: { ...nodata, other: event.detail.value } });
        }}
      ></k-input>
      <div class="options">
        <k-select
          label="When a row has an empty coordinate"
          reserve
          .options=${EMPTY_COORDINATE_OPTIONS}
          .value=${draft.emptyCoordinates}
          help="A row that is skipped is counted in a warning."
          @k-select-change=${(event: CustomEvent<SelectChange>) => {
            const { value } = event.detail;
            if (value === 'error' || value === 'skip') {
              this.tell({ emptyCoordinates: value });
            }
          }}
        ></k-select>
        <k-select
          label="Numbers in the file are written with"
          reserve
          .options=${DECIMAL_OPTIONS}
          .value=${draft.decimalSeparator}
          help="Found from the file; change it if the numbers are read wrongly."
          @k-select-change=${(event: CustomEvent<SelectChange>) => {
            const { value } = event.detail;
            if (value === '.' || value === ',') {
              this.tell({ decimalSeparator: value });
            }
          }}
        ></k-select>
      </div>
    `;
  }
}

customElements.define('karmania-nodata-step', KarmaniaNodataStep);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-nodata-step': KarmaniaNodataStep;
  }
}
