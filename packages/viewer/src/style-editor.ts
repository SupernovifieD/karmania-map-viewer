import type { ClassColour, LayerContours, StylePatch } from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import type { CheckboxChange, SelectChange } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import {
  CONTOUR_FIELDS,
  SWATCHES,
  classCountChoice,
  classCountOptions,
  classesWith,
  colourByOptions,
  colourByValue,
  colourFor,
  colourFromText,
  contourColumnOptions,
  contourColumnValue,
  contourFromText,
  contourText,
  contoursProblem,
  contoursWith,
  contoursWithColumn,
  methodChoice,
  methodOptions,
  numberFields,
  numberFromText,
  numberOf,
  numberPatch,
  numberStep,
  numberTaken,
  numberText,
  rampOptions,
} from './legend-style.js';
import type {
  ContourKey,
  ContoursInfo,
  NumberField,
  NumberKey,
  StyleInfo,
} from './legend-style.js';
import './ramp-select.js';
import type { RampChange } from './ramp-select.js';

/** The name of the event the editor sends when a person changes the style of the layer it is for. */
export const STYLE_CHANGE = 'karmania-style-change';

/** What the editor sends: the parts of the style to change (`setStyle`'s patch). */
export interface StyleChange {
  readonly patch: StylePatch;
}

/** The name of the event the editor sends when a person changes the contours of the layer it is for. */
export const CONTOURS_CHANGE = 'karmania-contours-change';

/**
 * What the editor sends about contours: that they are to be turned on (the settings they start with are the engine's to say, so the viewer asks for them),
 * or the settings they are to have (the whole of them, `setContours`'s).
 */
export type ContoursChange =
  { readonly kind: 'turn-on' } | { readonly kind: 'set'; readonly contours: LayerContours };

/**
 * The fields of the style of one layer, stacked, a label above each and 12 between them, each the whole width (section 10.3 of the brief): **Colour by** (a
 * single colour, or a column of the dataset) and, for a single colour, a row of twelve swatches and a field for the hex code, and, for a column, **Method**,
 * **Classes**, **Ramp** (a picker whose choices are drawn) and **Reverse ramp**. It shows the style it is given (`info`) and says what a person changed
 * (`karmania-style-change`, with a patch); it does not change the scene. Then, for every layer, **Opacity** and, for points, **Point size** or, for lines,
 * **Line width**, which are fields of numbers: the number is taken when Enter is pressed or the field is left, or at once with the up and down arrows (a step
 * of 1, of 10 with Shift); a text that is not a number, or is outside what the scene accepts, is said so with the range and the style is left as it is; and
 * Escape puts back the number the layer has.
 *
 * The swatches are two rows of six targets of 24, a group of radio buttons with one stop for Tab (the one that is chosen, or the first), moved by the arrow keys, which choose as they go. The
 * hex code is taken when Enter is pressed or the field is left: six digits or three, with or without the `#`; text that is not a colour is said not to be one,
 * and the style is left as it is. Escape puts back the colour the layer has.
 */
export class KarmaniaStyleEditor extends LitElement {
  static override properties = {
    info: { attribute: false },
    hex: { state: true },
    hexError: { state: true },
    numbers: { state: true },
    numberErrors: { state: true },
    contourTexts: { state: true },
    contourErrors: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-12);
      }

      /* The contours of a layer: a group of fields like the others, under a caption. */
      .contours {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-12);
      }

      .contours .caption {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-caption);
        line-height: var(--k-line-height-caption);
        margin: var(--k-space-4) 0 0;
      }

      /* Why they were not made, or that they are being made: one line of words in the room of its own. */
      .contours .status {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
        margin: 0;
        overflow-wrap: anywhere;
      }

      .contours .status[role='alert'] {
        color: var(--k-danger);
      }

      .group-label {
        color: var(--k-text);
        display: block;
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        margin-bottom: var(--k-space-4);
      }

      /* The twelve swatches are two rows of six: each is a target of 24 by 24 (WCAG 2.2, 2.5.8) with its colour, 16 by 16, in the middle of it. A row of twelve cannot have
         targets of 24 in the width of the panel. */
      .swatches {
        display: grid;
        grid-template-columns: repeat(6, var(--k-space-24));
        /* The colours are 4 in from their targets, and are to start where the labels and the fields do. */
        margin-left: calc(var(--k-space-4) * -1);
      }

      .swatch {
        align-items: center;
        background: none;
        border: 0;
        box-sizing: border-box;
        cursor: pointer;
        display: flex;
        height: var(--k-space-24);
        justify-content: center;
        padding: 0;
        width: var(--k-space-24);
      }

      .chip {
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-sm);
        box-sizing: border-box;
        height: var(--k-icon-size-sm);
        pointer-events: none;
        width: var(--k-icon-size-sm);
      }

      /* The colour that is chosen has a ring round it, which is not a matter of colour: two rings, the surface's and the accent's. */
      .swatch[aria-checked='true'] .chip {
        box-shadow:
          0 0 0 var(--k-focus-width) var(--k-surface),
          0 0 0 calc(var(--k-focus-width) * 2) var(--k-accent);
      }

      .swatch:focus-visible {
        outline: none;
      }

      .swatch:focus-visible .chip {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: calc(var(--k-focus-width) * 2 + var(--k-border-width));
      }
    `,
  ];

  /** The layer's style and what its dataset is, or `undefined` for none (nothing is drawn). */
  declare info: StyleInfo | undefined;
  /** What is in the hex field, which is what a person typed until the colour is taken. */
  declare private hex: string;
  /** What is wrong with the text in the field, in words. */
  declare private hexError: string;
  /** What is in each field of numbers, which is what a person typed until the number is taken. */
  declare private numbers: Partial<Record<NumberKey, string>>;
  /** What is wrong with the text in each field of numbers, in words. */
  declare private numberErrors: Partial<Record<NumberKey, string>>;
  /** What is in each field of the settings of contours, which is what a person typed until the number is taken. */
  declare private contourTexts: Partial<Record<ContourKey, string>>;
  /** What is wrong with the text in each of those fields, in words. */
  declare private contourErrors: Partial<Record<ContourKey, string>>;

  constructor() {
    super();
    this.info = undefined;
    this.hex = '';
    this.hexError = '';
    this.numbers = {};
    this.numberErrors = {};
    this.contourTexts = {};
    this.contourErrors = {};
  }

  /** The field shows the colour the layer has, again, whenever that changes. */
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('info')) {
      const colour = this.info?.style.colour;
      if (colour?.mode === 'single') {
        const before = changed.get('info')?.style.colour;
        if (before?.mode !== 'single' || before.value !== colour.value) {
          this.hex = colour.value;
          this.hexError = '';
        }
      }
      this.showNumbers(changed.get('info'));
      this.showContours(changed.get('info'));
    }
  }

  /** Each field of the settings of contours shows the number the layer has, again, whenever that changes. */
  private showContours(before: StyleInfo | undefined): void {
    const settings = this.info?.contours?.settings;
    if (settings === undefined) {
      return;
    }
    for (const field of CONTOUR_FIELDS) {
      const text = contourText(field.key, settings);
      const was = before?.contours?.settings;
      if (was === undefined || contourText(field.key, was) !== text) {
        this.contourTexts = { ...this.contourTexts, [field.key]: text };
        this.contourErrors = { ...this.contourErrors, [field.key]: '' };
      }
    }
  }

  private changeContours(change: ContoursChange): void {
    this.dispatchEvent(
      new CustomEvent<ContoursChange>(CONTOURS_CHANGE, {
        detail: change,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Takes the number that is typed in a field of the settings of contours, if it is one: the settings change if it is not the number they have. */
  private commitContour(key: ContourKey): void {
    const settings = this.info?.contours?.settings;
    if (settings === undefined) {
      return;
    }
    const typed = contourFromText(key, this.contourTexts[key] ?? '');
    if ('error' in typed) {
      this.contourErrors = { ...this.contourErrors, [key]: typed.error };
      return;
    }
    this.contourTexts = { ...this.contourTexts, [key]: String(typed.value) };
    this.contourErrors = { ...this.contourErrors, [key]: '' };
    const next = contoursWith(settings, key, typed.value);
    if (next !== undefined) {
      this.changeContours({ kind: 'set', contours: next });
    }
  }

  /** Enter takes the number, and Escape puts back the number the layer has. */
  private onContourKey(event: KeyboardEvent, key: ContourKey): void {
    const settings = this.info?.contours?.settings;
    if (settings === undefined || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitContour(key);
    } else if (event.key === 'Escape') {
      this.contourTexts = { ...this.contourTexts, [key]: contourText(key, settings) };
      this.contourErrors = { ...this.contourErrors, [key]: '' };
    }
  }

  private contourInput(key: ContourKey, label: string, settings: LayerContours) {
    return html`
      <k-input
        label=${label}
        inputmode="decimal"
        reserve
        .value=${this.contourTexts[key] ?? contourText(key, settings)}
        .error=${this.contourErrors[key] ?? ''}
        @k-input-change=${(event: CustomEvent<{ value: string }>) => {
          this.contourTexts = { ...this.contourTexts, [key]: event.detail.value };
          this.contourErrors = { ...this.contourErrors, [key]: '' };
        }}
        @keydown=${(event: KeyboardEvent) => {
          this.onContourKey(event, key);
        }}
        @focusout=${() => {
          if (this.contourTexts[key] !== contourText(key, settings)) {
            this.commitContour(key);
          }
        }}
      ></k-input>
    `;
  }

  /**
   * The contours of a grid or a mesh: **Show contours**, and, once they are on, the column of a grid (its columns of numbers), the **Interval**, the **Base**
   * and **Index line every**, and a line that says that they are being made or why they were not.
   */
  private contoursSection(info: StyleInfo, contours: ContoursInfo) {
    const { settings, state } = contours;
    const problem = contoursProblem(state);
    return html`
      <div class="contours" role="group" aria-label="Contours">
        <p class="caption" aria-hidden="true">Contours</p>
        <k-checkbox
          .checked=${settings?.visible === true}
          @k-checkbox-change=${(event: CustomEvent<CheckboxChange>) => {
            if (settings === undefined) {
              this.changeContours({ kind: 'turn-on' });
            } else if (settings.visible !== event.detail.checked) {
              this.changeContours({
                kind: 'set',
                contours: { ...settings, visible: event.detail.checked },
              });
            }
          }}
          >Show contours</k-checkbox
        >
        ${
          settings === undefined
            ? nothing
            : html`${
                info.kind === 'grid'
                  ? html`<k-select
                      label="Contour column"
                      .options=${contourColumnOptions(info.columns)}
                      .value=${contourColumnValue(settings, info.columns) ?? ''}
                      @k-select-change=${(event: CustomEvent<SelectChange>) => {
                        const next = contoursWithColumn(settings, event.detail.value, info.columns);
                        if (next !== undefined) {
                          this.changeContours({ kind: 'set', contours: next });
                        }
                      }}
                    ></k-select>`
                  : nothing
              }
              ${CONTOUR_FIELDS.map((field) => this.contourInput(field.key, field.label, settings))}`
        }
        ${
          state.status === 'making'
            ? html`<p class="status" role="status">Making the contour lines…</p>`
            : problem === undefined
              ? nothing
              : html`<p class="status" role="alert">${problem}</p>`
        }
      </div>
    `;
  }

  /** Each field of numbers shows the number the layer has, again, whenever that changes (and whatever the person was typing in it goes). */
  private showNumbers(before: StyleInfo | undefined): void {
    const info = this.info;
    if (info === undefined) {
      return;
    }
    for (const field of numberFields(info.kind)) {
      const text = numberText(field, info.style);
      if (before === undefined || numberText(field, before.style) !== text) {
        this.numbers = { ...this.numbers, [field.key]: text };
        this.numberErrors = { ...this.numberErrors, [field.key]: '' };
      }
    }
  }

  private change(patch: StylePatch): void {
    this.dispatchEvent(
      new CustomEvent<StyleChange>(STYLE_CHANGE, {
        detail: { patch },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private readonly onColourBy = (event: CustomEvent<SelectChange>): void => {
    const info = this.info;
    if (info === undefined) {
      return;
    }
    const colour = colourFor(event.detail.value, info.style.colour, info.columns);
    if (colour !== undefined) {
      this.change({ colour });
    }
  };

  /** Says what a person changed of the classes of the layer, if it changes anything. */
  private changeClasses(
    change: Partial<Pick<ClassColour, 'method' | 'classes' | 'ramp' | 'reverse'>>,
  ): void {
    const colour = this.info?.style.colour;
    if (colour?.mode !== 'classes') {
      return;
    }
    const next = classesWith(colour, change);
    if (next !== undefined) {
      this.change({ colour: next });
    }
  }

  private choose(colour: string): void {
    this.hex = colour;
    this.hexError = '';
    if (this.info?.style.colour.mode !== 'single' || this.info.style.colour.value !== colour) {
      this.change({ colour: { mode: 'single', value: colour } });
    }
  }

  /** Takes the colour that is typed, if it is one. */
  private commitHex(): void {
    const colour = colourFromText(this.hex);
    if (colour === undefined) {
      this.hexError = 'Use a colour such as #e69f00.';
      return;
    }
    this.choose(colour);
  }

  private onHexKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitHex();
    } else if (event.key === 'Escape') {
      const colour = this.info?.style.colour;
      this.hex = colour?.mode === 'single' ? colour.value : '';
      this.hexError = '';
    }
  }

  /** Takes the number that is typed in a field of numbers, if it is one: the style is changed if it is not the number the layer has, and the field shows the number. */
  private commitNumber(field: NumberField): void {
    const style = this.info?.style;
    if (style === undefined) {
      return;
    }
    const typed = numberFromText(field, this.numbers[field.key] ?? '');
    if ('error' in typed) {
      this.numberErrors = { ...this.numberErrors, [field.key]: typed.error };
      return;
    }
    // What the layer will have, which is not always what was typed (an opacity is kept to four decimals): the field shows that, and a number that is the layer's own is no change.
    const taken = numberTaken(field, typed.value);
    this.numbers = { ...this.numbers, [field.key]: String(taken) };
    this.numberErrors = { ...this.numberErrors, [field.key]: '' };
    if (numberOf(field, style) !== taken) {
      this.change(numberPatch(field, taken));
    }
  }

  /** Enter takes the number, Escape puts back the number the layer has, and the up and down arrows step it (by 10 with Shift) and take it at once. */
  private onNumberKey(event: KeyboardEvent, field: NumberField): void {
    const style = this.info?.style;
    if (style === undefined || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitNumber(field);
    } else if (event.key === 'Escape') {
      this.numbers = { ...this.numbers, [field.key]: numberText(field, style) };
      this.numberErrors = { ...this.numberErrors, [field.key]: '' };
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      // A step goes from what is typed, if that is a number, and from what the layer has if it is not.
      const typed = numberFromText(field, this.numbers[field.key] ?? '');
      const from = 'value' in typed ? typed.value : numberOf(field, style);
      const next = numberStep(field, from, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
      this.numbers = { ...this.numbers, [field.key]: String(next) };
      this.commitNumber(field);
    }
  }

  private numberInput(field: NumberField, style: StyleInfo['style']) {
    return html`
      <k-input
        label=${field.label}
        inputmode="decimal"
        reserve
        .value=${this.numbers[field.key] ?? numberText(field, style)}
        .error=${this.numberErrors[field.key] ?? ''}
        @k-input-change=${(event: CustomEvent<{ value: string }>) => {
          this.numbers = { ...this.numbers, [field.key]: event.detail.value };
          this.numberErrors = { ...this.numberErrors, [field.key]: '' };
        }}
        @keydown=${(event: KeyboardEvent) => {
          this.onNumberKey(event, field);
        }}
        @focusout=${() => {
          if (this.numbers[field.key] !== numberText(field, style)) {
            this.commitNumber(field);
          }
        }}
      ></k-input>
    `;
  }

  /** The swatches move with the arrows, one stop for Tab, and choose as they go. */
  private onSwatchKey(event: KeyboardEvent, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const last = SWATCHES.length - 1;
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const colour = target === undefined ? undefined : SWATCHES[target];
    if (colour !== undefined) {
      event.preventDefault();
      this.choose(colour);
      void this.updateComplete.then(() => {
        this.renderRoot.querySelectorAll<HTMLElement>('.swatch')[target ?? 0]?.focus();
      });
    }
  }

  private swatches(current: string) {
    const chosen = SWATCHES.indexOf(current);
    return html`
      <div>
        <span class="group-label" id="colour-label">Colour</span>
        <div class="swatches" role="radiogroup" aria-labelledby="colour-label">
          ${SWATCHES.map(
            (colour, index) => html`
              <button
                type="button"
                class="swatch"
                role="radio"
                aria-label=${colour}
                aria-checked=${index === chosen ? 'true' : 'false'}
                tabindex=${index === Math.max(chosen, 0) ? '0' : '-1'}
                @click=${() => {
                  this.choose(colour);
                }}
                @keydown=${(event: KeyboardEvent) => {
                  this.onSwatchKey(event, index);
                }}
              >
                <span class="chip" aria-hidden="true" style=${`background: ${colour}`}></span>
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  /** The fields of a layer that is coloured by the classes of a column. */
  private classes(info: StyleInfo, colour: ClassColour) {
    const column = info.columns.find((candidate) => candidate.name === colour.column);
    return html`
      <k-select
        label="Method"
        .options=${methodOptions(column)}
        .value=${colour.method}
        @k-select-change=${(event: CustomEvent<SelectChange>) => {
          const method = methodChoice(event.detail.value, column);
          if (method !== undefined) {
            this.changeClasses({ method });
          }
        }}
      ></k-select>
      <k-select
        label="Classes"
        .options=${classCountOptions(colour.classes)}
        .value=${String(colour.classes)}
        @k-select-change=${(event: CustomEvent<SelectChange>) => {
          const classes = classCountChoice(event.detail.value);
          if (classes !== undefined) {
            this.changeClasses({ classes });
          }
        }}
      ></k-select>
      <karmania-ramp-select
        label="Ramp"
        .options=${rampOptions()}
        .value=${colour.ramp}
        .reverse=${colour.reverse}
        @karmania-ramp-change=${(event: CustomEvent<RampChange>) => {
          this.changeClasses({ ramp: event.detail.id });
        }}
      ></karmania-ramp-select>
      <k-checkbox
        .checked=${colour.reverse}
        @k-checkbox-change=${(event: CustomEvent<CheckboxChange>) => {
          this.changeClasses({ reverse: event.detail.checked });
        }}
        >Reverse ramp</k-checkbox
      >
    `;
  }

  override render() {
    const info = this.info;
    if (info === undefined) {
      return nothing;
    }
    const colour = info.style.colour;
    return html`
      <div class="fields">
        <k-select
          label="Colour by"
          .options=${colourByOptions(info.columns)}
          .value=${colourByValue(colour)}
          @k-select-change=${this.onColourBy}
        ></k-select>
        ${
          colour.mode === 'single'
            ? html`${this.swatches(colour.value)}
                <k-input
                  label="Hex code"
                  reserve
                  .value=${this.hex}
                  .error=${this.hexError}
                  @k-input-change=${(event: CustomEvent<{ value: string }>) => {
                    this.hex = event.detail.value;
                    this.hexError = '';
                  }}
                  @keydown=${(event: KeyboardEvent) => {
                    this.onHexKey(event);
                  }}
                  @focusout=${() => {
                    if (this.hex !== colour.value) {
                      this.commitHex();
                    }
                  }}
                ></k-input>`
            : this.classes(info, colour)
        }
        ${numberFields(info.kind).map((field) => this.numberInput(field, info.style))}
        ${info.contours === undefined ? nothing : this.contoursSection(info, info.contours)}
      </div>
    `;
  }
}

customElements.define('karmania-style-editor', KarmaniaStyleEditor);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-style-editor': KarmaniaStyleEditor;
  }

  interface HTMLElementEventMap {
    [STYLE_CHANGE]: CustomEvent<StyleChange>;
    [CONTOURS_CHANGE]: CustomEvent<ContoursChange>;
  }
}
