import { html } from 'lit';

/** Opens the dialog that sits beside the button that was pressed. */
function openNeighbour(event: Event): void {
  const demo = (event.currentTarget as HTMLElement).parentElement;
  const dialog = demo?.querySelector('k-dialog');
  if (dialog) {
    dialog.open = true;
  }
}

const SENTENCE =
  'A paragraph of text that is long enough to take a few lines, so that the body of the dialog has something to fill and, when there is a lot of it, something to scroll.';

const NOTE =
  'Choose a column for X, and one for Y, before going on. A note that is a good deal longer than two lines of the room it has between the buttons is cut short.';

/** Dialogs: a short one with no steps, and a tall one that is too much for the window. */
export function dialogSection() {
  return html`
    <section data-section="dialog">
      <h2>Dialog</h2>
      <p>Each opens over the page when its button is pressed.</p>
      <div class="row">
        <div id="dialog-short" class="dialog-demo">
          <k-button @click=${openNeighbour}>Open a dialog</k-button>
          <k-dialog heading="Import data">
            <p>The body is a column of content, 24 from the edges of the dialog.</p>
            <k-button>A control in the body</k-button>
            <k-button slot="footer-start" variant="ghost">Cancel</k-button>
            <k-button slot="footer-end">Back</k-button>
            <k-button slot="footer-end" variant="primary">Next</k-button>
          </k-dialog>
        </div>
        <div id="dialog-note" class="dialog-demo">
          <k-button @click=${openNeighbour}>Open a dialog with a note</k-button>
          <k-dialog heading="Import data">
            <p>The note in the footer says why Next cannot be used.</p>
            <k-button slot="footer-start" variant="ghost">Cancel</k-button>
            <span slot="footer-note" title=${NOTE}>${NOTE}</span>
            <k-button slot="footer-end" disabled>Back</k-button>
            <k-button slot="footer-end" variant="primary" disabled>Next</k-button>
          </k-dialog>
        </div>
        <div id="dialog-long" class="dialog-demo">
          <k-button @click=${openNeighbour}>Open a dialog with a lot in it</k-button>
          <k-dialog
            heading="A title that is a good deal longer than the room that the dialog has for one"
          >
            <div slot="steps">Where the steps will be</div>
            ${Array.from(
              { length: 24 },
              (_, index) => html`<p>${String(index + 1)}. ${SENTENCE}</p>`,
            )}
            <k-button slot="footer-start" variant="ghost">Cancel</k-button>
            <k-button slot="footer-end" variant="primary">Load</k-button>
          </k-dialog>
        </div>
      </div>
    </section>
  `;
}
