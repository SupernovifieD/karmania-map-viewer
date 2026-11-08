import { sharedStyles } from '@karmania/ui';
import type { InputChange, SelectChange, SelectOption } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import './crs-matches.js';
import type { CrsPick } from './crs-matches.js';
import { CrsSearch } from './crs-search.js';
import { DRAFT_CHANGE } from './file-step.js';
import type { DraftChange } from './file-step.js';
import type { CrsInfo, Engine, Units } from '@karmania/engine';
import './findings.js';
import {
  crsOf,
  describeCrs,
  describeNamed,
  describeSource,
  epsgAfterTyping,
  epsgError,
  parseEpsg,
  summarizeCrs,
  UNIT_NAMES,
} from './import-crs.js';
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
 * units. The code is shown with its name, what kind of system it is and its unit, from the engine's
 * definitions of the EPSG codes (a code that is not in them says so). A line sums up what is chosen and
 * where it came from. A box takes a code or part of a name, and under the line, in a box of a fixed
 * height, are the (at most 20) systems that match it, to pick one: a code typed is chosen as it is typed,
 * and a name is chosen from the matches.
 */
export class KarmaniaCrsStep extends LitElement {
  static override properties = {
    entry: { attribute: false },
    draft: { attribute: false },
    engine: { attribute: false },
    names: { state: true },
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

      /* What is said can hold a file name, which has nowhere to break: it breaks anywhere, and the
         line is as wide as its room and no wider. */
      .found-text,
      .summary-text {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      /* With the matches of a name under it, what is chosen has room for two lines whatever it says, so
         that the box under it does not move when a long name is chosen: the name, the unit and where the
         code came from fit in two lines of the dialog's width (about 650 px) for every system of the
         registry (measured by the reviews of steps 12.F17 and 12.F21: all 6,184 do, in both wordings, at 646 and at
         631 px; the widest, EPSG 8206, is about 1,010 px on one line). Nothing is cut: a longer text,
         in a narrow window or in a registry with longer names, takes the lines it needs and moves the box. */
      .summary-text[data-two-lines] {
        min-height: 2lh;
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
  /** The engine whose definitions give the names of the codes; without it no name is shown. */
  declare engine: Engine | undefined;
  /** What the definitions say of the codes that have been asked about: the system, or `null` if the code is not in them. */
  declare names: ReadonlyMap<number, CrsInfo | null>;
  /** The codes the engine has been asked about, so that none is asked twice. */
  private readonly asked = new Set<number>();
  /** The search of the definitions, which a change of what it found draws the step again for. */
  private readonly finder = new CrsSearch(() => {
    this.requestUpdate();
  });

  constructor() {
    super();
    this.entry = undefined;
    this.draft = undefined;
    this.engine = undefined;
    this.names = new Map();
  }

  /** Asks the engine what a code means, once, and shows the answer when it comes. */
  private lookUp(code: number | undefined): void {
    const engine = this.engine;
    if (engine === undefined || code === undefined || this.asked.has(code)) {
      return;
    }
    this.asked.add(code);
    engine
      .crsInfo(code)
      .then((info) => {
        this.names = new Map(this.names).set(code, info ?? null);
      })
      // If the engine cannot say, no name is shown: the step is what it was without them.
      .catch(() => undefined);
  }

  protected override willUpdate(): void {
    const found = this.entry?.preview.crs?.crs;
    this.lookUp(found?.kind === 'epsg' ? found.code : undefined);
    if (this.draft?.crs.mode === 'epsg') {
      this.lookUp(parseEpsg(this.draft.crs.epsg));
      this.finder.search(this.engine, this.draft.crs.query);
    }
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
    const nameOf = (code: number | undefined): CrsInfo | null | undefined =>
      code === undefined ? undefined : this.names.get(code);
    const chosenCode = draft.crs.mode === 'epsg' ? parseEpsg(draft.crs.epsg) : undefined;
    const summaryInfo =
      draft.crs.mode === 'detected'
        ? nameOf(found?.crs.kind === 'epsg' ? found.crs.code : undefined)
        : nameOf(chosenCode);
    const chosen = summarizeCrs(draft.crs, found, sidecar, summaryInfo);
    // The same test as the sentence's: a mode with nothing usable in it (no code typed, a name not yet
    // picked) is no choice, whatever the mode.
    const unchosen = crsOf(draft.crs, found) === null;
    return html`
      <p>Say which coordinate system the coordinates in the file are in.</p>
      <p class="found">
        <k-icon name="info" size="16"></k-icon>
        <span class="found-text"
          >${
            found === undefined
              ? 'No coordinate system was found in or beside the file.'
              : `Found ${describeNamed(found.crs, nameOf(found.crs.kind === 'epsg' ? found.crs.code : undefined))}, from ${describeSource(found.source, sidecar)}.`
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
                label="EPSG code or name"
                placeholder="for example: 32640 or UTM zone 40"
                reserve
                .value=${draft.crs.query}
                error=${epsgError(draft.crs.query) ?? ''}
                help=${this.finder.help(draft.crs.query)}
                @k-input-change=${(event: CustomEvent<InputChange>) => {
                  const query = event.detail.value;
                  this.tell({
                    crs: { ...draft.crs, query, epsg: epsgAfterTyping(query, draft.crs.epsg) },
                  });
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
        <k-icon name=${unchosen ? 'circle-alert' : 'check'} size="16"></k-icon>
        <span class="summary-text" ?data-two-lines=${draft.crs.mode === 'epsg'}
          ><strong>Chosen:</strong> ${chosen}</span
        >
      </p>
      ${
        draft.crs.mode === 'epsg'
          ? html`<karmania-crs-matches
              .query=${draft.crs.query}
              .results=${this.finder.results}
              .failed=${this.finder.failed}
              .chosen=${chosenCode}
              @karmania-crs-pick=${(event: CustomEvent<CrsPick>) => {
                this.tell({ crs: { ...draft.crs, epsg: String(event.detail.code) } });
              }}
            ></karmania-crs-matches>`
          : nothing
      }
    `;
  }
}

customElements.define('karmania-crs-step', KarmaniaCrsStep);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-crs-step': KarmaniaCrsStep;
  }
}
