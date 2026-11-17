import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_NAME,
  MAX_FILE_NAME,
  defaultOptions,
  errorText,
  fileNameOf,
  pictureSize,
  problemText,
  problemsOf,
  progressText,
  sizeCaption,
  warningText,
  withCommas,
} from './export-options.js';

const SCREEN = { width: 1160, height: 648 };

describe('defaultOptions and pictureSize', () => {
  it('start as the map is on screen, at 96 dpi, with the legend, a name, and the custom size the screen’s', () => {
    expect(defaultOptions({ width: 1159.6, height: 648.2 })).toEqual({
      preset: 'screen',
      dpi: 96,
      custom: { width: 1160, height: 648 },
      legend: true,
      name: DEFAULT_FILE_NAME,
    });
  });

  it('give the size of the picture: the screen’s at dpi / 96, the paper’s at the dpi, or what was typed', () => {
    const state = defaultOptions(SCREEN);
    expect(pictureSize(state, SCREEN)).toEqual(SCREEN);
    expect(pictureSize({ ...state, dpi: 300 }, SCREEN)).toEqual({ width: 3625, height: 2025 });
    expect(pictureSize({ ...state, preset: 'a4-landscape', dpi: 300 }, SCREEN)).toEqual({
      width: 3508,
      height: 2480,
    });
    expect(
      pictureSize(
        { ...state, preset: 'custom', custom: { width: 640, height: 480 }, dpi: 300 },
        SCREEN,
      ),
    ).toEqual({
      width: 640,
      height: 480,
    });
  });
});

describe('words', () => {
  it('writes numbers with thousands commas, and the caption of the preview as the brief has it', () => {
    expect(withCommas(3508)).toBe('3,508');
    expect(sizeCaption({ width: 3508, height: 2480 }, 300)).toBe('3,508 × 2,480 px · 300 dpi');
  });

  it('says what is wrong with a size, with the limit named and what to do about it', () => {
    expect(problemText({ code: 'too_large', side: 'width', most: 8192 })).toBe(
      'The width can be at most 8,192 pixels on this computer. Use a smaller size or a lower resolution.',
    );
    expect(problemText({ code: 'too_small', side: 'height', least: 64 })).toBe(
      'The height has to be at least 64 pixels.',
    );
    expect(problemText({ code: 'not_a_size' })).toMatch(/whole numbers/);
  });

  it('says what a layout warns of', () => {
    expect(warningText('map_narrow')).toMatch(/more than half/);
    expect(warningText('no_room_for_map')).toMatch(/no room for the map/);
  });

  it('finds the problems of a size against what the card allows, or against 8,192 when the card is not known', () => {
    expect(problemsOf({ width: 3508, height: 2480 }, undefined)).toEqual([]);
    expect(problemsOf({ width: 9000, height: 2480 }, undefined)).toEqual([
      { code: 'too_large', side: 'width', most: 8192 },
    ]);
    expect(
      problemsOf(
        { width: 5000, height: 2480 },
        { renderbuffer: 4096, texture: 16384, viewport: 16384 },
      ),
    ).toEqual([{ code: 'too_large', side: 'width', most: 4096 }]);
  });
});

describe('fileNameOf', () => {
  it('is what was typed when it is a name', () => {
    expect(fileNameOf('Geology of the north')).toBe('Geology of the north');
  });

  it('is the default for nothing, for spaces and for a name that is only a ".png"', () => {
    expect(fileNameOf('')).toBe(DEFAULT_FILE_NAME);
    expect(fileNameOf('   ')).toBe(DEFAULT_FILE_NAME);
    expect(fileNameOf('.png')).toBe(DEFAULT_FILE_NAME);
    expect(fileNameOf('...')).toBe(DEFAULT_FILE_NAME);
  });

  it('does not double a ".png" that was typed, in any case', () => {
    expect(fileNameOf('map.png')).toBe('map');
    expect(fileNameOf('map.PNG')).toBe('map');
    expect(fileNameOf('map.png.png')).toBe('map');
  });

  it('makes the characters that no system allows in a name into hyphens: path separators, drive marks, wildcards, quotes, control characters', () => {
    expect(fileNameOf('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(fileNameOf('line\nbreak')).toBe('line-break');
    // A path does not get out of the folder the browser saves in, and does not begin with a hyphen that a command line would take for an option.
    expect(fileNameOf('../../etc/passwd')).toBe('etc-passwd');
    expect(fileNameOf('-rf')).toBe('rf');
  });

  it('takes spaces and dots off the ends and keeps the ones inside', () => {
    expect(fileNameOf('  .map. v2 . ')).toBe('map. v2');
  });

  it('is at most 100 characters, with no space or dot left at the cut', () => {
    const long = fileNameOf(`${'a'.repeat(99)} bbbb`);
    expect(long.length).toBeLessThanOrEqual(MAX_FILE_NAME);
    expect(long.endsWith(' ')).toBe(false);
    expect(fileNameOf('x'.repeat(500))).toHaveLength(MAX_FILE_NAME);
  });
});

describe('errorText', () => {
  it('has words for each code an export can end with, that say what to do', () => {
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
    const texts = codes.map((code) => errorText({ name: 'ExportError', code }));
    expect(new Set(texts).size).toBe(codes.length);
    for (const text of texts) {
      expect(text.endsWith('.')).toBe(true);
      expect(text).not.toMatch(/undefined|null|_/);
    }
    expect(errorText({ name: 'ExportError', code: 'too_large' })).toMatch(
      /smaller size or a lower resolution/,
    );
    expect(errorText({ name: 'ComposeError', code: 'no_room_for_map' })).toBe(
      warningText('no_room_for_map'),
    );
  });

  it('says the font when the font did not load, and the plain failure for anything else, however odd', () => {
    expect(errorText({ name: 'ExportFontError' })).toMatch(/font/);
    expect(errorText(new Error('boom'))).toBe('The picture could not be made.');
    expect(errorText(undefined)).toBe('The picture could not be made.');
    expect(errorText('text')).toBe('The picture could not be made.');
  });
});

describe('progressText', () => {
  it('says "Rendering…" with a per cent for the picture and "Writing the file…" for the file, the split being 70 %', () => {
    expect(progressText(0)).toBe('Rendering… 0 %');
    expect(progressText(0.4 * 0.7)).toBe('Rendering… 28 %');
    expect(progressText(0.69)).toBe('Rendering… 69 %');
    expect(progressText(0.7)).toBe('Writing the file… 70 %');
    expect(progressText(1)).toBe('Writing the file… 100 %');
  });

  it('keeps to 0 and 100 per cent', () => {
    expect(progressText(-1)).toBe('Rendering… 0 %');
    expect(progressText(7)).toBe('Writing the file… 100 %');
  });
});
