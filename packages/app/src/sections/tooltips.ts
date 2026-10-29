import { kButton } from '@karmania/ui';
import { html } from 'lit';

/** Tooltips on buttons: the usual one, one that adds to the button's name, one beside its button, and one in a box that clips. */
export function tooltipsSection() {
  return html`
    <section data-section="tooltips">
      <h2>Tooltip</h2>
      <div class="row">
        <k-tooltip id="tip-icon" text="Collapse panel">
          ${kButton({ icon: 'chevrons-right', label: 'Collapse panel', variant: 'ghost' })}
        </k-tooltip>
        <k-tooltip id="tip-describes" text="Opens the import wizard">
          ${kButton({ icon: 'upload', children: 'Import' })}
        </k-tooltip>
        <k-tooltip
          id="tip-long"
          text="A tooltip with a good deal to say, which has to wrap onto several lines instead of running off the window"
        >
          ${kButton({ icon: 'info', label: 'More information', variant: 'ghost' })}
        </k-tooltip>
        <k-tooltip id="tip-below" text="Preferred below" placement="bottom">
          ${kButton({ icon: 'search', label: 'Search', variant: 'ghost' })}
        </k-tooltip>
      </div>
      <h3>Beside the control, over what is next to it</h3>
      <div class="row indented">
        <k-tooltip id="tip-left" text="Beside the control" placement="left">
          ${kButton({ icon: 'layers', label: 'Layers', variant: 'ghost' })}
        </k-tooltip>
      </div>
      <h3>In a box that hides what overflows it</h3>
      <div class="clipping-box" id="clipping-box">
        <k-tooltip id="tip-clipped" text="Not cut off by the box around it">
          ${kButton({ icon: 'x', label: 'Close', variant: 'ghost' })}
        </k-tooltip>
      </div>
    </section>
  `;
}
