import { css, html, LitElement } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { PropertyValues } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import './button.js';
import './tooltip.js';

/** The name of the event a dialog sends when a person closes it, with Esc or its close button. */
export const DIALOG_CLOSE = 'k-dialog-close';

/** What the keyboard can be put on: the controls a person would Tab to. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Whether `element`, or anything in it, can have the keyboard, looking inside the elements that have
 * a tree of their own as well (the controls of a form are often in one).
 */
function holdsFocusable(element: Element): boolean {
  if (element.matches(FOCUSABLE)) {
    return true;
  }
  const roots: ParentNode[] =
    element.shadowRoot === null ? [element] : [element, element.shadowRoot];
  return roots.some(
    (root) =>
      root.querySelector(FOCUSABLE) !== null ||
      [...root.querySelectorAll('*')].some(
        (inner) => inner.shadowRoot !== null && holdsFocusable(inner),
      ),
  );
}

/**
 * A modal dialog, centred in the window over a dimmed page:
 *
 * ```html
 * <k-dialog heading="Import data" open>
 *   <div slot="steps">...</div>
 *   The body, which scrolls when it is too tall.
 *   <k-button slot="footer-start" variant="ghost">Cancel</k-button>
 *   <k-button slot="footer-end" variant="primary">Next</k-button>
 * </k-dialog>
 * ```
 *
 * From the top: a header with the title and a close button; the `steps` slot, if anything is in
 * it; the body, which is the only part that scrolls; and a footer with `footer-start` on its left
 * and `footer-end` on its right, the primary action last. Between them `footer-note` has room for a
 * line or two of muted text, such as why the primary action cannot be used yet.
 *
 * It is a native `<dialog>` opened with `showModal()`, so the rest of the page is inert while it
 * is open, Tab stays inside it and Esc closes it, and, when it closes, the keyboard goes back to
 * the control that was focused before it opened. When it opens the keyboard is on the dialog
 * itself, which a screen reader announces by name, and the first Tab goes to its first control. It is open while `open` is set. When a person
 * closes it (Esc, or the close button), it sets `open` to false and sends `k-dialog-close`;
 * closing it by setting `open` sends nothing. Clicking outside it does not close it: what a
 * dialog holds is often work that would be lost. A body that scrolls and has nothing in it that the
 * keyboard can be put on (text only) is a stop for the keyboard itself, with the dialog's name, so
 * that it can be scrolled without a pointer; one that has controls in it is left as it is. A dialog is as tall as what is in it, up to its
 * limit; with `fill` it is as tall as it can be whatever is in it, which suits one whose content
 * changes (a wizard), since its buttons then stay where they are.
 */
export class KDialog extends LitElement {
  static override properties = {
    heading: { type: String },
    open: { type: Boolean, reflect: true },
    fill: { type: Boolean, reflect: true },
    hasSteps: { state: true },
    scrollsAlone: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      /* The dialog itself is what is drawn, in the top layer, so the element has no box. */
      :host {
        display: contents;
      }

      dialog {
        background: var(--k-surface);
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-lg);
        color: var(--k-text);
        flex-direction: column;
        font-size: var(--k-font-size-body);
        line-height: var(--k-line-height-body);
        margin: auto;
        max-height: min(var(--k-dialog-max-size), calc(100dvh - var(--k-space-48)));
        max-width: none;
        overflow: hidden;
        padding: 0;
        width: min(var(--k-dialog-max-size), calc(100vw - var(--k-space-48)));
      }

      dialog[open] {
        display: flex;
      }

      /* As tall as a dialog gets, whatever is in it, so that the buttons stay where they are. */
      :host([fill]) dialog {
        height: min(var(--k-dialog-max-size), calc(100dvh - var(--k-space-48)));
      }

      /* The dialog itself has the keyboard when it opens, so that its name is read and no control
         is picked for the person. Nothing about it can be operated, so it shows no ring. */
      dialog:focus-visible {
        outline: none;
      }

      dialog::backdrop {
        background: color-mix(in srgb, var(--k-scrim) 40%, transparent);
      }

      /* The ring is drawn inside: the dialog clips what is outside it. */
      .body:focus-visible {
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      header {
        align-items: center;
        display: flex;
        flex: none;
        gap: var(--k-space-8);
        height: var(--k-dialog-header-height);
        justify-content: space-between;
        padding: 0 var(--k-space-24);
      }

      h2 {
        font-size: var(--k-font-size-dialog-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-dialog-title);
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .close {
        flex: none;
      }

      .steps {
        flex: none;
        padding: 0 var(--k-space-24) var(--k-space-16);
      }

      .steps:not(.filled) {
        display: none;
      }

      .body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden auto;
        padding: var(--k-space-24);
      }

      /* The border takes a pixel at the top; the same below keeps the buttons on the middle of
         the 64, on whole pixels. */
      footer {
        align-items: center;
        border-top: var(--k-border-width) solid var(--k-border);
        display: flex;
        flex: none;
        gap: var(--k-space-8);
        height: var(--k-dialog-footer-height);
        justify-content: space-between;
        padding: 0 var(--k-space-24) var(--k-border-width);
      }

      /* Room for a note between the buttons: at most two lines, cut with an ellipsis after that. */
      .note {
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        color: var(--k-text-muted);
        display: -webkit-box;
        flex: 1 1 auto;
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
        min-width: 0;
        overflow: hidden;
        padding: 0 var(--k-space-8);
      }

      .end {
        align-items: center;
        display: flex;
        gap: var(--k-space-8);
        margin-left: auto;
      }
    `,
  ];

  /** The dialog's title. */
  declare heading: string;
  /** Whether the dialog is open. */
  declare open: boolean;
  /** Whether it is as tall as it can be, instead of as tall as what is in it. */
  declare fill: boolean;
  /** Whether anything is in the `steps` slot. */
  declare private hasSteps: boolean;
  /** Whether the body scrolls and has nothing in it for the keyboard, so that it is a stop itself. */
  declare private scrollsAlone: boolean;
  private bodyObserver: ResizeObserver | undefined;
  private bodyCheck = 0;

  constructor() {
    super();
    this.heading = '';
    this.open = false;
    this.fill = false;
    this.hasSteps = false;
    this.scrollsAlone = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.bodyObserver?.disconnect();
    this.bodyObserver = undefined;
    cancelAnimationFrame(this.bodyCheck);
  }

  /** Looks again, at the next frame, at whether the body scrolls with nothing in it for the keyboard. */
  private readonly checkBody = (): void => {
    cancelAnimationFrame(this.bodyCheck);
    this.bodyCheck = requestAnimationFrame(() => {
      const body = this.renderRoot.querySelector<HTMLElement>('.body');
      if (body === null) {
        return;
      }
      const scrolls = body.scrollHeight > body.clientHeight + 1;
      // Only what is in the body counts: the controls in the footer are no help to someone who is
      // reading it.
      const inBody = body.querySelector('slot')?.assignedElements({ flatten: true }) ?? [];
      this.scrollsAlone = scrolls && !inBody.some(holdsFocusable);
    });
  };

  /** Watches the body, and what is in it, for a change in size, since either decides whether it scrolls. */
  private watchBody(): void {
    const body = this.renderRoot.querySelector<HTMLElement>('.body');
    if (body === null) {
      return;
    }
    this.bodyObserver ??= new ResizeObserver(this.checkBody);
    this.bodyObserver.disconnect();
    this.bodyObserver.observe(body);
    for (const element of this.children) {
      this.bodyObserver.observe(element);
    }
    this.checkBody();
  }

  private get dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('dialog');
  }

  protected override firstUpdated(): void {
    this.watchBody();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has('open')) {
      return;
    }
    const dialog = this.dialog;
    if (dialog === null) {
      return;
    }
    if (this.open && !dialog.open) {
      dialog.showModal();
      // The browser puts the keyboard on the first control, the close button, whose tooltip would
      // then open at once. The dialog itself takes it instead.
      dialog.focus({ preventScroll: true });
    } else if (!this.open && dialog.open) {
      dialog.close();
    }
  }

  /**
   * The dialog was closed. If a person did that, `open` is still set and the dialog is shut, and
   * they are told. The browser sends this a moment after the dialog closes, so one that arrives
   * after the dialog was opened again is the echo of an earlier close, and is not a person's.
   */
  private readonly onNativeClose = (): void => {
    if (this.open && this.dialog?.open === false) {
      this.open = false;
      this.dispatchEvent(new CustomEvent(DIALOG_CLOSE, { bubbles: true, composed: true }));
    }
  };

  private readonly onCloseButton = (): void => {
    this.dialog?.close();
  };

  private readonly onBodyChange = (): void => {
    this.watchBody();
  };

  private readonly onStepsChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    this.hasSteps = slot.assignedNodes().length > 0;
  };

  override render() {
    return html`
      <dialog aria-labelledby="title" tabindex="-1" @close=${this.onNativeClose}>
        <header>
          <h2 id="title" data-truncate>${this.heading}</h2>
          <k-tooltip text="Close" class="close">
            <k-button
              icon="x"
              label="Close"
              variant="ghost"
              @click=${this.onCloseButton}
            ></k-button>
          </k-tooltip>
        </header>
        <div class="steps ${this.hasSteps ? 'filled' : ''}">
          <slot name="steps" @slotchange=${this.onStepsChange}></slot>
        </div>
        <div
          class="body"
          data-scroll-region
          role=${ifDefined(this.scrollsAlone ? 'region' : undefined)}
          aria-labelledby=${ifDefined(this.scrollsAlone ? 'title' : undefined)}
          tabindex=${ifDefined(this.scrollsAlone ? '0' : undefined)}
        >
          <slot @slotchange=${this.onBodyChange}></slot>
        </div>
        <footer>
          <slot name="footer-start"></slot>
          <div class="note"><slot name="footer-note"></slot></div>
          <div class="end"><slot name="footer-end"></slot></div>
        </footer>
      </dialog>
    `;
  }
}

defineOnce('k-dialog', KDialog);

declare global {
  interface HTMLElementTagNameMap {
    'k-dialog': KDialog;
  }

  interface HTMLElementEventMap {
    [DIALOG_CLOSE]: CustomEvent;
  }
}
