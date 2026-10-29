import type { StepDefinition } from '@karmania/ui';
import { html } from 'lit';

/** The five steps of the import wizard. */
const WIZARD_STEPS: readonly StepDefinition[] = [
  { id: 'file', label: 'File' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'nodata', label: 'Nodata' },
  { id: 'crs', label: 'CRS' },
  { id: 'review', label: 'Review' },
];

/** Steps with more to say than they have room for. */
const LONG_STEPS: readonly StepDefinition[] = [
  { id: 'a', label: 'Choose the files to import' },
  { id: 'b', label: 'Say what each column is for' },
  { id: 'c', label: 'Check the result' },
];

/** The step indicator at each place in a sequence, in the width the wizard gives it, and cramped. */
export function stepsSection() {
  return html`
    <section data-section="steps">
      <h2>Steps</h2>
      <div class="steps-demo" id="steps-first">
        <k-steps label="Import steps" current="file" .steps=${WIZARD_STEPS}></k-steps>
      </div>
      <div class="steps-demo" id="steps-middle">
        <k-steps label="Import steps" current="nodata" .steps=${WIZARD_STEPS}></k-steps>
      </div>
      <div class="steps-demo" id="steps-last">
        <k-steps label="Import steps" current="review" .steps=${WIZARD_STEPS}></k-steps>
      </div>
      <h3>With more to say than there is room for</h3>
      <div class="steps-demo narrow" id="steps-crowded">
        <k-steps label="Import steps" current="b" .steps=${LONG_STEPS}></k-steps>
      </div>
    </section>
  `;
}
