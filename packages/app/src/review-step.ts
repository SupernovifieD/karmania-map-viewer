import type { Finding, Summary } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import './findings.js';
import { describeSize, KIND_ICONS } from './import-files.js';
import { groupFindings, PHASE_LABELS } from './import-run.js';
import type { RunState } from './import-run.js';

/** The name of the event the step sends when a person asks to stop the import. */
export const RUN_CANCEL = 'karmania-run-cancel';

/** The name of the event the step sends when a person asks to run the import again. */
export const RUN_AGAIN = 'karmania-run-again';

/** The words that say a person did not get a dataset. */
const FAILURE_FINDING = (message: string): Finding => ({
  code: 'engine.failed',
  severity: 'error',
  message: `The import could not be done: ${message}`,
  hint: 'Try again. If it keeps happening, reload the page.',
  count: 1,
  examples: [],
});

/**
 * The wizard's last step: the import runs while it is shown, with a bar that says how far it has got
 * and a button to stop it, and when it is done the step says what came of it. If it worked, what will
 * be loaded (each dataset, with how much is in it), then the warnings and notes about it. If it did
 * not, what nothing was loaded for: the errors, each with a link to the step that can fix it, and
 * the rest. Findings are in three groups, errors, warnings and notes, each finding once.
 */
export class KarmaniaReviewStep extends LitElement {
  static override properties = {
    run: { attribute: false },
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

      p,
      h3,
      h4 {
        margin: 0;
      }

      h3 {
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
      }

      h4 {
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        margin-bottom: var(--k-space-8);
      }

      .actions {
        display: flex;
        gap: var(--k-space-8);
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

      ul.datasets {
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-md);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .dataset {
        align-items: center;
        display: flex;
        gap: var(--k-space-8);
        min-width: 0;
        padding: var(--k-space-8) var(--k-space-12);
      }

      .dataset + .dataset {
        border-top: var(--k-border-width) solid var(--k-border);
      }

      .dataset k-icon {
        color: var(--k-text-muted);
        flex: none;
      }

      .dataset .name {
        flex: 1 1 auto;
        font-weight: var(--k-weight-medium);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dataset .size {
        color: var(--k-text-muted);
        flex: none;
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
      }

      .none {
        color: var(--k-text-muted);
      }
    `,
  ];

  /** What the import has come to. */
  declare run: RunState;

  constructor() {
    super();
    this.run = { status: 'idle' };
  }

  private ask(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  private datasets(summaries: readonly Summary[]) {
    return html`<ul class="datasets">
      ${summaries.map(
        (summary) =>
          html`<li class="dataset" data-dataset=${summary.name}>
            <k-icon name=${KIND_ICONS[summary.kind]} size="16"></k-icon>
            <span class="name" data-truncate title=${summary.name}>${summary.name}</span>
            <span class="size">${describeSize(summary)}</span>
          </li>`,
      )}
    </ul>`;
  }

  /** One group of findings, with how many there are: nothing if there are none. */
  private group(title: string, severity: string, findings: readonly Finding[], links: boolean) {
    return findings.length === 0
      ? nothing
      : html`<section class="group" data-severity=${severity}>
          <h4>${title} (${String(findings.length)})</h4>
          <karmania-findings .findings=${findings} ?stepLinks=${links}></karmania-findings>
        </section>`;
  }

  override render() {
    const run = this.run;
    switch (run.status) {
      case 'idle':
      case 'running': {
        const phase = run.status === 'running' ? run.phase : undefined;
        const fraction = run.status === 'running' ? run.fraction : undefined;
        return html`
          <k-progress
            label=${phase === undefined ? 'Starting' : PHASE_LABELS[phase]}
            .value=${fraction ?? Number.NaN}
          ></k-progress>
          <div class="actions">
            ${kButton({
              children: 'Cancel import',
              onClick: () => {
                this.ask(RUN_CANCEL);
              },
            })}
          </div>
        `;
      }
      case 'cancelled':
        return html`
          <p class="note">
            <k-icon name="info" size="16"></k-icon>
            <span>The import was cancelled. Nothing was loaded.</span>
          </p>
          <div class="actions">
            ${kButton({
              children: 'Import again',
              onClick: () => {
                this.ask(RUN_AGAIN);
              },
            })}
          </div>
        `;
      case 'failed':
        return html`
          <karmania-findings .findings=${[FAILURE_FINDING(run.message)]}></karmania-findings>
          <div class="actions">
            ${kButton({
              children: 'Try again',
              onClick: () => {
                this.ask(RUN_AGAIN);
              },
            })}
          </div>
        `;
      case 'blocked':
      case 'loaded': {
        const groups = groupFindings(run.findings);
        const loaded = run.status === 'loaded';
        return html`
          <h3 class="verdict">${loaded ? 'Ready to load' : 'Nothing was loaded'}</h3>
          ${loaded ? this.datasets(run.summaries) : nothing}
          ${this.group('Errors', 'error', groups.errors, true)}
          ${this.group('Warnings', 'warning', groups.warnings, true)}
          ${this.group('Notes', 'info', groups.notes, true)}
          ${
            loaded && run.findings.length === 0
              ? html`<p class="none">Nothing to warn about.</p>`
              : nothing
          }
        `;
      }
    }
  }
}

customElements.define('karmania-review-step', KarmaniaReviewStep);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-review-step': KarmaniaReviewStep;
  }

  interface HTMLElementEventMap {
    [RUN_CANCEL]: CustomEvent;
    [RUN_AGAIN]: CustomEvent;
  }
}
