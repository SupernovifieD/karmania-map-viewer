import type { SelectOption } from '@karmania/ui';
import { html } from 'lit';

const KINDS: readonly SelectOption[] = [
  { value: 'points', label: 'Points' },
  { value: 'lines', label: 'Lines' },
  { value: 'blocks', label: 'Block model' },
  { value: 'mesh', label: 'Mesh', disabled: true },
];

const LONG_OPTIONS: readonly SelectOption[] = [
  { value: 'long', label: 'A choice with a good deal more to say than there is room for' },
  { value: 'short', label: 'Short' },
];

/** Selects and text inputs: at rest, with help, with an error, disabled, compact, and cramped. */
export function fieldsSection() {
  return html`
    <section data-section="fields">
      <h2>Select</h2>
      <div class="fields" id="fields-select">
        <div class="field-demo" id="select-default">
          <k-select label="Kind" value="points" .options=${KINDS}></k-select>
        </div>
        <div class="field-demo" id="select-help">
          <k-select
            label="Kind"
            value="lines"
            help="A CSV file can hold points, lines or blocks"
            .options=${KINDS}
          ></k-select>
        </div>
        <div class="field-demo" id="select-disabled">
          <k-select label="Kind" value="points" disabled .options=${KINDS}></k-select>
        </div>
        <div class="field-demo narrow-field" id="select-long">
          <k-select
            label="A label that is longer than its room"
            value="long"
            .options=${LONG_OPTIONS}
          ></k-select>
        </div>
        <div class="field-demo" id="select-compact">
          <k-select
            label="Role of the column Easting"
            hide-label
            size="28"
            value="lines"
            .options=${KINDS}
          ></k-select>
        </div>
      </div>
      <h2>Text input</h2>
      <div class="fields" id="fields-input">
        <div class="field-demo" id="input-default">
          <k-input label="Dataset name" value="Collars"></k-input>
        </div>
        <div class="field-demo" id="input-placeholder">
          <k-input label="Dataset name" placeholder="Name the dataset"></k-input>
        </div>
        <div class="field-demo" id="input-help">
          <k-input
            label="EPSG code"
            value="32640"
            inputmode="numeric"
            help="A whole number, such as 32640"
          ></k-input>
        </div>
        <div class="field-demo" id="input-error">
          <k-input
            label="EPSG code"
            value="3264x"
            inputmode="numeric"
            error="Enter a whole number, such as 32640"
          ></k-input>
        </div>
        <div class="field-demo" id="input-disabled">
          <k-input label="Dataset name" value="Collars" disabled></k-input>
        </div>
        <div class="field-demo" id="input-reserve">
          <k-input label="Dataset name" value="Collars" reserve></k-input>
        </div>
        <div class="field-demo narrow-field" id="input-long">
          <k-input
            label="A label that is longer than its room"
            value="A value that is a good deal longer than the room that the input has for it"
            error="A message that is longer than the room it has, so it wraps onto a second line"
          ></k-input>
        </div>
        <div class="field-demo" id="input-compact">
          <k-input label="Rename the column Easting" hide-label size="28" value="Easting"></k-input>
        </div>
      </div>
    </section>
  `;
}
