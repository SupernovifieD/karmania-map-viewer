/**
 * What the map coordinate system dialog says would change if a system were chosen (section 10.5 of the brief): the datasets that would start
 * or stop being drawn, with the reasons. It is the difference between two answers of the engine's `previewFrame` (for the system the map is in
 * and for the one that is thought of), which keeps nothing, so asking changes nothing.
 */
import type { Engine, Summary } from '@karmania/engine';
import type { DrawableEntry, FrameChoice } from '@karmania/engine/display';
import type { CrsRef } from '@karmania/engine/types';
import { said, withoutNotDrawn } from './finding-text.js';

/** What would happen to a dataset. */
export type ChangeKind = 'starts' | 'stops';

/** A dataset that would start or stop being drawn, and why. */
export interface Change {
  readonly id: number;
  readonly name: string;
  readonly kind: ChangeKind;
  /** The reason it would stop (the finding the engine gives, with its hint), or what it would take to start: its positions converted, or none. */
  readonly reason: string;
}

/** Why a dataset that would start to be drawn can be: it is in the system, or it is converted to it. */
function startReason(entry: DrawableEntry): string {
  const notes = entry.findings.map((finding) => said(finding, '')).filter((text) => text !== '');
  const how = entry.reprojected
    ? 'Its coordinates would be converted to the new system.'
    : 'It is in that system.';
  return [how, ...notes].join(' ');
}

/**
 * The datasets whose being drawn is different in `after` from what it is in `before`, in the order they were loaded. `before` is what the
 * map is now (`undefined` if it has no system, when nothing is drawn). A dataset that is drawn in both, or in neither, is not a change.
 */
export function whatChanges(
  before: FrameChoice | undefined,
  after: FrameChoice,
  datasets: readonly Summary[],
): readonly Change[] {
  const was = new Map(
    (before?.drawable ?? []).map((entry) => [entry.id, entry.status === 'drawn']),
  );
  const names = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
  const changes: Change[] = [];
  for (const entry of after.drawable) {
    const drawnNow = entry.status === 'drawn';
    if ((was.get(entry.id) ?? false) === drawnNow) {
      continue;
    }
    changes.push({
      id: entry.id,
      name: names.get(entry.id) ?? `Dataset ${String(entry.id)}`,
      kind: drawnNow ? 'starts' : 'stops',
      reason: drawnNow
        ? startReason(entry)
        : withoutNotDrawn(said(entry.findings[0], 'It cannot be drawn in that coordinate system.')),
    });
  }
  return changes;
}

/** Where the working out of what would change is. */
export type PreviewStatus = 'idle' | 'working' | 'ready' | 'failed';

/**
 * Works out what would change for the system that is thought of, asking the engine as the thought changes: the latest asking wins, so an
 * answer that comes after a newer question is dropped. `changed` is called when the status or the changes are different.
 */
export class ChangesPreview {
  status: PreviewStatus = 'idle';
  changes: readonly Change[] = [];
  private asking = 0;

  constructor(private readonly changed: () => void) {}

  /**
   * Asks what choosing `choice` would change, from `current` (the system the map is in, or `undefined` if it has none). Nothing is asked for
   * no choice, or without an engine.
   */
  ask(
    engine: Pick<Engine, 'previewFrame'> | undefined,
    current: CrsRef | undefined,
    choice: CrsRef | undefined,
    datasets: readonly Summary[],
  ): void {
    const asking = ++this.asking;
    if (engine === undefined || choice === undefined) {
      this.set('idle', []);
      return;
    }
    this.set('working', []);
    Promise.all([
      current === undefined ? Promise.resolve(undefined) : engine.previewFrame(current),
      engine.previewFrame(choice),
    ]).then(
      ([before, after]) => {
        if (asking === this.asking) {
          this.set('ready', whatChanges(before, after, datasets));
        }
      },
      () => {
        if (asking === this.asking) {
          this.set('failed', []);
        }
      },
    );
  }

  /** Forgets what was worked out and what is being worked out. */
  reset(): void {
    this.asking += 1;
    this.set('idle', []);
  }

  private set(status: PreviewStatus, changes: readonly Change[]): void {
    this.status = status;
    this.changes = changes;
    this.changed();
  }
}
