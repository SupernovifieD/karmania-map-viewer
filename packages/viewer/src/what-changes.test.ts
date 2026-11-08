import type { Summary } from '@karmania/engine';
import type { DrawableEntry, FrameChoice } from '@karmania/engine/display';
import type { CrsRef, Finding } from '@karmania/engine/types';
import { describe, expect, it, vi } from 'vitest';
import { ChangesPreview, whatChanges } from './what-changes.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };
const UTM41: CrsRef = { kind: 'epsg', code: 32641 };

const finding = (message: string, hint?: string): Finding => ({
  code: 'display.crs.not_convertible',
  severity: 'warning',
  message,
  ...(hint === undefined ? {} : { hint }),
  count: 1,
  examples: [],
});
const entry = (id: number, drawn: boolean, extra: Partial<DrawableEntry> = {}): DrawableEntry => ({
  id,
  status: drawn ? 'drawn' : 'not_drawn',
  reprojected: false,
  findings: [],
  ...extra,
});
const choice = (...drawable: DrawableEntry[]): FrameChoice => ({
  frame: { mapCrs: UTM40, origin: [0, 0, 0], source: 'user' },
  drawable,
  findings: [],
});
const datasets = [
  { id: 1, name: 'Wells' },
  { id: 2, name: 'Faults' },
  { id: 3, name: 'Grid' },
] as unknown as Summary[];

describe('what would change', () => {
  it('is a dataset that stops being drawn, with the engine’s reason and its hint', () => {
    const before = choice(entry(1, true), entry(2, true));
    const after = choice(
      entry(1, true),
      entry(2, false, {
        findings: [
          finding('Faults is in a local grid.', 'Change the map’s coordinate system to it.'),
        ],
      }),
    );
    expect(whatChanges(before, after, datasets)).toEqual([
      {
        id: 2,
        name: 'Faults',
        kind: 'stops',
        reason: 'Faults is in a local grid. Change the map’s coordinate system to it.',
      },
    ]);
  });

  it('leaves off the engine’s own "Not drawn: " from the reason, which "would stop being drawn" says', () => {
    const [change] = whatChanges(
      choice(entry(1, true)),
      choice(entry(1, false, { findings: [finding('Not drawn: Wells is a local grid.')] })),
      datasets,
    );
    expect(change?.reason).toBe('Wells is a local grid.');
  });

  it('is a dataset that starts being drawn, in the system or converted to it', () => {
    const before = choice(entry(1, false), entry(2, false), entry(3, false));
    const after = choice(
      entry(1, true),
      entry(2, true, { reprojected: true }),
      entry(3, true, { reprojected: true, findings: [finding('The grid is warped.')] }),
    );
    expect(
      whatChanges(before, after, datasets).map((change) => [
        change.name,
        change.kind,
        change.reason,
      ]),
    ).toEqual([
      ['Wells', 'starts', 'It is in that system.'],
      ['Faults', 'starts', 'Its coordinates would be converted to the new system.'],
      [
        'Grid',
        'starts',
        'Its coordinates would be converted to the new system. The grid is warped.',
      ],
    ]);
  });

  it('leaves out what is drawn in both and what is drawn in neither', () => {
    const before = choice(entry(1, true), entry(2, false));
    const after = choice(entry(1, true, { reprojected: true }), entry(2, false));
    expect(whatChanges(before, after, datasets)).toEqual([]);
  });

  it('has everything that would be drawn start, when the map has no system now', () => {
    const after = choice(entry(1, true), entry(2, false));
    expect(
      whatChanges(undefined, after, datasets).map((change) => [change.id, change.kind]),
    ).toEqual([[1, 'starts']]);
  });

  it('keeps the order the datasets were loaded in, and names one that is not listed by its number', () => {
    const before = choice(entry(1, true), entry(7, true));
    const after = choice(entry(1, false), entry(7, false));
    expect(whatChanges(before, after, datasets).map((change) => change.name)).toEqual([
      'Wells',
      'Dataset 7',
    ]);
  });

  it('says that a dataset cannot be drawn in the system when the engine gave no reason', () => {
    const [change] = whatChanges(choice(entry(1, true)), choice(entry(1, false)), datasets);
    expect(change?.reason).toBe('It cannot be drawn in that coordinate system.');
  });
});

/** An engine whose previews the test answers by hand, and counts. */
function control() {
  const asked: CrsRef[] = [];
  const waiting: { resolve: (value: FrameChoice) => void; reject: (error: Error) => void }[] = [];
  const engine = {
    previewFrame: (crs: CrsRef): Promise<FrameChoice> => {
      asked.push(crs);
      return new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
  };
  return { engine, asked, waiting };
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the working out of what would change', () => {
  it('asks for the system the map is in and the one that is thought of, and says what differs', async () => {
    const { engine, asked, waiting } = control();
    const changed = vi.fn();
    const preview = new ChangesPreview(changed);
    preview.ask(engine, UTM40, UTM41, datasets);
    expect(preview.status).toBe('working');
    expect(asked).toEqual([UTM40, UTM41]);
    waiting[0]?.resolve(choice(entry(1, true)));
    waiting[1]?.resolve(choice(entry(1, false)));
    await settle();
    expect(preview.status).toBe('ready');
    expect(preview.changes.map((change) => [change.name, change.kind])).toEqual([
      ['Wells', 'stops'],
    ]);
  });

  it('asks only for the choice when the map has no system now', async () => {
    const { engine, asked, waiting } = control();
    const preview = new ChangesPreview(vi.fn());
    preview.ask(engine, undefined, UTM41, datasets);
    expect(asked).toEqual([UTM41]);
    waiting[0]?.resolve(choice(entry(1, true)));
    await settle();
    expect(preview.changes.map((change) => change.kind)).toEqual(['starts']);
  });

  it('is idle, and asks nothing, with no choice or no engine', () => {
    const { engine, asked } = control();
    const preview = new ChangesPreview(vi.fn());
    preview.ask(engine, UTM40, undefined, datasets);
    expect(preview.status).toBe('idle');
    preview.ask(undefined, UTM40, UTM41, datasets);
    expect(preview.status).toBe('idle');
    expect(asked).toEqual([]);
  });

  it('lets the latest asking win, for an answer and for a failure', async () => {
    const { engine, waiting } = control();
    const preview = new ChangesPreview(vi.fn());
    preview.ask(engine, UTM40, UTM41, datasets);
    preview.ask(engine, UTM40, { kind: 'local', units: 'm' }, datasets);
    // The first question's answers come late: they are dropped, and so is its failure.
    waiting[0]?.resolve(choice(entry(1, true)));
    waiting[1]?.reject(new Error('late'));
    await settle();
    expect(preview.status).toBe('working');
    waiting[2]?.resolve(choice(entry(1, true)));
    waiting[3]?.resolve(choice(entry(1, false)));
    await settle();
    expect(preview.status).toBe('ready');
    expect(preview.changes.map((change) => change.kind)).toEqual(['stops']);
  });

  it('says it failed, with nothing to show, when the engine cannot say', async () => {
    const { engine, waiting } = control();
    const preview = new ChangesPreview(vi.fn());
    preview.ask(engine, UTM40, UTM41, datasets);
    waiting[0]?.reject(new Error('no'));
    await settle();
    expect(preview.status).toBe('failed');
    expect(preview.changes).toEqual([]);
  });

  it('forgets what it knew on reset, and ignores what was being asked', async () => {
    const { engine, waiting } = control();
    const preview = new ChangesPreview(vi.fn());
    preview.ask(engine, UTM40, UTM41, datasets);
    preview.reset();
    waiting[0]?.resolve(choice(entry(1, true)));
    waiting[1]?.resolve(choice(entry(1, false)));
    await settle();
    expect(preview.status).toBe('idle');
    expect(preview.changes).toEqual([]);
  });
});
