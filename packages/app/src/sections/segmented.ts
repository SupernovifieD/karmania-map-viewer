import type { SegmentedOption } from '@karmania/ui';
import { html } from 'lit';

const VIEWS: readonly SegmentedOption[] = [
  { value: '2d', label: '2D' },
  { value: '3d', label: '3D' },
];

const SPANS: readonly SegmentedOption[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** Segmented controls: two choices as the toolbar's view control has them, the other one chosen, three choices, and disabled. */
export function segmentedSection() {
  return html`
    <section data-section="segmented">
      <h2>Segmented control</h2>
      <div class="fields" id="segmented-demos">
        <div class="field-demo" id="segmented-default">
          <k-segmented label="View" value="2d" .options=${VIEWS}></k-segmented>
        </div>
        <div class="field-demo" id="segmented-second">
          <k-segmented label="View, the second chosen" value="3d" .options=${VIEWS}></k-segmented>
        </div>
        <div class="field-demo" id="segmented-three">
          <k-segmented label="Span" value="week" .options=${SPANS}></k-segmented>
        </div>
        <div class="field-demo" id="segmented-disabled">
          <k-segmented label="View, disabled" value="2d" disabled .options=${VIEWS}></k-segmented>
        </div>
      </div>
    </section>
  `;
}
