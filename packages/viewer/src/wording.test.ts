/**
 * The words the viewer writes itself to a person (step 24.4g): why a layer is not on the map, what a coordinate system would change, and what the export says (its
 * warnings, its size problems, its failures, its progress), held to the rules that the findings of the engine are held to in `docs/validation-codes.md` and the registry
 * test of `karmania-core`: each is a sentence, and none uses a word a reader should not have to know. The words are the same lists as the Rust test's
 * (`NOT_PLAIN` and `NOT_PLAIN_WORDS`); a word added there is added here.
 *
 * The raw text that an engine fault carries (the layer's `failed` hint quotes what the program said) is not words of the viewer's: only what the viewer writes is read.
 */
import type { DrawableEntry, FrameChoice } from '@karmania/engine/display';
import type { CrsRef, Finding } from '@karmania/engine/types';
import type { Summary } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { errorText, problemText, progressText, warningText } from './export-options.js';
import { layerNotice } from './layer-notice.js';
import { whatChanges } from './what-changes.js';

/** Words a person should not have to know, as substrings (as `NOT_PLAIN` of `crates/karmania-core/src/codes.rs`). */
const NOT_PLAIN = ['NaN', 'delimiter', 'kernel', 'u32', 'i32', 'f64', 'WKT', 'projected system'];

/** Whole words, in any case (as `NOT_PLAIN_WORDS` of the same file). */
const NOT_PLAIN_WORDS = [
  'finite',
  'vertex',
  'vertices',
  'ring',
  'rings',
  'datum',
  'datums',
  'geocentric',
];

/** Fails for a text that is not a sentence or that uses a word a reader should not have to know. */
function plain(text: string | undefined): void {
  expect(text, 'a text').toBeTypeOf('string');
  const said = text ?? '';
  expect(said, `"${said}" begins with a capital letter or a name`).toMatch(/^[A-Z0-9“]/);
  expect(said, `"${said}" is a sentence`).toMatch(/[.…%)”]$/);
  for (const word of NOT_PLAIN) {
    expect(said, `"${said}" uses "${word}"`).not.toContain(word);
  }
  for (const word of said.split(/[^\p{L}\p{N}]+/u)) {
    expect(NOT_PLAIN_WORDS, `"${said}" uses "${word}"`).not.toContain(word.toLowerCase());
  }
}

describe('the words of the viewer for a layer that is not on the map', () => {
  it('has a plain message, and a plain hint where there is one, for each way a layer is not drawn', () => {
    const states = [
      { status: 'failed', message: 'the program’s own words' },
      { status: 'unsupported' },
      { status: 'not_drawn', findings: [] },
    ] as const;
    for (const state of states) {
      const notice = layerNotice(state);
      plain(notice?.message);
      expect(notice?.message.startsWith('Not drawn: '), notice?.message).toBe(true);
      if (notice?.hint !== undefined) {
        // The fixed words of the hint; the program's own are in quotation marks at its end and are not the viewer's.
        plain(notice.hint.replace(/ The program said: .*$/u, ''));
      }
    }
  });

  it('is what the engine says, with the opening that says it is not drawn, when it says why', () => {
    const finding: Finding = {
      code: 'display.blocks.other_crs',
      severity: 'warning',
      message: 'a block model is drawn only in the map’s own coordinate system.',
      hint: 'Change the map’s coordinate system to the one this dataset is in.',
      count: 1,
      examples: [],
    };
    const notice = layerNotice({ status: 'not_drawn', findings: [finding] });
    expect(notice?.message).toBe(`Not drawn: ${finding.message}`);
    plain(notice?.message);
    plain(notice?.hint);
  });
});

describe('the words of the dialog that says what a map coordinate system would change', () => {
  const UTM40: CrsRef = { kind: 'epsg', code: 32640 };
  const entry = (id: number, drawn: boolean, reprojected: boolean): DrawableEntry => ({
    id,
    status: drawn ? 'drawn' : 'not_drawn',
    reprojected,
    findings: [],
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

  it('gives a plain reason for a dataset that starts being drawn in the system, one that is converted to it, and one that stops without a reason of its own', () => {
    const changes = whatChanges(
      choice(entry(1, false, false), entry(2, false, false), entry(3, true, false)),
      choice(entry(1, true, false), entry(2, true, true), entry(3, false, false)),
      datasets,
    );
    expect(changes.map((change) => change.kind)).toEqual(['starts', 'starts', 'stops']);
    for (const change of changes) {
      plain(change.reason);
    }
  });
});

describe('the words of the export dialog', () => {
  it('has a plain sentence for each warning of the layout', () => {
    for (const warning of ['map_narrow', 'no_room_for_map', 'legend_too_tall'] as const) {
      plain(warningText(warning));
    }
  });

  it('has a plain sentence for each problem with a size', () => {
    plain(problemText({ code: 'not_a_size' }));
    plain(problemText({ code: 'too_small', side: 'width', least: 64 }));
    plain(problemText({ code: 'too_large', side: 'height', most: 8192 }));
  });

  it('has a plain sentence for each way an export ends without a file', () => {
    const codes = [
      'busy',
      'interrupted',
      'context_lost',
      'too_large',
      'point_size',
      'out_of_memory',
      'not_ready',
      'no_room_for_map',
    ];
    for (const code of codes) {
      plain(errorText({ code }));
    }
    plain(errorText({ name: 'ExportFontError' }));
    plain(errorText(new Error('anything else')));
    plain(errorText(undefined));
  });

  it('says how far the picture is in a plain status', () => {
    plain(progressText(0.4));
    plain(progressText(0.9));
  });
});
