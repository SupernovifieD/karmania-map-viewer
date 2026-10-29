import { sharedStyles } from '@karmania/ui';
import type { InputChange, SelectChange, SelectOption } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { DRAFT_CHANGE } from './file-step.js';
import type { DraftChange } from './file-step.js';
import type { Units } from '@karmania/engine';
import './findings.js';
import { describeCrs, describeSource, epsgError, summarizeCrs, UNIT_NAMES } from './import-crs.js';
import type { CrsMode } from './import-crs.js';
import type { ImportDraft } from './import-draft.js';
import type { FileEntry } from './import-files.js';

/** Whether some text, from a select say, is a way of choosing the coordinate system. */
function isMode(value: string): value is CrsMode {
  return value === 'detected' || value === 'epsg' || value === 'local';
}

const UNIT_OPTIONS: readonly SelectOption[] = (Object.entries(UNIT_NAMES) as [Units, string][]).map(
  ([value, label]) => ({ value, label }),
);

/**
 * The wizard's coordinate system step. It says which coordinate system was found in or beside the file,
 * and where it came from (the file's own `crs` member, a `.prj` file next to it, or the default of
 * GeoJSON), and a person chooses what the coordinates are in: what was found, an EPSG code that they
 * type, or a local grid, which is not tied to a place on the Earth (a mine grid) and has only its
 * units. The code is shown as it was given. There is no name, kind or unit beside it, because the
 * kernel has no list of coordinate systems to look it up in. A line at the end sums up what is chosen
 * and where it came from.
 */
export class KarmaniaCrsStep extends LitElement {
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

      .found {
        align-items: flex-start;
        display: flex;
        gap: var(--k-space-8);
      }

      .found k-icon {
        color: var(--k-info);
        flex: none;
        margin-top: var(--k-space-2);
      }

      .summary {
        align-items: flex-start;
        display: flex;
        gap: var(--k-space-8);
      }

      .summary k-icon {
        flex: none;
        margin-top: var(--k-space-2);
      }

      .summary strong {
        font-weight: var(--k-weight-medium);
      }

      /* The choice and what goes with it side by side, so that what goes with it appearing moves nothing. */
      .choice {
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
    const entry = this.entry;
    const draft = this.draft;
    if (entry === undefined || draft === undefined) {
      return nothing;
    }
    const { crs: found, findings } = entry.preview;
    const sidecar = entry.group.sidecars[0]?.name;
    const options: SelectOption[] = [
      ...(draft.crs.mode === undefined
        ? [{ value: '', label: 'Choose one…', disabled: true }]
        : []),
      ...(found === undefined
        ? []
        : [{ value: 'detected', label: `The one found: ${describeCrs(found.crs)}` }]),
      { value: 'epsg', label: 'An EPSG code' },
      { value: 'local', label: 'A local grid' },
    ];
    const about = findings.filter((finding) => finding.step === 'crs');
    return html`
      <p>Say which coordinate system the coordinates in the file are in.</p>
      <p class="found">
        <k-icon name="info" size="16"></k-icon>
        <span class="found-text"
          >${
            found === undefined
              ? 'No coordinate system was found in or beside the file.'
              : `Found ${describeCrs(found.crs)}, from ${describeSource(found.source, sidecar)}.`
          }</span
        >
      </p>
      ${
        about.length === 0
          ? nothing
          : html`<karmania-findings .findings=${about}></karmania-findings>`
      }
      <div class="choice">
        <k-select
          label="Coordinate system"
          reserve
          .options=${options}
          .value=${draft.crs.mode ?? ''}
          @k-select-change=${(event: CustomEvent<SelectChange>) => {
            const { value } = event.detail;
            if (isMode(value)) {
              this.tell({ crs: { ...draft.crs, mode: value } });
            }
          }}
        ></k-select>
        ${
          draft.crs.mode === 'epsg'
            ? html`<k-input
                label="EPSG code"
                inputmode="numeric"
                placeholder="for example: 32640"
                reserve
                .value=${draft.crs.epsg}
                error=${epsgError(draft.crs.epsg) ?? ''}
                @k-input-change=${(event: CustomEvent<InputChange>) => {
                  this.tell({ crs: { ...draft.crs, epsg: event.detail.value } });
                }}
              ></k-input>`
            : draft.crs.mode === 'local'
              ? html`<k-select
                  label="Units of the grid"
                  reserve
                  .options=${UNIT_OPTIONS}
                  .value=${draft.crs.units}
                  @k-select-change=${(event: CustomEvent<SelectChange>) => {
                    const { value } = event.detail;
                    if (value === 'm' || value === 'ft' || value === 'us_ft') {
                      this.tell({ crs: { ...draft.crs, units: value } });
                    }
                  }}
                ></k-select>`
              : nothing
        }
      </div>
      <p class="summary" role="status">
        <k-icon name=${draft.crs.mode === undefined ? 'circle-alert' : 'check'} size="16"></k-icon>
        <span class="summary-text"
          ><strong>Chosen:</strong> ${summarizeCrs(draft.crs, found, sidecar)}</span
        >
      </p>
    `;
  }
}

customElements.define('karmania-crs-step', KarmaniaCrsStep);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-crs-step': KarmaniaCrsStep;
  }
}
